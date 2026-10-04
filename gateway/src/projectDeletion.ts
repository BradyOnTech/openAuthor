const BUCKET = "mobile-encrypted-sync";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface ProjectDeletionIdentity {
  job_id: string;
  project_id: string;
  lease_token: string;
}

export interface ProjectDeletionLease extends ProjectDeletionIdentity {
  lease_expires_at: string;
  phase: "deleting" | "awaiting_backend_verification" | "finalized";
  pending_paths: string[];
}

/** Trusted database operations; every mutation compares the current lease token. */
export interface ProjectDeletionJobStore {
  assertLease(identity: ProjectDeletionIdentity, signal?: AbortSignal): Promise<ProjectDeletionLease>;
  renewLease(identity: ProjectDeletionIdentity, signal?: AbortSignal): Promise<ProjectDeletionLease>;
  prepareDeleteBatch(identity: ProjectDeletionIdentity, paths: string[], signal?: AbortSignal): Promise<ProjectDeletionLease>;
  acknowledgeBatch(identity: ProjectDeletionIdentity, paths: string[], signal?: AbortSignal): Promise<ProjectDeletionLease>;
  markStorageEmpty(identity: ProjectDeletionIdentity, signal?: AbortSignal): Promise<ProjectDeletionLease>;
}

export interface ProjectDeletionStorage {
  list(prefix: string, limit: number, offset: number, signal?: AbortSignal): Promise<unknown>;
  remove(paths: string[], signal?: AbortSignal): Promise<unknown>;
}

export class ProjectDeletionProblem extends Error {
  readonly code: string;
  constructor(code: string) {
    super("Encrypted-object deletion is incomplete. Retain the frozen job and review its current state before resuming.");
    this.code = code;
  }
}

function identity(value: ProjectDeletionIdentity): ProjectDeletionIdentity {
  if (!value || !UUID.test(value.job_id) || !UUID.test(value.project_id) || !UUID.test(value.lease_token)) throw new ProjectDeletionProblem("invalid_job");
  return { job_id: value.job_id, project_id: value.project_id, lease_token: value.lease_token };
}

function sameIdentity(left: ProjectDeletionIdentity, right: ProjectDeletionIdentity): boolean {
  return left.job_id === right.job_id && left.project_id === right.project_id && left.lease_token === right.lease_token;
}

function segment(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 255
    && value !== "." && value !== ".." && !/[\u0000-\u001f\u007f\\/%]/.test(value);
}

function scopedPath(path: unknown, projectId: string): path is string {
  const prefix = `projects/${projectId}/`;
  return typeof path === "string" && path.length <= 1024 && path.startsWith(prefix)
    && path.slice(prefix.length).split("/").every(segment);
}

function leaseState(value: ProjectDeletionLease, expected: ProjectDeletionIdentity, now: number): ProjectDeletionLease {
  if (!value || !sameIdentity(value, expected) || !Number.isFinite(Date.parse(value.lease_expires_at))
    || Date.parse(value.lease_expires_at) <= now || !["deleting", "awaiting_backend_verification", "finalized"].includes(value.phase)
    || !Array.isArray(value.pending_paths) || value.pending_paths.length > 100
    || !value.pending_paths.every(path => scopedPath(path, expected.project_id))
    || new Set(value.pending_paths).size !== value.pending_paths.length
    || (value.phase !== "deleting" && value.pending_paths.length > 0)) throw new ProjectDeletionProblem("lease_changed");
  return structuredClone(value);
}

function samePaths(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((path, index) => path === right[index]);
}

async function bounded<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(controller.signal),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new ProjectDeletionProblem("request_timeout")); }, timeoutMs); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

export interface ProjectDeletionWorkerOptions {
  jobs: ProjectDeletionJobStore;
  storage: ProjectDeletionStorage;
  operationTimeoutMs?: number;
  pageSize?: number;
  batchSize?: number;
  maxPages?: number;
  maxEntries?: number;
  maxDepth?: number;
  now?: () => number;
}

/** One durable batch per run; Storage emptiness never supplies a backing receipt. */
export class ProjectDeletionWorker {
  readonly #options: Required<ProjectDeletionWorkerOptions>;
  readonly #running = new Set<string>();

