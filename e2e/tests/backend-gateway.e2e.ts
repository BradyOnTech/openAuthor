import { test, expect } from "e2e";
import { generateKeyPairSync, sign } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CallJournal, createSessionGateway, FixedWindowSessionRateLimiter,
  OpenAIRealtimeUpstream, SessionLeases, SupabaseJwksPrincipalVerifier,
  SupabaseRpcProjectDeviceAuthorizer,
  type AuditEvent, type GatewayPolicy, type RealtimeSessionPolicy,
} from "../../gateway/src/index.ts";

const ISSUER = "https://e2e-fiction.supabase.co/auth/v1";
const DEVICE = "device-e2e-phone";
const PROJECT = "project-e2e-fiction";
const SESSION = "10000000-0000-4000-8000-000000000001";
const OFFER = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=e2e-offer\r\nt=0 0\r\n";
const ORIGIN = "https://app.openauthor.example";

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function closeServer(server: Server) {
  if (!server.listening) return;
  server.closeIdleConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

// Only hosted collaborators are local protocol fixtures. JWT verification,
// authorization adapter, multipart provider adapter, HTTP routing, rate policy,
// durable journal and independent lease enforcement are production code.
async function gateway(options: { limit?: number; ttl?: number; poll?: number; holdHangupAcknowledgement?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "openauthor-gateway-e2e-"));
  const path = join(directory, "calls.json");
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = { ...publicKey.export({ format: "jwk" }), alg: "ES256", kid: "e2e-key", use: "sig" };
  const audits: AuditEvent[] = [];
  const sessions: RealtimeSessionPolicy[] = [];
  const calls = new Set<string>();
  const hangups: string[] = [];
  let releaseHangupAcknowledgement!: () => void;
  const hangupAcknowledgement = new Promise<void>(resolve => { releaseHangupAcknowledgement = resolve; });
  if (!options.holdHangupAcknowledgement) releaseHangupAcknowledgement();
  let authorizationContacts = 0;
  let allowed = true;
  let failCreation = false;
  let malformedAnswer = false;
  let callCount = 0;
  const hosted = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      if (request.url === "/auth/v1/.well-known/jwks.json") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ keys: [jwk] }));
      } else if (request.url === "/rest/v1/rpc/authorize_realtime_session") {
        authorizationContacts += 1;
        const body = JSON.parse(bytes.toString("utf8"));
        expect(request.method).toBe("POST");
        expect(request.headers.apikey).toBe("e2e-publishable");
        expect(request.headers.authorization?.startsWith("Bearer ")).toBe(true);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(allowed && body.p_project_id === PROJECT && body.p_device_id === DEVICE));
      } else if (request.url === "/v1/realtime/calls") {
        expect(request.headers.authorization).toBe("Bearer synthetic-provider-key");
        const form = await new Response(bytes, { headers: { "content-type": request.headers["content-type"]! } }).formData();
        expect(await (form.get("sdp") as Blob).text()).toBe(OFFER);
        sessions.push(JSON.parse(await (form.get("session") as Blob).text()));
        if (failCreation) {
          response.writeHead(503);
          response.end("private-provider-error synthetic-provider-key");
          return;
        }
        const callId = `rtc_e2e_${++callCount}`;
        calls.add(callId);
        response.writeHead(201, { location: `/v1/realtime/calls/${callId}`, "x-request-id": `provider-request-${callCount}` });
        response.end(malformedAnswer ? "invalid-sdp-private" : "v=0\r\ns=e2e-answer\r\n");
      } else {
        const match = /^\/v1\/realtime\/calls\/(rtc_e2e_\d+)\/hangup$/.exec(request.url || "");
        if (!match || request.method !== "POST") { response.writeHead(404); response.end(); return; }
        expect(request.headers.authorization).toBe("Bearer synthetic-provider-key");
        hangups.push(match[1]);
        calls.delete(match[1]);
        await hangupAcknowledgement;
        response.writeHead(200); response.end();
      }
    } catch {
      response.writeHead(500); response.end("local-protocol-fixture-rejected");
    }
  });
  const hostedOrigin = await listen(hosted);
  const verifier = new SupabaseJwksPrincipalVerifier({ issuer: ISSUER, jwksUrl: `${hostedOrigin}/auth/v1/.well-known/jwks.json` });
  const authorizer = new SupabaseRpcProjectDeviceAuthorizer({
    supabaseUrl: "https://e2e-fiction.supabase.co", publishableKey: "e2e-publishable",
    fetchImpl: ((url, init) => {
      if (String(url) !== "https://e2e-fiction.supabase.co/rest/v1/rpc/authorize_realtime_session") throw new Error("Unexpected hosted destination.");
      return fetch(`${hostedOrigin}/rest/v1/rpc/authorize_realtime_session`, init);
    }) as typeof fetch,
  });
  const upstream = new OpenAIRealtimeUpstream({ apiKey: "synthetic-provider-key", baseUrl: hostedOrigin, timeoutMs: 1000 });
  const journal = new CallJournal(path);
  const clock = { now: () => new Date() };
  const leases = new SessionLeases({
    journal, upstream, principalVerifier: verifier, authorizer, clock,
    leaseTtlMs: options.ttl ?? 3000, maxDurationMs: 10_000,
    pollIntervalMs: options.poll ?? 500, authorizationTimeoutMs: 1000, maxCalls: 10,
  });
  await leases.initialize();
  const policy: GatewayPolicy = {
    allowedOrigins: [ORIGIN], maxRequestBytes: 4096, maxSdpBytes: 2048, requestBodyTimeoutMs: 1000,
    model: "gpt-realtime", voice: "marin", transcriptionModel: "gpt-4o-mini-transcribe",
    semanticVadEagerness: "low", instructions: "Help with this authorized fiction project.",
    tools: [{ type: "function", name: "scene_read", parameters: { type: "object" } }], allowedToolNames: ["scene_read"],
    issuanceTtlSeconds: 30, safetyIdentifierSecret: "synthetic-isolated-e2e-safety-secret",
  };
  const server = createSessionGateway({ policy, leases, dependencies: {
    principalVerifier: verifier, authorizer, upstream, clock,
    rateLimiter: new FixedWindowSessionRateLimiter({ limit: options.limit ?? 10, windowMs: 60_000 }),
    auditSink: { write: async event => { audits.push(event); } },
  } });
  const origin = await listen(server);
  function token(claims: Record<string, unknown> = {}) {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: "e2e-key", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iss: ISSUER, aud: "authenticated", sub: "author-e2e", role: "authenticated", device_id: DEVICE, session_id: SESSION, iat: now, exp: now + 300, ...claims })).toString("base64url");
    const input = `${header}.${payload}`;
    return `${input}.${sign("sha256", Buffer.from(input), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  }
  async function post(pathname = "/v1/realtime/sessions", body: object = { project_id: PROJECT, device_id: DEVICE, sdp: OFFER }, bearer = token(), headers: Record<string, string> = {}) {
    return fetch(`${origin}${pathname}`, { method: "POST", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  }
  return {
    origin, token, post, journal, path, calls, hangups, audits, sessions, releaseHangupAcknowledgement,
    authorizationContacts: () => authorizationContacts,
    revoke() { allowed = false; },
    failCreation(value: boolean) { failCreation = value; },
    malformedAnswer(value: boolean) { malformedAnswer = value; },
    async close() {
      await leases.shutdown();
      await closeServer(server);
      await closeServer(hosted);
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("backend: gateway health, origins and signed device authority reject invalid clients before allocation", async () => {
  const f = await gateway();
  try {
    const health = await fetch(`${f.origin}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });
    expect(f.authorizationContacts()).toBe(0);
    const preflight = await fetch(`${f.origin}/v1/realtime/sessions`, { method: "OPTIONS", headers: { origin: ORIGIN } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const invalid = [
      await f.post(undefined, undefined, "invalid-token"),
      await f.post(undefined, undefined, f.token({ exp: Math.floor(Date.now() / 1000) - 1 })),
      await f.post(undefined, undefined, f.token({ role: "anon" })),
      await f.post(undefined, { project_id: PROJECT, device_id: "different-phone", sdp: OFFER }),
      await f.post(undefined, { project_id: "different-book", device_id: DEVICE, sdp: OFFER }),
      await f.post(undefined, undefined, f.token(), { origin: `${ORIGIN}.attacker.example` }),
    ];
    expect(invalid.map(response => response.status)).toEqual([401, 401, 401, 403, 403, 403]);
    expect((await f.post(undefined, {})).status).toBe(400);
    expect((await f.post(undefined, [])).status).toBe(400);
    expect((await f.post(undefined, { project_id: PROJECT, device_id: DEVICE, sdp: "x".repeat(5000) })).status).toBe(413);
    expect(f.sessions).toHaveLength(0);
    expect((await fetch(`${f.origin}/v1/realtime/sessions`)).status).toBe(405);
    expect((await fetch(`${f.origin}/unavailable`)).status).toBe(404);
  } finally { await f.close(); }
});

