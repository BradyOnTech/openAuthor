import { describe, expect, it, vi } from "vitest";

import { InMemoryOutboxStore, MobileOutbox, type OutboxCipher, type OutboxEnvelope, type OutboxKind } from "../src/core/outbox";
import { readPendingOutbox, type OutboxReadCipher } from "../src/core/outboxReview";

// In-memory test adapter. The hosted browser test exercises the real Expo AES
// adapter, persistent IndexedDB and Python desktop decryption together.
class TestCipher implements OutboxCipher, OutboxReadCipher {
  readonly texts = new Map<string, string>();
  async fingerprint(value: string) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  async seal(plaintext: string) {
    const ciphertext = `opaque-${this.texts.size}`;
    this.texts.set(ciphertext, plaintext);
    return { ciphertext, ciphertextDigest: await this.fingerprint(ciphertext), keyVersion: 2 };
  }
  async open(envelope: OutboxEnvelope) {
    const text = this.texts.get(envelope.ciphertext);
    if (text === undefined) throw new Error("Unavailable test ciphertext.");
    return text;
  }
}

function fixture() {
  const cipher = new TestCipher();
  const store = new InMemoryOutboxStore();
  const outbox = new MobileOutbox({
    cipher, store, transport: { upload: async () => ({ acknowledgedAt: "2026-09-07T12:00:00Z" }) },
    now: () => "2026-09-07T11:00:00Z",
  });
  let counter = 0;
  const enqueue = (kind: OutboxKind, payload: Record<string, unknown>) => outbox.enqueue({
    projectId: "book", deviceId: "phone", operationId: `capture-${counter++}`, baseRevision: "rev-1", kind, payload,
  });
  const cipherForKeyVersion = vi.fn(async () => cipher);
  const read = () => readPendingOutbox({ projectId: "book", deviceId: "phone", store, cipherForKeyVersion });
  return { cipher, store, outbox, enqueue, read, cipherForKeyVersion };
}

describe("encrypted outbox review", () => {
  it("reads all capture kinds and conversation roles without modifying persistent envelopes", async () => {
    const f = fixture();
    await f.enqueue("capture_note", { content: "The brass key." });
    await f.enqueue("dictated_passage", { content: "Rain against the window." });
    await f.enqueue("story_memory_suggestion", { content: "Mara fears deep water." });
    await f.enqueue("change_set_request", { instruction: "Move the reveal later." });
    await f.enqueue("thread_turn", { role: "user", content: "Who hid the key?" });
    await f.enqueue("thread_turn", { role: "assistant", content: "Consider Elias." });
    await f.enqueue("review_decision", { decision: "deferred", target_kind: "proposal", target_id: "proposal-1" });
    const before = await f.store.pending("book");
    expect((await f.read()).map((item) => item.summary)).toEqual([
      "The brass key.", "Rain against the window.", "Mara fears deep water.", "Move the reveal later.",
      "You: Who hid the key?", "Copilot: Consider Elias.", "deferred: proposal proposal-1",
    ]);
    expect((await f.read()).every((item) => !item.unreadable && item.status === "local")).toBe(true);
    expect(await f.store.pending("book")).toEqual(before);
    expect(JSON.stringify(before)).not.toContain("brass key");
    // One key lookup per version per read, not one lookup per capture.
    expect(f.cipherForKeyVersion).toHaveBeenCalledTimes(2);
    expect(f.cipherForKeyVersion).toHaveBeenCalledWith(2);
  });

  it("does not access keys or reveal rows from another device, book or an acknowledged upload", async () => {
    const f = fixture();
    const original = await f.enqueue("capture_note", { content: "Private note" });
    const rows = [
      { ...original, deviceId: "other-phone" },
      { ...original, projectId: "other-book" },
      { ...original, acknowledgedAt: "2026-09-07T12:00:00Z" },
    ];
    expect(await readPendingOutbox({
      projectId: "book", deviceId: "phone", store: { pending: async () => rows }, cipherForKeyVersion: f.cipherForKeyVersion,
    })).toEqual([]);
    expect(f.cipherForKeyVersion).not.toHaveBeenCalled();
  });

  it("isolates a damaged ciphertext and retains both it and readable work", async () => {
    const f = fixture();
    const bad = await f.enqueue("capture_note", { content: "Do not lose this." });
    await f.enqueue("capture_note", { content: "Still readable." });
    const original = await f.store.pending("book");
    const open = vi.spyOn(f.cipher, "open");
    const result = await readPendingOutbox({
      projectId: "book", deviceId: "phone",
      store: { pending: async () => original.map((row) => row.operationId === bad.operationId ? { ...row, ciphertext: "damaged" } : row) },
      cipherForKeyVersion: f.cipherForKeyVersion,
    });
    expect(result[0]).toMatchObject({ unreadable: true });
    expect(result[0]!.summary).toContain("nothing was deleted");
    expect(result[1]).toMatchObject({ summary: "Still readable.", unreadable: false });
    expect(open).toHaveBeenCalledTimes(1);
    expect(await f.store.pending("book")).toEqual(original);
  });

  it.each(["schema_version", "project_id", "device_id", "operation_id", "base_revision", "kind"])(
    "rejects authenticated plaintext with mismatched %s", async (field) => {
      const f = fixture();
      const original = await f.enqueue("capture_note", { content: "Secret content" });
      const payload = JSON.parse(f.cipher.texts.get(original.ciphertext)!);
      payload[field] = "mismatched";
      const plaintext = JSON.stringify(payload);
      f.cipher.texts.set(original.ciphertext, plaintext);
      const row = { ...original, requestDigest: await f.cipher.fingerprint(plaintext) };
      const [item] = await readPendingOutbox({
        projectId: "book", deviceId: "phone", store: { pending: async () => [row] }, cipherForKeyVersion: f.cipherForKeyVersion,
      });
      expect(item?.unreadable).toBe(true);
      expect(item?.summary).not.toContain("Secret content");
    },
  );

  it("does not render unverified plaintext or leak JSON/key errors into the UI", async () => {
    const f = fixture();
    const row = await f.enqueue("capture_note", { content: "Secret content" });
    f.cipher.texts.set(row.ciphertext, "this is not JSON and includes private prose");
    expect((await f.read())[0]?.unreadable).toBe(true);
    const malformed = { ...row, requestDigest: await f.cipher.fingerprint(f.cipher.texts.get(row.ciphertext)!) };
    const input = { projectId: "book", deviceId: "phone", store: { pending: async () => [malformed] }, cipherForKeyVersion: f.cipherForKeyVersion };
    expect(JSON.stringify(await readPendingOutbox(input))).not.toContain("private prose");
    const result = await readPendingOutbox({ ...input, cipherForKeyVersion: async () => { throw new Error("secret-key-material"); } });
    expect(result[0]?.unreadable).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret-key-material");
    expect(await f.store.get(row.operationId)).toEqual(row);
  });

  it("reads older queued key versions after a rotation, then omits uploaded items", async () => {
    const f = fixture();
    const old = await f.enqueue("capture_note", { content: "Old key capture" });
    const next = await f.enqueue("capture_note", { content: "New key capture" });
    const resolver = vi.fn(async (_version: number) => f.cipher);
    const input = { projectId: "book", deviceId: "phone", store: {
      pending: async () => [old, { ...next, keyVersion: 3 }],
    }, cipherForKeyVersion: resolver };
    expect((await readPendingOutbox(input)).every((item) => !item.unreadable)).toBe(true);
    expect(resolver.mock.calls).toEqual([[2], [3]]);
    await f.outbox.flush("book");
    expect(await f.read()).toEqual([]);
  });
});
