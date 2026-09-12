import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAuthStorage, createCompanionAccount } from "./account";
import { deploymentScope, nativeSecrets } from "./secretStore";

const userId = "10000000-0000-4000-8000-000000000001";
const deviceId = "20000000-0000-4000-8000-000000000001";
function fixture() {
  const claims = { sub: userId, role: "authenticated", exp: Date.now() / 1000 + 3600, device_id: deviceId };
  const session = { access_token: "verified-token", user: { id: userId, email: "author@example.com" } };
  const client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
      getClaims: vi.fn(async () => ({ data: { claims }, error: null })),
      signInWithPassword: vi.fn(async () => ({ data: { session }, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
      refreshSession: vi.fn(async () => ({ data: { session }, error: null })),
    },
    rpc: vi.fn(async () => ({ data: {}, error: null })),
  };
  return { client, claims, session, account: createCompanionAccount(client as unknown as SupabaseClient) };
}

describe("desktop companion account", () => {
  it("uses signature-verified identity and retrieves a refreshed token for every request", async () => {
    const f = fixture();
    expect((await f.account.session({ userId, deviceId }))?.accessToken).toBe("verified-token");
    f.session.access_token = "refreshed-token";
    expect((await f.account.session({ userId, deviceId }))?.accessToken).toBe("refreshed-token");
    expect(f.client.auth.getClaims).toHaveBeenLastCalledWith("refreshed-token");
    await f.account.signOut();
    expect(f.client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it.each(["expired", "role", "account", "device"])("rejects %s session identity", async (reason) => {
    const f = fixture();
    if (reason === "expired") f.claims.exp = 1;
    if (reason === "role") f.claims.role = "anon";
    if (reason === "account") f.claims.sub = deviceId;
    if (reason === "device") f.claims.device_id = userId;
    await expect(f.account.session({ userId, deviceId })).rejects.toThrow("could not be verified");
  });

  it("discards an unverified sign-in and hides raw backend errors", async () => {
    const f = fixture();
    f.claims.role = "anon";
    await expect(f.account.signIn("author@example.com", "password")).rejects.toThrow("could not be verified");
    expect(f.client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    f.client.rpc.mockResolvedValue({ data: null, error: { message: "raw manuscript or token" } } as never);
    await expect(f.account.rpc("name", {})).rejects.toThrow("refused by the backend");
  });

  it("isolates credential slots by deployment and fails closed without a native vault", async () => {
    const secrets = { get: vi.fn(async () => null), set: vi.fn(), remove: vi.fn(), create: vi.fn() };
    const first = await deploymentScope("https://one.supabase.co/");
    const second = await deploymentScope("https://two.supabase.co/");
    const a = createAuthStorage(first, secrets);
    const b = createAuthStorage(second, secrets);
    await a.setItem("supabase-session", "session-json");
    await b.setItem("supabase-session", "other-session-json");
    expect(secrets.set.mock.calls[0][0]).not.toBe(secrets.set.mock.calls[1][0]);
    expect(secrets.set.mock.calls[0][0]).toMatch(/^auth-[a-f0-9]{64}-[a-f0-9]{64}$/);
    await expect(nativeSecrets.get("auth-test")).rejects.toThrow("requires the macOS desktop app");
    for (const url of ["http://example.com", "https://user:password@example.com", "https://example.com/path"]) {
      await expect(deploymentScope(url)).rejects.toThrow("HTTPS backend origin");
    }
  });
});
