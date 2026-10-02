import { parseEncryptedSnapshotBlobMetadata, parseMobileSnapshotManifest, MOBILE_SNAPSHOT_OBJECT_MAX_BYTES } from "@openauthor/contracts";

export type RecoverySnapshot = {
  snapshotId: string;
  projectId: string;
  revision: string;
  keyVersion: number;
  objectPath: string;
  byteLength: number;
  ciphertextSha256: string;
  manifestNonce: Uint8Array;
  manifestCiphertext: Uint8Array;
  manifestSha256: string;
};

export type ProjectKeyRecoveryTransport = {
  getRecoverySnapshot(projectId: string, expectedKeyVersion: number): Promise<RecoverySnapshot | null>;
  downloadRecoverySnapshot(snapshot: RecoverySnapshot): Promise<string>;
  recoverProjectKeyEnvelope(input: { projectId: string; expectedKeyVersion: number; expectedDeviceKeyId: string; envelopeId: string; sealedProjectKey: string }): Promise<void>;
};

export function validateRecoverySnapshot(snapshot: RecoverySnapshot, projectId: string, keyVersion: number): void {
  if (snapshot.projectId !== projectId || snapshot.keyVersion !== keyVersion) throw new Error("The recovery snapshot belongs to another book or key version.");
  parseEncryptedSnapshotBlobMetadata({
    schema: "openauthor.mobile.snapshot.blob", schema_version: 1,
    snapshot_id: snapshot.snapshotId, project_id: snapshot.projectId, project_revision: snapshot.revision,
    object_bucket: "mobile-encrypted-sync", object_key: snapshot.objectPath, content_type: "text/plain;charset=utf-8",
    encryption: { algorithm: "aes-256-gcm-v1", project_key_version: snapshot.keyVersion, aad_version: 1 },
    ciphertext_sha256: snapshot.ciphertextSha256, ciphertext_byte_length: snapshot.byteLength,
  });
  if (snapshot.byteLength > MOBILE_SNAPSHOT_OBJECT_MAX_BYTES || snapshot.manifestNonce.byteLength !== 12
    || snapshot.manifestCiphertext.byteLength < 17 || snapshot.manifestCiphertext.byteLength > 4096
    || !/^[0-9a-f]{64}$/.test(snapshot.manifestSha256)) throw new Error("The recovery snapshot metadata is invalid or exceeds its size limit.");
}

function buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
export async function recoveryDigest(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer(bytes))), byte => byte.toString(16).padStart(2, "0")).join("");
}
function json(bytes: ArrayBuffer): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("The decrypted recovery snapshot is invalid."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The decrypted recovery snapshot is invalid.");
  return value as Record<string, unknown>;
}
function canonicalBase64(value: string): Uint8Array {
  const binary = atob(value);
  if (btoa(binary) !== value) throw new Error("The recovery snapshot ciphertext is not canonical base64.");
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

// Both ciphertexts are authenticated with the existing mobile reader's AAD.
// The server supplies a locator, never a claim that an OA1 key is correct.
export async function verifyRecoverySnapshot(projectKey: CryptoKey, snapshot: RecoverySnapshot, ciphertext: string): Promise<void> {
  validateRecoverySnapshot(snapshot, snapshot.projectId, snapshot.keyVersion);
  const objectBytes = new TextEncoder().encode(ciphertext);
  if (objectBytes.byteLength !== snapshot.byteLength || await recoveryDigest(objectBytes) !== snapshot.ciphertextSha256
    || await recoveryDigest(snapshot.manifestCiphertext) !== snapshot.manifestSha256) throw new Error("The recovery snapshot failed its ciphertext integrity check.");
  const identity = ["openauthor.mobile.snapshot.manifest.v1", snapshot.snapshotId, snapshot.projectId, snapshot.revision, String(snapshot.keyVersion)].join("\0");
  let manifest: Record<string, unknown>;
  let plaintext: ArrayBuffer;
  try {
    manifest = json(await crypto.subtle.decrypt({ name: "AES-GCM", iv: buffer(snapshot.manifestNonce), additionalData: new TextEncoder().encode(identity) }, projectKey, buffer(snapshot.manifestCiphertext)));
    if (manifest.schema_version !== 1 || manifest.snapshot_id !== snapshot.snapshotId || manifest.project_id !== snapshot.projectId
      || manifest.project_revision !== snapshot.revision || manifest.key_version !== snapshot.keyVersion
      || typeof manifest.plaintext_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(manifest.plaintext_sha256)) throw new Error("Manifest identity mismatch.");
    const combined = canonicalBase64(ciphertext);
    if (combined.byteLength < 29) throw new Error("Encrypted snapshot is incomplete.");
    plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buffer(combined.slice(0, 12)),
      additionalData: new TextEncoder().encode(`openauthor.snapshot.v1|${snapshot.projectId}|${snapshot.revision}|${snapshot.keyVersion}`) }, projectKey, buffer(combined.slice(12)));
  } catch {
    throw new Error("The recovery key could not authenticate this book's published snapshot and manifest. Check the book, key version and recovery key.");
  }
  try {
    if (await recoveryDigest(new Uint8Array(plaintext)) !== manifest.plaintext_sha256) throw new Error("The recovery snapshot plaintext digest does not match its authenticated manifest.");
    const envelope = json(plaintext);
    const innerManifest = parseMobileSnapshotManifest(envelope.manifest);
    const payload = envelope.snapshot as Record<string, unknown> | undefined;
    if (innerManifest.project_id !== snapshot.projectId || innerManifest.revision !== snapshot.revision
      || !payload || typeof payload !== "object" || Array.isArray(payload)
      || payload.schema !== "openauthor.mobile.snapshot" || payload.schema_version !== 1
      || payload.project_id !== snapshot.projectId || payload.revision !== snapshot.revision
      || !Array.isArray(payload.scenes) || !Array.isArray(payload.evidence)
      || !payload.codex || typeof payload.codex !== "object" || Array.isArray(payload.codex)
      || !Array.isArray((payload.codex as Record<string, unknown>).entities)
      || !Array.isArray((payload.codex as Record<string, unknown>).relationships)) {
      throw new Error("The authenticated recovery snapshot contains another book or an invalid plaintext envelope.");
    }
  } finally {
    // Proof is transient; never cache decrypted prose during key recovery.
    new Uint8Array(plaintext).fill(0);
  }
}
