import { describe, expect, it } from "vitest";

import {
  InMemoryOutboxStore,
  MobileOutbox,
  type OutboxCipher,
  type OutboxTransport,
} from "../src/core/outbox";

class RecordingCipher implements OutboxCipher {
  readonly plaintexts: string[] = [];

  async fingerprint(plaintext: string): Promise<string> {
    let value = 0;
    for (const character of plaintext) value = (value * 31 + character.charCodeAt(0)) >>> 0;
    return value.toString(16).padStart(64, "0");
  }

  async seal(plaintext: string): Promise<{
    ciphertext: string;
    ciphertextDigest: string;
    keyVersion: number;
  }> {
    this.plaintexts.push(plaintext);
    return {
      ciphertext: `sealed:${encodeURIComponent(plaintext)}`,
      ciphertextDigest: "b".repeat(64),
      keyVersion: 3,
    };
  }
}

class RecordingTransport implements OutboxTransport {
  readonly uploaded: string[] = [];

  async upload(envelope: { operationId: string }): Promise<{ acknowledgedAt: string }> {
    this.uploaded.push(envelope.operationId);
    return { acknowledgedAt: "2026-08-30T15:01:00.000Z" };
  }
}

describe("MobileOutbox", () => {
  it("stores immutable ciphertext, deduplicates operation IDs, and uploads each capture once", async () => {
    const store = new InMemoryOutboxStore();
    const cipher = new RecordingCipher();
    const transport = new RecordingTransport();
    const outbox = new MobileOutbox({
      store,
      cipher,
      transport,
      now: () => "2026-08-30T15:00:00.000Z",
    });
    const command = {
      operationId: "operation-1",
      projectId: "project-mobile",
      deviceId: "device-ios",
      baseRevision: "rev-42",
      kind: "capture_note" as const,
      payload: { content: "Remember the brass key." },
    };

    const first = await outbox.enqueue(command);
    const duplicate = await outbox.enqueue(command);

    expect(duplicate).toEqual(first);
    expect(await store.pending("project-mobile")).toHaveLength(1);
    expect(JSON.stringify(await store.pending("project-mobile"))).not.toContain("brass key");
    expect(cipher.plaintexts).toHaveLength(1);
    expect(JSON.parse(cipher.plaintexts[0]!)).toEqual({
      base_revision: "rev-42",
      content: "Remember the brass key.",
      device_id: "device-ios",
      kind: "capture_note",
      operation_id: "operation-1",
      project_id: "project-mobile",
      schema_version: 1,
    });

    expect(await outbox.flush("project-mobile")).toEqual({ uploaded: 1, remaining: 0 });
    expect(await outbox.flush("project-mobile")).toEqual({ uploaded: 0, remaining: 0 });
    expect(transport.uploaded).toEqual(["operation-1"]);
  });

  it("prevents payload fields from replacing authenticated envelope identity", async () => {
    const outbox = new MobileOutbox({
      store: new InMemoryOutboxStore(), cipher: new RecordingCipher(), transport: new RecordingTransport(),
    });
    await expect(outbox.enqueue({
      operationId: "operation-1", projectId: "project-mobile", deviceId: "device-ios",
      baseRevision: "rev-42", kind: "capture_note",
      payload: { project_id: "another-project", content: "No" },
    })).rejects.toThrow("reserved field");
  });

  it("rejects reuse of an operation ID for different content", async () => {
    const outbox = new MobileOutbox({
      store: new InMemoryOutboxStore(),
      cipher: new RecordingCipher(),
      transport: new RecordingTransport(),
      now: () => "2026-08-30T15:00:00.000Z",
    });
    await outbox.enqueue({
      operationId: "operation-1",
      projectId: "project-mobile",
      deviceId: "device-ios",
      baseRevision: "rev-42",
      kind: "capture_note",
      payload: { text: "First" },
    });

    await expect(outbox.enqueue({
      operationId: "operation-1",
      projectId: "project-mobile",
      deviceId: "device-ios",
      baseRevision: "rev-42",
      kind: "capture_note",
      payload: { text: "Different" },
    })).rejects.toThrow("idempotency conflict");
  });
});
