import type {
  RealtimeCallRequest,
  RealtimeCallResult,
  RealtimeUpstream,
} from "./types.ts";

/** Deterministic test double; it never uses credentials or the network. */
export class FakeRealtimeUpstream implements RealtimeUpstream {
  readonly calls: RealtimeCallRequest[] = [];
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
    this.calls.push(structuredClone(request));
    if (this.#failure) throw this.#failure;
    return structuredClone(this.#result);
  }
}
