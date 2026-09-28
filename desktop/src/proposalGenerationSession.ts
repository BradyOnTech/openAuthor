import { draftProposal, generateProposal, listProposals } from "./api";
import type { ProposalRecord } from "./types";

export type GenerationInput = Parameters<typeof generateProposal>[1];
type Task = { input: GenerationInput; proposalId?: string; drafted?: boolean };
type Job = { id: string; tasks: Task[] };
type Snapshot = { job: Job | null; busy: boolean; stopRequested: boolean; error: string };
const sessions = new Map<string, ProposalGenerationSession>();

export class ProposalGenerationSession {
  private state: Snapshot = { job: null, busy: false, stopRequested: false, error: "" };
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
        this.state = { ...this.state, job, error: "A previous generation needs recovery. Retry resumes the remaining steps." };
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
    this.listeners.forEach(listener => listener());
  }
  private save(job: Job) {
    localStorage.setItem(this.key, JSON.stringify(job));
    this.publish({ job });
  }

  async start(inputs: GenerationInput[], existingProposalId?: string): Promise<ProposalRecord[] | null> {
    if (this.state.job || this.state.busy || !inputs.length) return null;
    if (existingProposalId && inputs.length !== 1) throw new Error("An existing Change Set needs a single draft request.");
    try {
      this.save({ id: crypto.randomUUID(), tasks: inputs.map(input => ({ input, proposalId: existingProposalId })) });
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
          const generated = await generateProposal(this.projectRoot, { ...task.input, requestId: `${job.id}:${index}:plan` });
          this.save({ ...job, tasks: job.tasks.map((row, i) => i === index ? { ...row, proposalId: generated.id } : row) });
        }
        if (this.state.stopRequested) return null;
        const plannedJob = this.state.job!;
        const planned = plannedJob.tasks[index];
        if (!planned.drafted) {
          await draftProposal(this.projectRoot, {
            proposalId: planned.proposalId!, provider: planned.input.provider, model: planned.input.model,
            requestId: `${plannedJob.id}:${index}:draft`,
          });
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
