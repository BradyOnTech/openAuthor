import { createMobileSyncService, type EncryptedMobileSnapshot } from "./mobileSync";
import { importMobileRecoveryKey } from "./projectKeyProvisioning";
import type { RecoverySnapshot } from "./snapshotRecovery";

export const recoveryFixtureKey = "OA1-AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8.EFAAEC69";
export const recoveryFixtureProject = "10000000-0000-4000-8000-000000000001";
export const recoveryFixtureDevice = "40000000-0000-4000-8000-000000000001";
export const recoveryFixtureDeviceKey = "60000000-0000-4000-8000-000000000001";

export async function recoverySnapshotFixture(input: { key?: CryptoKey; projectId?: string; version?: number; plaintextProjectId?: string } = {}): Promise<EncryptedMobileSnapshot> {
  const key = input.key ?? await importMobileRecoveryKey(recoveryFixtureKey);
  const projectId = input.projectId ?? recoveryFixtureProject;
  const snapshot = { schema: "openauthor.mobile.snapshot", schema_version: 1, project_id: input.plaintextProjectId ?? projectId,
    revision: "revision-one", scenes: [], codex: { entities: [], relationships: [] }, evidence: [] };
  const payload = new TextEncoder().encode(JSON.stringify(snapshot));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", payload));
  const manifest = { schema: "openauthor.mobile.snapshot.manifest" as const, schema_version: 1 as const,
    project_id: projectId, revision: "revision-one", content_sha256: Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join(""), byte_length: payload.length };
  const plaintext = new TextEncoder().encode(JSON.stringify({ manifest, snapshot }));
  let binary = "";
  for (const byte of plaintext) binary += String.fromCharCode(byte);
  return createMobileSyncService({
    sidecar: { prepareSnapshot: async () => ({ schema_version: 1, media_type: "application/vnd.openauthor.mobile-snapshot+json", manifest, plaintext_base64: btoa(binary) }), importOutboxItem: async () => { throw new Error("Not used by recovery fixture."); } },
    transport: { publishSnapshot: async () => undefined, pullOutbox: async () => [] },
  }).publishSnapshot({ projectRoot: "/synthetic-book", projectId, projectKey: key, keyVersion: input.version ?? 3 });
}

export function recoveryManifestRow(snapshot: EncryptedMobileSnapshot) {
  const bytea = (base64: string) => "\\x" + Array.from(atob(base64), character => character.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  return { snapshot_id: snapshot.snapshot_id, project_id: snapshot.manifest.project_id,
    project_revision: snapshot.manifest.revision, key_version: snapshot.key_version, schema_version: 1,
    object_bucket: snapshot.object.bucket, object_path: snapshot.object.path, object_byte_length: snapshot.object.byte_length,
    object_sha256: snapshot.object.sha256, manifest_algorithm: "aes-256-gcm-v1", manifest_nonce: bytea(snapshot.hosted_manifest.nonce_base64),
    manifest_ciphertext: bytea(snapshot.hosted_manifest.ciphertext_base64), manifest_ciphertext_sha256: snapshot.hosted_manifest.ciphertext_sha256,
    created_by_device_id: recoveryFixtureDevice };
}

export function recoveryMetadata(snapshot: EncryptedMobileSnapshot): RecoverySnapshot {
  const decode = (value: string) => Uint8Array.from(atob(value), character => character.charCodeAt(0));
  return { snapshotId: snapshot.snapshot_id, projectId: snapshot.manifest.project_id, revision: snapshot.manifest.revision,
    keyVersion: snapshot.key_version, objectPath: snapshot.object.path, byteLength: snapshot.object.byte_length,
    ciphertextSha256: snapshot.object.sha256, manifestNonce: decode(snapshot.hosted_manifest.nonce_base64),
    manifestCiphertext: decode(snapshot.hosted_manifest.ciphertext_base64), manifestSha256: snapshot.hosted_manifest.ciphertext_sha256 };
}
