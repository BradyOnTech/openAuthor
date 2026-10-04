import { expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { createClient } from "~/Developer/openAuthor/desktop/node_modules/@supabase/supabase-js/dist/index.mjs";
import { createAuthStorage, createCompanionAccount } from "/private/tmp/openauthor-desktop-grouped-updates/desktop/src/cloud/account.ts";

const userId = "10000000-0000-4000-8000-000000000001";
const deviceId = "20000000-0000-4000-8000-000000000001";
const sessionId = "30000000-0000-4000-8000-000000000001";
let sequence = 0;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function fixture(holdRefresh = false) {
  const url = `https://review-${++sequence}.invalid`;
  const slots = new Map<string, string>();
  const storage = createAuthStorage(`protocol-review-${sequence}`, {
    get: async key => slots.get(key) ?? null,
    set: async (key, value) => { slots.set(key, value); },
    remove: async key => { slots.delete(key); },
    create: async (key, value) => { if (!slots.has(key)) slots.set(key, value); return slots.get(key)!; },
  });
  const storageKey = `review-session-${sequence}`;
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: `review-${sequence}`, alg: "ES256", use: "sig" };
  function session(label: string, lifetime = 3600, claims: object = {}) {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: jwk.kid, typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iss: `${url}/auth/v1`, aud: "authenticated", sub: userId, role: "authenticated", device_id: deviceId, session_id: sessionId, iat: now, exp: now + lifetime, jti: label, ...claims })).toString("base64url");
    const input = `${header}.${payload}`;
    const access_token = `${input}.${sign("sha256", Buffer.from(input), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
    return { access_token, refresh_token: `synthetic-refresh-${label}`, token_type: "bearer", expires_in: lifetime, expires_at: now + lifetime, user: { id: userId, aud: "authenticated", email: "synthetic@example.invalid", created_at: new Date().toISOString() } };
  }
  const expired = session("expired", -60);
  const winning = session("winning");
  const staleResponse = session("losing-refresh");
  const started = deferred();
  const acknowledge = deferred();
  if (!holdRefresh) acknowledge.resolve();
  const requests: { path: string; method: string; authorization: string | null; body: unknown }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const parsed = new URL(request.url);
    expect(parsed.origin).toBe(url);
    const rawBody = request.method === "POST" ? await request.text() : "";
    const body = rawBody && request.headers.get("content-type")?.includes("application/json") ? JSON.parse(rawBody) : null;
    requests.push({ path: parsed.pathname + parsed.search, method: request.method, authorization: request.headers.get("authorization"), body });
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    if (parsed.pathname === "/auth/v1/.well-known/jwks.json") return json({ keys: [jwk] });
    if (parsed.pathname === "/auth/v1/token" && parsed.searchParams.get("grant_type") === "password") return json(winning);
    if (parsed.pathname === "/auth/v1/token" && parsed.searchParams.get("grant_type") === "refresh_token") {
      started.resolve();
      await acknowledge.promise;
      return json(staleResponse);
    }
    if (parsed.pathname === "/auth/v1/logout") return new Response(null, { status: 204 });
    if (parsed.pathname === "/rest/v1/rpc/mobile_get_account_deletion") return json({ owned: true });
    if (parsed.pathname === "/rest/v1/rpc/mobile_amend_account_deletion") return json({ code: "40001", message: "Synthetic transaction refusal", details: null, hint: null }, 409);
    throw new Error(`Unexpected local protocol route ${parsed.pathname}`);
  };
  const client = createClient(url, "synthetic-publishable-key", { auth: { storage, storageKey, autoRefreshToken: false, persistSession: true, detectSessionInUrl: false }, global: { fetch: fetchImpl } });
  await client.auth.initialize();
  const account = createCompanionAccount(client);
  return { account, client, storage, storageKey, expired, winning, staleResponse, session, requests, started, acknowledge,
    put: async (value: ReturnType<typeof session>) => { await storage.setItem(storageKey, JSON.stringify(value)); },
    close: async () => { acknowledge.resolve(); await client.auth.dispose(); },
  };
}

it("actual SDK: password sign-in verifies ES256 identity, refresh keeps identity, local sign-out clears storage", async () => {
  const f = await fixture();
  try {
    expect((await f.account.signIn("  synthetic@example.invalid  ", "synthetic-password")).accessToken).toBe(f.winning.access_token);
    expect(f.requests.find(request => request.path.includes("grant_type=password"))?.body).toMatchObject({ email: "synthetic@example.invalid", password: "synthetic-password" });
    expect(f.requests.some(request => request.path.endsWith("jwks.json"))).toBe(true);
    let identities = 0;
    const stop = f.account.onIdentityChange!(() => { identities += 1; });
    await f.account.refresh();
    expect(identities).toBe(0);
    expect(await f.account.rpc("mobile_get_account_deletion", {})).toEqual({ owned: true });
    expect(f.requests.at(-1)?.authorization).toBe(`Bearer ${f.staleResponse.access_token}`);
    await expect(f.account.rpc("mobile_amend_account_deletion", {})).rejects.toMatchObject({ name: "CompanionRpcRefusal" });
    await f.account.signOut();
    expect(f.requests.some(request => request.path === "/auth/v1/logout?scope=local")).toBe(true);
    expect(await f.storage.getItem(f.storageKey)).toBeNull();
    expect(await f.account.session()).toBeNull();
    expect(identities).toBe(1);
    stop();
  } finally { await f.close(); }
});

it("actual SDK: a lost refresh race returns and verifies the winning stored token for the next RPC", async () => {
  const f = await fixture(true);
  try {
    await f.put(f.expired);
    const current = f.account.session({ userId, deviceId });
    await f.started.promise;
    await f.put(f.winning);
    f.acknowledge.resolve();
    expect((await current)?.accessToken).toBe(f.winning.access_token);
    expect(JSON.parse((await f.storage.getItem(f.storageKey))!).refresh_token).toBe(f.winning.refresh_token);
    expect(await f.account.rpc("mobile_get_account_deletion", {})).toEqual({ owned: true });
    expect(f.requests.at(-1)?.authorization).toBe(`Bearer ${f.winning.access_token}`);
  } finally { await f.close(); }
});

it("actual SDK: clearing storage during a refresh fails closed without resurrecting the losing session", async () => {
  const f = await fixture(true);
  try {
    await f.put(f.expired);
    const current = f.account.session({ userId, deviceId });
    const rejected = expect(current).rejects.toThrow("could not be restored");
    await f.started.promise;
    await f.storage.removeItem(f.storageKey);
    f.acknowledge.resolve();
    await rejected;
    expect(await f.storage.getItem(f.storageKey)).toBeNull();
    expect(f.requests.some(request => request.path.startsWith("/rest/"))).toBe(false);
  } finally { await f.close(); }
});

it("actual SDK: a signed token for another device is refused by the wrapper", async () => {
  const f = await fixture();
  try {
    await f.put(f.session("wrong-device", 3600, { device_id: userId }));
    await expect(f.account.session({ userId, deviceId })).rejects.toThrow("could not be verified");
  } finally { await f.close(); }
});

it("actual SDK: an invalid ES256 signature is refused by getClaims and the wrapper", async () => {
  const f = await fixture();
  try {
    const invalid = { ...f.winning, access_token: f.winning.access_token.split(".").slice(0, 2).join(".") + "." + Buffer.alloc(64).toString("base64url") };
    await f.put(invalid);
    await expect(f.account.session({ userId, deviceId })).rejects.toThrow("could not be verified");
  } finally { await f.close(); }
});
