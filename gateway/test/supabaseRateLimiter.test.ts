import assert from "node:assert/strict";
import test from "node:test";

import { SupabaseRpcSessionRateLimiter } from "../src/supabaseRateLimiter.ts";

const request = {
  principal: { subject: "author-fiction", tenantId: "tenant-fiction", deviceId: "device-fiction", bearerToken: "private-fiction-token" },
  projectId: "project-fiction", deviceId: "device-fiction",
};

test("uses the verified device JWT and expected policy without client clocks or quota keys", async () => {
  let captured: RequestInit | undefined;
  const limiter = new SupabaseRpcSessionRateLimiter({
    supabaseUrl: "https://fiction.supabase.co", publishableKey: "fiction-publishable",
    limit: 5, windowMs: 60_000,
    fetchImpl: async (url, init) => {
      assert.equal(String(url), "https://fiction.supabase.co/rest/v1/rpc/mobile_consume_realtime_rate_limit");
      captured = init;
      return Response.json({ allowed: true, retry_after_seconds: null });
    },
  });
  assert.deepEqual(await limiter.consume("opaque-unused", -999, request), { allowed: true });
  assert.deepEqual(JSON.parse(String(captured?.body)), {
    p_project_id: request.projectId, p_device_id: request.deviceId,
    p_expected_limit: 5, p_expected_window_ms: 60_000,
  });
  assert.equal(new Headers(captured?.headers).get("authorization"), "Bearer private-fiction-token");
  assert.equal(new Headers(captured?.headers).get("apikey"), "fiction-publishable");
});

test("returns shared retry timing and refuses a mismatched verified device before contact", async () => {
  let contacts = 0;
  const limiter = new SupabaseRpcSessionRateLimiter({
    supabaseUrl: "https://fiction.supabase.co", publishableKey: "fiction-publishable", limit: 5, windowMs: 60_000,
    fetchImpl: async () => { contacts += 1; return Response.json({ allowed: false, retry_after_seconds: 42 }); },
  });
  assert.deepEqual(await limiter.consume("opaque", 0, request), { allowed: false, retryAfterSeconds: 42 });
  await assert.rejects(limiter.consume("opaque", 0, { ...request, deviceId: "different" }), /Shared session rate enforcement is unavailable/);
  assert.equal(contacts, 1);
});

test("fails closed for missing migration, transport loss, malformed/oversized decisions without leaking bodies or tokens", async () => {
  const privateSentinels = {
    body: "synthetic-rate-limit-body-sentinel-7c34f2",
    transport: "synthetic-rate-limit-transport-sentinel-53ef9b",
    extraRow: "synthetic-rate-limit-extra-row-sentinel-0b8fdc",
    bearer: request.principal.bearerToken,
    apiKey: "fiction-publishable",
  };
  const cases: Array<() => Promise<Response>> = [
    async () => new Response(privateSentinels.body, { status: 404 }),
    async () => { throw new Error(privateSentinels.transport); },
    async () => Response.json(true),
    async () => Response.json({ allowed: "true" }),
    async () => Response.json({ allowed: false, retry_after_seconds: 0 }),
    async () => Response.json({ allowed: false, retry_after_seconds: 1.5 }),
    async () => Response.json({ allowed: true, retry_after_seconds: 1 }),
    async () => Response.json({ allowed: false, retry_after_seconds: 61 }),
    async () => Response.json({ allowed: true, extra: privateSentinels.extraRow }),
    async () => new Response("x".repeat(2_000)),
    async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(2_000))); controller.close(); } })),
  ];
  for (const fetchImpl of cases) {
    let contacts = 0;
    const limiter = new SupabaseRpcSessionRateLimiter({
      supabaseUrl: "https://fiction.supabase.co", publishableKey: "fiction-publishable", limit: 5, windowMs: 60_000,
      fetchImpl: async () => { contacts += 1; return fetchImpl(); },
    });
    await assert.rejects(limiter.consume("opaque", 0, request), error => {
      assert.equal((error as Error).message, "Shared session rate enforcement is unavailable.");
      const serialized = JSON.stringify(error, (_key, value: unknown) => value instanceof Error
        ? Object.fromEntries(Object.getOwnPropertyNames(value).map(name => [name, (value as unknown as Record<string, unknown>)[name]]))
        : value);
      for (const sentinel of Object.values(privateSentinels)) {
        assert.equal(serialized.includes(sentinel), false, "backend details and credentials must remain private, including error causes and stacks");
      }
      return true;
    });
    assert.equal(contacts, 1, "an uncertain commit must not trigger automatic retries");
  }
});
