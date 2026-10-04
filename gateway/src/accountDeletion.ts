import { ProjectDeletionWorker, SupabaseDeletionStorage, SupabaseProjectDeletionJobStore } from "./projectDeletion.ts";
import type { SupabaseDeletionHttpOptions } from "./projectDeletion.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
export type AccountDeletionPhase = "deleting" | "auth_ready" | "finalized";
export interface AccountDeletionState {
  job_id: string;
  user_id: string;
  inventory_sha256: string;
  phase: AccountDeletionPhase;
  projects: Array<{ project_id: string; action: "delete" | "retain"; project_job_id: string | null; phase: string; blockers: string[] }>;
  blockers: string[];
}
export interface AccountDeletionJobStore {
  get(jobId: string): Promise<AccountDeletionState>;
}
export interface AccountDeletionAuthAdmin { deleteUser(userId: string): Promise<void>; }
export class AccountDeletionProblem extends Error {
  readonly code: string;
  constructor(code: string) {
    super("Account deletion is incomplete. Retain its reviewed intent and inspect authoritative progress before taking another action.");
    this.name = "AccountDeletionProblem";
    this.code = code;
  }
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 100 && value.every(item => typeof item === "string" && item.length <= 300);
export function accountDeletionState(value: unknown, jobId: string): AccountDeletionState {
  if (!record(value) || !UUID.test(jobId) || value.job_id !== jobId || typeof value.user_id !== "string" || !UUID.test(value.user_id)
    || typeof value.inventory_sha256 !== "string" || !HASH.test(value.inventory_sha256)
    || !["deleting", "auth_ready", "finalized"].includes(String(value.phase)) || !strings(value.blockers)
    || !Array.isArray(value.projects) || value.projects.length > 10000) throw new AccountDeletionProblem("invalid_account_state");
  const seen = new Set<string>();
  const projects = value.projects.map(item => {
    if (!record(item) || typeof item.project_id !== "string" || !UUID.test(item.project_id) || seen.has(item.project_id)
      || !["delete", "retain"].includes(String(item.action)) || typeof item.phase !== "string" || !strings(item.blockers)
      || (item.action === "delete" ? typeof item.project_job_id !== "string" || !UUID.test(item.project_job_id) : item.project_job_id !== null)
      || !(item.action === "delete" ? ["pending", "deleting", "awaiting_backend_verification", "finalized"] : ["retained"]).includes(item.phase)) throw new AccountDeletionProblem("invalid_account_state");
    seen.add(item.project_id);
    return { project_id: item.project_id, action: item.action as "delete" | "retain", project_job_id: item.project_job_id as string | null, phase: item.phase, blockers: item.blockers };
  });
  return { job_id: jobId, user_id: value.user_id, inventory_sha256: value.inventory_sha256, phase: value.phase as AccountDeletionPhase, projects, blockers: value.blockers };
}

export function accountDeletionProgress(state: AccountDeletionState) {
  return { job_id: state.job_id, phase: state.phase,
    children_pending: state.projects.filter(item => item.action === "delete" && ["pending", "deleting"].includes(item.phase)).length,
    awaiting_backend_verification: state.projects.filter(item => item.phase === "awaiting_backend_verification").length,
    shared_blockers: state.projects.filter(item => item.action === "retain").reduce((count, item) => count + item.blockers.length, 0) };
}

/** Drains one approved project lifecycle; it cannot create intent,
 * manufacture a backing receipt, choose shared retention, or delete Auth. */
export class AccountDeletionWorker {
  readonly #running = new Set<string>();
  readonly jobs: AccountDeletionJobStore;
  readonly drainProject: (jobId: string) => Promise<unknown>;
  constructor(jobs: AccountDeletionJobStore, drainProject: (jobId: string) => Promise<unknown>) {
    this.jobs = jobs; this.drainProject = drainProject;
  }
  async runOnce(jobId: string): Promise<ReturnType<typeof accountDeletionProgress>> {
    if (!UUID.test(jobId) || this.#running.has(jobId)) throw new AccountDeletionProblem("account_job_busy");
    this.#running.add(jobId);
    try {
      const state = accountDeletionState(await this.jobs.get(jobId), jobId);
      if (state.phase !== "deleting") return accountDeletionProgress(state);
      const child = state.projects.find(item => item.action === "delete" && ["pending", "deleting"].includes(item.phase));
      if (child) await this.drainProject(child.project_job_id!);
      const after = accountDeletionState(await this.jobs.get(jobId), jobId);
      if (after.user_id !== state.user_id || after.inventory_sha256 !== state.inventory_sha256) throw new AccountDeletionProblem("account_intent_changed");
      return accountDeletionProgress(after);
    } finally { this.#running.delete(jobId); }
  }
}

/** Separately invoked only after the operator gate. A lost administrative reply
 * is resolved by a positive finalized receipt; it never triggers a second DELETE. */
export async function finalizeAccountAuth(jobs: AccountDeletionJobStore, auth: AccountDeletionAuthAdmin, jobId: string, reviewedInventorySha256: string) {
  if (!HASH.test(reviewedInventorySha256)) throw new AccountDeletionProblem("reviewed_intent_required");
  const before = accountDeletionState(await jobs.get(jobId), jobId);
  if (before.inventory_sha256 !== reviewedInventorySha256) throw new AccountDeletionProblem("account_intent_changed");
  if (before.phase === "finalized") return accountDeletionProgress(before);
  if (before.phase !== "auth_ready" || before.projects.some(item => item.blockers.length || item.action === "delete" && item.phase !== "finalized")) throw new AccountDeletionProblem("account_not_ready");
  try { await auth.deleteUser(before.user_id); } catch { /* Only a positive transactional receipt can resolve uncertainty. */ }
  const after = accountDeletionState(await jobs.get(jobId), jobId);
  if (after.user_id !== before.user_id || after.inventory_sha256 !== before.inventory_sha256 || after.phase !== "finalized") throw new AccountDeletionProblem("auth_outcome_unconfirmed");
  return accountDeletionProgress(after);
}

class AccountDeletionHttp {
  readonly origin: string;
  readonly key: string;
  readonly fetch: typeof fetch;
  readonly timeoutMs: number;
  constructor(options: SupabaseDeletionHttpOptions) {
    let url: URL; try { url = new URL(options.supabaseUrl); } catch { throw new AccountDeletionProblem("invalid_configuration"); }
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash || typeof options.serviceKey !== "string" || !options.serviceKey.trim() || options.serviceKey.length > 16384
      || /[\u0000-\u001f\u007f]/.test(options.serviceKey)) throw new AccountDeletionProblem("invalid_configuration");
    this.origin = url.origin; this.key = options.serviceKey; this.fetch = options.fetch ?? fetch; this.timeoutMs = options.timeoutMs ?? 5000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60000) throw new AccountDeletionProblem("invalid_bounds");
  }
  async request(path: string, method: "POST" | "DELETE", body: object, expectsJson = true): Promise<unknown> {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new AccountDeletionProblem("request_timeout")); }, this.timeoutMs); });
      return await Promise.race([timeout, (async () => {
        const response = await this.fetch(`${this.origin}/${path}`, { method, body: JSON.stringify(body), headers: { authorization: `Bearer ${this.key}`, apikey: this.key, "content-type": "application/json" }, signal: abort.signal, redirect: "error" });
        if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new AccountDeletionProblem("account_control_unavailable"); }
        if (!expectsJson) { await response.body?.cancel().catch(() => undefined); return undefined; }
        const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let length = 0;
        if (reader) for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          length += value.byteLength; if (length > 4194304) { await reader.cancel(); throw new AccountDeletionProblem("invalid_account_state"); }
          chunks.push(value);
        }
        return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
      })()]);
    } catch (reason) { if (reason instanceof AccountDeletionProblem) throw reason; throw new AccountDeletionProblem("account_control_unavailable"); }
    finally { if (timer) clearTimeout(timer); }
  }
}

