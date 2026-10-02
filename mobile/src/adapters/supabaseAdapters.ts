import {
  MOBILE_SNAPSHOT_OBJECT_MAX_BYTES,
  parseEncryptedSnapshotBlobMetadata,
  parseOutboxEnvelope,
  parseProjectKeyVerifier,
  type ProjectKeyVerifier,
} from "@openauthor/contracts";

import type { DeviceEnrollmentTransport } from "../core/deviceEnrollment";
import type { OutboxEnvelope, OutboxTransport } from "../core/outbox";
import type { HostedSnapshotManifest, SnapshotSyncTransport } from "../core/snapshotSync";

type Result<T> = {
  data: T | null;
  error: { message?: string } | null;
};

type SessionShape = {
  access_token: string;
  user: { id: string; email?: string };
};

export interface MobileSupabaseClient {
  auth: {
    getSession(): Promise<Result<{ session: SessionShape | null }>>;
    getClaims(jwt?: string): Promise<Result<{ claims: Record<string, unknown> }>>;
    signInWithPassword(input: { email: string; password: string }): Promise<Result<{
      session: SessionShape | null;
    }>>;
    refreshSession(): Promise<Result<{ session: SessionShape | null }>>;
    signOut(options?: { scope: "local" }): Promise<{ error: { message?: string } | null }>;
    onAuthStateChange?(listener: (event: string, session: SessionShape | null) => void): { data: { subscription: { unsubscribe(): void } } };
  };
  from(table: string): {
    select(columns: string): {
      order(column: string, options: { ascending: boolean }): Promise<Result<unknown[]>>;
    };
  };
  rpc(name: string, params: Record<string, unknown>): Promise<Result<unknown>>;
  storage: {
    from(bucket: string): {
      download(path: string): Promise<Result<Blob>>;
    };
  };
}

export type MobileProjectSummary = {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  kind: "book";
  status: "active" | "archived";
  updatedAt: string;
};

