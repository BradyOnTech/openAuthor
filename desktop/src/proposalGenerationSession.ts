import { draftProposal, generateProposal, listProposals, regenerateProposalHunk, type RevisionAuthorization } from "./api";
import type { ProposalRecord } from "./types";

export type GenerationInput = Parameters<typeof generateProposal>[1];
type HunkRequest = { id: string; feedback: string; authorization?: RevisionAuthorization };
type Task = { input: GenerationInput; proposalId?: string; drafted?: boolean; hunk?: HunkRequest; authorization?: RevisionAuthorization; draftRequestId?: string; planAuthorization?: RevisionAuthorization; planRequestId?: string };
type Job = { id: string; tasks: Task[] };
type ReviewTask = { index: number; proposalId: string; input: GenerationInput };
type Snapshot = { job: Job | null; busy: boolean; stopRequested: boolean; error: string; reviewTask: ReviewTask | null; planReviewTask: { index: number; input: GenerationInput } | null };
const sessions = new Map<string, ProposalGenerationSession>();

function reviewTask(job: Job | null): ReviewTask | null {
  const index = job?.tasks.findIndex(task => !task.drafted) ?? -1;
  const task = job?.tasks[index];
  return task?.proposalId && !task.hunk && !task.authorization ? { index, proposalId: task.proposalId, input: task.input } : null;
}
function planReviewTask(job: Job | null) {
  const index = job?.tasks.findIndex(task => !task.drafted) ?? -1;
  const task = job?.tasks[index];
  return task && !task.proposalId && !task.planAuthorization ? { index, input: task.input } : null;
}

export class ProposalGenerationSession {
  private state: Snapshot = { job: null, busy: false, stopRequested: false, error: "", reviewTask: null, planReviewTask: null };
  private listeners = new Set<() => void>();
  private key: string;

