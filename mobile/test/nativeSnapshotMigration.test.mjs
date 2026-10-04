import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ database: null, files: new Map(), secrets: new Map(), pauseDecrypt: null, pauseText: null, pauseMissingRead: null }));
vi.mock("expo-secure-store", () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: async key => native.secrets.get(key) ?? null,
  setItemAsync: async (key, value) => { native.secrets.set(key, value); },
  deleteItemAsync: async key => { native.secrets.delete(key); },
}));
vi.mock("expo-file-system", () => {
  class Directory {
    constructor(...parts) { this.uri = parts.map(part => typeof part === "string" ? part : part.uri).join("/"); }
    get exists() { return [...native.files.keys()].some(path => path.startsWith(`${this.uri}/`)); }
    delete() { for (const path of native.files.keys()) if (path.startsWith(`${this.uri}/`)) native.files.delete(path); }
  }
  class File extends Directory {
    get exists() { return native.files.has(this.uri); }
    async text() {
      const pause = native.pauseText; native.pauseText = null;
      if (pause) await pause();
      if (!native.files.has(this.uri)) throw new Error("Legacy source was removed by a concurrent refresh.");
      return native.files.get(this.uri);
    }
    delete() { native.files.delete(this.uri); }
  }
  return { Directory, File, Paths: { document: "native-document" } };
});
vi.mock("expo-sqlite", () => ({ openDatabaseAsync: async () => port(native.database) }));
vi.mock("expo-crypto", async () => {
  const { webcrypto } = await import("node:crypto");
  class AESEncryptionKey {
    constructor(value) { this.value = value; }
    static async generate() { return new AESEncryptionKey(await webcrypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"])); }
    static async import(value) { return new AESEncryptionKey(await webcrypto.subtle.importKey("raw", Buffer.from(value, "base64"), "AES-GCM", true, ["encrypt", "decrypt"])); }
    async encoded() { return Buffer.from(await webcrypto.subtle.exportKey("raw", this.value)).toString("base64"); }
  }
  class AESSealedData {
    constructor(iv, bytes) { this.iv = iv; this.bytes = bytes; }
    static fromCombined(value) { const bytes = Buffer.from(value, "base64"); return new AESSealedData(bytes.subarray(0, 12), bytes.subarray(12)); }
    async combined() { return Buffer.concat([this.iv, Buffer.from(this.bytes)]).toString("base64"); }
  }
  return { AESEncryptionKey, AESSealedData, CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    digestStringAsync: async (algorithm, text) => Buffer.from(await webcrypto.subtle.digest(algorithm, new TextEncoder().encode(text))).toString("hex"),
    aesEncryptAsync: async (value, key, options) => {
      const iv = webcrypto.getRandomValues(new Uint8Array(12));
      return new AESSealedData(iv, await webcrypto.subtle.encrypt({ name: "AES-GCM", iv, ...options }, key.value, value));
    },
    aesDecryptAsync: async (sealed, key, options) => {
      const pause = native.pauseDecrypt; native.pauseDecrypt = null;
      if (pause) await pause();
      return webcrypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.iv, ...options }, key.value, sealed.bytes);
    },
  };
});
import { EncryptedFileSnapshotCache } from "../src/adapters/encryptedSnapshotCache";
import { SQLiteOutboxStore } from "../src/adapters/sqliteOutboxStore";
import { digestStringAsync, CryptoDigestAlgorithm } from "expo-crypto";

