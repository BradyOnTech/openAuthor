import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CallJournal } from "../src/callJournal.ts";
import { OpenAIRealtimeUpstream } from "../src/openAIRealtimeUpstream.ts";
import { SessionLeases } from "../src/sessionLeases.ts";
import { parseGatewayConfig } from "../src/config.ts";
import { createSessionGateway } from "../src/sessionGateway.ts";
import type { RealtimeCallRequest, SessionAuthorizationRequest } from "../src/types.ts";

const CALL: RealtimeCallRequest = { requestId: "synthetic-voice", sdp: "v=0\r\ns=synthetic-prose-not-journaled\r\n", session: {
  type: "realtime", model: "gpt-realtime", instructions: "private-instructions-not-journaled", output_modalities: ["audio"],
  audio: { input: { transcription: { model: "gpt-4o-mini-transcribe" }, turn_detection: { type: "semantic_vad", eagerness: "low", create_response: true, interrupt_response: true } }, output: { voice: "marin" } },
  tools: [], tool_choice: "none", safety_identifier: "synthetic-hash",
} };

function authorization(): SessionAuthorizationRequest {
  return { principal: { subject: "synthetic-author", tenantId: "synthetic-tenant", deviceId: "synthetic-phone", bearerToken: "synthetic-private-token", sessionId: "10000000-0000-4000-8000-000000000001", expiresAt: Date.now() + 60000 }, projectId: "synthetic-book", deviceId: "synthetic-phone" };
}

async function eventually(condition: () => boolean, timeout = 3000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail("Expected bounded voice lifecycle transition did not occur.");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function fixture(managerOverrides: Partial<ConstructorParameters<typeof SessionLeases>[0]> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "openauthor-voice-leases-"));
  const path = join(directory, "calls.json");
  const request = authorization();
  let allowed = true;
  let hangupFails = false;
  let nextHangupFailures = 0;
  let blockAuthorization = false;
  let count = 0;
  let createDelay = 0;
  let holdAnswer = false;
  const calls = new Set<string>();
  const requests: Array<{ path: string; auth: string | undefined }> = [];
  const provider = createServer(async (incoming, response) => {
    requests.push({ path: incoming.url!, auth: incoming.headers.authorization });
    for await (const _chunk of incoming) { /* Consume the actual multipart request. */ }
    if (incoming.url === "/v1/realtime/calls") {
      if (createDelay) await new Promise(resolve => setTimeout(resolve, createDelay));
      const callId = `rtc_local${++count}`;
      calls.add(callId);
      response.writeHead(201, { location: `/v1/realtime/calls/${callId}` });
      response.flushHeaders();
      while (holdAnswer && !response.destroyed) await new Promise(resolve => setTimeout(resolve, 5));
      response.end("v=0\r\ns=answer\r\n");
    } else if (incoming.url?.endsWith("/hangup")) {
      if (hangupFails || nextHangupFailures > 0) { nextHangupFailures = Math.max(0, nextHangupFailures - 1); response.writeHead(503); response.end("synthetic-private-error"); return; }
      if (!calls.has(incoming.url.split("/")[4]!)) { response.writeHead(404); response.end(); return; }
      calls.delete(incoming.url.split("/")[4]!);
      response.writeHead(200); response.end();
    } else { response.writeHead(404); response.end(); }
  });
  provider.listen(0, "127.0.0.1"); await once(provider, "listening");
  const baseUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
  const upstream = new OpenAIRealtimeUpstream({ apiKey: "sk-synthetic-control", baseUrl, timeoutMs: 1000 });
  const tokens = new Map([[request.principal.bearerToken, request.principal]]);
  const verifier = { verify: async (header: string | undefined) => structuredClone(tokens.get(header?.replace(/^Bearer /, "") ?? "") ?? null) };
  const authorizer = { authorize: async () => blockAuthorization ? new Promise<boolean>(() => {}) : allowed };
  const journal = new CallJournal(path);
  const makeManager = (nextJournal = journal, overrides: Partial<ConstructorParameters<typeof SessionLeases>[0]> = {}) => new SessionLeases({ journal: nextJournal, upstream, principalVerifier: verifier, authorizer, clock: { now: () => new Date() }, leaseTtlMs: 800, maxDurationMs: 3000, pollIntervalMs: 30, authorizationTimeoutMs: 500, maxCalls: 10, ...managerOverrides, ...overrides });
  const manager = makeManager(); await manager.initialize();
  return { request, tokens, path, directory, baseUrl, upstream, verifier, authorizer, journal, manager, makeManager, requests, calls,
    allow: (value: boolean) => { allowed = value; }, failHangup: (value: boolean) => { hangupFails = value; }, block: (value: boolean) => { blockAuthorization = value; },
    delayCreation: (value: number) => { createDelay = value; },
    failNextHangups: (value: number) => { nextHangupFailures = value; },
    holdAnswer: (value: boolean) => { holdAnswer = value; },
    async close() { await manager.shutdown().catch(() => undefined); provider.close(); await once(provider, "close"); rmSync(directory, { recursive: true, force: true }); },
  };
}