  constructor(options: ProjectDeletionWorkerOptions) {
    this.#options = { operationTimeoutMs: 5000, pageSize: 100, batchSize: 100, maxPages: 2000, maxEntries: 100000, maxDepth: 16, now: Date.now, ...options };
    for (const key of ["operationTimeoutMs", "pageSize", "batchSize", "maxPages", "maxEntries", "maxDepth"] as const) {
      if (!Number.isSafeInteger(this.#options[key]) || this.#options[key] < 1) throw new ProjectDeletionProblem("invalid_bounds");
    }
    if (this.#options.pageSize > 1000 || this.#options.batchSize > 100 || this.#options.operationTimeoutMs > 60000 || this.#options.maxPages > 100000 || this.#options.maxEntries > 1000000 || this.#options.maxDepth > 64) throw new ProjectDeletionProblem("invalid_bounds");
  }

  async #control(expected: ProjectDeletionIdentity, action: (signal: AbortSignal) => Promise<ProjectDeletionLease>): Promise<ProjectDeletionLease> {
    return leaseState(await bounded(action, this.#options.operationTimeoutMs), expected, this.#options.now());
  }

  async #renew(expected: ProjectDeletionIdentity, pending: string[]): Promise<ProjectDeletionLease> {
    const lease = await this.#control(expected, signal => this.#options.jobs.renewLease(expected, signal));
    if (lease.phase !== "deleting" || !samePaths(lease.pending_paths, pending)
      || Date.parse(lease.lease_expires_at) - this.#options.now() <= this.#options.operationTimeoutMs) throw new ProjectDeletionProblem("lease_changed");
    return lease;
  }

  async #inventory(expected: ProjectDeletionIdentity, pending: string[]): Promise<Set<string>> {
    const root = `projects/${expected.project_id}`;
    const folders = [{ path: root, depth: 0 }];
    const seen = new Set<string>();
    const objects = new Set<string>();
    let pages = 0;
    for (let index = 0; index < folders.length; index++) {
      const folder = folders[index]!;
      for (let offset = 0; ; offset += this.#options.pageSize) {
        if (++pages > this.#options.maxPages) throw new ProjectDeletionProblem("inventory_bound");
        await this.#renew(expected, pending);
        const rows = await bounded(signal => this.#options.storage.list(folder.path, this.#options.pageSize, offset, signal), this.#options.operationTimeoutMs);
        if (!Array.isArray(rows) || rows.length > this.#options.pageSize) throw new ProjectDeletionProblem("invalid_inventory");
        for (const row of rows) {
          if (!row || typeof row !== "object" || Array.isArray(row) || !segment(row.name)) throw new ProjectDeletionProblem("invalid_inventory");
          const path = `${folder.path}/${row.name}`;
          if (!scopedPath(path, expected.project_id) || seen.has(path) || seen.size >= this.#options.maxEntries) throw new ProjectDeletionProblem("invalid_inventory");
          seen.add(path);
          if (row.id === null && row.metadata === null) {
            if (folder.depth >= this.#options.maxDepth) throw new ProjectDeletionProblem("inventory_bound");
            folders.push({ path, depth: folder.depth + 1 });
          } else if (typeof row.id === "string" && row.id && row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)) {
            objects.add(path);
          } else throw new ProjectDeletionProblem("invalid_inventory");
        }
        if (rows.length < this.#options.pageSize) break;
      }
    }
    return objects;
  }

  async runOnce(supplied: ProjectDeletionLease): Promise<{ phase: ProjectDeletionLease["phase"]; acknowledged_paths: number }> {
    const expected = identity(supplied);
    if (this.#running.has(expected.job_id)) throw new ProjectDeletionProblem("job_busy");
    this.#running.add(expected.job_id);
    try {
      let lease = await this.#control(expected, signal => this.#options.jobs.assertLease(expected, signal));
      if (lease.phase !== "deleting") return { phase: lease.phase, acknowledged_paths: 0 };
      // Complete the stable offset traversal before deleting anything. A frozen
      // project's insertion/update fence is a required database precondition.
      const inventory = await this.#inventory(expected, lease.pending_paths);
      let pending = [...lease.pending_paths];
      if (pending.length === 0) {
        if (inventory.size === 0) {
          lease = await this.#control(expected, signal => this.#options.jobs.markStorageEmpty(expected, signal));
          if (lease.phase !== "awaiting_backend_verification") throw new ProjectDeletionProblem("lease_changed");
          return { phase: lease.phase, acknowledged_paths: 0 };
        }
        pending = [...inventory].sort().slice(0, this.#options.batchSize);
        lease = await this.#control(expected, signal => this.#options.jobs.prepareDeleteBatch(expected, pending, signal));
        if (lease.phase !== "deleting" || !samePaths(lease.pending_paths, pending)) throw new ProjectDeletionProblem("lease_changed");
      }
      const remaining = pending.filter(path => inventory.has(path));
      if (remaining.length > 0) {
        await this.#renew(expected, pending);
        // Even a successful DELETE response needs fresh absence readback. A
        // failure/lost response never causes a blind destructive retry.
        try { await bounded(signal => this.#options.storage.remove(remaining, signal), this.#options.operationTimeoutMs); } catch { /* Reconcile the persisted batch through readback below. */ }
        const after = await this.#inventory(expected, pending);
        if (pending.some(path => after.has(path))) throw new ProjectDeletionProblem("delete_unconfirmed");
      }
      lease = await this.#control(expected, signal => this.#options.jobs.acknowledgeBatch(expected, pending, signal));
      if (lease.phase !== "deleting" || lease.pending_paths.length > 0) throw new ProjectDeletionProblem("lease_changed");
      return { phase: lease.phase, acknowledged_paths: pending.length };
    } catch (error) {
      if (error instanceof ProjectDeletionProblem) throw error;
      throw new ProjectDeletionProblem("job_unavailable");
    } finally { this.#running.delete(expected.job_id); }
  }
}

export interface SupabaseDeletionHttpOptions {
  supabaseUrl: string;
  serviceKey: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

class DeletionHttpClient {
  readonly #url: string;
  readonly #key: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: SupabaseDeletionHttpOptions) {
    let url: URL;
    try { url = new URL(options.supabaseUrl); } catch { throw new ProjectDeletionProblem("invalid_storage_configuration"); }
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.pathname !== "/" || url.search || url.hash
      || typeof options.serviceKey !== "string" || !options.serviceKey.trim() || options.serviceKey.length > 16384 || /[\u0000-\u001f\u007f]/.test(options.serviceKey)) throw new ProjectDeletionProblem("invalid_storage_configuration");
    this.#url = url.origin;
    this.#key = options.serviceKey;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 5000;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1 || this.#timeoutMs > 60000) throw new ProjectDeletionProblem("invalid_bounds");
  }

  async request(path: string, method: string, body: object, signal?: AbortSignal): Promise<unknown> {
    try {
      const response = await this.#fetch(`${this.#url}/${path}`, {
        method, body: JSON.stringify(body), headers: { authorization: `Bearer ${this.#key}`, apikey: this.#key, "content-type": "application/json" },
        signal: AbortSignal.any([AbortSignal.timeout(this.#timeoutMs), ...(signal ? [signal] : [])]), redirect: "error",
      });
      if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new ProjectDeletionProblem("storage_unavailable"); }
      const reader = response.body?.getReader();
      let length = 0;
      const chunks: Uint8Array[] = [];
      if (reader) for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 1048576) { await reader.cancel().catch(() => undefined); throw new ProjectDeletionProblem("invalid_storage_response"); }
        chunks.push(value);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error) {
      if (error instanceof ProjectDeletionProblem) throw error;
      throw new ProjectDeletionProblem("storage_unavailable");
    }
  }
}

/** Exact Storage HTTP wire. The trusted service key remains process-local. */
export class SupabaseDeletionStorage implements ProjectDeletionStorage {
  readonly #http: DeletionHttpClient;
  constructor(options: SupabaseDeletionHttpOptions) { this.#http = new DeletionHttpClient(options); }

  async list(prefix: string, limit: number, offset: number, signal?: AbortSignal): Promise<unknown> {
    if (!prefix.startsWith("projects/") || !UUID.test(prefix.split("/")[1]!) || !prefix.split("/").every(segment) || prefix.length > 1024 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000 || !Number.isSafeInteger(offset) || offset < 0) throw new ProjectDeletionProblem("invalid_inventory");
    return this.#http.request(`storage/v1/object/list/${BUCKET}`, "POST", { prefix, limit, offset, sortBy: { column: "name", order: "asc" } }, signal);
  }

  async remove(paths: string[], signal?: AbortSignal): Promise<unknown> {
    const projectId = paths[0]?.split("/")[1] ?? "";
    if (!UUID.test(projectId) || paths.length < 1 || paths.length > 100 || new Set(paths).size !== paths.length || !paths.every(path => scopedPath(path, projectId))) throw new ProjectDeletionProblem("invalid_delete_batch");
    const result = await this.#http.request(`storage/v1/object/${BUCKET}`, "DELETE", { prefixes: paths }, signal);
    if (!Array.isArray(result) || result.length > paths.length || result.some(row => !row || typeof row !== "object" || Array.isArray(row) || !paths.includes(row.name)) || new Set(result.map(row => row.name)).size !== result.length) throw new ProjectDeletionProblem("invalid_storage_response");
    return result;
  }
}

export interface SupabaseProjectDeletionJobStoreOptions extends SupabaseDeletionHttpOptions {
  leaseSeconds?: number;
  now?: () => number;
}

/** Separate trusted worker RPCs. No owner request, backing receipt or finalizer. */
export class SupabaseProjectDeletionJobStore implements ProjectDeletionJobStore {
  readonly #http: DeletionHttpClient;
  readonly #leaseSeconds: number;
  readonly #now: () => number;

  constructor(options: SupabaseProjectDeletionJobStoreOptions) {
    this.#http = new DeletionHttpClient(options);
    this.#leaseSeconds = options.leaseSeconds ?? 60;
    this.#now = options.now ?? Date.now;
    if (!Number.isSafeInteger(this.#leaseSeconds) || this.#leaseSeconds < 15 || this.#leaseSeconds > 300) throw new ProjectDeletionProblem("invalid_bounds");
  }

  async claim(jobId: string, signal?: AbortSignal): Promise<ProjectDeletionLease> {
    if (!UUID.test(jobId)) throw new ProjectDeletionProblem("invalid_job");
    const value = await this.#http.request("rest/v1/rpc/mobile_claim_project_deletion", "POST", { p_job_id: jobId, p_lease_seconds: this.#leaseSeconds }, signal) as ProjectDeletionLease;
    if (!value || value.job_id !== jobId) throw new ProjectDeletionProblem("lease_changed");
    return leaseState(value, identity(value), this.#now());
  }

  async #rpc(name: string, supplied: ProjectDeletionIdentity, extra: object, signal?: AbortSignal): Promise<ProjectDeletionLease> {
    const expected = identity(supplied);
    const value = await this.#http.request(`rest/v1/rpc/${name}`, "POST", { p_job_id: expected.job_id, p_project_id: expected.project_id, p_lease_token: expected.lease_token, ...extra }, signal) as ProjectDeletionLease;
    return leaseState(value, expected, this.#now());
  }

  async assertLease(expected: ProjectDeletionIdentity, signal?: AbortSignal): Promise<ProjectDeletionLease> {
    return this.renewLease(expected, signal);
  }
  async renewLease(expected: ProjectDeletionIdentity, signal?: AbortSignal): Promise<ProjectDeletionLease> {
    return this.#rpc("mobile_renew_project_deletion_lease", expected, { p_lease_seconds: this.#leaseSeconds }, signal);
  }
  async prepareDeleteBatch(expected: ProjectDeletionIdentity, paths: string[], signal?: AbortSignal): Promise<ProjectDeletionLease> {
    if (paths.length === 0 || paths.length > 100 || !paths.every(path => scopedPath(path, expected.project_id)) || new Set(paths).size !== paths.length) throw new ProjectDeletionProblem("invalid_delete_batch");
    return this.#rpc("mobile_prepare_project_deletion_batch", expected, { p_paths: [...paths] }, signal);
  }
  async acknowledgeBatch(expected: ProjectDeletionIdentity, paths: string[], signal?: AbortSignal): Promise<ProjectDeletionLease> {
    if (paths.length === 0 || paths.length > 100 || !paths.every(path => scopedPath(path, expected.project_id)) || new Set(paths).size !== paths.length) throw new ProjectDeletionProblem("invalid_delete_batch");
    return this.#rpc("mobile_ack_project_deletion_batch", expected, { p_paths: [...paths] }, signal);
  }
  async markStorageEmpty(expected: ProjectDeletionIdentity, signal?: AbortSignal): Promise<ProjectDeletionLease> {
    return this.#rpc("mobile_mark_project_deletion_storage_empty", expected, {}, signal);
  }
}
