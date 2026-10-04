import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from "expo-crypto";
import Storage from "expo-sqlite/kv-store";
import { decodeDownloadedBook, type DownloadedBook, type DownloadedBookStore } from "../core/localCompanion";
import { ExpoSecretStore } from "./expoSecrets";

const PREFIX = "openauthor.mobile.downloaded-book.";
const KEY_SLOT = "openauthor.mobile.library-key.v1";

/** Only the small wrapping key uses SecureStore; book metadata is encrypted in SQLite. */
export class EncryptedDownloadedBookStore implements DownloadedBookStore {
  readonly #secrets = new ExpoSecretStore();

  async #key(create: boolean): Promise<AESEncryptionKey> {
    let encoded = await this.#secrets.get(KEY_SLOT);
    if (!encoded && create) {
      const candidate = await AESEncryptionKey.generate(256);
      encoded = await this.#secrets.create(KEY_SLOT, await candidate.encoded("base64"));
    }
    if (!encoded) throw new Error("Downloaded library key is unavailable. Reconnect to recover your books.");
    return AESEncryptionKey.import(encoded, "base64");
  }

  async list(): Promise<DownloadedBook[]> {
    const books: DownloadedBook[] = [];
    const keys = (await Storage.getAllKeys()).filter((key) => key.startsWith(PREFIX));
    if (!keys.length) return books;
    for (const slot of keys) {
      const book = await this.get(slot.slice(PREFIX.length));
      if (book) books.push(book);
    }
    return books.sort((a, b) => b.downloadedAt.localeCompare(a.downloadedAt));
  }

  async get(projectId: string): Promise<DownloadedBook | null> {
    const slot = `${PREFIX}${projectId}`;
    const encoded = await Storage.getItem(slot);
    if (encoded === null) return null;
    const plaintext = await aesDecryptAsync(AESSealedData.fromCombined(encoded), await this.#key(false), {
      additionalData: new TextEncoder().encode(slot),
    });
    if (typeof plaintext === "string") throw new Error("Downloaded library encoding is invalid.");
    const book = decodeDownloadedBook(new TextDecoder().decode(plaintext));
    if (book.projectId !== projectId) throw new Error("Downloaded book identity mismatch.");
    return book;
  }

  async put(book: DownloadedBook): Promise<void> {
    decodeDownloadedBook(JSON.stringify(book));
    const slot = `${PREFIX}${book.projectId}`;
    const sealed = await aesEncryptAsync(new TextEncoder().encode(JSON.stringify(book)), await this.#key(true), {
      additionalData: new TextEncoder().encode(slot),
    });
    const ciphertext = await sealed.combined("base64");
    if (typeof ciphertext !== "string") throw new Error("Downloaded library encryption failed.");
    await Storage.setItem(slot, ciphertext);
  }

  async clear(): Promise<void> {
    for (const slot of (await Storage.getAllKeys()).filter((key) => key.startsWith(PREFIX))) await Storage.removeItem(slot);
    await this.#secrets.delete(KEY_SLOT);
  }
}