  constructor(readonly projectRoot: string, scope = "") {
    this.key = `openauthor:proposal-generation:${projectRoot}${scope ? `:${scope}` : ""}`;
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) {
        const job = JSON.parse(raw) as Job;
        if (typeof job.id !== "string" || !Array.isArray(job.tasks) || !job.tasks.length || job.tasks.some(task => !task.input?.sceneId || !task.input.instruction)) {
          throw new Error("Invalid generation journal");
        }
        this.state = { ...this.state, job, reviewTask: reviewTask(job), planReviewTask: planReviewTask(job), error: reviewTask(job) || planReviewTask(job) ? "" : "A previous generation needs recovery. Retry reuses the original request; a new context review starts a new request." };
      }
    } catch {
      this.state.error = "Generation recovery storage could not be read. Keep a copy of your instructions before closing.";
    }
  }

  getSnapshot = (): Snapshot => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(changes: Partial<Snapshot>) {
    this.state = { ...this.state, ...changes };
    this.state.reviewTask = reviewTask(this.state.job);
    this.state.planReviewTask = planReviewTask(this.state.job);
    this.listeners.forEach(listener => listener());
  }
  private save(job: Job) {
    localStorage.setItem(this.key, JSON.stringify(job));
    this.publish({ job });
  }

  approveDraft = async (index: number, authorization: RevisionAuthorization): Promise<ProposalRecord[] | null> => {
    if (this.state.busy || !this.state.job || this.state.reviewTask?.index !== index || !authorization.fingerprint) return null;
    try {
      this.save({ ...this.state.job, tasks: this.state.job.tasks.map((task, i) => i === index ? { ...task, authorization } : task) });
    } catch {
      this.publish({ error: "Context approval could not be saved for recovery. Nothing was sent; free storage and review again." });
      return null;
    }
    return this.retry();
  };

  approvePlan = async (index: number, authorization: RevisionAuthorization): Promise<ProposalRecord[] | null> => {
    if (this.state.busy || !this.state.job || this.state.planReviewTask?.index !== index || !authorization.fingerprint) return null;
    try {
      this.save({ ...this.state.job, tasks: this.state.job.tasks.map((task, i) => i === index ? { ...task, planAuthorization: authorization } : task) });
    } catch {
      this.publish({ error: "Context approval could not be saved for recovery. Nothing was sent; free storage and review again." });
      return null;
    }
    return this.retry();
  };

  reviewDraftAgain = () => {
    if (this.state.busy || !this.state.job) return;
    const index = this.state.job.tasks.findIndex(task => !task.drafted);
    const task = this.state.job.tasks[index];
    if (!task || task.hunk || (!task.authorization && !task.planAuthorization)) return;
    try {
      this.save({ ...this.state.job, tasks: this.state.job.tasks.map((row, i) => i === index
        ? task.proposalId ? { ...row, authorization: undefined, draftRequestId: crypto.randomUUID() }
          : { ...row, planAuthorization: undefined, planRequestId: crypto.randomUUID() } : row) });
      this.publish({ error: "" });
    } catch {
      this.publish({ error: "Could not save a fresh context review. The original request is retained; nothing was sent." });
    }
  };

  async start(inputs: GenerationInput[], existingProposalId?: string, hunk?: HunkRequest): Promise<ProposalRecord[] | null> {
    if (this.state.job || this.state.busy || !inputs.length) return null;
    if (existingProposalId && inputs.length !== 1) throw new Error("An existing Change Set needs a single draft request.");
    if (hunk && !existingProposalId) throw new Error("Hunk regeneration needs an existing Change Set.");
    try {
      this.save({ id: crypto.randomUUID(), tasks: inputs.map(input => ({ input, proposalId: existingProposalId, hunk })) });
    } catch {
      this.publish({ error: "Recovery storage is full or unavailable. Nothing was sent; keep your instructions and free storage before retrying." });
      return null;
    }
    return this.retry();
  }

  retry = async (): Promise<ProposalRecord[] | null> => {
    if (!this.state.job || this.state.busy) return null;
    this.publish({ busy: true, stopRequested: false, error: "" });
    try {
      for (let index = 0; index < this.state.job!.tasks.length; index += 1) {
        const job = this.state.job!;
        const task = job.tasks[index];
        if (!task.proposalId) {
          if (!task.planAuthorization) return null;
          const generated = await generateProposal(this.projectRoot, { ...task.input, authorization: task.planAuthorization, requestId: task.planRequestId ?? `${job.id}:${index}:plan` });
          this.save({ ...job, tasks: job.tasks.map((row, i) => i === index ? { ...row, proposalId: generated.id } : row) });
        }
        if (this.state.stopRequested) return null;
        const plannedJob = this.state.job!;
        const planned = plannedJob.tasks[index];
        if (!planned.drafted) {
          if (planned.hunk) {
            await regenerateProposalHunk(this.projectRoot, planned.proposalId!, planned.hunk.id, planned.input.provider, planned.input.model, planned.hunk.feedback, `${plannedJob.id}:${index}:hunk`, planned.hunk.authorization);
          } else {
            if (!planned.authorization) return null;
            await draftProposal(this.projectRoot, {
              proposalId: planned.proposalId!, provider: planned.input.provider, model: planned.input.model,
              requestId: planned.draftRequestId ?? `${plannedJob.id}:${index}:draft`,
              authorization: planned.authorization,
              reviewMode: planned.input.reviewMode,
            });
          }
          this.save({ ...plannedJob, tasks: plannedJob.tasks.map((row, i) => i === index ? { ...row, drafted: true } : row) });
        }
        if (this.state.stopRequested) return null;
      }
      const proposals = await listProposals(this.projectRoot);
      return this.state.job!.tasks.map(task => {
        const proposal = proposals.find(row => row.id === task.proposalId);
        if (!proposal) throw new Error("A completed Change Set could not be found. Inspect Changes before starting another request.");
        return proposal;
      });
    } catch (error) {
      this.publish({ error: `Generation failed: ${error instanceof Error ? error.message : String(error)}` });
      return null;
    } finally {
      this.publish({ busy: false, ...(this.state.stopRequested ? { error: "Stopped after the current step. Completed work is retained; Retry resumes what remains." } : {}) });
    }
  };

  stop = () => { if (this.state.busy) this.publish({ stopRequested: true }); };

  clear = () => {
    if (this.state.busy) return;
    try {
      localStorage.removeItem(this.key);
      this.publish({ job: null, stopRequested: false, error: "" });
    } catch {
      this.publish({ error: "Could not clear the recovery journal. Existing Change Sets remain available in Changes." });
    }
  };
}

export function proposalGenerationSession(projectRoot: string, scope = ""): ProposalGenerationSession {
  const key = JSON.stringify([projectRoot, scope]);
  let session = sessions.get(key);
  if (!session) {
    session = new ProposalGenerationSession(projectRoot, scope);
    sessions.set(key, session);
  }
  return session;
}