export type EncryptedHostedManifest = {
  snapshotId: string;
  projectId: string;
  revision: string;
  keyVersion: number;
  schemaVersion: number;
  objectBucket: "mobile-encrypted-sync";
  objectPath: string;
  objectByteLength: number;
  objectSha256: string;
  algorithm: "aes-256-gcm-v1";
  nonceBase64: string;
  ciphertextBase64: string;
  ciphertextSha256: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} returned an invalid record.`);
  }
  return value as Record<string, unknown>;
}

function records(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`${label} returned an invalid collection.`);
  return value.map((item) => record(item, label));
}

function requiredString(value: unknown, label: string, maxLength = 512): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function requiredUuid(value: unknown, label: string): string {
  const uuid = requiredString(value, label, 36);
  if (!UUID_PATTERN.test(uuid)) throw new Error(`${label} is invalid.`);
  return uuid.toLowerCase();
}

function requiredSha256(value: unknown, label: string): string {
  const digest = requiredString(value, label, 64).toLowerCase();
  if (!SHA256_PATTERN.test(digest)) throw new Error(`${label} is invalid.`);
  return digest;
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${label} is invalid.`);
  }
  return parsed;
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  if (
    normalized.length % 4 === 1
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
    || normalized.includes("=") && !/=+$/.test(normalized)
  ) {
    throw new Error("Encrypted binary data is not valid base64.");
  }
  const unpadded = normalized.replace(/=+$/, "");
  const bytes: number[] = [];
  let accumulator = 0;
  let bitCount = 0;
  for (const character of unpadded) {
    const valueAt = BASE64_ALPHABET.indexOf(character);
    if (valueAt < 0) throw new Error("Encrypted binary data is not valid base64.");
    accumulator = (accumulator << 6) | valueAt;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((accumulator >> bitCount) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

function encodeBase64(bytes: Uint8Array): string {
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const combined = (first << 16) | (second << 8) | third;
    encoded += BASE64_ALPHABET[(combined >> 18) & 63];
    encoded += BASE64_ALPHABET[(combined >> 12) & 63];
    encoded += index + 1 < bytes.length ? BASE64_ALPHABET[(combined >> 6) & 63] : "=";
    encoded += index + 2 < bytes.length ? BASE64_ALPHABET[combined & 63] : "=";
  }
  return encoded;
}

function byteaToBytes(value: unknown, label: string): Uint8Array {
  const encoded = requiredString(value, label, 16 * 1024 * 1024 + 2);
  if (!encoded.startsWith("\\x") || encoded.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(encoded.slice(2))) {
    throw new Error(`${label} is invalid.`);
  }
  const hex = encoded.slice(2);
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesToBytea(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `\\x${hex}`;
}

function base64ToBytea(value: string, expectedLength?: number): string {
  const bytes = decodeBase64(value);
  if (expectedLength !== undefined && bytes.length !== expectedLength) {
    throw new Error("Encrypted binary data has an invalid length.");
  }
  return bytesToBytea(bytes);
}

function utf8ToBytea(value: string): string {
  return bytesToBytea(new TextEncoder().encode(value));
}

async function rpc(
  client: MobileSupabaseClient,
  name: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const result = await client.rpc(name, params);
  if (result.error) throw new Error(`Supabase RPC ${name} failed.`);
  return result.data;
}

async function verifiedSession(
  client: MobileSupabaseClient,
  expectedDeviceId?: string,
): Promise<{ accessToken: string; userId: string; email: string; sessionId: string | null; expiresAt: number | null }> {
  const sessionResult = await client.auth.getSession();
  const session = sessionResult.data?.session;
  if (sessionResult.error || !session?.access_token) {
    throw new Error("A verified Supabase session is required.");
  }
  return await verifySessionClaims(client, session, expectedDeviceId);
}

async function verifySessionClaims(
  client: MobileSupabaseClient,
  session: SessionShape,
  expectedDeviceId?: string,
): Promise<{ accessToken: string; userId: string; email: string; sessionId: string | null; expiresAt: number | null }> {
  const claimsResult = await client.auth.getClaims(session.access_token);
  const claims = claimsResult.data?.claims;
  if (claimsResult.error || !claims) throw new Error("Supabase JWT verification failed.");
  const subject = requiredUuid(claims.sub, "Supabase JWT subject");
  if (subject !== requiredUuid(session.user.id, "Supabase session user") || claims.role !== "authenticated") {
    throw new Error("Supabase JWT identity is invalid.");
  }
  if (expectedDeviceId !== undefined) {
    const expected = requiredUuid(expectedDeviceId, "Expected device identity");
    if (claims.device_id !== expected) {
      throw new Error("A matching device-bound Supabase session is required.");
    }
  }
  return {
    accessToken: session.access_token,
    userId: subject,
    email: typeof claims.email === "string" ? claims.email : session.user.email ?? "",
    sessionId: typeof claims.session_id === "string" && UUID_PATTERN.test(claims.session_id) ? claims.session_id.toLowerCase() : null,
    expiresAt: typeof claims.exp === "number" && Number.isFinite(claims.exp) ? claims.exp : null,
  };
}

export class SupabaseAuth {
  constructor(private readonly client: MobileSupabaseClient) {}

  async signInWithPassword(email: string, password: string): Promise<{
    userId: string;
    email: string;
  }> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) throw new Error("Email and password are required.");
    const result = await this.client.auth.signInWithPassword({ email: normalizedEmail, password });
    if (result.error || !result.data?.session) throw new Error("Supabase sign-in failed.");
    const verified = await verifiedSession(this.client);
    return { userId: verified.userId, email: verified.email };
  }

  async accessToken(expectedDeviceId?: string): Promise<string> {
    return (await verifiedSession(this.client, expectedDeviceId)).accessToken;
  }

  async recoveryIdentity(expectedDeviceId: string): Promise<{ userId: string; sessionId: string }> {
    const identity = await verifiedSession(this.client, expectedDeviceId);
    if (!identity.sessionId || identity.expiresAt === null || identity.expiresAt <= Date.now() / 1000) {
      throw new Error("A current verified sign-in session identity is required for book key recovery.");
    }
    return { userId: identity.userId, sessionId: identity.sessionId };
  }

  observeRecoveryIdentity(expected: { userId: string; deviceId: string; sessionId: string }, changed: () => void): () => void {
    const subscription = this.client.auth.onAuthStateChange?.((_event, session) => {
      // These event claims only revoke pending local work. They never authorize
      // an import; recoveryIdentity still verifies the signed current claims.
      try {
        if (!session) { changed(); return; }
        const encoded = session.access_token.split(".")[1];
        if (!encoded || encoded.length > 16384) { changed(); return; }
        const claims = JSON.parse(new TextDecoder().decode(decodeBase64(encoded))) as Record<string, unknown>;
        if (session.user.id !== expected.userId || claims.sub !== expected.userId
          || claims.device_id !== expected.deviceId || claims.session_id !== expected.sessionId) changed();
      } catch { changed(); }
    }).data.subscription;
    return () => subscription?.unsubscribe();
  }

  async refreshAfterEnrollment(expectedDeviceId: string): Promise<string> {
    const result = await this.client.auth.refreshSession();
    if (result.error || !result.data?.session) {
      throw new Error("Supabase session refresh after device enrollment failed.");
    }
    return (await verifySessionClaims(this.client, result.data.session, expectedDeviceId)).accessToken;
  }

  async signOut(): Promise<void> {
    const result = await this.client.auth.signOut({ scope: "local" });
    if (result.error) throw new Error("Supabase sign-out failed.");
  }
}