test("durably registers before answer delivery and expires without any client renewal", async () => {
  const f = await fixture();
  try {
    const { result, receipt } = await f.manager.issue(f.request, CALL);
    assert.deepEqual(f.journal.entries(), [[receipt.lease_id, result.callId]]);
    const saved = readFileSync(f.path, "utf8");
    for (const privateValue of [f.request.principal.bearerToken, f.request.projectId, CALL.sdp, CALL.session.instructions]) assert.equal(saved.includes(privateValue), false);
    assert.ok(Date.parse(receipt.lease_expires_at) <= Date.parse(receipt.expires_at));
    await eventually(() => f.calls.size === 0 && f.journal.entries().length === 0);
    assert.equal(f.requests.filter(row => row.path.endsWith("/hangup")).length, 1);
    assert.equal(f.journal.entries().length, 0);
    await assert.rejects(f.manager.renew(receipt.lease_id, f.request), error => (error as { statusCode: number }).statusCode === 410);
  } finally { await f.close(); }
});

test("polling terminates revoked authority and bounds a blocked hosted authorization", async () => {
  for (const blocked of [false, true]) {
    const f = await fixture();
    try {
      await f.manager.issue(f.request, CALL);
      if (blocked) f.block(true); else f.allow(false);
      await eventually(() => f.calls.size === 0 && f.journal.entries().length === 0);
      assert.equal(f.journal.entries().length, 0);
    } finally { await f.close(); }
  }
});

test("same-session JWT refresh renews the short lease but cannot extend hard duration", async () => {
  const f = await fixture();
  try {
    const issued = await f.manager.issue(f.request, CALL);
    await new Promise(resolve => setTimeout(resolve, 25));
    const refreshed = structuredClone(f.request);
    refreshed.principal.bearerToken = "synthetic-refreshed-private-token";
    refreshed.principal.expiresAt = Date.now() + 120000;
    f.tokens.set(refreshed.principal.bearerToken, refreshed.principal);
    const renewed = await f.manager.renew(issued.receipt.lease_id, refreshed);
    assert.equal(renewed.expires_at, issued.receipt.expires_at);
    assert.equal(renewed.lease_id, issued.receipt.lease_id);
    assert.ok(Date.parse(renewed.lease_expires_at) > Date.parse(issued.receipt.lease_expires_at));
    for (const field of ["subject", "tenantId", "deviceId", "sessionId"] as const) {
      const wrong = structuredClone(refreshed); wrong.principal[field] = "other";
      await assert.rejects(f.manager.renew(renewed.lease_id, wrong), error => (error as { statusCode: number }).statusCode === 403);
    }
    const wrong = structuredClone(refreshed); wrong.projectId = "other-book";
    await assert.rejects(f.manager.stop(renewed.lease_id, wrong), error => (error as { statusCode: number }).statusCode === 403);
    await f.manager.stop(renewed.lease_id, refreshed);
    assert.equal(f.calls.size, 0);
  } finally { await f.close(); }
});

test("every allowed nondefault lease produces a mobile-compatible renewal hint", async () => {
  const f = await fixture();
  try {
    const manager = f.makeManager(f.journal, { leaseTtlMs: 120000, maxDurationMs: 600000 });
    await manager.initialize();
    const issued = await manager.issue(f.request, CALL);
    assert.equal(issued.receipt.renew_after_ms, 10000);
    assert.equal((await manager.renew(issued.receipt.lease_id, f.request)).renew_after_ms, 10000);
    await manager.shutdown();
  } finally { await f.close(); }
});

test("expired verification and revocation during creation never deliver an unmonitored answer", async () => {
  const f = await fixture();
  try {
    const expired = structuredClone(f.request); expired.principal.expiresAt = Date.now() - 1;
    await assert.rejects(f.manager.issue(expired, CALL));
    assert.equal(f.requests.length, 0);
    f.allow(false);
    await assert.rejects(f.manager.issue(f.request, CALL));
    assert.equal(f.calls.size, 0);
    assert.equal(f.journal.entries().length, 0);
  } finally { await f.close(); }
});

