import { resolveMergeConflict, type RevisionAuthorization } from "./api";
import type { ProposalRecord } from "./types";

export type MergeRequest = Parameters<typeof resolveMergeConflict>[1];
type Request = MergeRequest;
type Snapshot = { pending: Request | null; busy: boolean; error: string };
const sessions = new Map<string, MergeResolutionSession>();

export class MergeResolutionSession {
  private state: Snapshot = { pending: null, busy: false, error: "" };
  private listeners = new Set<() => void>();
  private key: string;

  constructor(readonly projectRoot: string) {
    this.key = `openauthor:merge-resolution:${projectRoot}`;
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) {
        const pending = JSON.parse(raw) as Request;
        if (![pending.base, pending.head, pending.path, pending.provider, pending.requestId].every(value => typeof value === "string" && value.length > 0)) throw new Error("Invalid reconciliation journal");
        this.state = { ...this.state, pending, error: "A previous reconciliation needs recovery. Retry retrieves its saved result or resumes the same request." };
      }
    } catch {
      this.state.error = "Reconciliation recovery storage could not be read. Inspect Changes before starting another request.";
    }
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(changes: Partial<Snapshot>) {
    this.state = { ...this.state, ...changes };
    this.listeners.forEach(listener => listener());
  }

  async start(input: Request): Promise<ProposalRecord | null> {
    if (this.state.pending || this.state.busy) return null;
    const pending = { ...input, authorization: undefined, requestId: crypto.randomUUID() };
    try {
      localStorage.setItem(this.key, JSON.stringify(pending));
      this.publish({ pending });
    } catch {
      this.publish({ error: "Recovery storage is unavailable. Nothing was sent; free storage before retrying." });
      return null;
    }
    return this.retry();
  }

  approve = async (authorization: RevisionAuthorization): Promise<ProposalRecord | null> => {
    if (!this.state.pending || this.state.busy || this.state.pending.authorization || !authorization.fingerprint) return null;
    try {
      const pending = { ...this.state.pending, authorization };
      localStorage.setItem(this.key, JSON.stringify(pending));
      this.publish({ pending });
    } catch {
      this.publish({ error: "Context approval could not be saved for recovery. Nothing was sent; free storage and review again." });
      return null;
    }
    return this.retry();
  };

  reviewAgain = () => {
    if (!this.state.pending || this.state.busy) return;
    try {
      const pending = { ...this.state.pending, authorization: undefined, requestId: crypto.randomUUID() };
      localStorage.setItem(this.key, JSON.stringify(pending));
      this.publish({ pending, error: "" });
    } catch {
      this.publish({ error: "Could not save a fresh context review. The original request is retained; nothing was sent." });
    }
  };

  retry = async (): Promise<ProposalRecord | null> => {
    if (!this.state.pending?.authorization || this.state.busy) return null;
    this.publish({ busy: true, error: "" });
    try {
      return await resolveMergeConflict(this.projectRoot, this.state.pending!);
    } catch (error) {
      this.publish({ error: `Reconciliation failed: ${error instanceof Error ? error.message : String(error)}` });
      return null;
    } finally {
      this.publish({ busy: false });
    }
  };

  clear = () => {
    if (this.state.busy) return;
    try {
      localStorage.removeItem(this.key);
      this.publish({ pending: null, error: "" });
    } catch {
      this.publish({ error: "Could not clear the recovery request. Existing proposals remain in Changes." });
    }
  };
}

export function mergeResolutionSession(projectRoot: string): MergeResolutionSession {
  let session = sessions.get(projectRoot);
  if (!session) {
    session = new MergeResolutionSession(projectRoot);
    sessions.set(projectRoot, session);
  }
  return session;
}