export class SupabaseProjectKeyVerifier {
  constructor(private readonly client: MobileSupabaseClient, private readonly deviceId: string) {}

  async get(projectId: string, keyVersion: number): Promise<ProjectKeyVerifier | null> {
    const deviceId = requiredUuid(this.deviceId, "Device identity");
    const normalizedProjectId = requiredUuid(projectId, "Project identity");
    const expectedKeyVersion = positiveInteger(keyVersion, "Project key version");
    if (expectedKeyVersion > 2147483647) throw new Error("Project key version is invalid.");
    await verifiedSession(this.client, deviceId);
    const value = await rpc(this.client, "mobile_get_project_key_verifier", {
      p_requesting_device_id: deviceId,
      p_project_id: normalizedProjectId,
      p_expected_key_version: expectedKeyVersion,
    });
    if (value === null) return null;
    const verifier = parseProjectKeyVerifier(value);
    if (verifier.project_id !== normalizedProjectId || verifier.key_version !== expectedKeyVersion) {
      throw new Error("The key verifier does not match the selected book and version.");
    }
    return verifier;
  }
}

export class SupabaseProjects {
  constructor(
    private readonly client: MobileSupabaseClient,
    private readonly deviceId: string,
  ) {}

  async list(): Promise<MobileProjectSummary[]> {
    await verifiedSession(this.client, this.deviceId);
    const result = await this.client.from("projects")
      .select("id,workspace_id,name,slug,kind,status,updated_at")
      .order("updated_at", { ascending: false });
    if (result.error) throw new Error("Supabase project listing failed.");
    return records(result.data ?? [], "Project listing").map((row) => {
      const kind = requiredString(row.kind, "Project kind", 32);
      const status = requiredString(row.status, "Project status", 32);
      if (kind !== "book" || (status !== "active" && status !== "archived")) {
        throw new Error("Project listing contains an unsupported project.");
      }
      return {
        id: requiredUuid(row.id, "Project identity"),
        workspaceId: requiredUuid(row.workspace_id, "Workspace identity"),
        name: requiredString(row.name, "Project name", 240),
        slug: requiredString(row.slug, "Project slug", 240),
        kind,
        status,
        updatedAt: requiredString(row.updated_at, "Project update time", 64),
      };
    });
  }
}

export class SupabaseDeviceEnrollmentTransport implements DeviceEnrollmentTransport {
  constructor(private readonly client: MobileSupabaseClient) {}

