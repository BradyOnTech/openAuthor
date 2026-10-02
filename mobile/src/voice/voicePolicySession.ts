import type { VoiceTransport } from "./voiceController";
import { leaseWire, readVoiceLease, type VoiceLease } from "./voiceLease";

export type VoicePolicy = {
  renew(leaseId: string, signal: AbortSignal): Promise<VoiceLease>;
  stop(leaseId: string, signal: AbortSignal): Promise<void>;
};

/** Client media fence for a server-owned lease. The gateway independently
 * polls authority and hangs up; these timers do not confer server authority. */
export class VoicePolicySession implements VoiceTransport {
  #stopped = false;
  #started = false;
  #lease: VoiceLease | null = null;
  #hardTimer: ReturnType<typeof setTimeout> | undefined;
  #leaseTimer: ReturnType<typeof setTimeout> | undefined;
  #renewTimer: ReturnType<typeof setTimeout> | undefined;
  #renewTimeout: ReturnType<typeof setTimeout> | undefined;
  #renewAbort: AbortController | null = null;

  constructor(private readonly input: {
    transport: VoiceTransport;
    policy: VoicePolicy;
    onClosed(message: string): void;
    onRemoteStopUnconfirmed?(): void;
  }) {}

  async start() {
    this.#requireOpen();
    if (this.#started) throw new Error("Voice session has already started.");
    this.#started = true;
    try {
      const session = await this.input.transport.start();
      const lease = readVoiceLease({ lease_id: session.leaseId, expires_at: session.expiresAt,
        lease_expires_at: session.leaseExpiresAt, renew_after_ms: session.renewAfterMs });
      this.#lease = lease;
      if (this.#stopped) { this.#stopRemote(lease); this.#requireOpen(); }
      this.#hardTimer = setTimeout(() => this.#close("Voice session reached its maximum duration. Start a new session to continue."), Date.parse(lease.expiresAt) - Date.now());
      this.#scheduleLease(lease);
      return session;
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  #scheduleLease(lease: VoiceLease): void {
    clearTimeout(this.#leaseTimer); clearTimeout(this.#renewTimer);
    const remaining = Date.parse(lease.leaseExpiresAt) - Date.now();
    this.#leaseTimer = setTimeout(() => this.#close("Voice policy expired. Audio is closed; start a new session to continue."), remaining);
    this.#renewTimer = setTimeout(() => { void this.#renew(); }, Math.min(lease.renewAfterMs, Math.max(1, Math.floor(remaining / 2))));
  }

  async #renew(): Promise<void> {
    if (this.#stopped || !this.#lease || this.#renewAbort) return;
    const current = this.#lease;
    const abort = new AbortController();
    this.#renewAbort = abort;
    this.#renewTimeout = setTimeout(() => this.#close("Voice policy could not be renewed in time. Audio is closed; remote closure remains governed by the gateway lease."), 5_000);
    try {
      const next = readVoiceLease(leaseWire(await this.input.policy.renew(current.leaseId, abort.signal)));
      if (this.#stopped || abort.signal.aborted) return;
      if (next.leaseId !== current.leaseId || next.expiresAt !== current.expiresAt
        || Date.parse(next.leaseExpiresAt) < Date.parse(current.leaseExpiresAt)) {
        throw new Error("Voice policy scope changed.");
      }
      this.#scheduleLease(next);
      this.#lease = next;
    } catch {
      if (!this.#stopped) this.#close("Voice policy renewal was refused or could not be confirmed. Audio is closed; remote closure remains governed by the gateway lease.");
    } finally {
      clearTimeout(this.#renewTimeout);
      if (this.#renewAbort === abort) this.#renewAbort = null;
    }
  }

  #close(message: string): void {
    if (this.#stopped) return;
    this.stop();
    this.input.onClosed(message);
  }

  #requireOpen(): void {
    if (!this.#stopped && this.#lease && Math.min(Date.parse(this.#lease.expiresAt), Date.parse(this.#lease.leaseExpiresAt)) <= Date.now()) {
      this.#close("Voice policy expired. Audio is closed; start a new session to continue.");
    }
    if (this.#stopped) throw new Error("Voice session was stopped. Start a new session to continue.");
  }

  get active(): boolean {
    try { this.#requireOpen(); return true; } catch { return false; }
  }

  setMuted(muted: boolean): void { this.#requireOpen(); this.input.transport.setMuted(muted); }
  sendText(text: string): void { this.#requireOpen(); this.input.transport.sendText(text); }
  sendContext(context: unknown): void { this.#requireOpen(); this.input.transport.sendContext(context); }
  sendToolOutput(callId: string, output: unknown): void { this.#requireOpen(); this.input.transport.sendToolOutput(callId, output); }
  interrupt(): void { this.#requireOpen(); this.input.transport.interrupt(); }

  #stopRemote(lease: VoiceLease): void {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 5_000);
    void this.input.policy.stop(lease.leaseId, abort.signal).catch(() => {
      this.input.onRemoteStopUnconfirmed?.();
    }).finally(() => clearTimeout(timeout));
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    clearTimeout(this.#hardTimer); clearTimeout(this.#leaseTimer); clearTimeout(this.#renewTimer); clearTimeout(this.#renewTimeout);
    this.#renewAbort?.abort();
    this.input.transport.stop();
    if (this.#lease) this.#stopRemote(this.#lease);
  }
}
