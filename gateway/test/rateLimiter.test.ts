import assert from "node:assert/strict";
import test from "node:test";

import { FixedWindowSessionRateLimiter } from "../src/rateLimiter.ts";

test("limits each opaque key and resets at the next window", () => {
  const limiter = new FixedWindowSessionRateLimiter({ limit: 2, windowMs: 60_000 });

  assert.deepEqual(limiter.consume("opaque-a", 1_000), { allowed: true });
  assert.deepEqual(limiter.consume("opaque-a", 2_000), { allowed: true });
  assert.deepEqual(limiter.consume("opaque-b", 2_000), { allowed: true });
  assert.deepEqual(limiter.consume("opaque-a", 2_500), {
    allowed: false,
    retryAfterSeconds: 59,
  });
  assert.deepEqual(limiter.consume("opaque-a", 61_000), { allowed: true });
});
