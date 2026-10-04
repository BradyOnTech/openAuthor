import {
  importMobileOutboxItem,
  prepareMobileSnapshot,
  type MobileOutboxEnvelopeIdentity,
  type MobileOutboxImportResult,
  type MobileSnapshotManifest,
  type PreparedMobileSnapshot,
} from "../api";

export type MobileSyncSidecar = {
  prepareSnapshot(projectRoot: string, projectId: string): Promise<PreparedMobileSnapshot>;
  importOutboxItem(
    projectRoot: string,
    input: {
      envelope: MobileOutboxEnvelopeIdentity;
      payload: Record<string, unknown>;
    }
  ): Promise<MobileOutboxImportResult>;
};

export type EncryptedMobileSnapshot = {
  schema_version: 1;
  snapshot_id: string;
  key_version: number;
  manifest: MobileSnapshotManifest;
  plaintext_sha256: string;
  object: {
    bucket: "mobile-encrypted-sync";
    path: string;
    byte_length: number;
    sha256: string;
    content_type: "text/plain;charset=utf-8";
  };
  encryption: {
    algorithm: "AES-256-GCM";
    iv_base64: string;
    associated_data_version: 1;
  };
  ciphertext_base64: string;
  hosted_manifest: {
    algorithm: "AES-256-GCM";
    nonce_base64: string;
    ciphertext_base64: string;
    ciphertext_sha256: string;
    associated_data_version: 1;
  };
};

export const MOBILE_OUTBOX_KINDS = [
  "capture_note",
  "dictated_passage",
  "story_memory_suggestion",
  "change_set_request",
  "thread_turn",
  "review_decision",
] as const;

export type MobileOutboxKind = (typeof MOBILE_OUTBOX_KINDS)[number];

export type HostedMobileOutboxIdentity = {
  projectId: string;
  deviceId: string;
  operationId: string;
  baseRevision: string;
  kind: MobileOutboxKind;
  keyVersion: number;
};

export type EncryptedMobileOutboxItem = {
  schema_version: 1;
  envelope: HostedMobileOutboxIdentity;
  receivedAt?: string;
  encryption: {
    algorithm: "AES-256-GCM";
    iv_base64: string;
    associated_data_version: 1;
  };
  ciphertext_base64: string;
};

export type MalformedMobileOutboxItem = {
  schema_version: 1;
  envelope: HostedMobileOutboxIdentity;
  receivedAt: string;
  transport_error: "malformed_hosted_ciphertext";
};

export type PulledMobileOutboxItem =
  | EncryptedMobileOutboxItem
  | MalformedMobileOutboxItem;

export type MobileOutboxCursor = {
  receivedAt: string;
  operationId: string;
};

export type MobileSyncTransport = {
  publishSnapshot(snapshot: EncryptedMobileSnapshot): Promise<void>;
  pullOutbox(
    projectId: string,
    page?: { after?: MobileOutboxCursor | null; limit?: number }
  ): Promise<PulledMobileOutboxItem[]>;
  acknowledgeOutbox?(
    identity: HostedMobileOutboxIdentity,
    status: "imported" | "conflict" | "rejected"
  ): Promise<void>;
};

export type MobileProjectKeyResolver = (
  keyVersion: number
) => CryptoKey | null | Promise<CryptoKey | null>;

type CryptoProvider = Pick<Crypto, "getRandomValues" | "randomUUID" | "subtle">;

function base64ToBytes(value: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error("Mobile sync payload contains invalid base64.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function bytesBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

function assertProjectKey(key: CryptoKey, usage: KeyUsage): void {
  const algorithm = key.algorithm as AesKeyAlgorithm;
  if (
    key.type !== "secret"
    || key.extractable
    || algorithm.name !== "AES-GCM"
    || algorithm.length !== 256
    || !key.usages.includes(usage)
  ) {
    throw new Error(
      `Mobile sync requires a non-extractable AES-256-GCM key with ${usage} permission.`
    );
  }
}

function requiredKeyVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Mobile sync key version is invalid.");
  }
  return value;
}

function snapshotAssociatedData(
  manifest: MobileSnapshotManifest,
  keyVersion: number
): Uint8Array {
  return new TextEncoder().encode(
    `openauthor.snapshot.v1|${manifest.project_id}|${manifest.revision}|${keyVersion}`
  );
}

function outboxAssociatedData(envelope: HostedMobileOutboxIdentity): Uint8Array {
  return new TextEncoder().encode([
    "openauthor.mobile.outbox.v1",
    envelope.projectId,
    envelope.deviceId,
    envelope.operationId,
    envelope.baseRevision,
    envelope.kind,
    String(envelope.keyVersion),
  ].join("\0"));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  if (
    value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return value;
  }
  throw new Error("Mobile outbox payload contains a non-JSON value.");
}