test("backend: signed session creation clamps policy, durably registers, renews only its owner and acknowledges stop", async () => {
  const f = await gateway();
  try {
    const response = await f.post(undefined, { project_id: PROJECT, device_id: DEVICE, sdp: OFFER, session: { model: "untrusted-model", instructions: "private-client-instructions" } });
    expect(response.status).toBe(201);
    const issued = await response.json() as any;
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(f.journal.entries()).toEqual([[issued.lease_id, issued.call_id]]);
    const persisted = await readFile(f.path, "utf8");
    for (const secret of [f.token(), OFFER, DEVICE, PROJECT, "synthetic-provider-key"]) expect(persisted).not.toContain(secret);
    expect(f.sessions[0].model).toBe("gpt-realtime");
    expect(f.sessions[0].instructions).toBe("Help with this authorized fiction project.");
    expect(f.sessions[0].tools.map(tool => tool.name)).toEqual(["scene_read"]);
    const scope = { project_id: PROJECT, device_id: DEVICE };
    const adoption = await f.post(`/v1/realtime/sessions/${issued.lease_id}/renew`, scope, f.token({ session_id: "10000000-0000-4000-8000-000000000002" }));
    expect(adoption.status).toBe(403);
    expect(f.calls.size).toBe(1);
    const renewed = await f.post(`/v1/realtime/sessions/${issued.lease_id}/renew`, scope, f.token({ exp: Math.floor(Date.now() / 1000) + 600 }));
    expect(renewed.status).toBe(200);
    const receipt = await renewed.json() as any;
    expect(receipt.expires_at).toBe(issued.expires_at);
    expect(receipt.lease_id).toBe(issued.lease_id);
    expect(f.sessions).toHaveLength(1);
    const stopped = await f.post(`/v1/realtime/sessions/${issued.lease_id}/stop`, scope);
    expect(stopped.status).toBe(200);
    expect(await stopped.json()).toEqual({ stopped: true });
    expect(f.calls.size).toBe(0);
    expect(f.journal.entries()).toHaveLength(0);
    expect(f.hangups).toEqual([issued.call_id]);
    expect((await f.post(`/v1/realtime/sessions/${issued.lease_id}/renew`, scope)).status).toBe(410);
    const audit = JSON.stringify(f.audits);
    for (const secret of [PROJECT, DEVICE, OFFER, "author-e2e", "private-client-instructions", "synthetic-provider-key"]) expect(audit).not.toContain(secret);
  } finally { await f.close(); }
});