export class SupabaseAccountDeletionJobStore implements AccountDeletionJobStore {
  readonly #http: AccountDeletionHttp;
  constructor(options: SupabaseDeletionHttpOptions) { this.#http = new AccountDeletionHttp(options); }
  async get(jobId: string) {
    if (!UUID.test(jobId)) throw new AccountDeletionProblem("invalid_account_state");
    return accountDeletionState(await this.#http.request("rest/v1/rpc/mobile_get_account_deletion_worker", "POST", { p_job_id: jobId }), jobId);
  }
  async list(afterJobId: string | null = null, limit = 50): Promise<Array<{ job_id: string; phase: AccountDeletionPhase }>> {
    if (afterJobId !== null && !UUID.test(afterJobId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new AccountDeletionProblem("invalid_bounds");
    const rows = await this.#http.request("rest/v1/rpc/mobile_list_account_deletion_work", "POST", { p_after_job_id: afterJobId, p_limit: limit });
    if (!Array.isArray(rows) || rows.length > limit || new Set(rows.map(item => item?.job_id)).size !== rows.length || rows.some(item => !record(item) || typeof item.job_id !== "string" || !UUID.test(item.job_id) || !["deleting", "auth_ready"].includes(String(item.phase)))) throw new AccountDeletionProblem("invalid_account_state");
    return rows as Array<{ job_id: string; phase: AccountDeletionPhase }>;
  }
}
export class SupabaseAccountDeletionAuthAdmin implements AccountDeletionAuthAdmin {
  readonly #http: AccountDeletionHttp;
  constructor(options: SupabaseDeletionHttpOptions) { this.#http = new AccountDeletionHttp(options); }
  async deleteUser(userId: string) {
    if (!UUID.test(userId)) throw new AccountDeletionProblem("invalid_account_state");
    await this.#http.request(`auth/v1/admin/users/${userId}`, "DELETE", { should_soft_delete: false }, false);
  }
}
export function createAccountDeletionWorker(options: SupabaseDeletionHttpOptions) {
  const jobs = new SupabaseAccountDeletionJobStore(options);
  const projectJobs = new SupabaseProjectDeletionJobStore(options);
  const projectWorker = new ProjectDeletionWorker({ jobs: projectJobs, storage: new SupabaseDeletionStorage(options) });
  return new AccountDeletionWorker(jobs, async jobId => {
    let lease = await projectJobs.claim(jobId);
    for (let batch = 0; batch < 1000; batch++) {
      const result = await projectWorker.runOnce(lease);
      if (result.phase !== "deleting") return result;
      lease = await projectJobs.assertLease(lease);
    }
    throw new AccountDeletionProblem("project_work_bound");
  });
}
