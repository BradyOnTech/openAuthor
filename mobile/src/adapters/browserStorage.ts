/** Device-local encrypted storage. The wrapping key is non-exportable, but this
 * is browser-origin protection, not an OS keychain or protection against XSS. */
export class BrowserStorage {
  #database: Promise<IDBDatabase> | undefined;

  constructor(private readonly name = "openauthor-companion-v1") {}

  async #open(): Promise<IDBDatabase> {
    if (!this.#database) {
      this.#database = new Promise((resolve, reject) => {
        const request = indexedDB.open(this.name, 1);
        request.onupgradeneeded = () => {
          for (const store of ["records", "keys", "outbox"]) request.result.createObjectStore(store);
        };
        request.onsuccess = () => {
          const database = request.result;
          database.onversionchange = () => { database.close(); this.#database = undefined; };
          resolve(database);
        };
        request.onerror = () => { this.#database = undefined; reject(new Error("Browser storage is unavailable.")); };
        request.onblocked = () => reject(new Error("Close other openAuthor tabs to update browser storage."));
      });
    }
    return this.#database;
  }

  async transaction<T>(store: string, mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
    const database = await this.#open();
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(store, mode, { durability: mode === "readwrite" ? "strict" : "default" });
      let value: T;
      transaction.oncomplete = () => resolve(value);
      transaction.onabort = () => reject(transaction.error ?? new Error("Browser storage transaction failed."));
      transaction.onerror = () => { /* onabort owns the failure result. */ };
      try { run(transaction.objectStore(store), (result) => { value = result; }); }
      catch (error) { transaction.abort(); reject(error); }
    });
  }

  async key(): Promise<CryptoKey> {
    const candidate = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    // Selection and insertion share a transaction, including across browser tabs.
    return this.transaction("keys", "readwrite", (store, done) => {
      const read = store.get("wrapping-key");
      read.onsuccess = () => {
        if (read.result) done(read.result as CryptoKey);
        else { store.add(candidate, "wrapping-key"); done(candidate); }
      };
    });
  }

  async get(key: string): Promise<string | null> {
    const record = await this.transaction<{ iv: Uint8Array<ArrayBuffer>; bytes: ArrayBuffer } | undefined>("records", "readonly", (store, done) => {
      const read = store.get(key);
      read.onsuccess = () => done(read.result);
    });
    if (!record) return null;
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.iv, additionalData: new TextEncoder().encode(key) }, await this.key(), record.bytes);
    return new TextDecoder().decode(plaintext);
  }

  async set(key: string, value: string): Promise<void> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const bytes = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(key) }, await this.key(), new TextEncoder().encode(value));
    await this.transaction<void>("records", "readwrite", (store) => { store.put({ iv, bytes }, key); });
  }

  async create(key: string, value: string): Promise<string> {
    const wrappingKey = await this.key();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const additionalData = new TextEncoder().encode(key);
    const bytes = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData }, wrappingKey, new TextEncoder().encode(value));
    // Crypto awaits happen outside the transaction, which must remain active
    // until this synchronous read-or-add chain has completed across all tabs.
    const chosen = await this.transaction<{ iv: Uint8Array<ArrayBuffer>; bytes: ArrayBuffer }>("records", "readwrite", (store, done) => {
      const read = store.get(key);
      read.onsuccess = () => {
        if (read.result) done(read.result);
        else { store.add({ iv, bytes }, key); done({ iv, bytes }); }
      };
    });
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: chosen.iv, additionalData }, wrappingKey, chosen.bytes));
  }

  async delete(key: string): Promise<void> {
    await this.transaction<void>("records", "readwrite", (store) => { store.delete(key); });
  }

  async keys(prefix: string): Promise<string[]> {
    return this.transaction("records", "readonly", (store, done) => {
      const read = store.getAllKeys();
      read.onsuccess = () => done(read.result.map(String).filter((key) => key.startsWith(prefix)));
    });
  }

  async deletePrefix(prefix: string): Promise<void> {
    await this.transaction<void>("records", "readwrite", (store) => {
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) return;
        if (String(item.key).startsWith(prefix)) item.delete();
        item.continue();
      };
    });
  }
}

export const browserStorage = new BrowserStorage();
