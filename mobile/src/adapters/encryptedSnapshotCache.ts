import {
  AESEncryptionKey,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
  CryptoDigestAlgorithm,
  digestStringAsync,
} from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";

import type { CachedSnapshot, SnapshotCache } from "../core/snapshotSync";

const CACHE_KEY_SLOT = "openauthor.mobile.snapshot-cache-key.v1";

async function cacheKey(create: boolean): Promise<AESEncryptionKey | null> {
  const existing = await SecureStore.getItemAsync(CACHE_KEY_SLOT);
  if (existing) return await AESEncryptionKey.import(existing, "base64");
  if (!create) return null;
  const generated = await AESEncryptionKey.generate(256);
  await SecureStore.setItemAsync(CACHE_KEY_SLOT, await generated.encoded("base64"), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return generated;
}

async function projectFilename(projectId: string): Promise<string> {
  const digest = await digestStringAsync(CryptoDigestAlgorithm.SHA256, projectId);
  return `${digest}.snapshot`;
}

function cacheDirectory(): Directory {
  return new Directory(Paths.document, "openauthor-snapshots");
}

async function projectFile(projectId: string): Promise<File> {
  return new File(cacheDirectory(), await projectFilename(projectId));
}

export class EncryptedFileSnapshotCache implements SnapshotCache {
  async load(projectId: string): Promise<CachedSnapshot | null> {
    const file = await projectFile(projectId);
    if (!file.exists) return null;
    const key = await cacheKey(false);
    if (!key) throw new Error("Encrypted snapshot cache key is unavailable.");
    const sealed = AESSealedData.fromCombined(await file.text());
    const plaintext = await aesDecryptAsync(sealed, key, {
      additionalData: new TextEncoder().encode(projectId),
    });
    if (typeof plaintext === "string") throw new Error("Snapshot cache encoding is invalid.");
    const decoded = JSON.parse(new TextDecoder().decode(plaintext)) as CachedSnapshot;
    if (decoded.snapshot.project_id !== projectId || decoded.manifest.projectId !== projectId) {
      throw new Error("Snapshot cache project identity mismatch.");
    }
    return decoded;
  }

  async replace(projectId: string, value: CachedSnapshot): Promise<void> {
    if (value.snapshot.project_id !== projectId || value.manifest.projectId !== projectId) {
      throw new Error("Snapshot cache project identity mismatch.");
    }
    const directory = cacheDirectory();
    if (!directory.exists) directory.create({ idempotent: true, intermediates: true });
    const key = await cacheKey(true);
    if (!key) throw new Error("Unable to create snapshot cache key.");
    const sealed = await aesEncryptAsync(
      new TextEncoder().encode(JSON.stringify(value)),
      key,
      { additionalData: new TextEncoder().encode(projectId) },
    );
    const ciphertext = await sealed.combined("base64");
    if (typeof ciphertext !== "string") throw new Error("Snapshot cache encryption failed.");
    const target = await projectFile(projectId);
    const temporary = new File(directory, `${target.name}.${Date.now()}.tmp`);
    temporary.create({ overwrite: true });
    temporary.write(ciphertext);
    await temporary.move(target, { overwrite: true });
  }

  async delete(projectId: string): Promise<void> {
    const file = await projectFile(projectId);
    if (file.exists) file.delete();
  }

  async deleteAll(): Promise<void> {
    const directory = cacheDirectory();
    if (directory.exists) directory.delete();
    await SecureStore.deleteItemAsync(CACHE_KEY_SLOT);
  }
}
