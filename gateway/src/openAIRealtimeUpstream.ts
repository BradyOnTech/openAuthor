import type {
  RealtimeCallRequest,
  RealtimeCallResult,
  RealtimeUpstream,
} from "./types.ts";

export interface OpenAIRealtimeUpstreamOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export class RealtimeUpstreamError extends Error {
  readonly statusCode: number;
  readonly upstreamRequestId?: string;

  constructor(statusCode: number, upstreamRequestId?: string) {
    super("OpenAI Realtime call creation failed.");
    this.name = "RealtimeUpstreamError";
    this.statusCode = statusCode;
    if (upstreamRequestId) this.upstreamRequestId = upstreamRequestId;
  }
}

export function validCallId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}

export class OpenAIRealtimeUpstream implements RealtimeUpstream {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;

  constructor(options: OpenAIRealtimeUpstreamOptions) {
    if (!options.apiKey) throw new Error("An OpenAI API key is required.");
    this.#apiKey = options.apiKey;
    const base = new URL(options.baseUrl ?? "https://api.openai.com");
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname);
    if ((base.protocol !== "https:" && !(base.protocol === "http:" && loopback)) || base.username || base.password || base.search || base.hash || base.pathname !== "/") throw new Error("OpenAI origin is invalid.");
    this.#baseUrl = base.origin;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#maxResponseBytes = options.maxResponseBytes ?? 256 * 1_024;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1) {
      throw new Error("OpenAI request timeout must be a positive integer.");
    }
    if (!Number.isSafeInteger(this.#maxResponseBytes) || this.#maxResponseBytes < 1) {
      throw new Error("OpenAI response limit must be a positive integer.");
    }
  }

  async createCall(request: RealtimeCallRequest): Promise<RealtimeCallResult> {
    const form = new FormData();
    form.append("sdp", new Blob([request.sdp], { type: "application/sdp" }), "offer.sdp");
    form.append(
      "session",
      new Blob([JSON.stringify(request.session)], { type: "application/json" }),
      "session.json",
    );

    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/v1/realtime/calls`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          "x-client-request-id": request.requestId,
        },
        body: form,
        signal: AbortSignal.timeout(this.#timeoutMs),
        redirect: "error",
      });
    } catch {
      throw new RealtimeUpstreamError(503);
    }
    const upstreamRequestId = response.headers.get("x-request-id") ?? undefined;
    if (!response.ok) {
      response.body?.cancel().catch(() => undefined);
      throw new RealtimeUpstreamError(response.status, upstreamRequestId);
    }

    const location = response.headers.get("location");
    let callId: string | undefined;
    try {
      if (!location || location.includes("%") || location.includes("..")) throw new Error();
      const callUrl = new URL(location, this.#baseUrl);
      const match = /^\/v1\/realtime\/calls\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/.exec(callUrl.pathname);
      if (callUrl.origin !== this.#baseUrl || callUrl.username || callUrl.password || callUrl.search || callUrl.hash || !match) throw new Error();
      callId = match[1]!;
      await request.onCallCreated?.(callId);
    } catch {
      await response.body?.cancel().catch(() => undefined);
      if (callId && !request.onCallCreated) await this.hangupCall(callId).catch(() => undefined);
      throw new RealtimeUpstreamError(502, upstreamRequestId);
    }
    try {
      const declaredLength = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declaredLength) && declaredLength > this.#maxResponseBytes) {
        await response.body?.cancel().catch(() => undefined);
        throw new RealtimeUpstreamError(502, upstreamRequestId);
      }
      let sdp: string;
      try {
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            if (totalBytes > this.#maxResponseBytes) {
              await reader.cancel().catch(() => undefined);
              throw new RealtimeUpstreamError(502, upstreamRequestId);
            }
            chunks.push(value);
          }
        }
        sdp = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
      } catch (error) {
        if (error instanceof RealtimeUpstreamError) throw error;
        throw new RealtimeUpstreamError(502, upstreamRequestId);
      }
      if (!sdp.startsWith("v=0")) {
        throw new RealtimeUpstreamError(502, upstreamRequestId);
      }
      return {
        sdp,
        callId,
        ...(upstreamRequestId ? { upstreamRequestId } : {}),
      };
    } catch (error) {
      if (!request.onCallCreated) await this.hangupCall(callId).catch(() => undefined);
      throw error;
    }
  }

  async hangupCall(callId: string): Promise<void> {
    if (!validCallId(callId)) throw new RealtimeUpstreamError(502);
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/v1/realtime/calls/${callId}/hangup`, {
        method: "POST", headers: { authorization: `Bearer ${this.#apiKey}` },
        signal: AbortSignal.timeout(this.#timeoutMs), redirect: "error",
      });
    } catch {
      throw new RealtimeUpstreamError(503);
    }
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok) throw new RealtimeUpstreamError(response.status);
  }
}
