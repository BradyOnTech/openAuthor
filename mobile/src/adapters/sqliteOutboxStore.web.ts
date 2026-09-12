import { OUTBOX_KINDS, type OutboxEnvelope, type OutboxStore } from "../core/outbox";
import { browserStorage, type BrowserStorage } from "./browserStorage";

// Keep the platform-specific interface identical; no SQLite or plaintext draft
// is included in the web bundle. The outbox is encrypted before this adapter.
export class SQLiteOutboxStore implements OutboxStore {
  constructor(private readonly storage: BrowserStorage = browserStorage) {}
  get(operationId: string): Promise<OutboxEnvelope | null> {
    return this.storage.transaction("outbox", "readonly", (store, done) => {
      const read = store.get(operationId);
      read.onsuccess = () => done(read.result ?? null);
    });
  }
  async put(envelope: OutboxEnvelope): Promise<void> {
    if (envelope.schemaVersion !== 1 || !OUTBOX_KINDS.includes(envelope.kind)
      || !/^[0-9a-f]{64}$/.test(envelope.requestDigest) || !/^[0-9a-f]{64}$/.test(envelope.ciphertextDigest)
      || !envelope.ciphertext || envelope.acknowledgedAt !== undefined) throw new Error("Only pending ciphertext envelopes can be persisted.");
    await this.storage.transaction<void>("outbox", "readwrite", (store) => { store.add(envelope, envelope.operationId); });
  }
  pending(projectId: string): Promise<OutboxEnvelope[]> {
    return this.storage.transaction("outbox", "readonly", (store, done) => {
      const read = store.getAll();
      read.onsuccess = () => done((read.result as OutboxEnvelope[])
        .filter((item) => item.projectId === projectId && !item.acknowledgedAt)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.operationId.localeCompare(b.operationId)));
    });
  }
  async acknowledge(operationId: string, acknowledgedAt: string): Promise<void> {
    if (!acknowledgedAt.trim() || acknowledgedAt.length > 64) throw new Error("Outbox acknowledgement time is invalid.");
    await this.storage.transaction<void>("outbox", "readwrite", (store) => {
      const read = store.get(operationId);
      read.onsuccess = () => {
        const value = read.result as OutboxEnvelope | undefined;
        if (!value || (value.acknowledgedAt && value.acknowledgedAt !== acknowledgedAt)) { store.transaction.abort(); return; }
        store.put({ ...value, acknowledgedAt }, operationId);
      };
    });
  }
  async deleteAll(): Promise<void> { await this.storage.transaction<void>("outbox", "readwrite", (store) => { store.clear(); }); }
}