async function canonicalPayloadDigest(
  payload: Record<string, unknown>,
  cryptoProvider: CryptoProvider
): Promise<string> {
  const canonical = JSON.stringify(canonicalize(payload));
  const digest = await cryptoProvider.subtle.digest(
    "SHA-256",
    bytesBuffer(new TextEncoder().encode(canonical))
  );
  return "sha256:" + Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(
  bytes: Uint8Array,
  cryptoProvider: CryptoProvider
): Promise<string> {
  const digest = await cryptoProvider.subtle.digest("SHA-256", bytesBuffer(bytes));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const defaultSidecar: MobileSyncSidecar = {
  prepareSnapshot: prepareMobileSnapshot,
  importOutboxItem: importMobileOutboxItem,
};

export function createMobileSyncService(options: {
  transport: MobileSyncTransport;
  sidecar?: MobileSyncSidecar;
  cryptoProvider?: CryptoProvider;
}) {
  const sidecar = options.sidecar ?? defaultSidecar;
  const cryptoProvider = options.cryptoProvider ?? crypto;

  return {
    async publishSnapshot(input: {
      projectRoot: string;
      projectId: string;
      projectKey: CryptoKey;
      keyVersion: number;
    }): Promise<EncryptedMobileSnapshot> {
      assertProjectKey(input.projectKey, "encrypt");
      const keyVersion = requiredKeyVersion(input.keyVersion);
      const prepared = await sidecar.prepareSnapshot(input.projectRoot, input.projectId);
      if (prepared.manifest.project_id !== input.projectId) {
        throw new Error("Prepared mobile snapshot belongs to a different project.");
      }
      const plaintext = base64ToBytes(prepared.plaintext_base64);
      const plaintextSha256 = await sha256Hex(plaintext, cryptoProvider);
      const snapshotId = cryptoProvider.randomUUID();
      const iv = new Uint8Array(12);
      cryptoProvider.getRandomValues(iv);
      const associatedData = snapshotAssociatedData(prepared.manifest, keyVersion);
      const ciphertext = await cryptoProvider.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: bytesBuffer(iv),
          additionalData: bytesBuffer(associatedData),
        },
        input.projectKey,
        bytesBuffer(plaintext)
      );
      const ciphertextBytes = new Uint8Array(ciphertext);
      const combined = new Uint8Array(iv.byteLength + ciphertextBytes.byteLength);
      combined.set(iv, 0);
      combined.set(ciphertextBytes, iv.byteLength);
      const ciphertextBase64 = bytesToBase64(combined);
      const objectBytes = new TextEncoder().encode(ciphertextBase64);
      const objectPath = `projects/${input.projectId}/snapshots/${snapshotId}.bin`;

      const hostedManifestPlaintext = new TextEncoder().encode(JSON.stringify({
        schema_version: 1,
        snapshot_id: snapshotId,
        project_id: input.projectId,
        project_revision: prepared.manifest.revision,
        key_version: keyVersion,
        plaintext_sha256: plaintextSha256,
      }));
      const hostedManifestNonce = new Uint8Array(12);
      cryptoProvider.getRandomValues(hostedManifestNonce);
      const hostedManifestAad = new TextEncoder().encode([
        "openauthor.mobile.snapshot.manifest.v1",
        snapshotId,
        input.projectId,
        prepared.manifest.revision,
        String(keyVersion),
      ].join("\0"));
      const hostedManifestCiphertext = new Uint8Array(
        await cryptoProvider.subtle.encrypt(
          {
            name: "AES-GCM",
            iv: bytesBuffer(hostedManifestNonce),
            additionalData: bytesBuffer(hostedManifestAad),
          },
          input.projectKey,
          bytesBuffer(hostedManifestPlaintext)
        )
      );
      const encrypted: EncryptedMobileSnapshot = {
        schema_version: 1,
        snapshot_id: snapshotId,
        key_version: keyVersion,
        manifest: prepared.manifest,
        plaintext_sha256: plaintextSha256,
        object: {
          bucket: "mobile-encrypted-sync",
          path: objectPath,
          byte_length: objectBytes.byteLength,
          sha256: await sha256Hex(objectBytes, cryptoProvider),
          content_type: "text/plain;charset=utf-8",
        },
        encryption: {
          algorithm: "AES-256-GCM",
          iv_base64: bytesToBase64(iv),
          associated_data_version: 1,
        },
        ciphertext_base64: ciphertextBase64,
        hosted_manifest: {
          algorithm: "AES-256-GCM",
          nonce_base64: bytesToBase64(hostedManifestNonce),
          ciphertext_base64: bytesToBase64(hostedManifestCiphertext),
          ciphertext_sha256: await sha256Hex(hostedManifestCiphertext, cryptoProvider),
          associated_data_version: 1,
        },
      };
      await options.transport.publishSnapshot(encrypted);
      return encrypted;
    },
    async importOutbox(input: {
      projectRoot: string;
      projectId: string;
    } & (
      | { resolveProjectKey: MobileProjectKeyResolver }
      | { projectKey: CryptoKey; keyVersion: number }
    )): Promise<{
      imported: MobileOutboxImportResult[];
      failures: Array<{
        operationId: string | null;
        classification: "permanent" | "transient";
        error: string;
      }>;
    }> {
      let resolveProjectKey: MobileProjectKeyResolver;
      if ("resolveProjectKey" in input) {
        resolveProjectKey = input.resolveProjectKey;
      } else {
        assertProjectKey(input.projectKey, "decrypt");
        const compatibleKeyVersion = requiredKeyVersion(input.keyVersion);
        resolveProjectKey = (version) => (
          version === compatibleKeyVersion ? input.projectKey : null
        );
      }
      const imported: MobileOutboxImportResult[] = [];
      const failures: Array<{
        operationId: string | null;
        classification: "permanent" | "transient";
        error: string;
      }> = [];
      const rejectPermanent = async (item: PulledMobileOutboxItem) => {
        failures.push({
          operationId: item.envelope.operationId,
          classification: "permanent",
          error: "Unable to decrypt or import mobile outbox item.",
        });
        if (options.transport.acknowledgeOutbox) {
          try {
            await options.transport.acknowledgeOutbox(item.envelope, "rejected");
          } catch {
            failures.push({
              operationId: item.envelope.operationId,
              classification: "transient",
              error: "Unable to acknowledge mobile outbox item; retry is required.",
            });
          }
        }
      };

      let after: MobileOutboxCursor | null = null;
      while (true) {
        let encryptedItems: PulledMobileOutboxItem[];
        try {
          encryptedItems = await options.transport.pullOutbox(input.projectId, {
            after,
            limit: 100,
          });
        } catch {
          failures.push({
            operationId: null,
            classification: "transient",
            error: "Unable to load mobile outbox; retry is required.",
          });
          break;
        }

        for (const item of encryptedItems) {
          if ("transport_error" in item) {
            await rejectPermanent(item);
            continue;
          }
          if (
            item.schema_version !== 1
            || item.encryption.algorithm !== "AES-256-GCM"
            || item.encryption.associated_data_version !== 1
            || item.envelope.projectId !== input.projectId
            || !MOBILE_OUTBOX_KINDS.includes(item.envelope.kind)
          ) {
            await rejectPermanent(item);
            continue;
          }

          let projectKey: CryptoKey | null;
          try {
            const itemKeyVersion = requiredKeyVersion(item.envelope.keyVersion);
            projectKey = await resolveProjectKey(itemKeyVersion);
            if (projectKey === null) {
              throw new Error("Project key version is temporarily unavailable.");
            }
            assertProjectKey(projectKey, "decrypt");
          } catch {
            failures.push({
              operationId: item.envelope.operationId,
              classification: "transient",
              error: "Project key version is temporarily unavailable.",
            });
            continue;
          }

          let result: MobileOutboxImportResult;
          try {
            const iv = base64ToBytes(item.encryption.iv_base64);
            if (iv.byteLength !== 12) {
              throw new Error("Encrypted mobile outbox IV is invalid.");
            }
            const plaintext = await cryptoProvider.subtle.decrypt(
              {
                name: "AES-GCM",
                iv: bytesBuffer(iv),
                additionalData: bytesBuffer(outboxAssociatedData(item.envelope)),
              },
              projectKey,
              bytesBuffer(base64ToBytes(item.ciphertext_base64))
            );
            const decoded: unknown = JSON.parse(new TextDecoder().decode(plaintext));
            if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)) {
              throw new Error("Decrypted mobile outbox payload must be an object.");
            }
            const payload = decoded as Record<string, unknown>;
            if (
              payload.schema_version !== 1
              || payload.project_id !== item.envelope.projectId
              || payload.device_id !== item.envelope.deviceId
              || payload.operation_id !== item.envelope.operationId
              || payload.base_revision !== item.envelope.baseRevision
              || payload.kind !== item.envelope.kind
            ) {
              throw new Error("Decrypted mobile outbox identity does not match hosted metadata.");
            }
            const payloadDigest = await canonicalPayloadDigest(payload, cryptoProvider);
            result = await sidecar.importOutboxItem(input.projectRoot, {
              envelope: {
                projectId: item.envelope.projectId,
                deviceId: item.envelope.deviceId,
                operationId: item.envelope.operationId,
                baseRevision: item.envelope.baseRevision,
                payloadDigest,
              },
              payload,
            });
          } catch {
            await rejectPermanent(item);
            continue;
          }

          imported.push(result);
          if (options.transport.acknowledgeOutbox) {
            try {
              await options.transport.acknowledgeOutbox(
                item.envelope,
                result.disposition === "conflict" ? "conflict" : "imported"
              );
            } catch {
              failures.push({
                operationId: item.envelope.operationId,
                classification: "transient",
                error: "Unable to acknowledge mobile outbox item; retry is required.",
              });
            }
          }
        }

        if (encryptedItems.length < 100) break;
        const lastItem = encryptedItems[encryptedItems.length - 1];
        const nextAfter = lastItem?.receivedAt ? {
          receivedAt: lastItem.receivedAt,
          operationId: lastItem.envelope.operationId,
        } : null;
        if (
          !nextAfter
          || (
            nextAfter.receivedAt === after?.receivedAt
            && nextAfter.operationId === after.operationId
          )
        ) {
          failures.push({
            operationId: null,
            classification: "transient",
            error: "Mobile outbox pagination did not advance; retry is required.",
          });
          break;
        }
        after = nextAfter;
      }
      return { imported, failures };
    },
  };
}
