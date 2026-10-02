import type { RateLimitDecision, SessionAuthorizationRequest, SessionRateLimiter } from "./types.ts";

export interface SupabaseRpcSessionRateLimiterOptions {
  supabaseUrl: string;
  publishableKey: string;
  limit: number;
  windowMs: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function unavailable(): Error {
  return new Error("Shared session rate enforcement is unavailable.");
}

/** A database-owned quota shared across devices, books and gateway replicas. */
export class SupabaseRpcSessionRateLimiter implements SessionRateLimiter {
  readonly #url: string;
  readonly #key: string;
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: SupabaseRpcSessionRateLimiterOptions) {
    const url = new URL(options.supabaseUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      throw new Error("Supabase rate enforcement requires an HTTPS origin.");
    }
    if (!options.publishableKey || options.publishableKey.length > 16_384) throw unavailable();
    if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 1_000
      || !Number.isSafeInteger(options.windowMs) || options.windowMs < 1_000 || options.windowMs > 86_400_000) {
      throw new Error("Shared rate policy is out of bounds.");
    }
    this.#timeoutMs = options.timeoutMs ?? 5_000;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 100 || this.#timeoutMs > 60_000) throw unavailable();
    this.#url = new URL("/rest/v1/rpc/mobile_consume_realtime_rate_limit", url).toString();
    this.#key = options.publishableKey;
    this.#limit = options.limit;
    this.#windowMs = options.windowMs;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async consume(_key: string, _nowMs: number, request: SessionAuthorizationRequest): Promise<RateLimitDecision> {
    if (request.principal.deviceId !== request.deviceId) throw unavailable();
    let response: Response | undefined;
    try {
      response = await this.#fetch(this.#url, {
        method: "POST",
        headers: {
          apikey: this.#key, authorization: `Bearer ${request.principal.bearerToken}`,
          accept: "application/json", "content-type": "application/json", "cache-control": "no-store",
        },
        body: JSON.stringify({
          p_project_id: request.projectId, p_device_id: request.deviceId,
          p_expected_limit: this.#limit, p_expected_window_ms: this.#windowMs,
        }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      if (!response.ok || Number(response.headers.get("content-length") ?? "0") > 1_024) throw unavailable();
      const reader = response.body?.getReader();
      if (!reader) throw unavailable();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 1_024) throw unavailable();
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
      const row = value as Record<string, unknown>;
      if (Object.keys(row).some(key => key !== "allowed" && key !== "retry_after_seconds") || typeof row.allowed !== "boolean") throw unavailable();
      if (row.allowed) {
        if (row.retry_after_seconds !== null && row.retry_after_seconds !== undefined) throw unavailable();
        return { allowed: true };
      }
      const retry = row.retry_after_seconds;
      if (typeof retry !== "number" || !Number.isSafeInteger(retry) || retry < 1 || retry > Math.ceil(this.#windowMs / 1_000)) throw unavailable();
      return { allowed: false, retryAfterSeconds: retry };
    } catch {
      await response?.body?.cancel().catch(() => undefined);
      // A lost response may have consumed quota. Never retry or use local counters.
      throw unavailable();
    }
  }
}
