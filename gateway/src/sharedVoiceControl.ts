import { createHash } from "node:crypto";
import { validCallId } from "./openAIRealtimeUpstream.ts";
import type { SessionAuthorizationRequest } from "./types.ts";

export interface VoiceControlRecord {
  lease_id: string;
  user_id: string | null;
  tenant_id: string | null;
  project_id: string | null;
  device_id: string | null;
  session_id: string | null;
  identity_redacted: boolean;
  binding_sha256: string;
  call_id: string | null;
  phase: "allocating" | "registering" | "active" | "closing" | "closed" | "unknown";
  revision: number;
  hard_expires_at: string;
  lease_expires_at: string;
  jwt_expires_at: string;
  controller_observed: boolean;
  controller_id: string | null;
  claim_token: string | null;
  claim_expires_at: string | null;
}

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export class VoiceControlProblem extends Error {
  readonly refused: boolean;
  constructor(refused = false) { super("Independent voice control is unavailable or changed."); this.refused = refused; }
}

/** Local key binding is not proof that a credential belongs to an API project. */
export function voiceCredentialBinding(apiKey: string, projectId: string, organizationId = "", origin = "https://api.openai.com"): string {
  if (!apiKey || !/^[A-Za-z0-9_-]{1,128}$/.test(projectId) || (organizationId && !/^[A-Za-z0-9_-]{1,128}$/.test(organizationId))) throw new VoiceControlProblem();
  const url = new URL(origin);
  if (url.origin !== origin || (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))) throw new VoiceControlProblem();
  return createHash("sha256").update(JSON.stringify([origin, projectId, organizationId, createHash("sha256").update(apiKey).digest("hex")])).digest("hex");
}

