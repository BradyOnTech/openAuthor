import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VerifiedProjectKeyWrite } from "../src/core/projectRecovery";
const state = vi.hoisted(() => ({ secrets: new Map<string, string>(), local: new Map<string, string>(),
  writes: [] as string[], gate: null as null | (() => Promise<void>), accessGate: null as null | (() => Promise<void>) }));
vi.mock("expo-secure-store", () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
  getItemAsync: async (key: string) => state.secrets.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    if (key === "unrelated") await state.gate?.();
    if (key === "openauthor.mobile.local-access.v1" && JSON.parse(value).state === "active") await state.accessGate?.();
    state.writes.push(key); state.secrets.set(key, value);
  },
  deleteItemAsync: async (key: string) => { state.secrets.delete(key); },
}));
vi.mock("expo-sqlite/kv-store", () => ({ default: {
  getItem: async (key: string) => state.local.get(key) ?? null,
  setItem: async (key: string, value: string) => { state.local.set(key, value); },
  removeItem: async (key: string) => { state.local.delete(key); },
} }));
import { ExpoSecretStore, ExpoDeviceStore } from "../src/adapters/expoSecrets";

const projectId = "30000000-0000-4000-8000-000000000001", slot = `openauthor.project.${projectId}.key.4`;
const identity = { userId: "10000000-0000-4000-8000-000000000001", deviceId: "40000000-0000-4000-8000-000000000001",
  keyId: "41000000-0000-4000-8000-000000000001", email: "author@example.test", deployment: "https://db.example.test" };
const device = { userId: identity.userId, deviceId: identity.deviceId, keyId: identity.keyId, name: "Synthetic iOS", platform: "ios" as const, publicKey: "public", enrolledAt: "now", projectKeySlots: [] };
const candidate = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => { state.secrets.clear(); state.local.clear(); state.writes.length = 0; state.gate = null; state.accessGate = null; });
async function prepare() {
  const secrets = new ExpoSecretStore(), devices = new ExpoDeviceStore();
  await secrets.set("openauthor.mobile.local-access.v1", JSON.stringify({ version: 1, state: "active", ...identity }));
  await devices.save(device); await secrets.set(slot, "previous"); state.writes.length = 0;
  const input: VerifiedProjectKeyWrite = { projectId, keyVersion: 4, projectKey: candidate, expectedKey: "previous", identity, device, current() {} };
  return { secrets, devices, input };
}
describe("native project key commit queue through installed adapters", () => {
  it("restores the prior lock after explicit local authorization's OS write finishes under a changed scope", async () => {
    const { secrets } = await prepare(); await secrets.set("openauthor.mobile.local-access.v1", '{"version":1,"state":"locked"}');
    const entered = deferred(), release = deferred(); let closed = false;
    state.accessGate = async () => { entered.resolve(); await release.promise; };
    const pending = secrets.setLocalAccessIfCurrent(JSON.stringify({ version: 1, state: "active", ...identity }), () => { if (closed) throw new Error("closed session"); });
    const rejected = expect(pending).rejects.toThrow("closed session"); await entered.promise;
    closed = true; release.resolve(); await rejected;
    expect(JSON.parse((await secrets.get("openauthor.mobile.local-access.v1"))!).state).toBe("locked");
  });
  it.each(["signout", "device", "newer-key", "scope"])("fences a key write queued behind %s", async action => {
    const { secrets, devices, input } = await prepare(); const entered = deferred(), release = deferred();
    state.gate = async () => { entered.resolve(); await release.promise; };
    const blocked = secrets.set("unrelated", "value"); await entered.promise;
    let mutation: Promise<void> = Promise.resolve();
    if (action === "signout") mutation = new ExpoSecretStore().set("openauthor.mobile.local-access.v1", '{"version":1,"state":"locked"}');
    if (action === "device") mutation = new ExpoDeviceStore().save({ ...device, keyId: "41000000-0000-4000-8000-000000000002" });
    if (action === "newer-key") mutation = new ExpoSecretStore().set(slot, "newer");
    if (action === "scope") input.current = () => { throw new Error("closed session"); };
    const attempt = secrets.setProjectKeyIfCurrent(input); const rejected = expect(attempt).rejects.toThrow();
    release.resolve(); await blocked; await mutation; await rejected;
    expect(await secrets.get(slot)).toBe(action === "newer-key" ? "newer" : "previous");
    expect((await devices.current())!.projectKeySlots).toEqual([]);
  });
});
