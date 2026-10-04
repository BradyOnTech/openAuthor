import { describe, expect, it } from "vitest";

import type { OutboxEnvelope } from "../src/core/outbox";
import {
  SQLiteOutboxStore,
  type SQLiteDatabasePort,
} from "../src/adapters/sqliteOutboxStore";

type Row = Record<string, string | number | null>;

class MemorySQLite implements SQLiteDatabasePort {
  readonly rows = new Map<string, Row>();

  private required(
    params: Record<string, string | number | null>,
    key: string,
  ): string | number | null {
    const value = params[key];
    if (value === undefined) throw new Error(`Missing parameter ${key}`);
    return value;
  }

  async execAsync(sql: string): Promise<void> {
    if (sql.includes("DELETE FROM mobile_outbox")) this.rows.clear();
  }

  async runAsync(sql: string, params: Record<string, string | number | null>) {
    if (sql.includes("INSERT INTO mobile_outbox")) {
      const id = String(params.$operation_id);
      if (this.rows.has(id)) throw new Error("UNIQUE constraint failed");
      this.rows.set(id, {
        schema_version: this.required(params, "$schema_version"),
        operation_id: id,
        project_id: this.required(params, "$project_id"),
        device_id: this.required(params, "$device_id"),
        base_revision: this.required(params, "$base_revision"),
        kind: this.required(params, "$kind"),
        created_at: this.required(params, "$created_at"),
        key_version: this.required(params, "$key_version"),
        request_digest: this.required(params, "$request_digest"),
        ciphertext_digest: this.required(params, "$ciphertext_digest"),
        ciphertext: this.required(params, "$ciphertext"),
        acknowledged_at: null,
      });
      return { changes: 1 };
    }
    if (sql.includes("UPDATE mobile_outbox")) {
      const row = this.rows.get(String(params.$operation_id));
      if (row && (row.acknowledged_at === null || row.acknowledged_at === params.$acknowledged_at)) {
        row.acknowledged_at = this.required(params, "$acknowledged_at");
        return { changes: 1 };
      }
      return { changes: 0 };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }

  async getFirstAsync<T>(_: string, params: Record<string, string | number | null>): Promise<T | null> {
    return (this.rows.get(String(params.$operation_id)) as T | undefined) ?? null;
  }

  async getAllAsync<T>(_: string, params: Record<string, string | number | null>): Promise<T[]> {
    return [...this.rows.values()]
      .filter((row) => row.project_id === params.$project_id && row.acknowledged_at === null)
      .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at))) as T[];
  }

  async withExclusiveTransactionAsync(task: (database: SQLiteDatabasePort) => Promise<void>) {
    await task(this);
  }
}

const ENVELOPE: OutboxEnvelope = {
  schemaVersion: 1,
  operationId: "operation-1",
  projectId: "project-mobile",
  deviceId: "device-ios",
  baseRevision: "revision-4",
  kind: "capture_note",
  createdAt: "2026-08-30T12:00:00.000Z",
  keyVersion: 4,
  requestDigest: "a".repeat(64),
  ciphertextDigest: "b".repeat(64),
  ciphertext: "sealed-ciphertext-only",
};

describe("SQLiteOutboxStore", () => {
  it("persists only encrypted envelopes across store instances and orders pending work", async () => {
    const database = new MemorySQLite();
    const first = new SQLiteOutboxStore({ open: async () => database });
    await first.put(ENVELOPE);

    const reopened = new SQLiteOutboxStore({ open: async () => database });
    expect(await reopened.get(ENVELOPE.operationId)).toEqual(ENVELOPE);
    expect(await reopened.pending(ENVELOPE.projectId)).toEqual([ENVELOPE]);
    expect(JSON.stringify([...database.rows.values()])).not.toContain("payload");
    expect(JSON.stringify([...database.rows.values()])).not.toContain("privateKey");
  });

  it("rejects duplicate mutation and makes acknowledgements idempotent but immutable", async () => {
    const database = new MemorySQLite();
    const store = new SQLiteOutboxStore({ open: async () => database });
    await store.put(ENVELOPE);
    await expect(store.put({ ...ENVELOPE, ciphertext: "changed" })).rejects.toThrow("already exists");

    await store.acknowledge(ENVELOPE.operationId, "2026-08-30T12:01:00.000Z");
    await store.acknowledge(ENVELOPE.operationId, "2026-08-30T12:01:00.000Z");
    await expect(store.acknowledge(
      ENVELOPE.operationId,
      "2026-08-30T12:02:00.000Z",
    )).rejects.toThrow("immutable");
    expect(await store.pending(ENVELOPE.projectId)).toEqual([]);
  });

  it("deletes every local ciphertext envelope during device removal", async () => {
    const database = new MemorySQLite();
    const store = new SQLiteOutboxStore({ open: async () => database });
    await store.put(ENVELOPE);
    await store.deleteAll();
    expect(database.rows.size).toBe(0);
  });
});
