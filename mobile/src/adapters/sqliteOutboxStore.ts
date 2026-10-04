import type { OutboxEnvelope, OutboxKind, OutboxStore } from "../core/outbox";
import { OUTBOX_KINDS } from "../core/outbox";

type BindValue = string | number | null;
type BindParams = Record<string, BindValue>;

export interface SQLiteDatabasePort {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: BindParams): Promise<{ changes: number }>;
  getFirstAsync<T>(sql: string, params: BindParams): Promise<T | null>;
  getAllAsync<T>(sql: string, params: BindParams): Promise<T[]>;
  withExclusiveTransactionAsync(
    task: (database: SQLiteDatabasePort) => Promise<void>,
  ): Promise<void>;
}

type SQLiteOutboxRow = {
  schema_version: number;
  operation_id: string;
  project_id: string;
  device_id: string;
  base_revision: string;
  kind: string;
  created_at: string;
  key_version: number;
  request_digest: string;
  ciphertext_digest: string;
  ciphertext: string;
  acknowledged_at: string | null;
};

const CREATE_SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS mobile_outbox (
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  operation_id TEXT PRIMARY KEY NOT NULL CHECK (length(operation_id) BETWEEN 1 AND 160),
  project_id TEXT NOT NULL CHECK (length(project_id) BETWEEN 1 AND 160),
  device_id TEXT NOT NULL CHECK (length(device_id) BETWEEN 1 AND 160),
  base_revision TEXT NOT NULL CHECK (length(base_revision) BETWEEN 1 AND 160),
  kind TEXT NOT NULL CHECK (kind IN (
    'capture_note', 'dictated_passage', 'story_memory_suggestion',
    'change_set_request', 'thread_turn', 'review_decision'
  )),
  created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 1 AND 64),
  key_version INTEGER NOT NULL CHECK (key_version > 0),
  request_digest TEXT NOT NULL CHECK (length(request_digest) = 64),
  ciphertext_digest TEXT NOT NULL CHECK (length(ciphertext_digest) = 64),
  ciphertext TEXT NOT NULL CHECK (length(ciphertext) > 0),
  acknowledged_at TEXT CHECK (acknowledged_at IS NULL OR length(acknowledged_at) BETWEEN 1 AND 64)
);
CREATE TABLE IF NOT EXISTS mobile_local_cache (
  cache_id TEXT PRIMARY KEY NOT NULL CHECK (length(cache_id) = 64),
  ciphertext TEXT NOT NULL CHECK (length(ciphertext) BETWEEN 1 AND 134217728)
);
CREATE INDEX IF NOT EXISTS mobile_outbox_pending_project_idx
  ON mobile_outbox(project_id, created_at, operation_id)
  WHERE acknowledged_at IS NULL;
CREATE TRIGGER IF NOT EXISTS mobile_outbox_immutable_envelope
BEFORE UPDATE OF
  schema_version, operation_id, project_id, device_id, base_revision, kind,
  created_at, key_version, request_digest, ciphertext_digest, ciphertext
ON mobile_outbox
BEGIN
  SELECT RAISE(ABORT, 'mobile outbox ciphertext envelope is immutable');