function port(database) {
  return {
    execAsync: async sql => { database.exec(sql); },
    runAsync: async (sql, params) => database.prepare(sql).run(params),
    getFirstAsync: async (sql, params) => {
      const value = database.prepare(sql).get(params) ?? null;
      if (value === null && sql.includes("mobile_local_cache") && native.pauseMissingRead) {
        const pause = native.pauseMissingRead; native.pauseMissingRead = null;
        await pause();
      }
      return value;
    },
    getAllAsync: async (sql, params) => database.prepare(sql).all(params),
    withExclusiveTransactionAsync: async task => {
      database.exec("BEGIN IMMEDIATE;");
      try { await task(port(database)); database.exec("COMMIT;"); }
      catch (error) { database.exec("ROLLBACK;"); throw error; }
    },
  };
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const projectId = "book-one";
const snapshot = revision => ({ snapshot: { project_id: projectId, revision }, manifest: { projectId, revision }, cachedAt: "2026-10-02T12:00:00Z" });
let root, cache, records, cacheId, legacyPath, legacyCiphertext;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "openauthor-native-migration-"));
  native.database = new DatabaseSync(join(root, "cache.db"));
  native.files.clear(); native.secrets.clear();
  native.pauseDecrypt = null; native.pauseText = null; native.pauseMissingRead = null;
  cache = new EncryptedFileSnapshotCache(); records = new SQLiteOutboxStore();
  cacheId = await digestStringAsync(CryptoDigestAlgorithm.SHA256, `snapshot:${projectId}`);
  legacyPath = `native-document/openauthor-snapshots/${await digestStringAsync(CryptoDigestAlgorithm.SHA256, projectId)}.snapshot`;
  await cache.replace(projectId, snapshot("old"));
  legacyCiphertext = await records.loadLocalCiphertext(cacheId);
  await records.deleteLocalCiphertext(cacheId);
  native.files.set(legacyPath, legacyCiphertext);
});
afterEach(() => { native.database.close(); rmSync(root, { recursive: true, force: true }); });

describe("native legacy snapshot migration with real SQLite and AES", () => {
  it("returns a newer concurrent SQLite winner without replacing it with a slow legacy read", async () => {
    const started = deferred(), release = deferred();
    native.pauseDecrypt = async () => { started.resolve(); await release.promise; };
    const migrating = cache.load(projectId);
    await started.promise;
    await new EncryptedFileSnapshotCache().replace(projectId, snapshot("new"));
    const winner = await records.loadLocalCiphertext(cacheId);
    release.resolve();
    expect((await migrating).manifest.revision).toBe("new");
    expect(await records.loadLocalCiphertext(cacheId)).toBe(winner);
    expect(native.files.has(legacyPath)).toBe(false);
  });

  it("retains legacy ciphertext when the winning SQLite row cannot be decrypted", async () => {
    const started = deferred(), release = deferred();
    native.pauseDecrypt = async () => { started.resolve(); await release.promise; };
    const migrating = cache.load(projectId);
    const rejected = expect(migrating).rejects.toThrow();
    await started.promise;
    await records.replaceLocalCiphertext(cacheId, "invalid-winning-ciphertext");
    release.resolve(); await rejected;
    expect(native.files.get(legacyPath)).toBe(legacyCiphertext);
  });

  it.each(["text", "missing-row"])("rechecks SQLite when a concurrent refresh removes the legacy source during %s", async point => {
    const started = deferred(), release = deferred();
    const pause = async () => { started.resolve(); await release.promise; };
    if (point === "text") native.pauseText = pause; else native.pauseMissingRead = pause;
    const migrating = cache.load(projectId);
    await started.promise;
    await new EncryptedFileSnapshotCache().replace(projectId, snapshot("new"));
    release.resolve();
    expect((await migrating).manifest.revision).toBe("new");
    expect(native.files.has(legacyPath)).toBe(false);
  });

  it("keeps the legacy source after a failed conditional insert and migrates on retry", async () => {
    native.database.exec("CREATE TRIGGER deny_migration BEFORE INSERT ON mobile_local_cache BEGIN SELECT RAISE(ABORT, 'storage unavailable'); END;");
    await expect(cache.load(projectId)).rejects.toThrow("storage unavailable");
    expect(native.files.get(legacyPath)).toBe(legacyCiphertext);
    expect(await records.loadLocalCiphertext(cacheId)).toBeNull();
    native.database.exec("DROP TRIGGER deny_migration;");
    expect((await cache.load(projectId)).manifest.revision).toBe("old");
    expect(await records.loadLocalCiphertext(cacheId)).toBe(legacyCiphertext);
    expect(native.files.has(legacyPath)).toBe(false);
  });
});