test("concurrent renewal results cannot overwrite a newer lease or resurrect after expiry", async () => {
  const f = await fixture();
  try {
    const issued = await f.manager.issue(f.request, CALL);
    const results = await Promise.allSettled([
      f.manager.renew(issued.receipt.lease_id, f.request),
      f.manager.renew(issued.receipt.lease_id, f.request),
    ]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    f.block(true);
    const pending = f.manager.renew(issued.receipt.lease_id, f.request);
    await assert.rejects(pending);
    await eventually(() => f.calls.size === 0 && f.journal.entries().length === 0);
  } finally { await f.close(); }
});

test("JWT expiry and hard duration independently terminate despite attempted renewal", async () => {
  const f = await fixture();
  try {
    const shortJwt = structuredClone(f.request); shortJwt.principal.expiresAt = Date.now() + 300;
    f.tokens.set(shortJwt.principal.bearerToken, shortJwt.principal);
    const issued = await f.manager.issue(shortJwt, CALL);
    assert.equal(Date.parse(issued.receipt.lease_expires_at), shortJwt.principal.expiresAt);
    await eventually(() => f.calls.size === 0 && f.journal.entries().length === 0);
  } finally { await f.close(); }
  const g = await fixture();
  const manager = g.makeManager(g.journal, { leaseTtlMs: 400, maxDurationMs: 800 });
  try {
    await manager.initialize();
    const issued = await manager.issue(g.request, CALL);
    for (let index = 0; index < 3; index += 1) {
      await new Promise(resolve => setTimeout(resolve, 175));
      assert.equal((await manager.renew(issued.receipt.lease_id, g.request)).expires_at, issued.receipt.expires_at);
    }
    await eventually(() => g.calls.size === 0);
    await assert.rejects(manager.renew(issued.receipt.lease_id, g.request));
  } finally { await manager.shutdown(); await g.close(); }
});

test("late renewal cannot revive a stopped call or race its final acknowledgement", async () => {
  const f = await fixture();
  try {
    const issued = await f.manager.issue(f.request, CALL);
    f.block(true);
    const renewal = f.manager.renew(issued.receipt.lease_id, f.request);
    await f.manager.stop(issued.receipt.lease_id, f.request);
    await assert.rejects(renewal);
    assert.equal(f.calls.size, 0);
    assert.equal(f.journal.entries().length, 0);
  } finally { await f.close(); }
});

test("failed hangup remains durable, blocks new issuance and retries to confirmed teardown", async () => {
  const f = await fixture();
  try {
    const issued = await f.manager.issue(f.request, CALL);
    f.failHangup(true);
    await assert.rejects(f.manager.stop(issued.receipt.lease_id, f.request));
    assert.equal(f.journal.entries().length, 1);
    assert.equal(f.calls.size, 1);
    await assert.rejects(f.manager.issue(f.request, CALL));
    f.failHangup(false);
    await eventually(() => f.journal.entries().length === 0);
    assert.equal(f.calls.size, 0);
  } finally { await f.close(); }
});

test("delayed real HTTP creation headers and failed late hangup remain in the global issuance gate", async () => {
  const f = await fixture({ authorizationTimeoutMs: 80 });
  try {
    f.delayCreation(200); f.failHangup(true);
    await assert.rejects(f.manager.issue(f.request, CALL));
    await assert.rejects(f.manager.issue(f.request, CALL));
    await eventually(() => f.journal.entries().length === 1);
    await assert.rejects(f.manager.issue(f.request, CALL));
    assert.equal(f.requests.filter(row => row.path === "/v1/realtime/calls").length, 1);
    assert.equal(f.calls.size, 1);
    f.failHangup(false);
    await eventually(() => f.calls.size === 0 && f.journal.entries().length === 0);
  } finally { await f.close(); }
});

test("a managed late-call retry owns cleanup without an extra upstream hangup losing acknowledgement", async () => {
  const f = await fixture({ authorizationTimeoutMs: 80 });
  try {
    f.delayCreation(200); f.failNextHangups(1);
    await assert.rejects(f.manager.issue(f.request, CALL));
    await eventually(() => f.journal.entries().length === 0 && f.calls.size === 0 && f.requests.filter(row => row.path.endsWith("/hangup")).length >= 2);
    assert.equal(f.requests.filter(row => row.path.endsWith("/hangup")).length, 2);
  } finally { await f.close(); }
});

test("exclusive journal ownership and failed startup cleanup cannot be bypassed", async () => {
  const f = await fixture();
  try {
    assert.throws(() => new CallJournal(f.path), /owner/);
    f.journal.record("10000000-0000-4000-8000-000000000001", "rtc_prior_instance");
    f.calls.add("rtc_prior_instance");
    f.failHangup(true);
    const recovering = f.makeManager();
    await assert.rejects(recovering.initialize());
    await assert.rejects(recovering.issue(f.request, CALL));
    assert.equal(f.journal.entries().length, 1);
    f.failHangup(false);
    await recovering.initialize();
    assert.equal(f.journal.entries().length, 0);
  } finally { await f.close(); }
});

test("actual SIGKILL retains the call and restart issues hangup before becoming ready", async () => {
  const f = await fixture();
  f.journal.close();
  f.holdAnswer(true);
  const source = `
    import { CallJournal } from ${JSON.stringify(new URL("../src/callJournal.ts", import.meta.url).href)};
    import { SessionLeases } from ${JSON.stringify(new URL("../src/sessionLeases.ts", import.meta.url).href)};
    import { OpenAIRealtimeUpstream } from ${JSON.stringify(new URL("../src/openAIRealtimeUpstream.ts", import.meta.url).href)};
    const request = ${JSON.stringify(f.request)};
    const upstream = new OpenAIRealtimeUpstream({apiKey:"sk-synthetic-control",baseUrl:${JSON.stringify(f.baseUrl)}});
    const manager = new SessionLeases({journal:new CallJournal(${JSON.stringify(f.path)}),upstream,
      principalVerifier:{verify:async()=>request.principal},authorizer:{authorize:async()=>true},clock:{now:()=>new Date()},
      leaseTtlMs:10000,maxDurationMs:60000,pollIntervalMs:1000,authorizationTimeoutMs:1000,maxCalls:10});
    await manager.initialize();
    await manager.issue(request,${JSON.stringify(CALL)});
    process.stdout.write("READY\\n");
    setInterval(()=>{},1000);
  `;
  const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", source], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let errors = "";
  child.stdout.on("data", chunk => { output += chunk.toString(); });
  child.stderr.on("data", chunk => { errors += chunk.toString(); });
  try {
    await eventually(() => JSON.parse(readFileSync(f.path, "utf8")).calls.length === 1, 5000);
    assert.equal(output.includes("READY"), false, "The durable record must precede delivery of the withheld SDP answer.");
    assert.equal(f.calls.size, 1, errors);
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    const result = await exited;
    assert.equal(result[1], "SIGKILL");
    f.holdAnswer(false);
    const recoveredJournal = new CallJournal(f.path);
    assert.equal(recoveredJournal.entries().length, 1);
    const recovering = f.makeManager(recoveredJournal);
    await assert.rejects(recovering.issue(f.request, CALL));
    await recovering.initialize();
    assert.equal(f.calls.size, 0);
    assert.equal(recoveredJournal.entries().length, 0);
    await recovering.shutdown();
  } finally {
    f.holdAnswer(false);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await f.close();
  }
});

test("real HTTP issuance, owned renewal and stop use leases without spending another quota", async () => {
  const f = await fixture();
  const config = parseGatewayConfig({ GATEWAY_VOICE_CONTROL_MODE: "legacy-recovery", GATEWAY_CALL_JOURNAL_PATH: f.path, SUPABASE_URL: "https://fiction.supabase.co", SUPABASE_PUBLISHABLE_KEY: "public", OPENAI_API_KEY: "synthetic", SAFETY_IDENTIFIER_SECRET: "synthetic-secret-at-least-32-bytes" });
  let quotaRequests = 0;
  const server = createSessionGateway({ policy: config.policy, leases: f.manager, dependencies: {
    principalVerifier: f.verifier, authorizer: f.authorizer, upstream: f.upstream,
    rateLimiter: { consume: () => { quotaRequests += 1; return { allowed: true }; } },
    auditSink: { write: async () => {} }, clock: { now: () => new Date() },
  } });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/realtime/sessions`;
  const send = (target: string, body: object) => fetch(target, { method: "POST", headers: { authorization: `Bearer ${f.request.principal.bearerToken}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const identity = { project_id: f.request.projectId, device_id: f.request.deviceId };
  try {
    const issued = await send(url, { ...identity, sdp: CALL.sdp });
    assert.equal(issued.status, 201);
    const initial = await issued.json() as { lease_id: string; expires_at: string; lease_expires_at: string };
    const renewed = await send(`${url}/${initial.lease_id}/renew`, identity);
    assert.equal(renewed.status, 200);
    assert.equal((await renewed.json() as { expires_at: string }).expires_at, initial.expires_at);
    const wrong = await send(`${url}/${initial.lease_id}/stop`, { ...identity, project_id: "different-book" });
    assert.equal(wrong.status, 403);
    assert.equal((await send(`${url}/${initial.lease_id}/stop`, identity)).status, 200);
    assert.equal((await send(`${url}/${initial.lease_id}/renew`, identity)).status, 410);
    assert.equal(quotaRequests, 1);
    assert.equal(f.calls.size, 0);
  } finally { server.close(); await once(server, "close"); await f.close(); }
});
