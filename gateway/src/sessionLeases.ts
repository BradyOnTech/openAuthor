import { randomUUID } from "node:crypto";

import { CallJournal } from "./callJournal.ts";
import { validCallId } from "./openAIRealtimeUpstream.ts";
import type { GatewayVoiceControl, VoiceControlRecord } from "./sharedVoiceControl.ts";
import type { Clock, PrincipalVerifier, ProjectDeviceAuthorizer, RealtimeCallRequest, RealtimeCallResult, RealtimeUpstream, SessionAuthorizationRequest, SessionPrincipal } from "./types.ts";

export interface LeaseReceipt {
  lease_id: string;
  expires_at: string;
  lease_expires_at: string;
  renew_after_ms: number;
}

export interface SessionLeaseOptions {
  journal: CallJournal;
  upstream: RealtimeUpstream;
  principalVerifier: PrincipalVerifier;
  authorizer: ProjectDeviceAuthorizer;
  clock: Clock;
  leaseTtlMs: number;
  maxDurationMs: number;
  pollIntervalMs: number;
  authorizationTimeoutMs: number;
  maxCalls: number;
  control?: GatewayVoiceControl;
  /** Production legacy recovery drains journals and refuses new calls. */
  recoveryOnly?: boolean;
}

interface Lease {
  id: string;
  callId?: string;
  request: SessionAuthorizationRequest;
  hardDeadline: number;
  deadline: number;
  epoch: number;
  status: "starting" | "active" | "ending";
  expiryTimer?: ReturnType<typeof setTimeout>;
  pollTimer?: ReturnType<typeof setTimeout>;
  termination?: Promise<void>;
  creationPending: boolean;
  controlState?: VoiceControlRecord;
}

export class LeaseProblem extends Error {
  readonly statusCode: number;
  constructor(statusCode: number) { super("Voice session access is unavailable or expired."); this.statusCode = statusCode; }
}

function sameIdentity(left: SessionPrincipal, right: SessionPrincipal): boolean {
  return left.subject === right.subject && left.tenantId === right.tenantId && left.deviceId === right.deviceId && left.sessionId === right.sessionId;
}

async function bounded<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new LeaseProblem(503)), milliseconds); })]);
  } finally { if (timer) clearTimeout(timer); }
}

/** Server-owned leases. Client renewal never extends the hard call duration. */
export class SessionLeases {
  readonly #options: SessionLeaseOptions;
  readonly #leases = new Map<string, Lease>();
  #ready = false;
  #closing = false;
  #pendingIssues = 0;
  readonly #idleWaiters: Array<() => void> = [];
  readonly #creations = new Set<Promise<RealtimeCallResult>>();

  constructor(options: SessionLeaseOptions) {
    for (const value of [options.leaseTtlMs, options.maxDurationMs, options.pollIntervalMs, options.authorizationTimeoutMs, options.maxCalls]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error("Voice lease bounds must be positive integers.");
    }
    if (options.maxCalls > 1000 || options.leaseTtlMs > options.maxDurationMs || options.pollIntervalMs >= options.leaseTtlMs) throw new Error("Voice lease bounds are inconsistent.");
    this.#options = options;
  }

