import { isMobileAuthStorageKey } from "./authStorageKey";
import type { EncryptedRecoveryStorage } from "./companionRecovery";

export interface LegacyAuthStorage {
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<string[]>;
}
type RecordStorage = EncryptedRecoveryStorage & { deleteRecovery(scope: string): Promise<void> };
type AuthRecord = { version: 1; scope: string; values: Record<string, string> };
const writes = new Map<string, Promise<unknown>>();
const generations = new Map<string, number>();

/** Large auth sessions use the existing encrypted snapshot cache, with its small
 * wrapping key in SecureStore. Legacy SQLite values are never written again. */
export class EncryptedAuthStorage {
  readonly #scope: string;
  readonly #generation: number;
  constructor(private readonly input: { deployment: string; base: string; encrypted: RecordStorage; legacy: LegacyAuthStorage }) {
    this.#scope = JSON.stringify(["openauthor.mobile.auth.v1", input.deployment]);
    this.#generation = generations.get(this.#scope) ?? 0;
  }

  async #serialized<T>(operation: () => Promise<T>): Promise<T> {
    const pending = (writes.get(this.#scope) ?? Promise.resolve()).catch(() => {}).then(operation);
    writes.set(this.#scope, pending);
    try { return await pending; }
    finally { if (writes.get(this.#scope) === pending) writes.delete(this.#scope); }
  }

  #checkKey(key: string): void {
    if (!isMobileAuthStorageKey(key, this.input.base) || key.length > 240) throw new Error("Auth storage namespace is invalid.");
  }

  async #read(): Promise<AuthRecord> {
    const encoded = await this.input.encrypted.loadRecovery(this.#scope);
    if (encoded === null) return { version: 1, scope: this.#scope, values: {} };
    try {
      const record = JSON.parse(encoded) as AuthRecord;
      if (!record || record.version !== 1 || record.scope !== this.#scope || !record.values
        || typeof record.values !== "object" || Array.isArray(record.values) || encoded.length > 512 * 1024) throw new Error();
      for (const [key, value] of Object.entries(record.values)) {
        this.#checkKey(key);
        if (typeof value !== "string" || value.length > 256 * 1024) throw new Error();
      }
      return record;
    } catch { throw new Error("Encrypted sign-in storage is invalid. No saved book or capture was deleted."); }
  }

  async #commit(record: AuthRecord): Promise<void> {
    if (Object.keys(record.values).length === 0) {
      await this.input.encrypted.deleteRecovery(this.#scope);
      return;
    }
    const encoded = JSON.stringify(record);
    if (encoded.length > 512 * 1024) throw new Error("Sign-in storage exceeds the supported size.");
    await this.input.encrypted.saveRecovery(this.#scope, encoded);
    // Do not remove a legacy token until its replacement can actually be
    // decrypted and read. Encryption/quota/readback failure preserves recovery.
    if (await this.input.encrypted.loadRecovery(this.#scope) !== encoded) throw new Error("Encrypted sign-in storage verification failed.");
  }

  getItem(key: string): Promise<string | null> {
    this.#checkKey(key);
    return this.#serialized(async () => {
      if (this.#generation !== (generations.get(this.#scope) ?? 0)) return null;
      const record = await this.#read();
      const existing = record.values[key];
      if (existing !== undefined) { await this.input.legacy.removeItem(key); return existing; }
      const legacy = await this.input.legacy.getItem(key);
      if (legacy === null) return null;
      if (legacy.length > 256 * 1024) throw new Error("Saved sign-in data exceeds the supported size.");
      record.values[key] = legacy;
      await this.#commit(record);
      await this.input.legacy.removeItem(key);
      return legacy;
    });
  }

  setItem(key: string, value: string): Promise<void> {
    this.#checkKey(key);
    if (value.length > 256 * 1024) return Promise.reject(new Error("Sign-in data exceeds the supported size."));
    return this.#serialized(async () => {
      if (this.#generation !== (generations.get(this.#scope) ?? 0)) throw new Error("This sign-in session was closed. Sign in again.");
      const record = await this.#read();
      record.values[key] = value;
      await this.#commit(record);
      await this.input.legacy.removeItem(key);
    });
  }

  removeItem(key: string): Promise<void> {
    this.#checkKey(key);
    return this.#serialized(async () => {
      if (this.#generation !== (generations.get(this.#scope) ?? 0)) return;
      const record = await this.#read();
      delete record.values[key];
      await this.#commit(record);
      await this.input.legacy.removeItem(key);
    });
  }

  clear(): Promise<void> {
    // Fence SDK writes synchronously, including refresh responses that have
    // not entered storage yet. Earlier writes drain before ciphertext deletion.
    generations.set(this.#scope, (generations.get(this.#scope) ?? 0) + 1);
    return this.#serialized(async () => {
      let failed = false;
      try { await this.input.encrypted.deleteRecovery(this.#scope); } catch { failed = true; }
      try {
        for (const key of (await this.input.legacy.getAllKeys()).filter((key) => isMobileAuthStorageKey(key, this.input.base))) {
          try { await this.input.legacy.removeItem(key); } catch { failed = true; }
        }
      } catch { failed = true; }
      if (failed) throw new Error("Sign-in storage cleanup did not finish safely.");
    });
  }
}
