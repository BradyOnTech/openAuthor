import {
  MOBILE_OUTBOX_KINDS,
  type EncryptedMobileSnapshot,
  type HostedMobileOutboxIdentity,
  type MobileOutboxCursor,
  type MobileOutboxKind,
  type MobileSyncTransport,
  type PulledMobileOutboxItem,
} from "./mobileSync";
import {
  MOBILE_PROJECT_KEY_ENVELOPE_ALGORITHM,
  type MobileProjectDevice,
  type MobileProjectKeyState,
  type MobileProjectKeyEnvelope,
  type MobileProjectKeyProvisioningTransport,
} from "./projectKeyProvisioning";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

class RpcHttpError extends Error {
  constructor(readonly status: number) {
    super(`Supabase mobile sync RPC failed (${status}).`);
  }
}

function matchesPublication(value: unknown, expected: Record<string, string | number>): boolean {
  // PostgREST represents a composite/table result as a JSON row array unless
  // singular representation is selected. Accept exactly one full row only.
  if (Array.isArray(value) && value.length === 1) value = value[0];
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.entries(expected).every(([field, wanted]) => row[field] === wanted);
}

export type SupabaseMobileSyncTransportOptions = {
  supabaseUrl: string;
  publishableKey: string;
  userAccessToken: string;
  getAccessToken?: () => Promise<string>;
  deviceId: string;
  fetch?: FetchLike;
};

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function base64ToBytes(value: string): Uint8Array {
  let decoded: string;
  try {
    decoded = atob(value);
  } catch {
    throw new Error("Hosted mobile ciphertext is invalid base64.");
  }
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  if (bytesToBase64(bytes) !== value) {
    throw new Error("Hosted mobile ciphertext is not canonical base64.");
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

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlToBytes(
  value: string,
  expectedLength: number,
  label: string
): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.includes("=")) {
    throw new Error(`${label} is not unpadded base64url.`);
  }
  let binary: string;
  try {
    binary = atob(
      value.replace(/-/g, "+").replace(/_/g, "/")
        .padEnd(Math.ceil(value.length / 4) * 4, "=")
    );
  } catch {
    throw new Error(`${label} is invalid base64url.`);
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (
    bytes.byteLength !== expectedLength
    || bytesToBase64Url(bytes) !== value
  ) {
    throw new Error(`${label} must encode exactly ${expectedLength} bytes.`);
  }
  return bytes;
}

function bytesBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

function decodeBytea(value: unknown, label: string): Uint8Array {
  if (typeof value !== "string" || !/^\\x(?:[0-9a-f]{2})+$/i.test(value)) {
    throw new Error(`${label} has invalid PostgreSQL bytea encoding.`);
  }
  const bytes = new Uint8Array((value.length - 2) / 2);
  for (let index = 2; index < value.length; index += 2) {
    bytes[(index - 2) / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

function encodeBytea(bytes: Uint8Array): string {
  return "\\x" + Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytesBuffer(bytes));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Hosted mobile sync returned an invalid record.");
  }
  return value as Record<string, unknown>;
}

function stringField(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Hosted mobile sync field '${field}' is invalid.`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 1) {
    throw new Error(`${label} is invalid.`);
  }
  return numeric;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new Error(`${label} is invalid.`);
  }
  return numeric;
}

export class SupabaseMobileSyncTransport implements
  MobileSyncTransport,
  MobileProjectKeyProvisioningTransport {
  readonly #url: string;
  readonly #publishableKey: string;
  readonly #accessToken: () => Promise<string>;
  readonly #deviceId: string;
  readonly #fetch: FetchLike;

  constructor(options: SupabaseMobileSyncTransportOptions) {
    this.#url = required(options.supabaseUrl, "Supabase URL").replace(/\/+$/, "");
    this.#publishableKey = required(options.publishableKey, "Supabase publishable key");
    const token = required(options.userAccessToken, "User access token");
    this.#accessToken = options.getAccessToken ?? (async () => token);
    this.#deviceId = required(options.deviceId, "Desktop device id");
    this.#fetch = options.fetch ?? fetch;
  }

  async #rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
    const response = await this.#fetch(`${this.#url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: this.#publishableKey,
        Authorization: `Bearer ${await this.#accessToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new RpcHttpError(response.status);
    }
    try {
      return await response.json() as T;
    } catch {
      throw new Error("Supabase mobile sync RPC returned invalid JSON.");
    }
  }

  async #publicationReadback(expected: Record<string, string | number>): Promise<"confirmed" | "conflict" | "unknown"> {
    try {
      // This API is key-filtered and limited to the newest 100 rows. Presence
      // can confirm exact publication; absence cannot prove there was no commit.
      const rows = await this.#rpc<unknown>("mobile_list_snapshot_manifests", {
        p_requesting_device_id: this.#deviceId,
        p_project_id: expected.project_id,
        p_limit: 100,
      });
      if (!Array.isArray(rows) || rows.length > 100 || rows.some(row => !row || typeof row !== "object" || Array.isArray(row))) return "unknown";
      const matching = rows.filter(row => row.snapshot_id === expected.snapshot_id);
      if (matching.length !== 1) return "unknown";
      return matchesPublication(matching[0], expected) ? "confirmed" : "conflict";
    } catch {
      return "unknown";
    }
  }

  async #reconcilePublication(expected: Record<string, string | number>, failure: unknown): Promise<void> {
    const result = await this.#publicationReadback(expected);
    if (result === "confirmed") return;
    if (result === "conflict") throw new Error("A conflicting snapshot already uses this identity. Ciphertext was retained; no automatic retry was made.");
    const rejected = failure instanceof RpcHttpError && failure.status >= 400 && failure.status < 500 && ![408, 429].includes(failure.status);
    throw new Error(`${rejected ? "The publication request was rejected" : "The publication request could not be confirmed"}; its published state is unconfirmed. Ciphertext was retained; no automatic retry was made. Check the published snapshots before trying again.`);
  }

  async listProjectDevices(projectId: string): Promise<MobileProjectDevice[]> {
    const rows = await this.#rpc<unknown>("mobile_list_project_devices", {
      p_requesting_device_id: this.#deviceId,
      p_project_id: required(projectId, "Project id"),
    });
    if (!Array.isArray(rows)) {
      throw new Error("Supabase project device response must be a list.");
    }
    const devices: MobileProjectDevice[] = [];
    for (const value of rows) {
      const row = record(value);
      const publicKey = decodeBytea(row.public_key, "Mobile device public key");
      if (await sha256Hex(publicKey) !== stringField(row, "public_key_sha256")) {
        throw new Error("Mobile device public key digest mismatch.");
      }
      const keyAlgorithm = stringField(row, "key_algorithm");
      if (keyAlgorithm === "x25519-v1" && publicKey.byteLength !== 32) {
        throw new Error("X25519 mobile device public key must be 32 bytes.");
      }
      const enrolledAt = row.project_enrolled_at;
      const revokedAt = row.project_revoked_at;
      if (
        enrolledAt !== null && (typeof enrolledAt !== "string" || !enrolledAt.trim())
      ) {
        throw new Error("Mobile project enrollment timestamp is invalid.");
      }
      if (
        revokedAt !== null && (typeof revokedAt !== "string" || !revokedAt.trim())
      ) {
        throw new Error("Mobile project revocation timestamp is invalid.");
      }
      devices.push({
        deviceId: stringField(row, "device_id"),
        userId: stringField(row, "user_id"),
        platform: stringField(row, "platform"),
        deviceKeyVersion: positiveInteger(row.key_version, "Mobile device key version"),
        keyId: stringField(row, "key_id"),
        keyAlgorithm,
        publicKey: bytesToBase64Url(publicKey),
        projectEnrolledAt: enrolledAt,
        projectRevokedAt: revokedAt,
      });
    }
    return devices;
  }

  async revokeProjectDevice(input: {
    projectId: string;
    targetDeviceId: string;
    reasonCode: string;
  }): Promise<void> {
    const projectId = required(input.projectId, "Project id");
    const targetDeviceId = required(input.targetDeviceId, "Target device id");
    const reasonCode = required(input.reasonCode, "Revocation reason");
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(reasonCode)) throw new Error("Revocation reason code is invalid.");
    const response = await this.#rpc<unknown>("mobile_revoke_project_device", {
      p_requesting_device_id: this.#deviceId,
      p_project_id: projectId,
      p_target_device_id: targetDeviceId,
      p_reason_code: reasonCode,
    });
    const row = record(Array.isArray(response) && response.length === 1 ? response[0] : response);
    if (row.project_id !== projectId || row.device_id !== targetDeviceId
      || row.revoked_by_device_id !== this.#deviceId || row.revocation_reason_code !== reasonCode
      || typeof row.revoked_at !== "string" || !row.revoked_at.trim()) {
      throw new Error("Device revocation could not be confirmed. Refresh the device list before trying again.");
    }
  }

  async getProjectKeyState(projectId: string): Promise<MobileProjectKeyState> {
    const expectedProject = required(projectId, "Project id");
    const row = record(await this.#rpc<unknown>("mobile_get_project_key_state", {
      p_requesting_device_id: this.#deviceId, p_project_id: expectedProject,
    }));
    const latest = row.latest_key_version;
    const active = row.active_key_version;
    if (row.project_id !== expectedProject || typeof latest !== "number" || !Number.isSafeInteger(latest) || latest < 0
      || active !== null && (typeof active !== "number" || !Number.isSafeInteger(active) || active < 1 || active !== latest)) {
      throw new Error("Hosted book key state is invalid. Reconnect before syncing.");
    }
    return { latestKeyVersion: latest, activeKeyVersion: active as number | null };
  }

  async rotateProjectKeyWithEnvelopes(input: {
    projectId: string;
    expectedPreviousVersion: number;
    reasonCode: string;
    envelopes: MobileProjectKeyEnvelope[];
  }): Promise<{ keyVersion: number }> {
    const projectId = required(input.projectId, "Project id");
    if (input.envelopes.length === 0) {
      throw new Error("At least one project key envelope is required.");
    }
    const envelopes = await Promise.all(input.envelopes.map(async (envelope) => {
      if (envelope.algorithm !== MOBILE_PROJECT_KEY_ENVELOPE_ALGORITHM) {
        throw new Error("Project key envelope algorithm is unsupported.");
      }
      const sealedProjectKey = base64UrlToBytes(
        envelope.sealedProjectKey,
        80,
        "Sealed project key"
      );
      return {
        algorithm: envelope.algorithm,
        envelope_id: required(envelope.envelopeId, "Project key envelope id"),
        recipient_device_id: required(
          envelope.recipientDeviceId,
          "Recipient device id"
        ),
        recipient_key_id: required(envelope.recipientKeyId, "Recipient key id"),
        sealed_project_key_hex: bytesToHex(sealedProjectKey),
        sealed_project_key_sha256: await sha256Hex(sealedProjectKey),
      };
    }));
    const row = record(await this.#rpc<unknown>(
      "mobile_rotate_project_key_with_envelopes",
      {
        p_requesting_device_id: this.#deviceId,
        p_project_id: projectId,
        p_expected_previous_version: nonNegativeInteger(
          input.expectedPreviousVersion,
          "Expected previous project key version"
        ),
        p_reason_code: required(input.reasonCode, "Project key rotation reason"),
        p_envelopes: envelopes,
      }
    ));
    if (stringField(row, "project_id") !== projectId) {
      throw new Error("Hosted project key rotation belongs to another project.");
    }
    return {
      keyVersion: positiveInteger(row.key_version, "Hosted project key version"),
    };
  }

  async publishSnapshot(snapshot: EncryptedMobileSnapshot): Promise<void> {
    const {
      MOBILE_SNAPSHOT_OBJECT_MAX_BYTES,
      parseEncryptedSnapshotBlobMetadata,
    } = await import("@openauthor/contracts");
    if (snapshot.object.byte_length > MOBILE_SNAPSHOT_OBJECT_MAX_BYTES) {
      throw new Error("Encrypted snapshot object exceeds 64 MiB.");
    }
    parseEncryptedSnapshotBlobMetadata({
      schema: "openauthor.mobile.snapshot.blob",
      schema_version: 1,
      snapshot_id: snapshot.snapshot_id,
      project_id: snapshot.manifest.project_id,
      project_revision: snapshot.manifest.revision,
      object_bucket: snapshot.object.bucket,
      object_key: snapshot.object.path,
      content_type: snapshot.object.content_type,
      encryption: {
        algorithm: "aes-256-gcm-v1",
        project_key_version: snapshot.key_version,
        aad_version: snapshot.encryption.associated_data_version,
      },
      ciphertext_sha256: snapshot.object.sha256,
      ciphertext_byte_length: snapshot.object.byte_length,
    });
    if (
      snapshot.schema_version !== 1
      || snapshot.manifest.schema_version !== 1
      || snapshot.object.bucket !== "mobile-encrypted-sync"
      || snapshot.encryption.algorithm !== "AES-256-GCM"
      || snapshot.hosted_manifest.algorithm !== "AES-256-GCM"
      || snapshot.encryption.associated_data_version !== 1
      || snapshot.hosted_manifest.associated_data_version !== 1
    ) {
      throw new Error("Encrypted mobile snapshot metadata is unsupported.");
    }
    const expectedPath = (
      `projects/${snapshot.manifest.project_id}/snapshots/${snapshot.snapshot_id}.bin`
    );
    if (snapshot.object.path !== expectedPath) {
      throw new Error("Encrypted mobile snapshot object path is invalid.");
    }
    const objectBytes = new TextEncoder().encode(snapshot.ciphertext_base64);
    if (
      objectBytes.byteLength !== snapshot.object.byte_length
      || await sha256Hex(objectBytes) !== snapshot.object.sha256
    ) {
      throw new Error("Encrypted mobile snapshot object integrity check failed.");
    }
    const combined = base64ToBytes(snapshot.ciphertext_base64);
    const snapshotNonce = base64ToBytes(snapshot.encryption.iv_base64);
    if (
      snapshotNonce.byteLength !== 12
      || combined.byteLength < 29
      || !snapshotNonce.every((byte, index) => combined[index] === byte)
    ) {
      throw new Error("Encrypted mobile snapshot nonce is invalid.");
    }
    const manifestNonce = base64ToBytes(snapshot.hosted_manifest.nonce_base64);
    const manifestCiphertext = base64ToBytes(
      snapshot.hosted_manifest.ciphertext_base64
    );
    if (
      manifestNonce.byteLength !== 12
      || manifestCiphertext.byteLength < 17
      || await sha256Hex(manifestCiphertext)
        !== snapshot.hosted_manifest.ciphertext_sha256
    ) {
      throw new Error("Encrypted hosted snapshot manifest integrity check failed.");
    }

    // Capture the exact SQL immutable publication fields before any upload or
    // authorization await. Positive responses/readback must agree with all of
    // them, including the publishing device, rather than only the snapshot id.
    const publication = {
      snapshot_id: snapshot.snapshot_id, project_id: snapshot.manifest.project_id,
      project_revision: snapshot.manifest.revision, key_version: snapshot.key_version, schema_version: snapshot.schema_version,
      object_bucket: snapshot.object.bucket, object_path: snapshot.object.path,
      object_byte_length: snapshot.object.byte_length, object_sha256: snapshot.object.sha256,
      manifest_algorithm: "aes-256-gcm-v1", manifest_nonce: encodeBytea(manifestNonce),
      manifest_ciphertext: encodeBytea(manifestCiphertext), manifest_ciphertext_sha256: snapshot.hosted_manifest.ciphertext_sha256,
      created_by_device_id: this.#deviceId,
    };
    const ciphertext = snapshot.ciphertext_base64;

    const encodedPath = snapshot.object.path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const storageUrl = (
      `${this.#url}/storage/v1/object/${snapshot.object.bucket}/${encodedPath}`
    );
    const storageHeaders = {
      apikey: this.#publishableKey,
      Authorization: `Bearer ${await this.#accessToken()}`,
    };
    const upload = await this.#fetch(storageUrl, {
      method: "POST",
      headers: {
        ...storageHeaders,
        "Content-Type": snapshot.object.content_type,
        "x-upsert": "false",
      },
      body: ciphertext,
    });
    if (!upload.ok) {
      if (upload.status === 409) return this.#reconcilePublication(publication, new Error("Snapshot object already exists."));
      throw new Error(`Supabase snapshot upload failed (${upload.status}).`);
    }

    try {
      const request = Object.fromEntries(Object.entries(publication).map(([field, value]) => [field === "created_by_device_id" ? "p_requesting_device_id" : `p_${field}`, value]));
      const committed = await this.#rpc<unknown>("mobile_publish_snapshot", request);
      if (!matchesPublication(committed, publication)) throw new Error("Snapshot publication returned incomplete or conflicting metadata.");
    } catch (error) {
      // A failed response does not prove rollback, and a negative read can race
      // another publisher. Storage DELETE has no atomic manifest/commit fence.
      // Retain ciphertext until a trusted orphan/deletion lifecycle can decide.
      return this.#reconcilePublication(publication, error);
    }
  }

  async pullOutbox(
    projectId: string,
    page: { after?: MobileOutboxCursor | null; limit?: number } = {}
  ): Promise<PulledMobileOutboxItem[]> {
    const { parseOutboxEnvelope } = await import("@openauthor/contracts");
    const limit = page.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("Hosted outbox page limit must be between 1 and 500.");
    }
    const rows = await this.#rpc<unknown>("mobile_list_outbox", {
      p_requesting_device_id: this.#deviceId,
      p_project_id: required(projectId, "Project id"),
      p_after_received_at: page.after == null
        ? null
        : required(page.after.receivedAt, "Outbox page timestamp cursor"),
      p_after_operation_id: page.after == null
        ? null
        : required(page.after.operationId, "Outbox page operation cursor"),
      p_limit: limit,
    });
    if (!Array.isArray(rows)) {
      throw new Error("Supabase outbox response must be a list.");
    }
    const items: PulledMobileOutboxItem[] = [];
    for (const value of rows) {
      const row = record(value);
      if (row.algorithm !== "aes-256-gcm-v1") {
        throw new Error("Hosted outbox encryption algorithm is unsupported.");
      }
      const kind = stringField(row, "operation_type") as MobileOutboxKind;
      if (!MOBILE_OUTBOX_KINDS.includes(kind)) {
        throw new Error("Hosted outbox operation kind is unsupported.");
      }
      const receivedAt = stringField(row, "received_at");
      const envelope: HostedMobileOutboxIdentity = {
        projectId: stringField(row, "project_id"),
        deviceId: stringField(row, "source_device_id"),
        operationId: stringField(row, "operation_id"),
        baseRevision: stringField(row, "base_project_revision"),
        kind,
        keyVersion: positiveInteger(row.key_version, "Hosted outbox key version"),
      };
      try {
        const nonce = decodeBytea(row.nonce, "Hosted outbox nonce");
        if (nonce.byteLength !== 12) {
          throw new Error("Hosted outbox nonce has an invalid size.");
        }
        const storedCiphertext = decodeBytea(row.ciphertext, "Hosted outbox ciphertext");
        const expectedDigest = stringField(row, "ciphertext_sha256");
        if (await sha256Hex(storedCiphertext) !== expectedDigest) {
          throw new Error("Hosted outbox ciphertext digest mismatch.");
        }
        const combinedBase64 = new TextDecoder("utf-8", { fatal: true })
          .decode(storedCiphertext);
        const combined = base64ToBytes(combinedBase64);
        if (combined.byteLength < 29) {
          throw new Error("Hosted outbox ciphertext is too short.");
        }
        if (!nonce.every((byte, index) => combined[index] === byte)) {
          throw new Error("Hosted outbox nonce does not match combined ciphertext.");
        }
        const contractEnvelope = parseOutboxEnvelope({
          schema: "openauthor.mobile.outbox-envelope",
          schema_version: 1,
          project_id: envelope.projectId,
          device_id: envelope.deviceId,
          operation_id: envelope.operationId,
          base_revision: envelope.baseRevision,
          kind,
          created_at: stringField(row, "client_created_at"),
          payload: {
            algorithm: "aes-256-gcm-v1",
            project_key_version: envelope.keyVersion,
            nonce: bytesToBase64(nonce),
            aad_version: 1,
            ciphertext: combinedBase64,
            ciphertext_sha256: expectedDigest,
            ciphertext_byte_length: storedCiphertext.byteLength,
          },
        });
        items.push({
          schema_version: 1,
          receivedAt,
          envelope: {
            projectId: contractEnvelope.project_id,
            deviceId: contractEnvelope.device_id,
            operationId: contractEnvelope.operation_id,
            baseRevision: contractEnvelope.base_revision,
            kind: contractEnvelope.kind,
            keyVersion: contractEnvelope.payload.project_key_version,
          },
          encryption: {
            algorithm: "AES-256-GCM",
            iv_base64: bytesToBase64(nonce),
            associated_data_version: 1,
          },
          ciphertext_base64: bytesToBase64(combined.slice(12)),
        });
      } catch {
        items.push({
          schema_version: 1,
          envelope,
          receivedAt,
          transport_error: "malformed_hosted_ciphertext",
        });
      }
    }
    return items;
  }

  async acknowledgeOutbox(
    identity: HostedMobileOutboxIdentity,
    status: "imported" | "conflict" | "rejected"
  ): Promise<void> {
    await this.#rpc("mobile_ack_outbox", {
      p_requesting_device_id: this.#deviceId,
      p_operation_id: required(identity.operationId, "Outbox operation id"),
      p_status: status,
    });
  }
}
