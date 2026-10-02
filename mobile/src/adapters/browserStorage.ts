/** Device-local encrypted storage. The wrapping key is non-exportable, but this
 * is browser-origin protection, not an OS keychain or protection against XSS. */
export class BrowserStorage {
  #database: Promise<IDBDatabase> | undefined;
  #channel: BroadcastChannel | undefined;
  readonly #listeners = new Set<(key: string) => void>();
  readonly #authLeases = new Map<string, Set<() => void>>();

  subscribe(listener: (key: string) => void): () => void {
    this.#listeners.add(listener);
    if (!this.#channel && typeof BroadcastChannel !== "undefined") {
      try {
        this.#channel = new BroadcastChannel(`${this.name}:record-changes`);
        this.#channel.onmessage = (event) => {
          if (typeof event.data === "string") for (const callback of this.#listeners) callback(event.data);
        };
      } catch { /* Foreground access checks still protect browsers without cross-tab messages. */ }
    }
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) { this.#channel?.close(); this.#channel = undefined; }
    };
  }

  #changed(key: string): void {
    for (const listener of this.#listeners) { try { listener(key); } catch { /* Notification cannot undo a committed write. */ } }
    // Send only a content-free change signal. Never put captured text, access
    // records, keys or credentials into a cross-tab message.
    try {
      const channel = this.#channel ?? (typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(`${this.name}:record-changes`) : undefined);
      channel?.postMessage(key);
      if (channel !== this.#channel) channel?.close();
    } catch { /* Storage durability must not depend on notification availability. */ }
  }

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
    return this.#transaction([store], mode, (get, done) => run(get(store), done));
  }

  async #transaction<T>(stores: string[], mode: IDBTransactionMode, run: (get: (name: string) => IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
    const database = await this.#open();
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(stores, mode, { durability: mode === "readwrite" ? "strict" : "default" });
      let value: T;
      transaction.oncomplete = () => resolve(value);
      transaction.onabort = () => reject(transaction.error ?? new Error("Browser storage transaction failed."));
      transaction.onerror = () => { /* onabort owns the failure result. */ };
      try { run((name) => transaction.objectStore(name), (result) => { value = result; }); }
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
    this.#changed(key);
  }

  authLease(prefix: string): { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; delete(key: string): Promise<void> } {
    let closed = false;
    const close = () => { closed = true; };
    const leases = this.#authLeases.get(prefix) ?? new Set<() => void>();
    leases.add(close); this.#authLeases.set(prefix, leases);
    const fenceKey = `auth-generation:${prefix}`;
    const generation = this.transaction<string>("keys", "readwrite", (keys, done) => {
      const read = keys.get(fenceKey);
      read.onsuccess = () => {
        const value = typeof read.result === "string" ? read.result : crypto.randomUUID();
        if (read.result === undefined) keys.put(value, fenceKey);
        done(value);
      };
    });
    const checkKey = (key: string) => {
      if (key !== prefix && !key.startsWith(`${prefix}-`)) throw new Error("Sign-in storage namespace is invalid.");
    };
    const current = async <T>(key: string, stale: T, write: boolean, run: (records: IDBObjectStore, done: (value: T) => void) => void): Promise<T> => {
      checkKey(key);
      const expected = await generation;
      return this.#transaction(["keys", "records"], write ? "readwrite" : "readonly", (get, done) => {
        const read = get("keys").get(fenceKey);
        read.onsuccess = () => {
          if (closed || read.result !== expected) { done(stale); return; }
          run(get("records"), done);
        };
      });
    };
    return {
      get: async (key) => {
        const record = await current<{ iv: Uint8Array<ArrayBuffer>; bytes: ArrayBuffer } | null>(key, null, false, (records, done) => {
          const read = records.get(key); read.onsuccess = () => done(read.result ?? null);
        });
        if (!record) return null;
        return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.iv, additionalData: new TextEncoder().encode(key) }, await this.key(), record.bytes));
      },
      set: async (key, value) => {
        if (closed) throw new Error("This sign-in session was closed. Sign in again.");
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const bytes = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(key) }, await this.key(), new TextEncoder().encode(value));
        const saved = await current(key, false, true, (records, done) => { records.put({ iv, bytes }, key); done(true); });
        if (!saved) throw new Error("This sign-in session was closed. Sign in again.");
        this.#changed(key);
      },
      delete: async (key) => { await current<void>(key, undefined, true, (records) => { records.delete(key); }); },
    };
  }

  async clearAuth(prefix: string): Promise<void> {
    for (const close of this.#authLeases.get(prefix) ?? []) close();
    this.#authLeases.delete(prefix);
    // A content-free generation and ciphertext deletion commit together. A
    // late refresh in any tab cannot put credentials back after this commit.
    await this.#transaction<void>(["keys", "records"], "readwrite", (get) => {
      get("keys").put(crypto.randomUUID(), `auth-generation:${prefix}`);
      const cursor = get("records").openCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) return;
        const key = String(item.key);
        if (key === prefix || key.startsWith(`${prefix}-`)) item.delete();
        item.continue();
      };
    });
    this.#changed(prefix);
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
    this.#changed(key);
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