  async register(input: {
    deviceId: string;
    keyId: string;
    name: string;
    platform: "ios" | "android" | "web";
    publicKey: string;
  }): Promise<{ deviceId: string; keyId: string; enrolledAt: string }> {
    await verifiedSession(this.client);
    const deviceId = requiredUuid(input.deviceId, "Persisted device identity");
    const keyId = requiredUuid(input.keyId, "Persisted device key identity");
    const data = await rpc(this.client, "mobile_register_device", {
      p_device_id: deviceId,
      p_key_id: keyId,
      p_platform: input.platform,
      p_device_label: requiredString(input.name.trim(), "Device label", 80),
      p_key_algorithm: "x25519-v1",
      p_public_key: base64ToBytea(input.publicKey, 32),
    });
    const row = record(Array.isArray(data) ? data[0] : data, "Device registration");
    if (requiredUuid(row.id, "Registered device identity") !== deviceId) {
      throw new Error("Device registration identity mismatch.");
    }
    return {
      deviceId,
      keyId,
      enrolledAt: requiredString(row.enrolled_at, "Device enrollment time", 64),
    };
  }

  async rebind(input: {
    deviceId: string;
    keyId: string;
    name: string;
    platform: "ios" | "android" | "web";
    publicKey: string;
  }): Promise<{ deviceId: string; enrolledAt: string }> {
    const registered = await this.register(input);
    return { deviceId: registered.deviceId, enrolledAt: registered.enrolledAt };
  }

  async projectKeyEnvelope(input: {
    projectId: string;
    deviceId: string;
    keyVersion: number;
  }): Promise<{ keyVersion: number; envelope: string }> {
    await verifiedSession(this.client, input.deviceId);
    const data = await rpc(this.client, "mobile_get_project_key_envelopes", {
      p_requesting_device_id: requiredUuid(input.deviceId, "Device identity"),
      p_project_id: requiredUuid(input.projectId, "Project identity"),
    });
    const match = records(data ?? [], "Project key envelopes").find((row) => (
      row.key_version === input.keyVersion
      || Number(row.key_version) === input.keyVersion
    ));
    if (!match || requiredUuid(match.recipient_device_id, "Envelope recipient") !== input.deviceId) {
      throw new Error("No project key envelope is available for this device.");
    }
    if (match.algorithm !== "x25519-xsalsa20-poly1305-sealedbox-v1") {
      throw new Error("Project key envelope uses an unsupported algorithm.");
    }
    requiredSha256(match.sealed_project_key_sha256, "Project key envelope digest");
    const sealedProjectKey = byteaToBytes(
      match.sealed_project_key,
      "Sealed project key envelope",
    );
    // crypto_box_seal adds exactly 48 bytes to the 32-byte AES project key.
    if (sealedProjectKey.length !== 80) {
      throw new Error("Project key envelope has an invalid size.");
    }
    return {
      keyVersion: input.keyVersion,
      envelope: encodeBase64(sealedProjectKey)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, ""),
    };
  }

  async enrollProject(projectId: string, deviceId: string): Promise<void> {
    const normalizedDeviceId = requiredUuid(deviceId, "Device identity");
    await verifiedSession(this.client, normalizedDeviceId);
    await rpc(this.client, "mobile_enroll_project_device", {
      p_requesting_device_id: normalizedDeviceId,
      p_project_id: requiredUuid(projectId, "Project identity"),
      p_target_device_id: normalizedDeviceId,
    });
  }

  async revoke(deviceId: string): Promise<void> {
    const normalized = requiredUuid(deviceId, "Device identity");
    await verifiedSession(this.client, normalized);
    await rpc(this.client, "mobile_revoke_device", {
      p_requesting_device_id: normalized,
      p_target_device_id: normalized,
      p_reason_code: "user-requested",
    });
  }
}

