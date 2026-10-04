import "fake-indexeddb/auto";
import { createClient, type SupportedStorage } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { BrowserStorage } from "../src/adapters/browserStorage";
import { EncryptedFileSnapshotCache } from "../src/adapters/encryptedSnapshotCache.web";
import { EncryptedAuthStorage } from "../src/core/encryptedAuthStorage";

const base = "sb-lease-test-auth-token";
const session = JSON.stringify({ access_token: "fixture-old-access", refresh_token: "fixture-refresh", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "fixture-user" } });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe("closed auth storage leases", () => {
  it.each(["native", "browser"] as const)("withholds a late real-SDK refresh after %s offline cleanup and permits fresh sign-in", async (platform) => {
    const storage = new BrowserStorage(`lease-${crypto.randomUUID()}`);
    const deployment = `https://${crypto.randomUUID()}.example.test`;
    const encrypted = new EncryptedFileSnapshotCache(storage);
    const legacyValues = new Map<string, string>();
    const nativeInput = { deployment, base, encrypted, legacy: {
      getItem: async (key: string) => legacyValues.get(key) ?? null,
      removeItem: async (key: string) => { legacyValues.delete(key); },
      getAllKeys: async () => [...legacyValues.keys()],
    } };
    const browserPrefix = `auth:${base}`;
    const adapter = () => {
      if (platform === "native") return new EncryptedAuthStorage(nativeInput);
      const lease = storage.authLease(browserPrefix);
      return { getItem: (key: string) => lease.get(`auth:${key}`), setItem: (key: string, value: string) => lease.set(`auth:${key}`, value), removeItem: (key: string) => lease.delete(`auth:${key}`) };
    };
    const auth = adapter();
    await auth.setItem(base, session);
    await storage.set("snapshot:book-one", "retained encrypted snapshot");
    await storage.set("companion-recovery:book-one", "retained unfinished capture");
    let requests = 0, hold = false;
    const started = deferred(), release = deferred();
    const sdkStorage: SupportedStorage = {
      getItem: key => auth.getItem(key), removeItem: key => auth.removeItem(key),
      setItem: async (key, value) => { if (hold && key === base) { started.resolve(); await release.promise; } await auth.setItem(key, value); },
    };
    const fetch = async () => {
      requests++;
      return new Response(JSON.stringify({ access_token: "fixture-new-access", refresh_token: "fixture-new-refresh", token_type: "bearer", expires_in: 3600, user: { id: "fixture-user" } }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const client = createClient(deployment, "fixture-public", { global: { fetch }, auth: { storageKey: base, storage: sdkStorage, autoRefreshToken: false, persistSession: true, detectSessionInUrl: false } });
    try {
      await client.auth.getSession();
      hold = true;
      const refresh = client.auth.refreshSession().catch(error => error);
      await started.promise;
      await client.auth.dispose();
      if (platform === "native") await new EncryptedAuthStorage(nativeInput).clear();
      else await storage.clearAuth(browserPrefix);
      const afterCleanup = requests;
      expect(await adapter().getItem(base)).toBeNull();
      release.resolve();
      await refresh;
      expect(requests).toBe(afterCleanup);
      expect(await adapter().getItem(base)).toBeNull();
      expect(await storage.get("snapshot:book-one")).toBe("retained encrypted snapshot");
      expect(await storage.get("companion-recovery:book-one")).toBe("retained unfinished capture");
      const fresh = adapter();
      const next = createClient(deployment, "fixture-public", { global: { fetch }, auth: { storageKey: base, storage: fresh, autoRefreshToken: false, persistSession: true, detectSessionInUrl: false } });
      try {
        expect((await next.auth.signInWithPassword({ email: "fixture@example.test", password: "fixture-password" })).error).toBeNull();
        expect(await fresh.getItem(base)).not.toBeNull();
        await auth.removeItem(base);
        expect(await fresh.getItem(base)).not.toBeNull();
        expect(await auth.getItem(base)).toBeNull();
      } finally { await next.auth.dispose(); }
    } finally { release.resolve(); await client.auth.dispose(); }
  });

  it("atomically rejects an encrypted write from another tab after the auth generation changes", async () => {
    const name = `lease-${crypto.randomUUID()}`;
    const first = new BrowserStorage(name), second = new BrowserStorage(name);
    const prefix = `auth:${base}`;
    const old = first.authLease(prefix);
    await old.set(prefix, session);
    const original = crypto.subtle.encrypt.bind(crypto.subtle);
    const encrypted = deferred(), release = deferred();
    const encrypt = vi.spyOn(crypto.subtle, "encrypt").mockImplementation(async (...args) => {
      const bytes = await original(...args);
      encrypted.resolve(); await release.promise;
      return bytes;
    });
    try {
      const pending = old.set(prefix, "late credential write");
      const rejected = expect(pending).rejects.toThrow("session was closed");
      await encrypted.promise;
      await second.clearAuth(prefix);
      release.resolve(); await rejected;
      expect(await first.get(prefix)).toBeNull();
    } finally { release.resolve(); encrypt.mockRestore(); }
    const fresh = second.authLease(prefix);
    await fresh.set(prefix, "explicit fresh sign-in");
    await old.delete(prefix);
    expect(await fresh.get(prefix)).toBe("explicit fresh sign-in");
    expect(await old.get(prefix)).toBeNull();
  });
});
