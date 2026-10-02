import assert from "node:assert/strict";
import test from "node:test";

import { parseGatewayConfig } from "../src/config.ts";

function requiredEnvironment(): NodeJS.ProcessEnv {
  return {
    GATEWAY_CALL_JOURNAL_PATH: "/private/tmp/openauthor-gateway-test/calls.json",
    SUPABASE_URL: "https://fiction.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fiction",
    OPENAI_API_KEY: "sk-fiction-openai-key",
    SAFETY_IDENTIFIER_SECRET: "fiction-safety-secret-at-least-32-bytes",
  };
}

test("parses the minimal production environment with bounded server-owned defaults", () => {
  const config = parseGatewayConfig(requiredEnvironment());

  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 8080);
  assert.equal(config.supabase.url, "https://fiction.supabase.co");
  assert.equal(config.supabase.issuer, "https://fiction.supabase.co/auth/v1");
  assert.equal(config.supabase.audience, "authenticated");
  assert.equal(config.supabase.tenantClaim, "iss");
  assert.equal(config.supabase.deviceClaim, "device_id");
  assert.equal(config.supabase.authorizationRpc, "authorize_realtime_session");
  assert.deepEqual(config.policy.allowedOrigins, []);
  assert.equal(config.policy.model, "gpt-realtime");
  assert.equal(config.policy.voice, "marin");
  assert.equal(config.policy.transcriptionModel, "gpt-4o-mini-transcribe");
  assert.equal(config.policy.semanticVadEagerness, "low");
  assert.deepEqual(config.policy.allowedToolNames, [
    "scene_list",
    "scene_get",
    "retrieval_query",
    "capture_note",
    "capture_dictation",
    "story_memory_suggest",
    "changes_request",
    "review_decide",
  ]);
  assert.equal(config.policy.maxRequestBytes, 65_536);
  assert.equal(config.policy.maxSdpBytes, 49_152);
  assert.equal(config.rateLimit.limit, 5);
  assert.equal(config.rateLimit.windowMs, 60_000);
  assert.equal(config.shutdownTimeoutMs, 10_000);
});

test("fails closed for missing credentials and unsafe production configuration", () => {
  for (const name of [
    "GATEWAY_CALL_JOURNAL_PATH",
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "OPENAI_API_KEY",
    "SAFETY_IDENTIFIER_SECRET",
  ]) {
    const environment = requiredEnvironment();
    delete environment[name];
    assert.throws(() => parseGatewayConfig(environment), new RegExp(`${name} is required\\.`));
  }

  const invalid: ReadonlyArray<readonly [string, string, RegExp]> = [
    ["SUPABASE_URL", "http://fiction.supabase.co", /SUPABASE_URL must use HTTPS/],
    ["SUPABASE_ISSUER", "https://user:pass@fiction.supabase.co/auth/v1", /SUPABASE_ISSUER/],
    ["GATEWAY_ALLOWED_ORIGINS", "https://app.example.com/path", /origin/],
    ["PORT", "70000", /PORT/],
    ["GATEWAY_MAX_REQUEST_BYTES", "1.5", /GATEWAY_MAX_REQUEST_BYTES/],
    ["GATEWAY_MAX_SDP_BYTES", "70000", /must not exceed/],
    ["GATEWAY_RATE_WINDOW_MS", "999", /GATEWAY_RATE_WINDOW_MS/],
    ["GATEWAY_SHUTDOWN_TIMEOUT_MS", "0", /GATEWAY_SHUTDOWN_TIMEOUT_MS/],
    ["REALTIME_VAD_EAGERNESS", "aggressive", /REALTIME_VAD_EAGERNESS/],
    ["REALTIME_ALLOWED_TOOL_NAMES", "scene_list,delete_project", /unknown mobile tool/],
    ["SUPABASE_DEVICE_CLAIM", "device-id", /SUPABASE_DEVICE_CLAIM/],
    ["SUPABASE_AUTHORIZATION_RPC", "Authorize", /SUPABASE_AUTHORIZATION_RPC/],
    ["HOST", "0.0.0.0/path", /HOST/],
  ];
  for (const [name, value, expected] of invalid) {
    assert.throws(
      () => parseGatewayConfig({ ...requiredEnvironment(), [name]: value }),
      expected,
      `${name} should fail closed`,
    );
  }

  assert.throws(
    () => parseGatewayConfig({
      ...requiredEnvironment(),
      SAFETY_IDENTIFIER_SECRET: "too-short",
    }),
    /SAFETY_IDENTIFIER_SECRET must contain at least 32 UTF-8 bytes/,
  );
  assert.throws(
    () => parseGatewayConfig({
      ...requiredEnvironment(),
      OPENAI_API_KEY: "same-secret-value-that-is-over-32-bytes",
      SAFETY_IDENTIFIER_SECRET: "same-secret-value-that-is-over-32-bytes",
    }),
    /must not reuse OPENAI_API_KEY/,
  );
});

test("parses explicit safe policy and resource overrides", () => {
  const config = parseGatewayConfig({
    ...requiredEnvironment(),
    HOST: "127.0.0.1",
    PORT: "9090",
    GATEWAY_ALLOWED_ORIGINS: "https://app.example.com,https://admin.example.com",
    REALTIME_ALLOWED_TOOL_NAMES: "scene_list,retrieval_query",
    REALTIME_VAD_EAGERNESS: "medium",
    GATEWAY_RATE_LIMIT: "9",
    GATEWAY_RATE_WINDOW_MS: "120000",
    GATEWAY_ISSUANCE_TTL_SECONDS: "45",
  });

  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 9_090);
  assert.deepEqual(config.policy.allowedOrigins, [
    "https://app.example.com",
    "https://admin.example.com",
  ]);
  assert.deepEqual(config.policy.allowedToolNames, ["scene_list", "retrieval_query"]);
  assert.equal(config.policy.semanticVadEagerness, "medium");
  assert.deepEqual(config.rateLimit, { limit: 9, windowMs: 120_000 });
  assert.equal(config.policy.issuanceTtlSeconds, 45);
});
