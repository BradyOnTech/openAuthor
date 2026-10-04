// Exercise real SQLite/WAL on disposable files, outside the native type environment.
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { SQLiteOutboxStore } from "../src/adapters/sqliteOutboxStore";

function port(database) {
  return {
    execAsync: async (sql) => { database.exec(sql); },
    runAsync: async (sql, params) => database.prepare(sql).run(params),
    getFirstAsync: async (sql, params) => database.prepare(sql).get(params) ?? null,
    getAllAsync: async (sql, params) => database.prepare(sql).all(params),
    withExclusiveTransactionAsync: async (task) => {
      database.exec("BEGIN IMMEDIATE;");
      try { await task(port(database)); database.exec("COMMIT;"); }
      catch (error) { database.exec("ROLLBACK;"); throw error; }
    },
  };
}

async function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "openauthor-mobile-sqlite-"));
  const path = join(root, "local.db");
  let db = new DatabaseSync(path);
  const store = () => new SQLiteOutboxStore({ open: async () => port(db) });
  try {
    await run({ path, db, store, reopen: () => { db.close(); db = new DatabaseSync(path); return store(); } });
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
}

const firstId = "a".repeat(64);
const secondId = "b".repeat(64);
const firstCiphertext = Buffer.from(crypto.getRandomValues(new Uint8Array(80))).toString("base64");
const secondCiphertext = Buffer.from(crypto.getRandomValues(new Uint8Array(90))).toString("base64");

describe("native encrypted cache SQLite durability", () => {
  it("persists ciphertext across database reopening and uses WAL with FULL synchronization", async () => fixture(async ({ db, store, reopen, path }) => {
    const first = store();
    await first.replaceLocalCiphertext(firstId, firstCiphertext);
    expect(db.prepare("PRAGMA journal_mode").get().journal_mode).toBe("wal");
    expect(db.prepare("PRAGMA synchronous").get().synchronous).toBe(2);
    expect(await reopen().loadLocalCiphertext(firstId)).toBe(firstCiphertext);
    expect(readFileSync(path).includes(Buffer.from("private manuscript"))).toBe(false);
  }));

  it("rolls back a failed replacement and preserves the previous committed record", async () => fixture(async ({ db, store, reopen }) => {
    const cache = store();
    await cache.replaceLocalCiphertext(firstId, firstCiphertext);
    db.exec("CREATE TRIGGER deny_recovery BEFORE UPDATE ON mobile_local_cache BEGIN SELECT RAISE(ABORT, 'storage unavailable'); END;");
    await expect(cache.replaceLocalCiphertext(firstId, secondCiphertext)).rejects.toThrow("storage unavailable");
    expect(await reopen().loadLocalCiphertext(firstId)).toBe(firstCiphertext);
  }));

  it("retains the old generation when another process exits mid-transaction, and the new one after commit", async () => fixture(async ({ store, reopen, path }) => {
    await store().replaceLocalCiphertext(firstId, firstCiphertext);
    const exitDuringWrite = (commit) => spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { DatabaseSync } from 'node:sqlite';
      const database = new DatabaseSync(process.argv[1]);
      database.exec('PRAGMA synchronous=FULL; BEGIN IMMEDIATE;');
      database.prepare('UPDATE mobile_local_cache SET ciphertext=? WHERE cache_id=?').run(process.argv[2], process.argv[3]);
      if (process.argv[4] === 'commit') database.exec('COMMIT;');
      process.exit(0);
    `, path, secondCiphertext, firstId, commit ? "commit" : "pending"], { encoding: "utf8" });
    expect(exitDuringWrite(false).status).toBe(0);
    expect(await reopen().loadLocalCiphertext(firstId)).toBe(firstCiphertext);
    expect(exitDuringWrite(true).status).toBe(0);
    expect(await reopen().loadLocalCiphertext(firstId)).toBe(secondCiphertext);
  }));

  it("isolates record identities and deletes cache records without erasing pending outbox work", async () => fixture(async ({ store }) => {
    const cache = store();
    await cache.replaceLocalCiphertext(firstId, firstCiphertext);
    await cache.replaceLocalCiphertext(secondId, secondCiphertext);
    await cache.put({ schemaVersion: 1, operationId: "op-1", projectId: "book-1", deviceId: "device-1", baseRevision: "revision-1", kind: "capture_note", createdAt: "2026-10-02T12:00:00Z", keyVersion: 1, requestDigest: "c".repeat(64), ciphertextDigest: "d".repeat(64), ciphertext: firstCiphertext });
    await cache.deleteLocalCiphertext(firstId);
    expect(await cache.loadLocalCiphertext(firstId)).toBeNull();
    expect(await cache.loadLocalCiphertext(secondId)).toBe(secondCiphertext);
    await cache.deleteLocalCiphertextAll();
    expect(await cache.loadLocalCiphertext(secondId)).toBeNull();
    expect(await cache.pending("book-1")).toHaveLength(1);
    await cache.deleteAll();
    expect(await cache.pending("book-1")).toEqual([]);
  }));

  it("retries a failed database-open attempt when storage becomes available", async () => fixture(async ({ db }) => {
    let attempts = 0;
    const cache = new SQLiteOutboxStore({ open: async () => {
      attempts++;
      if (attempts === 1) throw new Error("Device storage unavailable");
      return port(db);
    } });
    await expect(cache.loadLocalCiphertext(firstId)).rejects.toThrow("Device storage unavailable");
    await cache.replaceLocalCiphertext(firstId, firstCiphertext);
    expect(await cache.loadLocalCiphertext(firstId)).toBe(firstCiphertext);
    expect(attempts).toBe(2);
  }));
});
