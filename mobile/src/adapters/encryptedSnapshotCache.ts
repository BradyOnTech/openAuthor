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

import { SQLiteOutboxStore } from "./sqliteOutboxStore";
import type { CachedSnapshot, SnapshotCache } from "../core/snapshotSync";

const CACHE_KEY_SLOT = "openauthor.mobile.snapshot-cache-key.v1";
let keyCreation: Promise<AESEncryptionKey> | null = null;

async function cacheKey(create: boolean): Promise<AESEncryptionKey | null> {
  const existing = await SecureStore.getItemAsync(CACHE_KEY_SLOT);
  if (existing) return await AESEncryptionKey.import(existing, "base64");
  if (!create) return null;
  if (!keyCreation) keyCreation = (async () => {
    // Cache/auth/recovery adapter instances share the one native JS runtime.
    // Recheck after entering the creation queue before generating a new key.
    const current = await SecureStore.getItemAsync(CACHE_KEY_SLOT);
    if (current) return AESEncryptionKey.import(current, "base64");
    const generated = await AESEncryptionKey.generate(256);
    await SecureStore.setItemAsync(CACHE_KEY_SLOT, await generated.encoded("base64"), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return generated;
  })();
  const pending = keyCreation;
  try { return await pending; }
  finally { if (keyCreation === pending) keyCreation = null; }
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
  readonly #records = new SQLiteOutboxStore();
  async #recordId(scope: string): Promise<string> { return digestStringAsync(CryptoDigestAlgorithm.SHA256, scope); }
  async #decryptSnapshot(projectId: string, ciphertext: string): Promise<CachedSnapshot> {
    const key = await cacheKey(false);
    if (!key) throw new Error("Encrypted snapshot cache key is unavailable.");
    const sealed = AESSealedData.fromCombined(ciphertext);
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

  async load(projectId: string): Promise<CachedSnapshot | null> {
    const file = await projectFile(projectId);
    const cacheId = await this.#recordId(`snapshot:${projectId}`);
    let current = await this.#records.loadLocalCiphertext(cacheId);
    let ciphertext = current;
    if (ciphertext === null) {
      try { if (file.exists) ciphertext = await file.text(); }
      catch (error) {
        current = await this.#records.loadLocalCiphertext(cacheId);
        if (current === null) throw error;
        ciphertext = current;
      }
      if (ciphertext === null) {
        // A refresh may have committed and removed the legacy file after the
        // initial absent-row read. Consult the durable winner before returning.
        current = await this.#records.loadLocalCiphertext(cacheId);
        ciphertext = current;
        if (ciphertext === null) return null;
      }
    }
    let decoded = await this.#decryptSnapshot(projectId, ciphertext);
    if (current === null) {
      // Authenticate/validate before migrating the old encrypted file. Keep it
      // until SQLite confirms its replacement. A concurrent refresh may have
      // committed a newer publication while the legacy file was decrypting.
      await this.#records.insertLocalCiphertextIfAbsent(cacheId, ciphertext);
      const persisted = await this.#records.loadLocalCiphertext(cacheId);
      if (persisted === null) throw new Error("Encrypted snapshot migration verification failed.");
      if (persisted !== ciphertext) decoded = await this.#decryptSnapshot(projectId, persisted);
      if (file.exists) file.delete();
    }
    return decoded;
  }

  async replace(projectId: string, value: CachedSnapshot): Promise<void> {
    if (value.snapshot.project_id !== projectId || value.manifest.projectId !== projectId) {
      throw new Error("Snapshot cache project identity mismatch.");
    }
    const key = await cacheKey(true);
    if (!key) throw new Error("Unable to create snapshot cache key.");
    const sealed = await aesEncryptAsync(
      new TextEncoder().encode(JSON.stringify(value)),
      key,
      { additionalData: new TextEncoder().encode(projectId) },
    );
    const ciphertext = await sealed.combined("base64");
    if (typeof ciphertext !== "string") throw new Error("Snapshot cache encryption failed.");
    const cacheId = await this.#recordId(`snapshot:${projectId}`);
    await this.#records.replaceLocalCiphertext(cacheId, ciphertext);
    if (await this.#records.loadLocalCiphertext(cacheId) !== ciphertext) throw new Error("Encrypted snapshot persistence verification failed.");
    const legacy = await projectFile(projectId);
    if (legacy.exists) legacy.delete();
  }

  async loadRecovery(scope: string): Promise<string | null> {
    const context = `companion-recovery:${scope}`;
    const ciphertext = await this.#records.loadLocalCiphertext(await this.#recordId(context));
    if (ciphertext === null) return null;
    const key = await cacheKey(false);
    if (!key) throw new Error("Encrypted recovery key is unavailable. No saved work was deleted.");
    const plaintext = await aesDecryptAsync(AESSealedData.fromCombined(ciphertext), key, {
      additionalData: new TextEncoder().encode(context),
    });
    if (typeof plaintext === "string") throw new Error("Recovery encoding is invalid.");
    return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
  }

  async saveRecovery(scope: string, value: string): Promise<void> {
    const context = `companion-recovery:${scope}`;
    const key = await cacheKey(true);
    if (!key) throw new Error("Encrypted recovery key is unavailable.");
    const sealed = await aesEncryptAsync(new TextEncoder().encode(value), key, {
      additionalData: new TextEncoder().encode(context),
    });
    const ciphertext = await sealed.combined("base64");
    if (typeof ciphertext !== "string") throw new Error("Recovery encryption failed.");
    await this.#records.replaceLocalCiphertext(await this.#recordId(context), ciphertext);
  }

  async deleteRecovery(scope: string): Promise<void> {
    await this.#records.deleteLocalCiphertext(await this.#recordId(`companion-recovery:${scope}`));
  }

  async delete(projectId: string): Promise<void> {
    await this.#records.deleteLocalCiphertext(await this.#recordId(`snapshot:${projectId}`));
    const file = await projectFile(projectId);
    if (file.exists) file.delete();
  }

  async deleteAll(): Promise<void> {
    const directory = cacheDirectory();
    try {
      if (directory.exists) directory.delete();
      await this.#records.deleteLocalCiphertextAll();
    } finally { await SecureStore.deleteItemAsync(CACHE_KEY_SLOT); }
  }
}