export class SupabaseSnapshotSyncTransport implements SnapshotSyncTransport {
  readonly #allowedObjects = new Map<string, number>();
  readonly #deviceId: string;
  readonly #maxObjectBytes: number;
  readonly #decodeManifest: (input: EncryptedHostedManifest) => Promise<{
    plaintextDigest: string;
  }>;

  constructor(
    private readonly client: MobileSupabaseClient,
    input: {
      deviceId: string;
      decodeManifest(input: EncryptedHostedManifest): Promise<{ plaintextDigest: string }>;
      maxObjectBytes?: number;
    },
  ) {
    this.#deviceId = requiredUuid(input.deviceId, "Device identity");
    this.#decodeManifest = input.decodeManifest;
    this.#maxObjectBytes = input.maxObjectBytes ?? MOBILE_SNAPSHOT_OBJECT_MAX_BYTES;
    if (!Number.isSafeInteger(this.#maxObjectBytes) || this.#maxObjectBytes < 1) {
      throw new Error("Snapshot object size limit is invalid.");
    }
  }

  async latestManifest(projectId: string, deviceId: string): Promise<HostedSnapshotManifest | null> {
    if (requiredUuid(deviceId, "Device identity") !== this.#deviceId) {
      throw new Error("Snapshot transport device identity mismatch.");
    }
    await verifiedSession(this.client, this.#deviceId);
    const normalizedProjectId = requiredUuid(projectId, "Project identity");
    const data = await rpc(this.client, "mobile_list_snapshot_manifests", {
      p_requesting_device_id: this.#deviceId,
      p_project_id: normalizedProjectId,
      p_limit: 1,
    });
    const rows = records(data ?? [], "Snapshot manifests");
    if (rows.length === 0) return null;
    const row = rows[0]!;
    const snapshotId = requiredUuid(row.snapshot_id, "Snapshot identity");
    if (requiredUuid(row.project_id, "Snapshot project identity") !== normalizedProjectId) {
      throw new Error("Hosted snapshot project identity mismatch.");
    }
    if (row.object_bucket !== "mobile-encrypted-sync" || row.manifest_algorithm !== "aes-256-gcm-v1") {
      throw new Error("Hosted snapshot encryption metadata is unsupported.");
    }
    const objectPath = requiredString(row.object_path, "Snapshot object path", 512);
    const expectedPath = `projects/${normalizedProjectId}/snapshots/${snapshotId}.bin`;
    if (objectPath !== expectedPath) throw new Error("Hosted snapshot object path is invalid.");
    const blob = parseEncryptedSnapshotBlobMetadata({
      schema: "openauthor.mobile.snapshot.blob",
      schema_version: 1,
      snapshot_id: snapshotId,
      project_id: normalizedProjectId,
      project_revision: row.project_revision,
      object_bucket: row.object_bucket,
      object_key: row.object_path,
      content_type: "text/plain;charset=utf-8",
      encryption: {
        algorithm: row.manifest_algorithm,
        project_key_version: row.key_version,
        aad_version: 1,
      },
      ciphertext_sha256: row.object_sha256,
      ciphertext_byte_length: row.object_byte_length,
    });
    const encrypted: EncryptedHostedManifest = {
      snapshotId,
      projectId: normalizedProjectId,
      revision: blob.project_revision,
      keyVersion: blob.encryption.project_key_version,
      schemaVersion: positiveInteger(row.schema_version, "Snapshot schema version"),
      objectBucket: "mobile-encrypted-sync",
      objectPath: blob.object_key,
      objectByteLength: blob.ciphertext_byte_length,
      objectSha256: blob.ciphertext_sha256,
      algorithm: "aes-256-gcm-v1",
      nonceBase64: encodeBase64(byteaToBytes(row.manifest_nonce, "Snapshot manifest nonce")),
      ciphertextBase64: encodeBase64(byteaToBytes(
        row.manifest_ciphertext,
        "Snapshot manifest ciphertext",
      )),
      ciphertextSha256: requiredSha256(
        row.manifest_ciphertext_sha256,
        "Snapshot manifest ciphertext digest",
      ),
    };
    if (encrypted.objectByteLength > this.#maxObjectBytes) {
      throw new Error("Encrypted snapshot exceeds this device's size limit.");
    }
    if (decodeBase64(encrypted.nonceBase64).length !== 12) {
      throw new Error("Snapshot manifest nonce has an invalid size.");
    }
    const decoded = await this.#decodeManifest(encrypted);
    const plaintextDigest = requiredSha256(decoded.plaintextDigest, "Snapshot plaintext digest");
    this.#allowedObjects.set(objectPath, encrypted.objectByteLength);
    return {
      snapshotId,
      projectId: normalizedProjectId,
      revision: encrypted.revision,
      objectPath,
      keyVersion: encrypted.keyVersion,
      ciphertextDigest: encrypted.objectSha256,
      plaintextDigest,
      byteLength: encrypted.objectByteLength,
      createdAt: requiredString(row.created_at, "Snapshot creation time", 64),
    };
  }

  async download(objectPath: string): Promise<string> {
    await verifiedSession(this.client, this.#deviceId);
    const expectedSize = this.#allowedObjects.get(objectPath);
    if (expectedSize === undefined) throw new Error("Snapshot object was not authorized by a manifest.");
    const result = await this.client.storage.from("mobile-encrypted-sync").download(objectPath);
    if (result.error || !result.data) throw new Error("Encrypted snapshot download failed.");
    if (result.data.size !== expectedSize || result.data.size > this.#maxObjectBytes) {
      throw new Error("Encrypted snapshot object size mismatch.");
    }
    const ciphertext = await result.data.text();
    if (new TextEncoder().encode(ciphertext).byteLength !== expectedSize) {
      throw new Error("Encrypted snapshot object size mismatch.");
    }
    return ciphertext;
  }

  async acknowledge(snapshotId: string, deviceId: string): Promise<void> {
    if (requiredUuid(deviceId, "Device identity") !== this.#deviceId) {
      throw new Error("Snapshot acknowledgement device identity mismatch.");
    }
    await verifiedSession(this.client, this.#deviceId);
    await rpc(this.client, "mobile_ack_snapshot", {
      p_requesting_device_id: this.#deviceId,
      p_snapshot_id: requiredUuid(snapshotId, "Snapshot identity"),
      p_acknowledgement: "verified",
    });
  }
}

export class SupabaseOutboxTransport implements OutboxTransport {
  readonly #deviceId: string;

  constructor(
    private readonly client: MobileSupabaseClient,
    deviceId: string,
  ) {
    this.#deviceId = requiredUuid(deviceId, "Device identity");
  }

  async upload(envelope: OutboxEnvelope): Promise<{ acknowledgedAt: string }> {
    if (envelope.schemaVersion !== 1 || requiredUuid(envelope.deviceId, "Device identity") !== this.#deviceId) {
      throw new Error("Outbox envelope device or schema mismatch.");
    }
    const combined = decodeBase64(envelope.ciphertext);
    const hostedEnvelope = parseOutboxEnvelope({
      schema: "openauthor.mobile.outbox-envelope",
      schema_version: 1,
      project_id: requiredUuid(envelope.projectId, "Project identity"),
      device_id: requiredUuid(envelope.deviceId, "Device identity"),
      operation_id: requiredUuid(envelope.operationId, "Outbox operation identity"),
      base_revision: requiredString(envelope.baseRevision, "Outbox base revision", 128),
      kind: envelope.kind,
      created_at: requiredString(envelope.createdAt, "Outbox creation time", 64),
      payload: {
        algorithm: "aes-256-gcm-v1",
        project_key_version: positiveInteger(envelope.keyVersion, "Outbox key version"),
        nonce: encodeBase64(combined.slice(0, 12)),
        aad_version: 1,
        ciphertext: envelope.ciphertext,
        ciphertext_sha256: envelope.ciphertextDigest,
        ciphertext_byte_length: new TextEncoder().encode(envelope.ciphertext).byteLength,
      },
    });
    await verifiedSession(this.client, this.#deviceId);
    const result = await rpc(this.client, "mobile_append_outbox", {
      p_requesting_device_id: this.#deviceId,
      p_operation_id: hostedEnvelope.operation_id,
      p_project_id: hostedEnvelope.project_id,
      p_key_version: hostedEnvelope.payload.project_key_version,
      p_base_project_revision: hostedEnvelope.base_revision,
      p_operation_type: hostedEnvelope.kind,
      p_client_created_at: hostedEnvelope.created_at,
      p_algorithm: hostedEnvelope.payload.algorithm,
      p_nonce: bytesToBytea(combined.slice(0, 12)),
      // Store the canonical base64 representation as bytea. It remains opaque
      // ciphertext while matching ExpoOutboxCipher's SHA-256 string digest.
      p_ciphertext: utf8ToBytea(hostedEnvelope.payload.ciphertext),
      p_ciphertext_sha256: hostedEnvelope.payload.ciphertext_sha256,
    });
    const row = record(Array.isArray(result) ? result[0] : result, "Outbox upload");
    return {
      acknowledgedAt: requiredString(row.received_at, "Outbox receipt time", 64),
    };
  }
}