test("backend: revocation and unrenewed expiry independently end known calls", async () => {
  for (const revoke of [true, false]) {
    const f = await gateway({ ttl: revoke ? 5000 : 300, poll: 50, holdHangupAcknowledgement: true });
    try {
      const issued = await (await f.post()).json() as any;
      if (revoke) f.revoke();
      await expect.poll(() => f.calls.size, { timeout: revoke ? 1000 : 3000, interval: 25 }).toBe(0);
      if (revoke) expect(Date.now()).toBeLessThan(Date.parse(issued.lease_expires_at));
      // Provider removal precedes its HTTP acknowledgement; keep recovery
      // records until the production adapter has received that acknowledgement.
      expect(f.journal.entries()).toEqual([[issued.lease_id, issued.call_id]]);
      expect(JSON.parse(await readFile(f.path, "utf8")).calls).toEqual([[issued.lease_id, issued.call_id]]);
      expect(f.hangups).toEqual([issued.call_id]);
      f.releaseHangupAcknowledgement();
      await expect.poll(() => f.journal.entries().length, { timeout: revoke ? 1000 : 3000, interval: 25 }).toBe(0);
      expect(JSON.parse(await readFile(f.path, "utf8")).calls).toHaveLength(0);
      expect(f.calls.size).toBe(0);
      expect(f.hangups).toEqual([issued.call_id]);
      expect((await f.post(`/v1/realtime/sessions/${issued.lease_id}/renew`, { project_id: PROJECT, device_id: DEVICE })).status).toBe(410);
    } finally { f.releaseHangupAcknowledgement(); await f.close(); }
  }
});

test("backend: issuance quota limits retries without consuming another slot for renewal or stop", async () => {
  const f = await gateway({ limit: 1 });
  try {
    const issued = await (await f.post()).json() as any;
    const scope = { project_id: PROJECT, device_id: DEVICE };
    expect((await f.post(`/v1/realtime/sessions/${issued.lease_id}/renew`, scope)).status).toBe(200);
    expect((await f.post(`/v1/realtime/sessions/${issued.lease_id}/stop`, scope)).status).toBe(200);
    const refused = await f.post();
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await refused.json() as any).error.code).toBe("rate_limited");
    expect(f.sessions).toHaveLength(1);
  } finally { await f.close(); }
});

test("backend: upstream failure hides private bodies and malformed answers tear down the registered call", async () => {
  const f = await gateway();
  try {
    f.failCreation(true);
    const unavailable = await f.post();
    expect(unavailable.status).toBe(502);
    expect(await unavailable.text()).not.toContain("private-provider-error");
    expect(f.journal.entries()).toHaveLength(0);
    f.failCreation(false);
    f.malformedAnswer(true);
    const malformed = await f.post();
    expect(malformed.status).toBe(502);
    expect(await malformed.text()).not.toContain("invalid-sdp-private");
    expect(f.calls.size).toBe(0);
    expect(f.hangups).toEqual(["rtc_e2e_1"]);
    expect(f.journal.entries()).toHaveLength(0);
    f.malformedAnswer(false);
    expect((await f.post()).status).toBe(201);
  } finally { await f.close(); }
});
