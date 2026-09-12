import { AESEncryptionKey, AESSealedData, aesDecryptAsync } from "expo-crypto";

import type { EncryptedHostedManifest } from "./supabaseAdapters";

function standardBase64(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
}

function additionalData(input: EncryptedHostedManifest): Uint8Array {
  return new TextEncoder().encode([
    "openauthor.mobile.snapshot.manifest.v1",
    input.snapshotId,
    input.projectId,
    input.revision,
    String(input.keyVersion),
  ].join("\0"));
}

export async function decryptHostedSnapshotManifest(
  input: EncryptedHostedManifest,
  projectKey: string,
): Promise<{ plaintextDigest: string }> {
  const key = await AESEncryptionKey.import(standardBase64(projectKey), "base64");
  const plaintext = await aesDecryptAsync(
    AESSealedData.fromParts(input.nonceBase64, input.ciphertextBase64),
    key,
    { additionalData: additionalData(input) },
  );
  if (typeof plaintext === "string") throw new Error("Encrypted snapshot manifest encoding is invalid.");
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error("Encrypted snapshot manifest is invalid JSON.");
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new Error("Encrypted snapshot manifest is invalid.");
  }
  const manifest = decoded as Record<string, unknown>;
  if (
    manifest.schema_version !== 1
    || manifest.snapshot_id !== input.snapshotId
    || manifest.project_id !== input.projectId
    || manifest.project_revision !== input.revision
    || manifest.key_version !== input.keyVersion
    || typeof manifest.plaintext_sha256 !== "string"
    || !/^[0-9a-f]{64}$/.test(manifest.plaintext_sha256)
  ) {
    throw new Error("Encrypted snapshot manifest identity is invalid.");
  }
  return { plaintextDigest: manifest.plaintext_sha256 };
}
