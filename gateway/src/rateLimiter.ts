import type { RateLimitDecision, SessionRateLimiter } from "./types.ts";

export interface FixedWindowRateLimiterOptions {
  limit: number;
  windowMs: number;
  maxKeys?: number;
}

interface WindowState {
  count: number;
  startedAtMs: number;
}

/**
 * In-memory limiter for one gateway process. Replace through SessionRateLimiter
 * with a shared implementation when deploying more than one replica.
 */
export class FixedWindowSessionRateLimiter implements SessionRateLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #maxKeys: number;
  readonly #windows = new Map<string, WindowState>();

  constructor(options: FixedWindowRateLimiterOptions) {
    if (!Number.isSafeInteger(options.limit) || options.limit < 1) {
      throw new Error("Rate limit must be a positive integer.");
    }
    if (!Number.isSafeInteger(options.windowMs) || options.windowMs < 1_000) {
      throw new Error("Rate-limit window must be at least one second.");
    }
    this.#limit = options.limit;
    this.#windowMs = options.windowMs;
    this.#maxKeys = options.maxKeys ?? 10_000;
  }

  consume(key: string, nowMs: number): RateLimitDecision {
    const existing = this.#windows.get(key);
    if (!existing || nowMs >= existing.startedAtMs + this.#windowMs) {
      this.#makeCapacity(nowMs);
      this.#windows.set(key, { count: 1, startedAtMs: nowMs });
      return { allowed: true };
    }
    if (existing.count >= this.#limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((existing.startedAtMs + this.#windowMs - nowMs) / 1_000),
        ),
      };
    }
    existing.count += 1;
    return { allowed: true };
  }

  #makeCapacity(nowMs: number): void {
    if (this.#windows.size < this.#maxKeys) return;
    for (const [key, state] of this.#windows) {
      if (nowMs >= state.startedAtMs + this.#windowMs) this.#windows.delete(key);
    }
    if (this.#windows.size >= this.#maxKeys) {
      const oldestKey = this.#windows.keys().next().value as string | undefined;
      if (oldestKey) this.#windows.delete(oldestKey);
    }
  }
}
