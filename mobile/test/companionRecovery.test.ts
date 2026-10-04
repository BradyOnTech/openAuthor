import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { BrowserStorage } from "../src/adapters/browserStorage";
import { EncryptedFileSnapshotCache } from "../src/adapters/encryptedSnapshotCache.web";
import { CompanionRecovery, companionRecoveryScope, emptyCompanionState, reconcileCompanionState, validateCompanionState, type CompanionState } from "../src/core/companionRecovery";
import type { LocalIdentity } from "../src/core/localCompanion";
import { SnapshotProject } from "../src/core/snapshotProject";

const identity: LocalIdentity = { userId: "user-one", email: "author@example.test", deviceId: "device-one", keyId: "key-one", deployment: "https://one.example.test" };
const state: CompanionState = {
  version: 1, tab: "capture", reading: { sceneId: "scene-one", revision: "rev-one", scrollY: 317 },
  capture: { operationId: "operation-one", kind: "dictated_passage", text: "An unfinished idea with a private character secret.", baseRevision: "rev-one" },
};

function setup() {
  const storage = new BrowserStorage(`companion-${crypto.randomUUID()}`);
  return { storage, cache: new EncryptedFileSnapshotCache(storage) };
}

const project = (revision: string, includeScene = true) => SnapshotProject.open({
  schema: "openauthor.mobile.snapshot", schema_version: 1, project_id: "book-one", revision,
  scenes: includeScene ? [{ id: "scene-one", title: "Opening", body: "Private manuscript", summary: "", pov: "Mara", status: "draft", created_at: "2026-10-02T12:00:00Z", updated_at: "2026-10-02T12:00:00Z" }] : [],
  codex: { entities: [], relationships: [] }, evidence: [],
});

describe("encrypted cold-restart companion recovery", () => {
  it("reopens reading position, capture kind/text and idempotency identity from ciphertext", async () => {
    const { storage, cache } = setup();
    await new CompanionRecovery(cache).save(identity, "book-one", state);
    const raw = await storage.transaction<unknown[]>("records", "readonly", (records, done) => {
      const read = records.getAll(); read.onsuccess = () => done(read.result);
    });
    expect(JSON.stringify(raw)).not.toContain(state.capture!.text);
    expect(JSON.stringify(raw)).not.toContain("scene-one");
    expect(await new CompanionRecovery(new EncryptedFileSnapshotCache(storage)).load(identity, "book-one")).toEqual(state);
    await cache.deleteAll();
    expect(await new CompanionRecovery(cache).load(identity, "book-one")).toEqual(emptyCompanionState());
  });

  it("isolates account, device, key, deployment and book and rejects copied records", async () => {
    const { storage, cache } = setup();
    const recovery = new CompanionRecovery(cache);
    await recovery.save(identity, "book-one", state);
    for (const other of [{ ...identity, userId: "user-two" }, { ...identity, deviceId: "device-two" }, { ...identity, keyId: "key-two" }, { ...identity, deployment: "https://two.example.test" }]) {
      expect(await recovery.load(other, "book-one")).toEqual(emptyCompanionState());
    }
    expect(await recovery.load(identity, "book-two")).toEqual(emptyCompanionState());
    const original = `companion-recovery:${companionRecoveryScope(identity, "book-one")}`;
    const other = `companion-recovery:${companionRecoveryScope(identity, "book-two")}`;
    await storage.transaction<void>("records", "readwrite", (records) => {
      const read = records.get(original); read.onsuccess = () => records.put(read.result, other);
    });
    await expect(recovery.load(identity, "book-two")).rejects.toThrow();
    expect(await recovery.load(identity, "book-one")).toEqual(state);
  });

  it("keeps prior committed recovery on a quota error and succeeds after retry", async () => {
    const { storage, cache } = setup();
    const first = new CompanionRecovery(cache);
    await first.save(identity, "book-one", state);
    let full = true;
    const recovery = new CompanionRecovery({
      loadRecovery: (scope) => cache.loadRecovery(scope),
      saveRecovery: (scope, value) => {
        if (full) return Promise.reject(new DOMException("No storage space", "QuotaExceededError"));
        return cache.saveRecovery(scope, value);
      },
    });
    const latest: CompanionState = { ...state, capture: { ...state.capture!, text: "The latest private idea." } };
    await expect(recovery.save(identity, "book-one", latest)).rejects.toThrow("No storage space");
    expect(await first.load(identity, "book-one")).toEqual(state);
    full = false;
    await recovery.save(identity, "book-one", latest);
    expect(await first.load(identity, "book-one")).toEqual(latest);
  });

  it("serializes older and newer writes and snapshots input before asynchronous encryption", async () => {
    const { cache } = setup();
    const calls: string[] = [];
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const recovery = new CompanionRecovery({
      loadRecovery: (scope) => cache.loadRecovery(scope),
      saveRecovery: async (scope, value) => { calls.push(value); if (calls.length === 1) { markStarted(); await blocked; } await cache.saveRecovery(scope, value); },
    });
    const first = recovery.save(identity, "book-one", state);
    const latest = structuredClone(state);
    latest.capture!.text = "Newer idea";
    const second = recovery.save(identity, "book-one", latest);
    latest.capture!.text = "Mutation after save";
    await started;
    expect(calls).toHaveLength(1);
    release();
    await Promise.all([first, second, recovery.drain()]);
    expect((await recovery.load(identity, "book-one")).capture!.text).toBe("Newer idea");
  });

  it("resets scroll for a changed publication, drops missing scenes, and retains capture base", () => {
    expect(reconcileCompanionState(project("rev-one"), state)).toEqual(state);
    const next = reconcileCompanionState(project("rev-two"), state);
    expect(next.reading).toEqual({ sceneId: "scene-one", revision: "rev-two", scrollY: 0 });
    expect(next.capture!.baseRevision).toBe("rev-one");
    expect(reconcileCompanionState(project("rev-two", false), state).reading).toBeNull();
  });

  it("refuses corrupt or oversized drafts without replacing their encrypted record", async () => {
    const { cache } = setup();
    const recovery = new CompanionRecovery(cache);
    const scope = companionRecoveryScope(identity, "book-one");
    await cache.saveRecovery(scope, JSON.stringify({ scope, state: { ...state, capture: { ...state.capture!, text: "x".repeat(48 * 1024 + 1) } } }));
    await expect(recovery.load(identity, "book-one")).rejects.toThrow("No saved work was deleted");
    expect(await cache.loadRecovery(scope)).not.toBeNull();
    expect(() => validateCompanionState({ ...state, reading: { ...state.reading, scrollY: NaN } })).toThrow();
    expect(() => validateCompanionState({ ...state, tab: "settings" })).toThrow();
  });
});
