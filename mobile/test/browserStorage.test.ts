import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { BrowserStorage } from "../src/adapters/browserStorage";
import { SQLiteOutboxStore } from "../src/adapters/sqliteOutboxStore.web";
import type { OutboxEnvelope } from "../src/core/outbox";

describe("browser companion persistence", () => {
  it("atomically persists one encrypted enrollment identity across tabs and reopening", async () => {
    const name = `browser-${crypto.randomUUID()}`;
    const first = new BrowserStorage(name);
    const second = new BrowserStorage(name);
    const values = await Promise.all([
      first.create("secret:identity", "private-key-one"),
      second.create("secret:identity", "private-key-two"),
    ]);
    expect(values[0]).toBe(values[1]);
    expect(await new BrowserStorage(name).create("secret:identity", "replacement")).toBe(values[0]);
    const raw = await first.transaction<unknown>("records", "readonly", (store, done) => {
      const read = store.get("secret:identity"); read.onsuccess = () => done(read.result);
    });
    expect(JSON.stringify(raw)).not.toContain("private-key");
  });

  it("encrypts records and survives reopening without persisting plaintext", async () => {
    const name = `browser-${crypto.randomUUID()}`;
    const writer = new BrowserStorage(name);
    await writer.set("snapshot:p1", "Private manuscript sentence.");
    const raw = await writer.transaction<unknown>("records", "readonly", (store, done) => {
      const read = store.get("snapshot:p1"); read.onsuccess = () => done(read.result);
    });
    expect(JSON.stringify(raw)).not.toContain("Private manuscript");
    expect((await writer.key()).extractable).toBe(false);
    expect(await new BrowserStorage(name).get("snapshot:p1")).toBe("Private manuscript sentence.");
    await writer.set("auth:token", "account-session");
    await writer.deletePrefix("snapshot:");
    expect(await writer.get("snapshot:p1")).toBeNull();
    expect(await writer.get("auth:token")).toBe("account-session");
  });

  it("chooses one wrapping key across simultaneous tabs and authenticates record identity", async () => {
    const name = `browser-${crypto.randomUUID()}`;
    const first = new BrowserStorage(name);
    const second = new BrowserStorage(name);
    await Promise.all([first.set("snapshot:p1", "One"), second.set("snapshot:p2", "Two")]);
    expect(await second.get("snapshot:p1")).toBe("One");
    expect(await first.get("snapshot:p2")).toBe("Two");
    await first.transaction<void>("records", "readwrite", (store) => {
      const read = store.get("snapshot:p1"); read.onsuccess = () => { store.put(read.result, "snapshot:p2"); };
    });
    await expect(second.get("snapshot:p2")).rejects.toThrow();
  });

  it("keeps encrypted outbox operations and acknowledgements immutable across tabs", async () => {
    const name = `browser-${crypto.randomUUID()}`;
    const first = new SQLiteOutboxStore(new BrowserStorage(name));
    const second = new SQLiteOutboxStore(new BrowserStorage(name));
    const envelope: OutboxEnvelope = { schemaVersion: 1, operationId: "o1", projectId: "p1", deviceId: "d1", baseRevision: "r1", kind: "capture_note", createdAt: "2026-09-07T12:00:00Z", keyVersion: 1, requestDigest: "a".repeat(64), ciphertextDigest: "b".repeat(64), ciphertext: "encrypted" };
    const results = await Promise.allSettled([first.put(envelope), second.put(envelope)]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(await second.pending("p1")).toEqual([envelope]);
    expect(await second.pending("another-project")).toEqual([]);
    await second.acknowledge("o1", "2026-09-07T13:00:00Z");
    await expect(first.acknowledge("o1", "2026-09-07T14:00:00Z")).rejects.toThrow();
    expect(await first.pending("p1")).toEqual([]);
    expect(await first.get("o1")).toMatchObject({ ciphertext: "encrypted", acknowledgedAt: "2026-09-07T13:00:00Z" });
    await second.deleteAll();
    expect(await first.get("o1")).toBeNull();
  });
});
