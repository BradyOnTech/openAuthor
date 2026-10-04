import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECT_KEY_VERIFIER_PLAINTEXT, projectKeyVerifierAdditionalData, type ProjectKeyVerifier } from "@openauthor/contracts";

const state = vi.hoisted(() => ({
  userId: "10000000-0000-4000-8000-000000000001", deviceId: "40000000-0000-4000-8000-000000000001",
  keyId: "41000000-0000-4000-8000-000000000001", sessionId: "11000000-0000-4000-8000-000000000001",
  token: "token1", offline: false, secrets: new Map<string, string>(), local: new Map<string, string>(),
  witness: null as ProjectKeyVerifier | null, activeVersion: 4, manifest: null as Record<string, unknown> | null,
  calls: [] as string[], gate: null as null | (() => Promise<void>), writes: [] as string[],
  localWriteGate: null as null | (() => Promise<void>),
  keyWriteGate: null as null | (() => Promise<void>),
  accessWriteGate: null as null | (() => Promise<void>),
  authListeners: new Set<(event: string, session: { access_token: string; user: { id: string } } | null) => void>(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" }, AppState: { addEventListener: () => ({ remove() {} }) } }));
vi.mock("expo", () => ({ NativeModule: class {}, registerWebModule: (type: new () => unknown) => new type() }));
vi.mock("expo-modules-core", () => ({ CodedError: class extends Error {} }));
vi.mock("expo-crypto/src/aes/ExpoCryptoAES", async () => await vi.importActual("expo-crypto/src/aes/ExpoCryptoAES.web"));
vi.mock("expo-crypto", async () => {
  const aes = await vi.importActual<Record<string, unknown>>("expo-crypto/src/aes/index");
  return { ...aes, randomUUID: () => crypto.randomUUID(), CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    digest: (algorithm: string, bytes: BufferSource) => crypto.subtle.digest(algorithm, bytes) };
});
vi.mock("expo-network", () => ({ getNetworkStateAsync: async () => ({ isConnected: !state.offline, isInternetReachable: !state.offline }) }));
vi.mock("expo-secure-store", () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
  getItemAsync: async (key: string) => state.secrets.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    state.writes.push(key);
    if (key.startsWith("openauthor.project.")) await state.keyWriteGate?.();
    if (key === "openauthor.mobile.local-access.v1" && JSON.parse(value).state === "active") await state.accessWriteGate?.();
    state.secrets.set(key, value);
  },
  deleteItemAsync: async (key: string) => { state.secrets.delete(key); },
}));
vi.mock("expo-sqlite/kv-store", () => ({ default: {
  getItem: async (key: string) => state.local.get(key) ?? null,
  setItem: async (key: string, value: string) => { await state.localWriteGate?.(); state.local.set(key, value); },
  removeItem: async (key: string) => { state.local.delete(key); },
} }));
vi.mock("../src/adapters/downloadedBookStore", () => ({ EncryptedDownloadedBookStore: class { async list() { return []; } } }));
vi.mock("../src/adapters/encryptedSnapshotCache", () => ({ EncryptedFileSnapshotCache: class {} }));
vi.mock("../src/adapters/sodiumDeviceCrypto", () => ({ SodiumDeviceCrypto: class {} }));
vi.mock("../src/adapters/sqliteOutboxStore", () => ({ SQLiteOutboxStore: class {} }));
vi.mock("../src/adapters/gatewayRealtime", () => ({ gatewayRealtimeDependencies() {} }));
vi.mock("../src/adapters/supabaseClient", () => ({ createMobileSupabaseClient: () => client(), asMobileSupabaseClient: (value: unknown) => value, clearMobileAuthSession: async () => {} }));

import { HostedRuntime } from "../src/app/hostedRuntime";
import { encodeRecoveryKey } from "../src/core/recoveryKey";
import { DeviceEnrollment } from "../src/core/deviceEnrollment";
import { ExpoDeviceStore, ExpoSecretStore } from "../src/adapters/expoSecrets";

const projectId = "30000000-0000-4000-8000-000000000001";
const projectKey = btoa(String.fromCharCode(...new Uint8Array(Array.from({ length: 32 }, (_, index) => index))));
const slot = `openauthor.project.${projectId}.key.4`;
const config = { supabaseUrl: "https://db.example.test", supabasePublishableKey: "public", gatewayUrl: "https://voice.example.test" };
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
function client() { return { auth: {
  signInWithPassword: async () => ({ data: { session: { access_token: state.token, user: { id: state.userId, email: "author@example.test" } } }, error: null }),
  getSession: async () => ({ data: { session: { access_token: state.token, user: { id: state.userId, email: "author@example.test" } } }, error: null }),
  getClaims: async () => ({ data: { claims: { sub: state.userId, role: "authenticated", device_id: state.deviceId, session_id: state.sessionId, exp: Date.now() / 1000 + 300 } }, error: null }),
  startAutoRefresh: async () => {}, stopAutoRefresh: async () => {}, dispose: async () => {}, signOut: async () => ({ error: null }),
  onAuthStateChange: (listener: (event: string, session: { access_token: string; user: { id: string } } | null) => void) => {
    state.authListeners.add(listener); return { data: { subscription: { unsubscribe: () => state.authListeners.delete(listener) } } };
  },
}, rpc: async (name: string, input: Record<string, unknown>) => {
  state.calls.push(name);
  if (name === "mobile_enroll_project_device") return { data: {}, error: null };
  if (name === "mobile_get_project_key_verifier") {
    await state.gate?.();
    if (input.p_expected_key_version !== state.activeVersion) return { data: null, error: { message: "stale version" } };
    return { data: state.witness, error: null };
  }
  if (name === "mobile_list_snapshot_manifests") { await state.gate?.(); return { data: state.manifest ? [state.manifest] : [], error: null }; }
  return { data: null, error: { message: "unexpected" } };
}, storage: { from: () => ({ download: () => { throw new Error("Recovery must not download manuscript ciphertext."); } }) } }; }
function device() { return { userId: state.userId, deviceId: state.deviceId, keyId: state.keyId, name: "Synthetic iOS", platform: "ios", publicKey: "public", enrolledAt: "now", projectKeySlots: [] }; }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function encrypt(plaintext: string, aad: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(projectKey), value => value.charCodeAt(0)), "AES-GCM", false, ["encrypt"]);
  const nonce = new Uint8Array(12).fill(9);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: new Uint8Array(aad) }, key, new TextEncoder().encode(plaintext)));
  return { nonce, ciphertext, digest: hex(new Uint8Array(await crypto.subtle.digest("SHA-256", ciphertext))) };
}
async function runtime() { const value = new HostedRuntime({ ...config }); await value.restoreSession({ online: true }); state.writes.length = 0; return value; }
beforeEach(async () => {
  state.userId = "10000000-0000-4000-8000-000000000001"; state.deviceId = "40000000-0000-4000-8000-000000000001";
  state.keyId = "41000000-0000-4000-8000-000000000001"; state.sessionId = "11000000-0000-4000-8000-000000000001";
  state.token = "token1"; state.offline = false; state.secrets.clear(); state.local.clear(); state.calls.length = 0; state.writes.length = 0;
  state.gate = null; state.localWriteGate = null; state.keyWriteGate = null; state.accessWriteGate = null; state.manifest = null; state.activeVersion = 4;
  state.authListeners.clear();
  state.local.set("openauthor.mobile.enrolled-device.v1", JSON.stringify(device()));
  state.secrets.set(`openauthor.device.${state.deviceId}.private-key`, "private");
  const value = await encrypt(PROJECT_KEY_VERIFIER_PLAINTEXT, projectKeyVerifierAdditionalData(projectId, 4));
  state.witness = { schema: "openauthor.mobile.project-key-verifier", schema_version: 1, project_id: projectId, key_version: 4,
    algorithm: "aes-256-gcm-v1", aad_version: 1, nonce_hex: hex(value.nonce), ciphertext_hex: hex(value.ciphertext), ciphertext_sha256: value.digest };
});

