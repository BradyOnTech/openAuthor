import type {
  RealtimeCallRequest,
  RealtimeCallResult,
  RealtimeUpstream,
} from "./types.ts";

/** Deterministic test double; it never uses credentials or the network. */
export class FakeRealtimeUpstream implements RealtimeUpstream {
  readonly calls: RealtimeCallRequest[] = [];
  readonly hangups: string[] = [];
  #result: RealtimeCallResult;
  #failure: Error | undefined;

  constructor(result: RealtimeCallResult) {
    this.#result = structuredClone(result);
  }

  setResult(result: RealtimeCallResult): void {
    this.#result = structuredClone(result);
    this.#failure = undefined;
  }

  failWith(error: Error): void {
    this.#failure = error;
  }

  async createCall(request: RealtimeCallRequest): Promise<RealtimeCallResult> {
    const { onCallCreated, ...serializable } = request;
    this.calls.push(structuredClone(serializable));
    if (this.#failure) throw this.#failure;
    if (this.#result.callId) await onCallCreated?.(this.#result.callId);
    return structuredClone(this.#result);
  }

  async hangupCall(callId: string): Promise<void> {
    this.hangups.push(callId);
  }
}
