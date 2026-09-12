import { describe, expect, it, vi } from "vitest";
import {
  createMobileSyncService,
  type EncryptedMobileOutboxItem,
  type EncryptedMobileSnapshot,
  type HostedMobileOutboxIdentity,
  type MobileOutboxCursor,
  type MobileSyncSidecar,
  type MobileSyncTransport,
} from "./mobileSync";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function bytesBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

async function projectKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytesBuffer(bytes)));
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function encryptedOutboxItem(
  key: CryptoKey,
  envelope: HostedMobileOutboxIdentity,
  payload: Record<string, unknown>,
  receivedAt: string
): Promise<EncryptedMobileOutboxItem> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const associatedData = new TextEncoder().encode([
    "openauthor.mobile.outbox.v1",
    envelope.projectId,
    envelope.deviceId,
    envelope.operationId,
    envelope.baseRevision,
    envelope.kind,
    String(envelope.keyVersion),
  ].join("\0"));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: bytesBuffer(iv),
      additionalData: bytesBuffer(associatedData),
    },
    key,
    bytesBuffer(plaintext)
  );
  return {
    schema_version: 1,
    envelope,
    receivedAt,
    encryption: {
      algorithm: "AES-256-GCM",
      iv_base64: bytesToBase64(iv),
      associated_data_version: 1,
    },
    ciphertext_base64: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

describe("mobile sync service", () => {
  it("encrypts snapshots locally and publishes no project key or plaintext", async () => {
    const plaintext = new TextEncoder().encode('{"manifest":{"project_id":"project-one"}}');
    const manifest = {
      schema: "openauthor.mobile.snapshot.manifest" as const,
      schema_version: 1 as const,
      project_id: "project-one",
      revision: "revision-one",
      content_sha256: "a".repeat(64),
      byte_length: plaintext.byteLength,
    };
    const sidecar: MobileSyncSidecar = {
      prepareSnapshot: vi.fn(async () => ({
        schema_version: 1 as const,
        media_type: "application/vnd.openauthor.mobile-snapshot+json" as const,
        manifest,
        plaintext_base64: bytesToBase64(plaintext),
      })),
      importOutboxItem: vi.fn(),
    };
    let published: EncryptedMobileSnapshot | undefined;
    const transport: MobileSyncTransport = {
      publishSnapshot: vi.fn(async (snapshot) => { published = snapshot; }),
      pullOutbox: vi.fn(async () => []),
    };
    const key = await projectKey();
    const service = createMobileSyncService({ sidecar, transport });

    const result = await service.publishSnapshot({
      projectRoot: "/project",
      projectId: "project-one",
      projectKey: key,
      keyVersion: 7,
    });

    expect(result).toEqual(published);
    expect(sidecar.prepareSnapshot).toHaveBeenCalledWith("/project", "project-one");
    expect(published?.encryption).toEqual(expect.objectContaining({
      algorithm: "AES-256-GCM",
      associated_data_version: 1,
    }));
    expect(published?.key_version).toBe(7);
    expect(published?.snapshot_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(published?.plaintext_sha256).toBe(await sha256Hex(plaintext));
    expect(published?.object).toEqual({
      bucket: "mobile-encrypted-sync",
      path: `projects/project-one/snapshots/${published!.snapshot_id}.bin`,
      byte_length: new TextEncoder().encode(published!.ciphertext_base64).byteLength,
      sha256: await sha256Hex(new TextEncoder().encode(published!.ciphertext_base64)),
      content_type: "text/plain;charset=utf-8",
    });
    expect(published?.ciphertext_base64).not.toContain("manifest");
    expect(JSON.stringify(published)).not.toContain("projectKey");
    expect(Object.keys(published ?? {}).sort()).toEqual([
      "ciphertext_base64",
      "encryption",
      "hosted_manifest",
      "key_version",
      "manifest",
      "object",
      "plaintext_sha256",
      "schema_version",
      "snapshot_id",
    ]);

    const associatedData = new TextEncoder().encode(
      "openauthor.snapshot.v1|project-one|revision-one|7"
    );
    const combined = base64ToBytes(published!.ciphertext_base64);
    expect(combined.slice(0, 12)).toEqual(base64ToBytes(published!.encryption.iv_base64));
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytesBuffer(combined.slice(0, 12)),
        additionalData: bytesBuffer(associatedData),
      },
      key,
      bytesBuffer(combined.slice(12))
    );
    expect(new Uint8Array(decrypted)).toEqual(plaintext);

    const hostedManifestAad = new TextEncoder().encode([
      "openauthor.mobile.snapshot.manifest.v1",
      published!.snapshot_id,
      "project-one",
      "revision-one",
      "7",
    ].join("\0"));
    const hostedManifestPlaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytesBuffer(base64ToBytes(published!.hosted_manifest.nonce_base64)),
        additionalData: bytesBuffer(hostedManifestAad),
      },
      key,
      bytesBuffer(base64ToBytes(published!.hosted_manifest.ciphertext_base64))
    );
    expect(JSON.parse(new TextDecoder().decode(hostedManifestPlaintext))).toEqual({
      schema_version: 1,
      snapshot_id: published!.snapshot_id,
      project_id: "project-one",
      project_revision: "revision-one",
      key_version: 7,
      plaintext_sha256: await sha256Hex(plaintext),
    });
    expect(published!.hosted_manifest.ciphertext_sha256).toBe(
      await sha256Hex(base64ToBytes(published!.hosted_manifest.ciphertext_base64))
    );
  });

  it("decrypts outbox operations locally before durable sidecar import", async () => {
    const key = await projectKey();
    const envelope = {
      projectId: "project-one",
      deviceId: "device-ios-1",
      operationId: "operation-note-1",
      baseRevision: "revision-one",
      kind: "capture_note" as const,
      keyVersion: 7,
    };
    const plaintextJson = (
      '{"base_revision":"revision-one","content":"Let the shadow arrive first.",'
      + '"device_id":"device-ios-1","kind":"capture_note",'
      + '"operation_id":"operation-note-1","project_id":"project-one",'
      + '"schema_version":1,"title":"Gate shadow"}'
    );
    const payload = JSON.parse(plaintextJson) as Record<string, unknown>;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const associatedData = new TextEncoder().encode([
      "openauthor.mobile.outbox.v1",
      envelope.projectId,
      envelope.deviceId,
      envelope.operationId,
      envelope.baseRevision,
      envelope.kind,
      String(envelope.keyVersion),
    ].join("\0"));
    const plaintext = new TextEncoder().encode(plaintextJson);
    const expectedDigest = `sha256:${Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytesBuffer(plaintext)))
    ).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: bytesBuffer(iv),
        additionalData: bytesBuffer(associatedData),
      },
      key,
      bytesBuffer(plaintext)
    );
    const imported = {
      schema_version: 1 as const,
      project_id: envelope.projectId,
      device_id: envelope.deviceId,
      operation_id: envelope.operationId,
      kind: "capture_note",
      payload_digest: expectedDigest,
      base_revision: envelope.baseRevision,
      imported_revision: envelope.baseRevision,
      stale: false,
      disposition: "imported" as const,
      artifact_kind: "mobile_inbox_item",
      artifact_id: "mobile-inbox-one",
      imported_at: "2026-08-30T00:00:00Z",
    };
    const sidecar: MobileSyncSidecar = {
      prepareSnapshot: vi.fn(),
      importOutboxItem: vi.fn(async () => imported),
    };
    const transport: MobileSyncTransport = {
      publishSnapshot: vi.fn(),
      pullOutbox: vi.fn(async () => [{
        schema_version: 1 as const,
        envelope,
        encryption: {
          algorithm: "AES-256-GCM" as const,
          iv_base64: bytesToBase64(iv),
          associated_data_version: 1 as const,
        },
        ciphertext_base64: bytesToBase64(new Uint8Array(ciphertext)),
      }]),
      acknowledgeOutbox: vi.fn(async () => undefined),
    };
    const service = createMobileSyncService({ sidecar, transport });

    const report = await service.importOutbox({
      projectRoot: "/project",
      projectId: "project-one",
      projectKey: key,
      keyVersion: 7,
    });

    expect(report).toEqual({ imported: [imported], failures: [] });
    expect(sidecar.importOutboxItem).toHaveBeenCalledWith("/project", {
      envelope: {
        projectId: envelope.projectId,
        deviceId: envelope.deviceId,
        operationId: envelope.operationId,
        baseRevision: envelope.baseRevision,
        payloadDigest: expectedDigest,
      },
      payload,
    });
    expect(transport.acknowledgeOutbox).toHaveBeenCalledWith(envelope, "imported");
    expect(transport.pullOutbox).toHaveBeenCalledWith("project-one", {
      after: null,
      limit: 100,
    });
    expect(JSON.stringify(vi.mocked(transport.pullOutbox).mock.calls)).not.toContain("projectKey");
    expect(JSON.stringify(envelope)).not.toContain("payloadDigest");
  });

  it("imports valid offline work encrypted under multiple project-key versions", async () => {
    const keySix = await projectKey();
    const keySeven = await projectKey();
    const envelopeSix = {
      projectId: "project-one",
      deviceId: "device-ios-1",
      operationId: "operation-old-key",
      baseRevision: "revision-old",
      kind: "dictated_passage" as const,
      keyVersion: 6,
    };
    const envelopeSeven = {
      projectId: "project-one",
      deviceId: "device-ios-1",
      operationId: "operation-current-key",
      baseRevision: "revision-current",
      kind: "capture_note" as const,
      keyVersion: 7,
    };
    const payloadFor = (envelope: HostedMobileOutboxIdentity) => ({
      schema_version: 1,
      project_id: envelope.projectId,
      device_id: envelope.deviceId,
      operation_id: envelope.operationId,
      base_revision: envelope.baseRevision,
      kind: envelope.kind,
      content: `content for ${envelope.operationId}`,
    });
    const items = await Promise.all([
      encryptedOutboxItem(
        keySix,
        envelopeSix,
        payloadFor(envelopeSix),
        "2026-08-30T12:00:00Z"
      ),
      encryptedOutboxItem(
        keySeven,
        envelopeSeven,
        payloadFor(envelopeSeven),
        "2026-08-30T12:01:00Z"
      ),
    ]);
    const imported = (envelope: HostedMobileOutboxIdentity) => ({
      schema_version: 1 as const,
      project_id: envelope.projectId,
      device_id: envelope.deviceId,
      operation_id: envelope.operationId,
      kind: envelope.kind,
      payload_digest: `sha256:${"a".repeat(64)}`,
      base_revision: envelope.baseRevision,
      imported_revision: envelope.baseRevision,
      stale: false,
      disposition: "imported" as const,
      artifact_kind: envelope.kind === "dictated_passage" ? "proposal" : "mobile_inbox_item",
      artifact_id: `artifact-${envelope.operationId}`,
      imported_at: "2026-08-30T12:02:00Z",
    });
    const sidecar: MobileSyncSidecar = {
      prepareSnapshot: vi.fn(),
      importOutboxItem: vi.fn(async (_root, input) => imported({
        projectId: input.envelope.projectId,
        deviceId: input.envelope.deviceId,
        operationId: input.envelope.operationId,
        baseRevision: input.envelope.baseRevision,
        kind: input.payload.kind as "dictated_passage" | "capture_note",
        keyVersion: input.envelope.operationId === envelopeSix.operationId ? 6 : 7,
      })),
    };
    const acknowledgeOutbox = vi.fn(async () => undefined);
    const transport: MobileSyncTransport = {
      publishSnapshot: vi.fn(),
      pullOutbox: vi.fn(async () => items),
      acknowledgeOutbox,
    };
    const resolveProjectKey = vi.fn(async (version: number) => (
      version === 6 ? keySix : version === 7 ? keySeven : null
    ));

    const report = await createMobileSyncService({ sidecar, transport }).importOutbox({
      projectRoot: "/project",
      projectId: "project-one",
      resolveProjectKey,
    });

    expect(report.imported.map((item) => item.operation_id)).toEqual([
      envelopeSix.operationId,
      envelopeSeven.operationId,
    ]);
    expect(report.imported[0].artifact_kind).toBe("proposal");
    expect(report.failures).toEqual([]);
    expect(resolveProjectKey).toHaveBeenCalledWith(6);
    expect(resolveProjectKey).toHaveBeenCalledWith(7);
    expect(acknowledgeOutbox).toHaveBeenNthCalledWith(1, envelopeSix, "imported");
    expect(acknowledgeOutbox).toHaveBeenNthCalledWith(2, envelopeSeven, "imported");
    expect(sidecar.importOutboxItem).toHaveBeenCalledTimes(2);
  });

  it("acknowledges authenticated-decryption poison as permanently rejected", async () => {
    const key = await projectKey();
    const envelope = {
      projectId: "project-one",
      deviceId: "device-ios-1",
      operationId: "operation-tampered",
      baseRevision: "revision-one",
      kind: "capture_note" as const,
      keyVersion: 7,
    };
    const sidecar: MobileSyncSidecar = {
      prepareSnapshot: vi.fn(),
      importOutboxItem: vi.fn(),
    };
    const acknowledgeOutbox = vi.fn(async () => undefined);
    const transport: MobileSyncTransport = {
      publishSnapshot: vi.fn(),
      pullOutbox: vi.fn(async () => [{
        schema_version: 1 as const,
        envelope,
        encryption: {
          algorithm: "AES-256-GCM" as const,
          iv_base64: bytesToBase64(new Uint8Array(12)),
          associated_data_version: 1 as const,
        },
        ciphertext_base64: bytesToBase64(new Uint8Array([1, 2, 3, 4])),
      }]),
      acknowledgeOutbox,
    };
    const service = createMobileSyncService({ sidecar, transport });

    const report = await service.importOutbox({
      projectRoot: "/project",
      projectId: "project-one",
      projectKey: key,
      keyVersion: 7,
    });

    expect(report).toEqual({
      imported: [],
      failures: [{
        operationId: "operation-tampered",
        classification: "permanent",
        error: "Unable to decrypt or import mobile outbox item.",
      }],
    });
    expect(sidecar.importOutboxItem).not.toHaveBeenCalled();
    expect(acknowledgeOutbox).toHaveBeenCalledWith(envelope, "rejected");
    expect(JSON.stringify(report)).not.toContain("capture_note");
  });

  it("rejects a transport-malformed row and still imports later rows in its page", async () => {
    const key = await projectKey();
    const malformedEnvelope: HostedMobileOutboxIdentity = {
      projectId: "project-one",
      deviceId: "device-ios-1",
      operationId: "operation-malformed-hosted",
      baseRevision: "revision-one",
      kind: "capture_note",
      keyVersion: 7,
    };
    const validEnvelope: HostedMobileOutboxIdentity = {
      ...malformedEnvelope,
      operationId: "operation-after-malformed",
    };
    const validItem = await encryptedOutboxItem(key, validEnvelope, {
      schema_version: 1,
      project_id: validEnvelope.projectId,
      device_id: validEnvelope.deviceId,
      operation_id: validEnvelope.operationId,
      base_revision: validEnvelope.baseRevision,
      kind: validEnvelope.kind,
      content: "still reachable",
    }, "2026-08-30T12:00:01Z");
    const imported = {
      schema_version: 1 as const,
      project_id: validEnvelope.projectId,
      device_id: validEnvelope.deviceId,
      operation_id: validEnvelope.operationId,
      kind: validEnvelope.kind,
      payload_digest: `sha256:${"d".repeat(64)}`,
      base_revision: validEnvelope.baseRevision,
      imported_revision: validEnvelope.baseRevision,
      stale: false,
      disposition: "imported" as const,
      artifact_kind: "mobile_inbox_item",
      artifact_id: "mobile-inbox-after-malformed",
      imported_at: "2026-08-30T12:01:00Z",
    };
    const acknowledgeOutbox = vi.fn(async () => undefined);
    const sidecar: MobileSyncSidecar = {
      prepareSnapshot: vi.fn(),
      importOutboxItem: vi.fn(async () => imported),
    };
    const transport: MobileSyncTransport = {
      publishSnapshot: vi.fn(),
      pullOutbox: vi.fn(async () => [{
        schema_version: 1 as const,
        envelope: malformedEnvelope,
        receivedAt: "2026-08-30T12:00:00Z",
        transport_error: "malformed_hosted_ciphertext" as const,
      }, validItem]),
      acknowledgeOutbox,
    };

    const report = await createMobileSyncService({ sidecar, transport }).importOutbox({
      projectRoot: "/project",
      projectId: "project-one",
      projectKey: key,
      keyVersion: 7,
    });

    expect(report.imported).toEqual([imported]);
    expect(report.failures).toEqual([{
      operationId: malformedEnvelope.operationId,
      classification: "permanent",
      error: "Unable to decrypt or import mobile outbox item.",
    }]);
    expect(acknowledgeOutbox).toHaveBeenNthCalledWith(1, malformedEnvelope, "rejected");
    expect(acknowledgeOutbox).toHaveBeenNthCalledWith(2, validEnvelope, "imported");
  });

  it("leaves historical-key work pending when that key is temporarily unavailable", async () => {
    const oldKey = await projectKey();
    const envelope = {
      projectId: "project-one",
      deviceId: "device-ios-1",
      operationId: "operation-awaiting-old-key",
      baseRevision: "revision-old",
      kind: "thread_turn" as const,
      keyVersion: 3,
    };
    const item = await encryptedOutboxItem(oldKey, envelope, {
      schema_version: 1,
      project_id: envelope.projectId,
      device_id: envelope.deviceId,
      operation_id: envelope.operationId,
      base_revision: envelope.baseRevision,
      kind: envelope.kind,
      content: "Offline thought",
    }, "2026-08-30T12:00:00Z");
    const acknowledgeOutbox = vi.fn(async () => undefined);
    const sidecar: MobileSyncSidecar = {
      prepareSnapshot: vi.fn(),
      importOutboxItem: vi.fn(),
    };
    const transport: MobileSyncTransport = {
      publishSnapshot: vi.fn(),
      pullOutbox: vi.fn(async () => [item]),
      acknowledgeOutbox,
    };

    const report = await createMobileSyncService({ sidecar, transport }).importOutbox({
      projectRoot: "/project",
      projectId: "project-one",
      resolveProjectKey: vi.fn(async () => null),
    });

    expect(report).toEqual({
      imported: [],
      failures: [{
        operationId: envelope.operationId,
        classification: "transient",
        error: "Project key version is temporarily unavailable.",
      }],
    });
    expect(sidecar.importOutboxItem).not.toHaveBeenCalled();
    expect(acknowledgeOutbox).not.toHaveBeenCalled();
  });

  it("paginates past more than ten full pages of retryable old-key work", async () => {
    const unavailableItems: EncryptedMobileOutboxItem[] = Array.from(
      { length: 1_000 },
      (_, index) => ({
        schema_version: 1,
        receivedAt: new Date(Date.UTC(2026, 7, 30, 12, 0, index)).toISOString(),
        envelope: {
          projectId: "project-one",
          deviceId: "device-ios-1",
          operationId: `operation-old-${String(index).padStart(4, "0")}`,
          baseRevision: "revision-old",
          kind: "thread_turn",
          keyVersion: 3,
        },
        encryption: {
          algorithm: "AES-256-GCM",
          iv_base64: bytesToBase64(new Uint8Array(12)),
          associated_data_version: 1,
        },
        ciphertext_base64: bytesToBase64(new Uint8Array([1])),
      })
    );
    const currentKey = await projectKey();
    const currentEnvelope = {
      projectId: "project-one",
      deviceId: "device-ios-1",
      operationId: "operation-current-after-page",
      baseRevision: "revision-current",
      kind: "capture_note" as const,
      keyVersion: 7,
    };
    const currentItem = await encryptedOutboxItem(currentKey, currentEnvelope, {
      schema_version: 1,
      project_id: currentEnvelope.projectId,
      device_id: currentEnvelope.deviceId,
      operation_id: currentEnvelope.operationId,
      base_revision: currentEnvelope.baseRevision,
      kind: currentEnvelope.kind,
      content: "Reached after old offline work",
    }, "2026-08-30T13:00:00Z");
    const pullOutbox = vi.fn(async (
      _projectId: string,
      page?: { after?: MobileOutboxCursor | null; limit?: number }
    ) => {
      if (!page?.after) return unavailableItems.slice(0, 100);
      const previousIndex = unavailableItems.findIndex(
        (item) => item.envelope.operationId === page.after?.operationId
      );
      if (previousIndex < unavailableItems.length - 1) {
        return unavailableItems.slice(previousIndex + 1, previousIndex + 101);
      }
      return [currentItem];
    });
    const imported = {
      schema_version: 1 as const,
      project_id: "project-one",
      device_id: currentEnvelope.deviceId,
      operation_id: currentEnvelope.operationId,
      kind: currentEnvelope.kind,
      payload_digest: `sha256:${"c".repeat(64)}`,
      base_revision: currentEnvelope.baseRevision,
      imported_revision: currentEnvelope.baseRevision,
      stale: false,
      disposition: "imported" as const,
      artifact_kind: "mobile_inbox_item",
      artifact_id: "mobile-inbox-current",
      imported_at: "2026-08-30T12:03:00Z",
    };
    const sidecar: MobileSyncSidecar = {
      prepareSnapshot: vi.fn(),
      importOutboxItem: vi.fn(async () => imported),
    };
    const transport: MobileSyncTransport = {
      publishSnapshot: vi.fn(),
      pullOutbox,
      acknowledgeOutbox: vi.fn(async () => undefined),
    };

    const report = await createMobileSyncService({ sidecar, transport }).importOutbox({
      projectRoot: "/project",
      projectId: "project-one",
      resolveProjectKey: async (version) => version === 7 ? currentKey : null,
    });

    expect(report.imported).toEqual([imported]);
    expect(report.failures).toHaveLength(1_000);
    expect(report.failures.every((failure) => failure.classification === "transient")).toBe(true);
    expect(pullOutbox).toHaveBeenNthCalledWith(1, "project-one", {
      after: null,
      limit: 100,
    });
    expect(pullOutbox).toHaveBeenNthCalledWith(2, "project-one", {
      after: {
        receivedAt: unavailableItems[99].receivedAt,
        operationId: unavailableItems[99].envelope.operationId,
      },
      limit: 100,
    });
    expect(pullOutbox).toHaveBeenNthCalledWith(11, "project-one", {
      after: {
        receivedAt: unavailableItems[999].receivedAt,
        operationId: unavailableItems[999].envelope.operationId,
      },
      limit: 100,
    });
    expect(sidecar.importOutboxItem).toHaveBeenCalledTimes(1);
  });

  it("classifies a hosted outbox network failure as transient", async () => {
    const key = await projectKey();
    const transport: MobileSyncTransport = {
      publishSnapshot: vi.fn(),
      pullOutbox: vi.fn(async () => {
        throw new Error("network unavailable");
      }),
      acknowledgeOutbox: vi.fn(),
    };
    const sidecar: MobileSyncSidecar = {
      prepareSnapshot: vi.fn(),
      importOutboxItem: vi.fn(),
    };

    const report = await createMobileSyncService({ sidecar, transport }).importOutbox({
      projectRoot: "/project",
      projectId: "project-one",
      projectKey: key,
      keyVersion: 7,
    });

    expect(report).toEqual({
      imported: [],
      failures: [{
        operationId: null,
        classification: "transient",
        error: "Unable to load mobile outbox; retry is required.",
      }],
    });
    expect(sidecar.importOutboxItem).not.toHaveBeenCalled();
    expect(transport.acknowledgeOutbox).not.toHaveBeenCalled();
  });

  it("rejects sidecar import poison through the review-safe seam only", async () => {
    const key = await projectKey();
    const envelope = {
      projectId: "project-one",
      deviceId: "device-ios-1",
      operationId: "operation-import-poison",
      baseRevision: "revision-one",
      kind: "dictated_passage" as const,
      keyVersion: 7,
    };
    const item = await encryptedOutboxItem(key, envelope, {
      schema_version: 1,
      project_id: envelope.projectId,
      device_id: envelope.deviceId,
      operation_id: envelope.operationId,
      base_revision: envelope.baseRevision,
      kind: envelope.kind,
      content: "Proposal-only dictated prose",
    }, "2026-08-30T12:00:00Z");
    const sidecar: MobileSyncSidecar = {
      prepareSnapshot: vi.fn(),
      importOutboxItem: vi.fn(async () => {
        throw new Error("proposal store unavailable");
      }),
    };
    const acknowledgeOutbox = vi.fn(async () => undefined);
    const transport: MobileSyncTransport = {
      publishSnapshot: vi.fn(),
      pullOutbox: vi.fn(async () => [item]),
      acknowledgeOutbox,
    };

    const report = await createMobileSyncService({ sidecar, transport }).importOutbox({
      projectRoot: "/project",
      projectId: "project-one",
      projectKey: key,
      keyVersion: 7,
    });

    expect(report.failures).toEqual([{
      operationId: envelope.operationId,
      classification: "permanent",
      error: "Unable to decrypt or import mobile outbox item.",
    }]);
    expect(sidecar.importOutboxItem).toHaveBeenCalledTimes(1);
    expect(acknowledgeOutbox).toHaveBeenCalledWith(envelope, "rejected");
    expect(JSON.stringify(report)).not.toContain("Proposal-only dictated prose");
  });

  it("rejects decrypted outbox identity that disagrees with hosted metadata", async () => {
    const key = await projectKey();
    const envelope = {
      projectId: "project-one",
      deviceId: "device-ios-1",
      operationId: "operation-mismatch",
      baseRevision: "revision-one",
      kind: "capture_note" as const,
      keyVersion: 7,
    };
    const associatedData = new TextEncoder().encode([
      "openauthor.mobile.outbox.v1",
      envelope.projectId,
      envelope.deviceId,
      envelope.operationId,
      envelope.baseRevision,
      envelope.kind,
      String(envelope.keyVersion),
    ].join("\0"));
    const mismatched = new TextEncoder().encode(
      '{"base_revision":"revision-one","content":"private",'
      + '"device_id":"device-ios-1","kind":"capture_note",'
      + '"operation_id":"operation-mismatch","project_id":"other-project",'
      + '"schema_version":1}'
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: bytesBuffer(iv),
        additionalData: bytesBuffer(associatedData),
      },
      key,
      bytesBuffer(mismatched)
    );
    const sidecar: MobileSyncSidecar = {
      prepareSnapshot: vi.fn(),
      importOutboxItem: vi.fn(),
    };
    const transport: MobileSyncTransport = {
      publishSnapshot: vi.fn(),
      pullOutbox: vi.fn(async () => [{
        schema_version: 1 as const,
        envelope,
        encryption: {
          algorithm: "AES-256-GCM" as const,
          iv_base64: bytesToBase64(iv),
          associated_data_version: 1 as const,
        },
        ciphertext_base64: bytesToBase64(new Uint8Array(ciphertext)),
      }]),
    };

    const report = await createMobileSyncService({ sidecar, transport }).importOutbox({
      projectRoot: "/project",
      projectId: "project-one",
      projectKey: key,
      keyVersion: 7,
    });

    expect(report.failures).toEqual([{
      operationId: "operation-mismatch",
      classification: "permanent",
      error: "Unable to decrypt or import mobile outbox item.",
    }]);
    expect(sidecar.importOutboxItem).not.toHaveBeenCalled();
    expect(JSON.stringify(report)).not.toContain("private");
  });
});
