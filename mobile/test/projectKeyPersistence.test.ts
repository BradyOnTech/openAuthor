import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { browserStorage, BrowserStorage } from "../src/adapters/browserStorage";
import { ExpoSecretStore, ExpoDeviceStore } from "../src/adapters/expoSecrets.web";
import type { VerifiedProjectKeyWrite } from "../src/core/projectRecovery";
import { LocalCompanion } from "../src/core/localCompanion";

const projectId = "30000000-0000-4000-8000-000000000001";
const slot = `openauthor.project.${projectId}.key.4`;
const identity = { userId: "10000000-0000-4000-8000-000000000001", deviceId: "40000000-0000-4000-8000-000000000001",
  keyId: "41000000-0000-4000-8000-000000000001", email: "author@example.test", deployment: "https://db.example.test" };
const device = { userId: identity.userId, deviceId: identity.deviceId, keyId: identity.keyId, name: "Synthetic browser", platform: "web" as const, publicKey: "public", enrolledAt: "now", projectKeySlots: [] };
const candidate = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function prepare() {
  const secrets = new ExpoSecretStore(), devices = new ExpoDeviceStore();
  await secrets.set("openauthor.mobile.local-access.v1", JSON.stringify({ version: 1, state: "active", ...identity }));
  await devices.save(device); await secrets.set(slot, "previous");
  const input: VerifiedProjectKeyWrite = { projectId, keyVersion: 4, projectKey: candidate, expectedKey: "previous", identity, device, current() {} };
  return { secrets, devices, input };
}
describe("actual encrypted browser key persistence guards", () => {
  it.each(["scope", "device"])("withholds delayed explicit local authorization after %s changes", async action => {
    const { secrets, devices } = await prepare();
    await secrets.set("openauthor.mobile.local-access.v1", '{"version":1,"state":"locked"}');
    const local = new LocalCompanion({ deployment: identity.deployment, secrets,
      books: { async get() { return null; }, async list() { return []; }, async put() {}, async clear() {} },
      localDevice: async () => (await devices.current())! });
    const entered = deferred(), release = deferred(); let closed = false, held = false;
    const original = crypto.subtle.encrypt.bind(crypto.subtle);
    const spy = vi.spyOn(crypto.subtle, "encrypt").mockImplementation(async (...args: Parameters<typeof crypto.subtle.encrypt>) => {
      if (!held) { held = true; entered.resolve(); await release.promise; }
      return await original(...args);
    });
    try {
      const attempt = local.authorize(identity, device, true, () => { if (closed) throw new Error("closed session"); });
      const rejected = expect(attempt).rejects.toThrow(); await entered.promise;
      if (action === "scope") closed = true;
      else await new BrowserStorage().set("device:current", JSON.stringify({ ...device, keyId: "41000000-0000-4000-8000-000000000002" }));
      release.resolve(); await rejected;
      expect(await local.isLocked()).toBe(true); await expect(local.require()).rejects.toThrow("Signing out locks local access");
    } finally { release.resolve(); spy.mockRestore(); }
  });
  it("restores locked browser access when closure arrives after the active transaction commits", async () => {
    const { secrets } = await prepare(); await secrets.set("openauthor.mobile.local-access.v1", '{"version":1,"state":"locked"}');
    const entered = deferred(), release = deferred(); let closed = false, held = false;
    const original = browserStorage.transaction.bind(browserStorage);
    const spy = vi.spyOn(browserStorage, "transaction").mockImplementation(async (...args) => {
      const result = await original(...args);
      if (!held && args[0] === "records" && args[1] === "readwrite") { held = true; entered.resolve(); await release.promise; }
      return result;
    });
    try {
      const attempt = secrets.setLocalAccessIfCurrent(JSON.stringify({ version: 1, state: "active", ...identity }), () => { if (closed) throw new Error("closed session"); });
      const rejected = expect(attempt).rejects.toThrow("closed session"); await entered.promise;
      expect(JSON.parse((await secrets.get("openauthor.mobile.local-access.v1"))!).state).toBe("active");
      closed = true; release.resolve(); await rejected;
      expect(JSON.parse((await secrets.get("openauthor.mobile.local-access.v1"))!).state).toBe("locked");
    } finally { release.resolve(); spy.mockRestore(); }
  });
  it("commits the encrypted key and device index together", async () => {
    const { secrets, devices, input } = await prepare(); await secrets.setProjectKeyIfCurrent(input);
    expect(await secrets.get(slot)).toBe(candidate); expect((await devices.current())!.projectKeySlots).toEqual([slot]);
    const record = await browserStorage.transaction<{ iv: Uint8Array; bytes: ArrayBuffer }>("records", "readonly", (store, done) => {
      const read = store.get(`secret:${slot}`); read.onsuccess = () => done(read.result);
    });
    expect(new TextDecoder().decode(record.bytes)).not.toContain(candidate);
  });
  it.each(["signout", "device", "newer-key", "scope"])("refuses a delayed encrypted commit after %s changes", async action => {
    const { secrets, devices, input } = await prepare(); const entered = deferred(), release = deferred();
    let closed = false;
    input.current = () => { if (closed) throw new Error("closed session"); };
    const original = crypto.subtle.encrypt.bind(crypto.subtle);
    let held = false;
    const spy = vi.spyOn(crypto.subtle, "encrypt").mockImplementation(async (...args: Parameters<typeof crypto.subtle.encrypt>) => {
      if (!held) { held = true; entered.resolve(); await release.promise; }
      return await original(...args);
    });
    try {
      const pending = secrets.setProjectKeyIfCurrent(input); const rejected = expect(pending).rejects.toThrow(); await entered.promise;
      const otherWindow = new BrowserStorage();
      if (action === "signout") await otherWindow.set("secret:openauthor.mobile.local-access.v1", '{"version":1,"state":"locked"}');
      if (action === "device") await otherWindow.set("device:current", JSON.stringify({ ...device, keyId: "41000000-0000-4000-8000-000000000002" }));
      if (action === "newer-key") await otherWindow.set(`secret:${slot}`, "newer");
      if (action === "scope") closed = true;
      release.resolve(); await rejected;
      expect(await secrets.get(slot)).toBe(action === "newer-key" ? "newer" : "previous");
      expect((await devices.current())!.projectKeySlots).toEqual([]);
    } finally { release.resolve(); spy.mockRestore(); }
  });
  it("refuses a different existing key before crypto writes without a current-key CAS", async () => {
    const { secrets, input } = await prepare(); await secrets.set(slot, "newer");
    await expect(secrets.setProjectKeyIfCurrent(input)).rejects.toThrow("saved book key changed");
    expect(await secrets.get(slot)).toBe("newer");
  });
  it.each(["scope", "newer-key", "device"])("rolls back its own encrypted records after late %s and preserves superseding records", async action => {
    const { secrets, devices, input } = await prepare(); const entered = deferred(), release = deferred();
    let closed = false, held = false;
    input.current = () => { if (closed) throw new Error("closed session"); };
    const original = browserStorage.transaction.bind(browserStorage);
    const spy = vi.spyOn(browserStorage, "transaction").mockImplementation(async (...args) => {
      const result = await original(...args);
      if (!held && args[0] === "records" && args[1] === "readwrite") { held = true; entered.resolve(); await release.promise; }
      return result;
    });
    try {
      const attempt = secrets.setProjectKeyIfCurrent(input); const rejected = expect(attempt).rejects.toThrow();
      await entered.promise; expect(await secrets.get(slot)).toBe(candidate); closed = true;
      const otherWindow = new BrowserStorage();
      if (action === "newer-key") await otherWindow.set(`secret:${slot}`, "newer");
      if (action === "device") await otherWindow.set("device:current", JSON.stringify({ ...device, keyId: "41000000-0000-4000-8000-000000000002" }));
      release.resolve(); await rejected;
      expect(await secrets.get(slot)).toBe(action === "newer-key" ? "newer" : "previous");
      expect((await devices.current())!.projectKeySlots).toEqual([]);
      expect((await devices.current())!.keyId).toBe(action === "device" ? "41000000-0000-4000-8000-000000000002" : device.keyId);
    } finally { release.resolve(); spy.mockRestore(); }
  });
});