/** Supabase verifies the signature. Local inspection rejects broad/wrong roles. */
export function trustedVoiceToken(value: string, role: "mobile_voice_gateway" | "mobile_voice_controller"): string {
  try {
    const parts = value.split(".");
    if (parts.length !== 3 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
    if (payload.role !== role || !Number.isSafeInteger(payload.exp) || payload.exp * 1000 <= Date.now()) throw new Error();
  } catch { throw new VoiceControlProblem(); }
  return value;
}

function instant(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
export function voiceRecord(value: unknown, binding: string): VoiceControlRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new VoiceControlProblem();
  const row = value as VoiceControlRecord;
  const validScope = row.identity_redacted === true
    ? row.phase === "closed" && [row.user_id, row.tenant_id, row.project_id, row.device_id, row.session_id].every(id => id === null)
    : row.identity_redacted === false && [row.user_id, row.project_id, row.device_id, row.session_id].every(id => typeof id === "string" && uuidPattern.test(id))
      && typeof row.tenant_id === "string" && row.tenant_id.length > 0 && row.tenant_id.length <= 256;
  if (typeof row.lease_id !== "string" || !uuidPattern.test(row.lease_id) || !validScope || row.binding_sha256 !== binding
    || !["allocating", "registering", "active", "closing", "closed", "unknown"].includes(row.phase)
    || !Number.isSafeInteger(row.revision) || row.revision < 0 || typeof row.controller_observed !== "boolean"
    || (row.call_id !== null && !validCallId(row.call_id))
    || (["registering", "active", "closed"].includes(row.phase) && row.call_id === null)
    || ![row.hard_expires_at, row.lease_expires_at, row.jwt_expires_at].every(instant)
    || Date.parse(row.lease_expires_at) > Math.min(Date.parse(row.hard_expires_at), Date.parse(row.jwt_expires_at))
    || (row.controller_id !== null && (typeof row.controller_id !== "string" || !uuidPattern.test(row.controller_id)))
    || (row.claim_token !== null && (typeof row.claim_token !== "string" || !uuidPattern.test(row.claim_token)))
    || (row.claim_expires_at !== null && !instant(row.claim_expires_at))
    || ((row.claim_token === null) !== (row.claim_expires_at === null))) throw new VoiceControlProblem();
  return structuredClone(row);
}

export function sameVoiceScope(left: VoiceControlRecord, right: VoiceControlRecord): boolean {
  const identity = (["lease_id", "binding_sha256", "hard_expires_at"] as const).every(key => left[key] === right[key])
    && (left.call_id === null || left.call_id === right.call_id);
  // Auth removal may redact only a positively closed receipt. It cannot turn
  // another call, credential binding or hard deadline into a matching result.
  return identity && (right.phase === "closed" && right.identity_redacted
    || !left.identity_redacted && !right.identity_redacted
      && (["user_id", "tenant_id", "project_id", "device_id", "session_id"] as const).every(key => left[key] === right[key]));
}

export interface VoiceRpcOptions {
  supabaseUrl: string;
  publishableKey: string;
  token: string;
  binding: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class VoiceRpc {
  readonly binding: string;
  readonly #url: string;
  readonly #options: VoiceRpcOptions;
  readonly #role: "mobile_voice_gateway" | "mobile_voice_controller";
  constructor(options: VoiceRpcOptions, role: "mobile_voice_gateway" | "mobile_voice_controller") {
    const url = new URL(options.supabaseUrl);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash
      || (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))
      || !options.publishableKey || !/^[0-9a-f]{64}$/.test(options.binding)) throw new VoiceControlProblem();
    trustedVoiceToken(options.token, role);
    const timeoutMs = options.timeoutMs ?? 5000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new VoiceControlProblem();
    this.#url = url.origin; this.binding = options.binding; this.#options = { ...options, timeoutMs }; this.#role = role;
  }
  async call(name: string, body: Record<string, unknown>): Promise<unknown> {
    trustedVoiceToken(this.#options.token, this.#role);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.#request(name, body, controller.signal),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new VoiceControlProblem()); }, this.#options.timeoutMs!); }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  }
  async #request(name: string, body: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    try {
      const response = await (this.#options.fetchImpl ?? fetch)(`${this.#url}/rest/v1/rpc/${name}`, {
        method: "POST", headers: { authorization: `Bearer ${this.#options.token}`, apikey: this.#options.publishableKey, "content-type": "application/json" },
        body: JSON.stringify(body), signal, redirect: "error",
      });
      if (!response.ok || !response.body) throw new VoiceControlProblem(response.status === 403);
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        const item = await reader.read(); if (item.done) break;
        size += item.value.byteLength; if (size > 1048576) { await reader.cancel(); throw new VoiceControlProblem(); }
        chunks.push(item.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error) { if (error instanceof VoiceControlProblem) throw error; throw new VoiceControlProblem(); }
  }
}

export interface GatewayVoiceControl {
  begin(id: string, request: SessionAuthorizationRequest): Promise<VoiceControlRecord>;
  attach(row: VoiceControlRecord, callId: string): Promise<VoiceControlRecord>;
  ready(row: VoiceControlRecord): Promise<VoiceControlRecord>;
  renew(row: VoiceControlRecord, request: SessionAuthorizationRequest): Promise<VoiceControlRecord>;
  close(row: VoiceControlRecord): Promise<VoiceControlRecord>;
  closed(row: VoiceControlRecord): Promise<void>;
  recover(id: string, callId: string): Promise<void>;
}

export class SupabaseGatewayVoiceControl implements GatewayVoiceControl {
  readonly #rpc: VoiceRpc;
  readonly #leaseMs: number;
  readonly #durationMs: number;
  readonly #waitMs: number;
  constructor(options: VoiceRpcOptions & { leaseMs: number; maxDurationMs: number; registrationTimeoutMs?: number }) {
    this.#rpc = new VoiceRpc(options, "mobile_voice_gateway"); this.#leaseMs = options.leaseMs; this.#durationMs = options.maxDurationMs; this.#waitMs = options.registrationTimeoutMs ?? 5000;
    if (!Number.isSafeInteger(this.#waitMs) || this.#waitMs < 1 || this.#waitMs > 60000) throw new VoiceControlProblem();
  }
  #identity(row: VoiceControlRecord) { return { p_lease_id: row.lease_id, p_binding: this.#rpc.binding }; }
  #scope(id: string, request: SessionAuthorizationRequest) {
    return { p_lease_id: id, p_user_id: request.principal.subject, p_tenant_id: request.principal.tenantId,
      p_project_id: request.projectId, p_device_id: request.deviceId, p_session_id: request.principal.sessionId,
      p_binding: this.#rpc.binding, p_jwt_expires_at: new Date(request.principal.expiresAt!).toISOString() };
  }
  #checked(value: unknown, original: VoiceControlRecord) {
    const row = voiceRecord(value, this.#rpc.binding);
    if (!sameVoiceScope(original, row) || row.revision < original.revision) throw new VoiceControlProblem();
    return row;
  }
  async begin(id: string, request: SessionAuthorizationRequest): Promise<VoiceControlRecord> {
    const body = { ...this.#scope(id, request), p_lease_ms: this.#leaseMs, p_max_duration_ms: this.#durationMs };
    let value: unknown;
    try { value = await this.#rpc.call("mobile_voice_begin", body); }
    catch { value = await this.#rpc.call("mobile_voice_get", { p_lease_id: id, p_binding: this.#rpc.binding }); }
    const row = voiceRecord(value, this.#rpc.binding);
    if (row.lease_id !== id || row.user_id !== request.principal.subject || row.tenant_id !== request.principal.tenantId
      || row.project_id !== request.projectId || row.device_id !== request.deviceId || row.session_id !== request.principal.sessionId
      || row.phase !== "allocating" || row.call_id !== null || Date.parse(row.lease_expires_at) <= Date.now()
      || Date.parse(row.jwt_expires_at) !== request.principal.expiresAt) throw new VoiceControlProblem();
    return row;
  }
  async attach(original: VoiceControlRecord, callId: string): Promise<VoiceControlRecord> {
    let value: unknown;
    try { value = await this.#rpc.call("mobile_voice_attach", { ...this.#identity(original), p_call_id: callId }); }
    catch { value = await this.#rpc.call("mobile_voice_get", this.#identity(original)); }
    const row = this.#checked(value, original); if (row.call_id !== callId) throw new VoiceControlProblem(); return row;
  }
  async #wait(original: VoiceControlRecord, closed: boolean): Promise<VoiceControlRecord> {
    const until = Date.now() + this.#waitMs;
    do {
      const row = this.#checked(await this.#rpc.call("mobile_voice_get", this.#identity(original)), original);
      if (closed ? row.phase === "closed" : row.phase === "active" && row.controller_observed && Date.parse(row.lease_expires_at) > Date.now()) return row;
      if (!closed && ["closing", "closed", "unknown"].includes(row.phase)) throw new VoiceControlProblem();
      if (Date.now() >= until) break;
      await new Promise(resolve => setTimeout(resolve, Math.min(100, until - Date.now())));
    } while (Date.now() < until);
    throw new VoiceControlProblem();
  }
  ready(row: VoiceControlRecord) { return this.#wait(row, false); }
  async renew(original: VoiceControlRecord, request: SessionAuthorizationRequest): Promise<VoiceControlRecord> {
    const row = this.#checked(await this.#rpc.call("mobile_voice_renew", { ...this.#scope(original.lease_id, request), p_revision: original.revision }), original);
    if (row.phase !== "active" || !row.controller_observed || row.revision !== original.revision + 1) throw new VoiceControlProblem(); return row;
  }
  async close(original: VoiceControlRecord): Promise<VoiceControlRecord> {
    const row = this.#checked(await this.#rpc.call("mobile_voice_close", this.#identity(original)), original);
    if (!["closing", "closed", "unknown"].includes(row.phase)) throw new VoiceControlProblem(); return row;
  }
  async closed(row: VoiceControlRecord) { await this.#wait(row, true); }
  async recover(id: string, callId: string) {
    const row = voiceRecord(await this.#rpc.call("mobile_voice_get", { p_lease_id: id, p_binding: this.#rpc.binding }), this.#rpc.binding);
    if (row.lease_id !== id || row.call_id !== callId) throw new VoiceControlProblem();
    if (row.phase !== "closed") await this.closed(await this.close(row));
  }
}

export interface ControllerVoiceControl {
  poll(): Promise<VoiceControlRecord[]>;
  claim(id: string, forceClose: boolean): Promise<VoiceControlRecord>;
  observed(row: VoiceControlRecord): Promise<VoiceControlRecord>;
  complete(row: VoiceControlRecord): Promise<VoiceControlRecord>;
}
export class SupabaseControllerVoiceControl implements ControllerVoiceControl {
  readonly #rpc: VoiceRpc;
  readonly #id: string;
  readonly #pollMs: number;
  readonly #claimMs: number;
  constructor(options: VoiceRpcOptions & { controllerId: string; pollMs: number; claimMs: number }) {
    this.#rpc = new VoiceRpc(options, "mobile_voice_controller"); this.#id = options.controllerId; this.#pollMs = options.pollMs; this.#claimMs = options.claimMs;
    if (!uuidPattern.test(this.#id)) throw new VoiceControlProblem();
  }
  async poll(): Promise<VoiceControlRecord[]> {
    const rows = await this.#rpc.call("mobile_voice_controller_poll", { p_controller_id: this.#id, p_binding: this.#rpc.binding, p_poll_ms: this.#pollMs, p_claim_ms: this.#claimMs, p_limit: 100 });
    if (!Array.isArray(rows) || rows.length > 100) throw new VoiceControlProblem();
    const parsed = rows.map(row => voiceRecord(row, this.#rpc.binding));
    if (new Set(parsed.map(row => row.lease_id)).size !== parsed.length || new Set(parsed.flatMap(row => row.call_id === null ? [] : [row.call_id])).size !== parsed.filter(row => row.call_id !== null).length) throw new VoiceControlProblem();
    parsed.forEach(row => this.#claimIdentity(row)); return parsed;
  }
  #claimIdentity(row: VoiceControlRecord) {
    if (row.controller_id !== this.#id || row.claim_token === null || row.claim_expires_at === null || Date.parse(row.claim_expires_at) <= Date.now()) throw new VoiceControlProblem();
  }
  async claim(id: string, forceClose: boolean) {
    const row = voiceRecord(await this.#rpc.call("mobile_voice_controller_claim", { p_controller_id: this.#id, p_lease_id: id, p_binding: this.#rpc.binding, p_claim_ms: this.#claimMs, p_force_close: forceClose }), this.#rpc.binding);
    if (row.lease_id !== id || row.call_id === null) throw new VoiceControlProblem();
    if (row.phase !== "closed") this.#claimIdentity(row); return row;
  }
  async #ack(name: string, original: VoiceControlRecord) {
    this.#claimIdentity(original);
    const row = voiceRecord(await this.#rpc.call(name, { p_controller_id: this.#id, p_lease_id: original.lease_id, p_binding: this.#rpc.binding, p_claim_token: original.claim_token }), this.#rpc.binding);
    if (!sameVoiceScope(original, row) || row.claim_token !== original.claim_token || row.controller_id !== this.#id || row.revision < original.revision) throw new VoiceControlProblem(); return row;
  }
  observed(row: VoiceControlRecord) { return this.#ack("mobile_voice_controller_observed", row); }
  complete(row: VoiceControlRecord) { return this.#ack("mobile_voice_controller_complete", row); }
}