END;
`;

const SELECT_COLUMNS = `
schema_version, operation_id, project_id, device_id, base_revision, kind,
created_at, key_version, request_digest, ciphertext_digest, ciphertext, acknowledged_at
`;

function validDigest(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function envelopeFromRow(row: SQLiteOutboxRow): OutboxEnvelope {
  if (
    row.schema_version !== 1
    || !OUTBOX_KINDS.includes(row.kind as OutboxKind)
    || !Number.isSafeInteger(row.key_version)
    || row.key_version < 1
    || !validDigest(row.request_digest)
    || !validDigest(row.ciphertext_digest)
    || !row.ciphertext
  ) {
    throw new Error("Persistent outbox contains an invalid encrypted envelope.");
  }
  const envelope: OutboxEnvelope = {
    schemaVersion: 1,
    operationId: row.operation_id,
    projectId: row.project_id,
    deviceId: row.device_id,
    baseRevision: row.base_revision,
    kind: row.kind as OutboxKind,
    createdAt: row.created_at,
    keyVersion: row.key_version,
    requestDigest: row.request_digest,
    ciphertextDigest: row.ciphertext_digest,
    ciphertext: row.ciphertext,
  };
  return row.acknowledged_at
    ? { ...envelope, acknowledgedAt: row.acknowledged_at }
    : envelope;
}

async function defaultOpen(): Promise<SQLiteDatabasePort> {
  const { openDatabaseAsync } = await import("expo-sqlite");
  return await openDatabaseAsync("openauthor-mobile-outbox-v1.db") as SQLiteDatabasePort;
}

export class SQLiteOutboxStore implements OutboxStore {
  readonly #open: () => Promise<SQLiteDatabasePort>;
  #databasePromise: Promise<SQLiteDatabasePort> | null = null;

  constructor(input: { open?: () => Promise<SQLiteDatabasePort> } = {}) {
    this.#open = input.open ?? defaultOpen;
  }

  async #database(): Promise<SQLiteDatabasePort> {
    if (!this.#databasePromise) {
      const pending = this.#open().then(async (database) => {
        await database.execAsync(CREATE_SCHEMA);
        return database;
      });
      this.#databasePromise = pending;
      void pending.catch(() => { if (this.#databasePromise === pending) this.#databasePromise = null; });
    }
    return await this.#databasePromise;
  }

  async #getFrom(
    database: SQLiteDatabasePort,
    operationId: string,
  ): Promise<OutboxEnvelope | null> {
    const row = await database.getFirstAsync<SQLiteOutboxRow>(
      `SELECT ${SELECT_COLUMNS} FROM mobile_outbox WHERE operation_id = $operation_id`,
      { $operation_id: operationId },
    );
    return row ? envelopeFromRow(row) : null;
  }

  async get(operationId: string): Promise<OutboxEnvelope | null> {
    return await this.#getFrom(await this.#database(), operationId);
  }

  async put(envelope: OutboxEnvelope): Promise<void> {
    if (
      envelope.schemaVersion !== 1
      || !OUTBOX_KINDS.includes(envelope.kind)
      || !validDigest(envelope.requestDigest)
      || !validDigest(envelope.ciphertextDigest)
      || !envelope.ciphertext
      || envelope.acknowledgedAt !== undefined
    ) {
      throw new Error("Only pending ciphertext envelopes can be persisted.");
    }
    const database = await this.#database();
    try {
      await database.runAsync(
        `INSERT INTO mobile_outbox (
          schema_version, operation_id, project_id, device_id, base_revision, kind,
          created_at, key_version, request_digest, ciphertext_digest, ciphertext, acknowledged_at
        ) VALUES (
          $schema_version, $operation_id, $project_id, $device_id, $base_revision, $kind,
          $created_at, $key_version, $request_digest, $ciphertext_digest, $ciphertext, NULL
        )`,
        {
          $schema_version: 1,
          $operation_id: envelope.operationId,
          $project_id: envelope.projectId,
          $device_id: envelope.deviceId,
          $base_revision: envelope.baseRevision,
          $kind: envelope.kind,
          $created_at: envelope.createdAt,
          $key_version: envelope.keyVersion,
          $request_digest: envelope.requestDigest,
          $ciphertext_digest: envelope.ciphertextDigest,
          $ciphertext: envelope.ciphertext,
        },
      );
    } catch {
      if (await this.#getFrom(database, envelope.operationId)) {
        throw new Error("Outbox operation already exists.");
      }
      throw new Error("Encrypted outbox persistence failed.");
    }
  }

  async pending(projectId: string): Promise<OutboxEnvelope[]> {
    const database = await this.#database();
    const rows = await database.getAllAsync<SQLiteOutboxRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM mobile_outbox
       WHERE project_id = $project_id AND acknowledged_at IS NULL
       ORDER BY created_at, operation_id`,
      { $project_id: projectId },
    );
    return rows.map(envelopeFromRow);
  }

  async acknowledge(operationId: string, acknowledgedAt: string): Promise<void> {
    if (!acknowledgedAt.trim() || acknowledgedAt.length > 64) {
      throw new Error("Outbox acknowledgement time is invalid.");
    }
    const database = await this.#database();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      const existing = await this.#getFrom(transaction, operationId);
      if (!existing) throw new Error("Unknown outbox operation.");
      if (existing.acknowledgedAt && existing.acknowledgedAt !== acknowledgedAt) {
        throw new Error("Outbox acknowledgement is immutable.");
      }
      if (existing.acknowledgedAt === acknowledgedAt) return;
      const result = await transaction.runAsync(
        `UPDATE mobile_outbox
         SET acknowledged_at = $acknowledged_at
         WHERE operation_id = $operation_id AND acknowledged_at IS NULL`,
        { $operation_id: operationId, $acknowledged_at: acknowledgedAt },
      );
      if (result.changes !== 1) throw new Error("Outbox acknowledgement failed.");
    });
  }

  async loadLocalCiphertext(cacheId: string): Promise<string | null> {
    if (!validDigest(cacheId)) throw new Error("Local encrypted record identity is invalid.");
    const row = await (await this.#database()).getFirstAsync<{ ciphertext: string }>(
      "SELECT ciphertext FROM mobile_local_cache WHERE cache_id = $cache_id", { $cache_id: cacheId },
    );
    return row?.ciphertext ?? null;
  }

  async replaceLocalCiphertext(cacheId: string, ciphertext: string): Promise<void> {
    if (!validDigest(cacheId) || !ciphertext || ciphertext.length > 128 * 1024 * 1024) throw new Error("Local encrypted record is invalid.");
    await (await this.#database()).runAsync(
      `INSERT INTO mobile_local_cache (cache_id, ciphertext) VALUES ($cache_id, $ciphertext)
       ON CONFLICT(cache_id) DO UPDATE SET ciphertext = excluded.ciphertext`,
      { $cache_id: cacheId, $ciphertext: ciphertext },
    );
  }

  async insertLocalCiphertextIfAbsent(cacheId: string, ciphertext: string): Promise<void> {
    if (!validDigest(cacheId) || !ciphertext || ciphertext.length > 128 * 1024 * 1024) throw new Error("Local encrypted record is invalid.");
    await (await this.#database()).runAsync(
      `INSERT INTO mobile_local_cache (cache_id, ciphertext) VALUES ($cache_id, $ciphertext)
       ON CONFLICT(cache_id) DO NOTHING`,
      { $cache_id: cacheId, $ciphertext: ciphertext },
    );
  }

  async deleteLocalCiphertext(cacheId: string): Promise<void> {
    if (!validDigest(cacheId)) throw new Error("Local encrypted record identity is invalid.");
    await (await this.#database()).runAsync("DELETE FROM mobile_local_cache WHERE cache_id = $cache_id", { $cache_id: cacheId });
  }

  async deleteLocalCiphertextAll(): Promise<void> {
    await (await this.#database()).execAsync("DELETE FROM mobile_local_cache;");
  }

  async deleteAll(): Promise<void> {
    await (await this.#database()).execAsync("DELETE FROM mobile_outbox; DELETE FROM mobile_local_cache;");
  }
}
