import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { BrowserStorage } from "../src/adapters/browserStorage";
import { EncryptedFileSnapshotCache } from "../src/adapters/encryptedSnapshotCache.web";
import { EncryptedAuthStorage, type LegacyAuthStorage } from "../src/core/encryptedAuthStorage";

const base = "sb-test-auth-token";
function setup() {
  const deployment = `https://${crypto.randomUUID()}.example.test`;
  const storage = new BrowserStorage(`auth-${crypto.randomUUID()}`);
  const encrypted = new EncryptedFileSnapshotCache(storage);
  const legacyValues = new Map<string, string>();
  const legacy: LegacyAuthStorage = {
    getItem: async (key) => legacyValues.get(key) ?? null,
    removeItem: async (key) => { legacyValues.delete(key); },
    getAllKeys: async () => [...legacyValues.keys()],
  };
  const input = { deployment, base, encrypted, legacy };
  return { storage, encrypted, legacy, legacyValues, input, auth: new EncryptedAuthStorage(input) };
}

describe("native sign-in encryption and safe upgrade", () => {
  it("stores a large session encrypted and reopens without a plaintext KV copy", async () => {
    const { auth, input, storage, legacyValues } = setup();
    const session = JSON.stringify({ refresh_token: "Private-refresh-token", user_metadata: "x".repeat(5000) });
    await auth.setItem(base, session);
    expect(legacyValues.size).toBe(0);
    expect(await new EncryptedAuthStorage(input).getItem(base)).toBe(session);
    const raw = await storage.transaction<unknown[]>("records", "readonly", (records, done) => {
      const request = records.getAll(); request.onsuccess = () => done(request.result);
    });
    expect(JSON.stringify(raw)).not.toContain("Private-refresh-token");
  });

  it("migrates each legacy auth key only after encrypted readback verification", async () => {
    const { input, legacyValues } = setup();
    legacyValues.set(base, "legacy-session");
    legacyValues.set(`${base}-code-verifier`, "private-verifier");
    let verified = false;
    const encrypted = {
      loadRecovery: async (scope: string) => { const value = await input.encrypted.loadRecovery(scope); if (value !== null) verified = true; return value; },
      saveRecovery: (scope: string, value: string) => input.encrypted.saveRecovery(scope, value),
      deleteRecovery: (scope: string) => input.encrypted.deleteRecovery(scope),
    };
    const auth = new EncryptedAuthStorage({ ...input, encrypted, legacy: { ...input.legacy, removeItem: async (key) => { expect(verified).toBe(true); legacyValues.delete(key); } } });
    expect(await auth.getItem(base)).toBe("legacy-session");
    expect(await auth.getItem(`${base}-code-verifier`)).toBe("private-verifier");
    expect(legacyValues.size).toBe(0);
    expect(await new EncryptedAuthStorage(input).getItem(base)).toBe("legacy-session");
  });

  it("preserves legacy sign-in recovery when encryption or quota fails", async () => {
    const { input, legacyValues } = setup();
    legacyValues.set(base, "legacy-session");
    const auth = new EncryptedAuthStorage({ ...input, encrypted: { ...input.encrypted,
      loadRecovery: (scope) => input.encrypted.loadRecovery(scope),
      saveRecovery: async () => { throw new DOMException("No encrypted storage", "QuotaExceededError"); },
      deleteRecovery: (scope) => input.encrypted.deleteRecovery(scope),
    } });
    await expect(auth.getItem(base)).rejects.toThrow("No encrypted storage");
    expect(legacyValues.get(base)).toBe("legacy-session");
    expect(await new EncryptedAuthStorage(input).getItem(base)).toBe("legacy-session");
    expect(legacyValues.has(base)).toBe(false);
  });

  it("keeps legacy plaintext when encrypted readback fails instead of claiming migration", async () => {
    const { input, legacyValues } = setup();
    legacyValues.set(base, "legacy-session");
    const auth = new EncryptedAuthStorage({ ...input, encrypted: {
      loadRecovery: async () => null,
      saveRecovery: (scope, value) => input.encrypted.saveRecovery(scope, value),
      deleteRecovery: (scope) => input.encrypted.deleteRecovery(scope),
    } });
    await expect(auth.getItem(base)).rejects.toThrow("verification failed");
    expect(legacyValues.get(base)).toBe("legacy-session");
  });

  it("retries a legacy-deletion failure using the verified encrypted copy", async () => {
    const { input, legacyValues } = setup();
    legacyValues.set(base, "legacy-session");
    let denied = true;
    const auth = new EncryptedAuthStorage({ ...input, legacy: { ...input.legacy, removeItem: async (key) => {
      if (denied) throw new Error("Legacy cleanup unavailable");
      legacyValues.delete(key);
    } } });
    await expect(auth.getItem(base)).rejects.toThrow("Legacy cleanup unavailable");
    expect(legacyValues.get(base)).toBe("legacy-session");
    denied = false;
    expect(await auth.getItem(base)).toBe("legacy-session");
    expect(legacyValues.size).toBe(0);
  });

  it("preserves session and PKCE writes from simultaneous adapter instances", async () => {
    const { auth, input } = setup();
    const other = new EncryptedAuthStorage(input);
    await Promise.all([auth.setItem(base, "session-one"), other.setItem(`${base}-code-verifier`, "verifier-one")]);
    expect(await other.getItem(base)).toBe("session-one");
    expect(await auth.getItem(`${base}-code-verifier`)).toBe("verifier-one");
    await auth.removeItem(base);
    expect(await other.getItem(base)).toBeNull();
    expect(await other.getItem(`${base}-code-verifier`)).toBe("verifier-one");
  });

  it("rejects corrupted encrypted records without falling back to legacy plaintext", async () => {
    const { input, legacyValues, storage, auth } = setup();
    await auth.setItem(base, "encrypted-session");
    legacyValues.set(base, "older-legacy-session");
    const slots = await storage.keys("companion-recovery:");
    await storage.set(slots[0]!, JSON.stringify({ version: 1, scope: "another-deployment", values: { [base]: "wrong-session" } }));
    await expect(auth.getItem(base)).rejects.toThrow("No saved book or capture was deleted");
    expect(legacyValues.get(base)).toBe("older-legacy-session");
  });

  it("clears encrypted and legacy auth including corrupt data, retaining other books and deployments", async () => {
    const { auth, input, legacyValues, storage } = setup();
    await auth.setItem(base, "session");
    legacyValues.set(base, "stale-legacy");
    legacyValues.set(`${base}-code-verifier`, "verifier");
    legacyValues.set("unrelated-key", "keep");
    const other = new EncryptedAuthStorage({ ...input, deployment: `${input.deployment}/other` });
    await other.setItem(base, "other-session");
    await storage.set("snapshot:book-one", "encrypted-book");
    await auth.clear();
    expect(await auth.getItem(base)).toBeNull();
    expect(await other.getItem(base)).toBe("other-session");
    expect(legacyValues).toEqual(new Map([["unrelated-key", "keep"]]));
    expect(await storage.get("snapshot:book-one")).toBe("encrypted-book");
  });

  it("attempts every cleanup even if encrypted deletion fails and reports content-free failure", async () => {
    const { input, legacyValues } = setup();
    legacyValues.set(base, "private-session");
    legacyValues.set(`${base}-code-verifier`, "private-verifier");
    const auth = new EncryptedAuthStorage({ ...input, encrypted: {
      loadRecovery: (scope) => input.encrypted.loadRecovery(scope),
      saveRecovery: (scope, value) => input.encrypted.saveRecovery(scope, value),
      deleteRecovery: async () => { throw new Error("Sensitive internal path"); },
    } });
    await expect(auth.clear()).rejects.toThrow("Sign-in storage cleanup did not finish safely");
    expect(legacyValues.size).toBe(0);
  });

  it("does not recreate encrypted files when the SDK removes a missing session during device cleanup", async () => {
    const { auth, storage } = setup();
    await auth.removeItem(base);
    expect(await storage.keys("companion-recovery:")).toEqual([]);
    expect(() => auth.setItem("unrelated-key", "private")).toThrow();
  });
});
