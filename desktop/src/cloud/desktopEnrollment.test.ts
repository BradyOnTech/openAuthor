import { describe, expect, it, vi } from "vitest";
import sodium from "libsodium-wrappers";
import { enrollDesktopForProject } from "./desktopEnrollment";
import type { CompanionAccount } from "./account";
import type { DesktopSecretStore } from "./secretStore";

const userId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000001";
const scope = "a".repeat(64);
function fixture() {
  const records = new Map<string, string>();
  const events: string[] = [];
  const secrets: DesktopSecretStore = {
    get: vi.fn(async (key) => records.get(key) ?? null),
    set: vi.fn(async (key, value) => { records.set(key, value); }),
    remove: vi.fn(async (key) => { records.delete(key); }),
    create: vi.fn(async (key, value) => {
      events.push("persist");
      if (!records.has(key)) records.set(key, value);
      return records.get(key)!;
    }),
  };
  const registered: Record<string, unknown>[] = [];
  let envelopes: unknown[] = [];
  const account: CompanionAccount = {
    session: vi.fn(async () => ({ userId, email: "author@example.com", accessToken: "verified-token" })),
    signIn: vi.fn(), signOut: vi.fn(), refresh: vi.fn(),
    rpc: vi.fn(async (name, params) => {
      events.push(name);
      if (name === "mobile_register_device") { registered.push(params); return { id: params.p_device_id }; }
      if (name === "mobile_get_project_key_envelopes") return envelopes;
      return {};
    }),
  };
  const run = () => enrollDesktopForProject({ scope, projectId, secrets, account });
  return { run, account, secrets, records, events, registered, setEnvelopes: (next: unknown[]) => { envelopes = next; } };
}

describe("durable desktop enrollment", () => {
  it("persists before registration and reuses the same identity after restart", async () => {
    const f = fixture();
    const first = await f.run();
    const second = await f.run();
    expect(f.events[0]).toBe("persist");
    expect(first.deviceId).toBe(second.deviceId);
    const saved = JSON.parse([...f.records.values()][0]);
    expect(first.deviceKey).toEqual({ keyId: saved.keyId, publicKey: saved.publicKey });
    expect(second.deviceKey).toEqual(first.deviceKey);
    expect(f.secrets.create).toHaveBeenCalledTimes(1);
    expect(f.registered[0]).toEqual(f.registered[1]);
    expect(JSON.stringify(f.registered)).not.toContain("privateKey");
    expect(f.account.session).toHaveBeenCalledWith({ userId, deviceId: first.deviceId });
    expect(await first.accessToken()).toBe("verified-token");
  });

  it("retries an ambiguous registration with the persisted key rather than registering a new device", async () => {
    const f = fixture();
    vi.mocked(f.account.rpc).mockRejectedValueOnce(new Error("Response lost"));
    await expect(f.run()).rejects.toThrow("Response lost");
    const original = JSON.parse([...f.records.values()][0]);
    const retried = await f.run();
    expect(retried.deviceId).toBe(original.deviceId);
    expect(f.secrets.create).toHaveBeenCalledTimes(1);
  });

  it("does not register anything if secure persistence fails", async () => {
    const f = fixture();
    vi.mocked(f.secrets.create).mockRejectedValue(new Error("Keychain locked"));
    await expect(f.run()).rejects.toThrow("Keychain locked");
    expect(f.account.rpc).not.toHaveBeenCalled();
  });

  it("atomically chooses one identity when two enrollment attempts overlap", async () => {
    const f = fixture();
    const [first, second] = await Promise.all([f.run(), f.run()]);
    expect(first.deviceId).toBe(second.deviceId);
    expect(f.registered[0]).toEqual(f.registered[1]);
  });

  it("unseals multiple key versions after restart as non-extractable keys", async () => {
    const f = fixture();
    const initial = await f.run();
    const saved = JSON.parse([...f.records.values()][0]);
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const sealed = sodium.crypto_box_seal(raw, sodium.from_base64(saved.publicKey, sodium.base64_variants.URLSAFE_NO_PADDING));
    const digest = sodium.to_hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(sealed).buffer)));
    const envelope = {
      project_id: projectId, recipient_device_id: initial.deviceId, recipient_key_id: saved.keyId,
      algorithm: "x25519-xsalsa20-poly1305-sealedbox-v1", sealed_project_key: `\\x${sodium.to_hex(sealed)}`,
      sealed_project_key_sha256: digest,
    };
    f.setEnvelopes([{ ...envelope, key_version: 1 }, { ...envelope, key_version: 3 }]);
    const restored = await f.run();
    expect([...restored.projectKeys.keys()]).toEqual([1, 3]);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const original = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, original, new TextEncoder().encode("Chapter one"));
    const key = restored.projectKeys.get(3)!;
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
    expect(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext))).toBe("Chapter one");
    f.setEnvelopes([{ ...envelope, key_version: 3, sealed_project_key_sha256: "0".repeat(64) }]);
    await expect(f.run()).rejects.toThrow("checksum mismatch");
    f.setEnvelopes([{ ...envelope, key_version: 3, project_id: userId }]);
    await expect(f.run()).rejects.toThrow("identity mismatch");
  });

  it("refuses a mismatched saved account and a wrong device claim", async () => {
    const f = fixture();
    await f.run();
    const slot = [...f.records.keys()][0];
    const original = f.records.get(slot)!;
    f.records.set(slot, JSON.stringify({ ...JSON.parse(original), userId: projectId }));
    vi.mocked(f.account.rpc).mockClear();
    await expect(f.run()).rejects.toThrow("does not match this account");
    expect(f.account.rpc).not.toHaveBeenCalled();
    f.records.set(slot, original);
    vi.mocked(f.account.session).mockImplementation(async (expected) => {
      if (expected?.deviceId) throw new Error("Wrong device claim");
      return { userId, email: "author@example.com", accessToken: "verified-token" };
    });
    await expect(f.run()).rejects.toThrow("Wrong device claim");
    expect(f.account.rpc).toHaveBeenCalledTimes(1);
  });

  it("never silently generates replacement keys for corrupt stored material", async () => {
    const f = fixture();
    f.records.set(`device-${scope}-${userId}`, "corrupt");
    await expect(f.run()).rejects.toThrow("saved device identity is invalid");
    expect(f.secrets.create).not.toHaveBeenCalled();
    expect(f.account.rpc).not.toHaveBeenCalled();
  });

  it("fences a later sign-in to the same account/device while permitting token refresh in the original signed session", async () => {
    const f = fixture();
    let sessionId = "80000000-0000-4000-8000-000000000001";
    let expiration = 3000000000;
    vi.mocked(f.account.session).mockImplementation(async () => ({ userId, email: "author@example.com", accessToken: `${btoa("{}")} .${btoa(JSON.stringify({ session_id: sessionId, exp: expiration }))}.synthetic`.replace(" ", "") }));
    const enrolled = await f.run();
    expiration++;
    await expect(enrolled.accessToken()).resolves.toContain("synthetic");
    sessionId = "80000000-0000-4000-8000-000000000002";
    await expect(enrolled.accessToken()).rejects.toThrow("session changed");
  });
});