describe("HostedRuntime reviewed no-snapshot recovery", () => {
  it("retires the online Auth watch before downloaded mode, while explicit sign-out still locks local access", async () => {
    const value = await runtime(); expect(state.authListeners.size).toBe(1);
    expect((await value.openDownloadedLibrary()).downloadedOnly).toBe(true);
    expect(state.authListeners.size).toBe(0);
    for (const listener of state.authListeners) listener("SIGNED_OUT", null);
    expect((await value.openDownloadedLibrary()).downloadedOnly).toBe(true);
    await value.signOut();
    await expect(value.openDownloadedLibrary()).rejects.toThrow("Signing out locks local access");
  });
  it("rolls back local authorization when SDK replacement arrives during its final native access write", async () => {
    const value = await runtime(); await value.signOut();
    const entered = deferred(), release = deferred();
    state.accessWriteGate = async () => { entered.resolve(); await release.promise; };
    const attempt = value.signIn("author@example.test", "synthetic-password"); const rejected = expect(attempt).rejects.toThrow("identity changed");
    await entered.promise;
    state.sessionId = "11000000-0000-4000-8000-000000000002";
    const token = `head.${btoa(JSON.stringify({ sub: state.userId, device_id: state.deviceId, session_id: state.sessionId }))}.signature`;
    for (const listener of state.authListeners) listener("SIGNED_IN", { access_token: token, user: { id: state.userId } });
    // Downloaded entry must await the pending closure, even though the UI has
    // already redacted. The OS write is deliberately still in flight here.
    const downloaded = expect(value.openDownloadedLibrary()).rejects.toThrow("Signing out locks local access");
    release.resolve(); await rejected; await downloaded;
    expect(JSON.parse(state.secrets.get("openauthor.mobile.local-access.v1")!).state).toBe("locked");
    state.accessWriteGate = null;
    expect((await value.signIn("author@example.test", "synthetic-password")).userId).toBe(state.userId);
    expect(JSON.parse(state.secrets.get("openauthor.mobile.local-access.v1")!).state).toBe("active");
  });
  it("imports the authenticated current verifier without a snapshot and indexes the saved slot", async () => {
    const value = await runtime(); await value.importRecoveryKey(projectId, 4, await encodeRecoveryKey(projectKey));
    expect(state.secrets.get(slot)).toBe(projectKey);
    expect(JSON.parse(state.local.get("openauthor.mobile.enrolled-device.v1")!).projectKeySlots).toEqual([slot]);
    expect(state.calls.filter(name => name === "mobile_get_project_key_verifier")).toHaveLength(2);
    expect(state.calls).not.toContain("mobile_list_snapshot_manifests");
  });
  it("preserves the old key when a checksum-valid wrong key is provided", async () => {
    const value = await runtime(); state.secrets.set(slot, "previous-key");
    await expect(value.importRecoveryKey(projectId, 4, await encodeRecoveryKey(btoa(String.fromCharCode(...new Uint8Array(32).fill(3)))))).rejects.toThrow();
    expect(state.secrets.get(slot)).toBe("previous-key"); expect(state.writes).not.toContain(slot);
  });
  it.each(["signout", "session", "user", "device", "rotation", "downloaded", "local-lock"])("withholds a delayed proof after %s changes", async action => {
    const value = await runtime(); state.secrets.set(slot, "previous-key");
    const entered = deferred(), release = deferred(); state.gate = async () => { entered.resolve(); await release.promise; };
    const attempt = value.importRecoveryKey(projectId, 4, await encodeRecoveryKey(projectKey)); const rejected = expect(attempt).rejects.toThrow();
    await entered.promise;
    if (action === "signout") await value.signOut();
    if (action === "session") state.sessionId = "11000000-0000-4000-8000-000000000002";
    if (action === "user") state.userId = "10000000-0000-4000-8000-000000000002";
    if (action === "device") { state.keyId = "41000000-0000-4000-8000-000000000002"; state.local.set("openauthor.mobile.enrolled-device.v1", JSON.stringify(device())); }
    if (action === "rotation") state.activeVersion = 5;
    if (action === "downloaded") await value.openDownloadedLibrary();
    if (action === "local-lock") state.secrets.set("openauthor.mobile.local-access.v1", '{"version":1,"state":"locked"}');
    release.resolve(); await rejected;
    expect(state.secrets.get(slot)).toBe("previous-key"); expect(state.writes).not.toContain(slot);
  });
  it("accepts an ordinary access-token refresh in the same Auth session", async () => {
    const value = await runtime(); const entered = deferred(), release = deferred(); state.gate = async () => { entered.resolve(); await release.promise; };
    const attempt = value.importRecoveryKey(projectId, 4, await encodeRecoveryKey(projectKey)); await entered.promise;
    state.token = "token2"; release.resolve(); await attempt; expect(state.secrets.get(slot)).toBe(projectKey);
  });
  it("refuses legacy absent proof with explicit snapshot/rotation guidance", async () => {
    const value = await runtime(); state.witness = null;
    await expect(value.importRecoveryKey(projectId, 4, await encodeRecoveryKey(projectKey))).rejects.toThrow("rotate");
    expect(state.writes).not.toContain(slot);
  });
  it("retains authenticated encrypted-manifest recovery for legacy keys", async () => {
    const value = await runtime(); state.witness = null;
    const snapshotId = "60000000-0000-4000-8000-000000000001", revision = "revision-0004";
    const sealed = await encrypt(JSON.stringify({ schema_version: 1, snapshot_id: snapshotId, project_id: projectId, project_revision: revision, key_version: 4, plaintext_sha256: "b".repeat(64) }),
      new TextEncoder().encode(["openauthor.mobile.snapshot.manifest.v1", snapshotId, projectId, revision, "4"].join("\0")));
    state.manifest = { snapshot_id: snapshotId, project_id: projectId, project_revision: revision, key_version: 4, schema_version: 1,
      object_bucket: "mobile-encrypted-sync", object_path: `projects/${projectId}/snapshots/${snapshotId}.bin`, object_byte_length: 40, object_sha256: "a".repeat(64),
      manifest_algorithm: "aes-256-gcm-v1", manifest_nonce: `\\x${hex(sealed.nonce)}`, manifest_ciphertext: `\\x${hex(sealed.ciphertext)}`,
      manifest_ciphertext_sha256: sealed.digest, created_at: "2026-10-02T12:00:00Z" };
    await value.importRecoveryKey(projectId, 4, await encodeRecoveryKey(projectKey)); expect(state.secrets.get(slot)).toBe(projectKey);
  });
  it("fences the native adapter after its slot-index write is delayed by sign-out", async () => {
    const value = await runtime(); state.secrets.set(slot, "previous-key");
    const entered = deferred(), release = deferred(); state.localWriteGate = async () => { entered.resolve(); await release.promise; };
    const attempt = value.importRecoveryKey(projectId, 4, await encodeRecoveryKey(projectKey)); const rejected = expect(attempt).rejects.toThrow();
    await entered.promise; const exiting = value.signOut(); release.resolve(); await rejected; await exiting;
    expect(state.secrets.get(slot)).toBe("previous-key"); expect(state.writes).not.toContain(slot);
  });
  it("fences a same-account replacement Auth session during a delayed native slot-index write", async () => {
    const value = await runtime(); state.secrets.set(slot, "previous-key");
    const entered = deferred(), release = deferred(); state.localWriteGate = async () => { entered.resolve(); await release.promise; };
    const attempt = value.importRecoveryKey(projectId, 4, await encodeRecoveryKey(projectKey)); const rejected = expect(attempt).rejects.toThrow();
    await entered.promise; state.sessionId = "11000000-0000-4000-8000-000000000002";
    const token = `head.${btoa(JSON.stringify({ sub: state.userId, device_id: state.deviceId, session_id: state.sessionId }))}.signature`;
    for (const listener of state.authListeners) listener("SIGNED_IN", { access_token: token, user: { id: state.userId } });
    release.resolve(); await rejected;
    expect(state.secrets.get(slot)).toBe("previous-key"); expect(state.writes).not.toContain(slot);
  });
  it.each(["session", "signout"])("rolls back a late candidate after %s interrupts an already-dispatched native key write", async action => {
    const value = await runtime(); const entered = deferred(), release = deferred();
    state.keyWriteGate = async () => { entered.resolve(); await release.promise; };
    const attempt = value.importRecoveryKey(projectId, 4, await encodeRecoveryKey(projectKey)); const rejected = expect(attempt).rejects.toThrow();
    await entered.promise;
    let exiting: Promise<void> = Promise.resolve();
    if (action === "signout") exiting = value.signOut();
    else {
      state.sessionId = "11000000-0000-4000-8000-000000000002";
      const token = `head.${btoa(JSON.stringify({ sub: state.userId, device_id: state.deviceId, session_id: state.sessionId }))}.signature`;
      for (const listener of state.authListeners) listener("SIGNED_IN", { access_token: token, user: { id: state.userId } });
    }
    release.resolve(); await rejected; await exiting;
    // Native SecureStore has no cancellation API after dispatch. Its queue
    // restores the previous slot and index before allowing any next write.
    expect(state.secrets.has(slot)).toBe(false);
    expect(JSON.parse(state.local.get("openauthor.mobile.enrolled-device.v1")!).projectKeySlots).not.toContain(slot);
    if (action === "signout") expect(JSON.parse(state.secrets.get("openauthor.mobile.local-access.v1")!).state).toBe("locked");
    const unavailable = async (): Promise<never> => { throw new Error("Local cleanup must not call crypto or network."); };
    const cleanup = new DeviceEnrollment({ secrets: new ExpoSecretStore(), devices: new ExpoDeviceStore(),
      crypto: { generateKeyPair: unavailable, openSealedProjectKey: unavailable },
      transport: { register: unavailable, rebind: unavailable, projectKeyEnvelope: unavailable, revoke: unavailable } });
    await cleanup.clearCurrentLocal();
    expect(state.secrets.has(slot)).toBe(false); expect(state.local.has("openauthor.mobile.enrolled-device.v1")).toBe(false);
    expect(state.authListeners.size).toBe(0);
  });
});