  async initialize(): Promise<void> {
    if (this.#ready) return;
    // Previous tokens are deliberately absent from disk: stop old calls, rather
    // than resuming an unverifiable session after a crash or deploy.
    for (const [id, callId] of this.#options.journal.entries()) {
      if (this.#options.control) await bounded(this.#options.control.recover(id, callId), this.#options.authorizationTimeoutMs);
      else await bounded(this.#options.upstream.hangupCall(callId), this.#options.authorizationTimeoutMs);
      this.#options.journal.retire(id);
    }
    this.#ready = true;
  }

  async issue(request: SessionAuthorizationRequest, call: RealtimeCallRequest): Promise<{ result: RealtimeCallResult; receipt: LeaseReceipt }> {
    this.#available();
    this.#validPrincipal(request.principal);
    const now = this.#options.clock.now().getTime();
    const lease: Lease = {
      id: randomUUID(), request: structuredClone(request), hardDeadline: now + this.#options.maxDurationMs,
      deadline: Math.min(now + this.#options.leaseTtlMs, request.principal.expiresAt!), epoch: 0, status: "starting", creationPending: true,
    };
    this.#leases.set(lease.id, lease);
    this.#pendingIssues += 1;
    try {
      if (this.#options.control) {
        lease.controlState = await bounded(this.#options.control.begin(lease.id, request), this.#options.authorizationTimeoutMs);
        lease.hardDeadline = Date.parse(lease.controlState.hard_expires_at);
        lease.deadline = Date.parse(lease.controlState.lease_expires_at);
      }
      const creation = this.#options.upstream.createCall({ ...call, onCallCreated: async callId => {
        if (!validCallId(callId) || lease.callId) throw new LeaseProblem(503);
        lease.callId = callId;
        this.#options.journal.record(lease.id, callId);
        if (this.#options.control && lease.controlState) {
          lease.controlState = await this.#options.control.attach(lease.controlState, callId);
          lease.controlState = await this.#options.control.ready(lease.controlState);
          lease.deadline = Date.parse(lease.controlState.lease_expires_at);
        }
        if (this.#closing || lease.status !== "starting") {
          delete lease.termination;
          await this.#terminate(lease);
          throw new LeaseProblem(503);
        }
      } });
      this.#creations.add(creation);
      const settled = () => {
        lease.creationPending = false;
        this.#creations.delete(creation);
        if (lease.status === "ending" && !lease.callId) this.#leases.delete(lease.id);
        else if (lease.status === "ending" && this.#leases.has(lease.id)) void this.#terminate(lease).catch(() => undefined);
      };
      void creation.then(settled, settled);
      const result = await bounded(creation, this.#options.authorizationTimeoutMs);
      if (!lease.callId || result.callId !== lease.callId) throw new LeaseProblem(503);
      if (!await this.#authorized(lease.request)) throw new LeaseProblem(403);
      if (this.#closing || this.#expired(lease) || [...this.#leases.values()].some(other => other !== lease && other.status === "ending")) throw new LeaseProblem(410);
      lease.status = "active";
      this.#schedule(lease);
      return { result, receipt: this.#receipt(lease) };
    } catch (error) {
      await this.#terminate(lease).catch(() => undefined);
      throw error;
    } finally {
      this.#pendingIssues -= 1;
      if (this.#pendingIssues === 0) this.#idleWaiters.splice(0).forEach(resolve => resolve());
    }
  }

  async renew(id: string, request: SessionAuthorizationRequest): Promise<LeaseReceipt> {
    const lease = this.#owned(id, request);
    const epoch = lease.epoch;
    let allowed = false;
    try { allowed = await this.#authorized(request); } catch {
      await this.#terminate(lease).catch(() => undefined);
      throw new LeaseProblem(503);
    }
    if (!allowed) {
      await this.#terminate(lease).catch(() => undefined);
      throw new LeaseProblem(403);
    }
    if (lease.epoch !== epoch || lease.status !== "active" || this.#expired(lease) || this.#closing) throw new LeaseProblem(410);
    if (this.#options.control && lease.controlState) {
      try {
        const state = await bounded(this.#options.control.renew(lease.controlState, request), this.#options.authorizationTimeoutMs);
        if (lease.epoch !== epoch || lease.status !== "active" || this.#closing) throw new LeaseProblem(410);
        lease.controlState = state;
        lease.deadline = Date.parse(state.lease_expires_at);
      } catch (error) { await this.#terminate(lease).catch(() => undefined); throw error; }
    }
    lease.request = structuredClone(request);
    if (!this.#options.control) lease.deadline = Math.min(lease.hardDeadline, this.#options.clock.now().getTime() + this.#options.leaseTtlMs, request.principal.expiresAt!);
    lease.epoch += 1;
    this.#schedule(lease);
    return this.#receipt(lease);
  }

  async stop(id: string, request: SessionAuthorizationRequest): Promise<void> {
    const lease = this.#owned(id, request, true);
    await this.#terminate(lease);
  }

  async shutdown(): Promise<void> {
    this.#closing = true;
    if (this.#pendingIssues) await new Promise<void>(resolve => this.#idleWaiters.push(resolve));
    // The real upstream adapter owns a bounded HTTP timeout. Keep the journal
    // open while a late response may still reveal a call requiring teardown.
    await Promise.allSettled([...this.#creations]);
    const results = await Promise.allSettled([...this.#leases.values()].map(lease => this.#terminate(lease)));
    for (const lease of this.#leases.values()) this.#clearTimers(lease);
    this.#options.journal.close();
    if (results.some(result => result.status === "rejected")) throw new LeaseProblem(503);
  }

  #available(): void {
    if (!this.#ready || this.#closing || this.#options.recoveryOnly || this.#leases.size >= this.#options.maxCalls || [...this.#leases.values()].some(lease => lease.status === "ending")) throw new LeaseProblem(503);
  }

  #validPrincipal(principal: SessionPrincipal): void {
    if (typeof principal.sessionId !== "string" || !principal.sessionId || !Number.isSafeInteger(principal.expiresAt) || principal.expiresAt! <= this.#options.clock.now().getTime()) throw new LeaseProblem(401);
  }

  #owned(id: string, request: SessionAuthorizationRequest, allowEnding = false): Lease {
    const lease = this.#leases.get(id);
    if (!lease || (lease.status !== "active" && !(allowEnding && lease.status === "ending"))) throw new LeaseProblem(410);
    if (!sameIdentity(lease.request.principal, request.principal) || lease.request.projectId !== request.projectId || lease.request.deviceId !== request.deviceId) throw new LeaseProblem(403);
    this.#validPrincipal(request.principal);
    if (!allowEnding && this.#expired(lease)) {
      void this.#terminate(lease).catch(() => undefined);
      throw new LeaseProblem(410);
    }
    return lease;
  }

  async #authorized(request: SessionAuthorizationRequest): Promise<boolean> {
    this.#validPrincipal(request.principal);
    const principal = await bounded(this.#options.principalVerifier.verify(`Bearer ${request.principal.bearerToken}`), this.#options.authorizationTimeoutMs);
    if (!principal || !sameIdentity(request.principal, principal)) return false;
    this.#validPrincipal(principal);
    return bounded(this.#options.authorizer.authorize({ ...request, principal }), this.#options.authorizationTimeoutMs);
  }

  #expired(lease: Lease): boolean { return this.#options.clock.now().getTime() >= lease.deadline; }

  #receipt(lease: Lease): LeaseReceipt {
    return { lease_id: lease.id, expires_at: new Date(lease.hardDeadline).toISOString(), lease_expires_at: new Date(lease.deadline).toISOString(), renew_after_ms: Math.max(1, Math.min(10000, Math.floor(this.#options.leaseTtlMs / 3))) };
  }

  #clearTimers(lease: Lease): void {
    if (lease.expiryTimer) clearTimeout(lease.expiryTimer);
    if (lease.pollTimer) clearTimeout(lease.pollTimer);
  }

  #schedule(lease: Lease): void {
    this.#clearTimers(lease);
    lease.expiryTimer = setTimeout(() => { void this.#terminate(lease).catch(() => undefined); }, Math.max(1, lease.deadline - this.#options.clock.now().getTime()));
    lease.pollTimer = setTimeout(() => { void this.#poll(lease); }, this.#options.pollIntervalMs);
    lease.expiryTimer.unref(); lease.pollTimer.unref();
  }

  async #poll(lease: Lease): Promise<void> {
    const epoch = lease.epoch;
    let allowed = false;
    try { allowed = await this.#authorized(lease.request); } catch { allowed = false; }
    if (lease.status !== "active" || lease.epoch !== epoch) return;
    if (!allowed || this.#expired(lease)) {
      await this.#terminate(lease).catch(() => undefined);
      return;
    }
    if (lease.epoch === epoch) {
      lease.pollTimer = setTimeout(() => { void this.#poll(lease); }, this.#options.pollIntervalMs);
      lease.pollTimer.unref();
    }
  }

  #terminate(lease: Lease): Promise<void> {
    if (lease.termination) return lease.termination;
    lease.status = "ending"; lease.epoch += 1;
    this.#clearTimers(lease);
    if (!lease.callId && lease.creationPending) return Promise.resolve();
    lease.termination = (async () => {
      if (lease.callId) {
        if (this.#options.control && lease.controlState) {
          try {
            if (lease.controlState.call_id === null) lease.controlState = await this.#options.control.attach(lease.controlState, lease.callId);
            lease.controlState = await this.#options.control.close(lease.controlState);
          } catch (error) {
            // A registration/storage outage must still stop this exact known
            // call. Retain the local record; independent acknowledgement is
            // unknown and startup recovery must not infer it from an error.
            if (!lease.controlState.controller_observed) await bounded(this.#options.upstream.hangupCall(lease.callId), this.#options.authorizationTimeoutMs).catch(() => undefined);
            throw error;
          }
          await bounded(this.#options.control.closed(lease.controlState), this.#options.authorizationTimeoutMs);
        } else await bounded(this.#options.upstream.hangupCall(lease.callId), this.#options.authorizationTimeoutMs);
        this.#options.journal.retire(lease.id);
      } else if (this.#options.control && lease.controlState) {
        await bounded(this.#options.control.close(lease.controlState), this.#options.authorizationTimeoutMs);
      }
      this.#leases.delete(lease.id);
    })().catch(error => {
      delete lease.termination;
      if (!this.#closing) {
        lease.pollTimer = setTimeout(() => { void this.#terminate(lease).catch(() => undefined); }, this.#options.pollIntervalMs);
        lease.pollTimer.unref();
      }
      throw error;
    });
    return lease.termination;
  }
}
