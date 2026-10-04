export const OUTBOX_KINDS = [
  "capture_note",
  "dictated_passage",
  "story_memory_suggestion",
  "change_set_request",
  "thread_turn",
  "review_decision",
] as const;

export type OutboxKind = (typeof OUTBOX_KINDS)[number];

export type OutboxCommand = {
  operationId: string;
  projectId: string;
  deviceId: string;
  baseRevision: string;
  kind: OutboxKind;
  payload: Record<string, unknown>;
};

export type OutboxEnvelope = {
  schemaVersion: 1;
  operationId: string;
  projectId: string;
  deviceId: string;
  baseRevision: string;
  kind: OutboxKind;
  createdAt: string;
  keyVersion: number;
  requestDigest: string;
  ciphertextDigest: string;
  ciphertext: string;
  acknowledgedAt?: string;
};

export interface OutboxCipher {
  fingerprint(plaintext: string): Promise<string>;
  seal(plaintext: string, context: {
    projectId: string;
    deviceId: string;
    operationId: string;
    baseRevision: string;
    kind: OutboxKind;
  }): Promise<{
    ciphertext: string;
    ciphertextDigest: string;
    keyVersion: number;
  }>;
}

export interface OutboxStore {
  get(operationId: string): Promise<OutboxEnvelope | null>;
  put(envelope: OutboxEnvelope): Promise<void>;
  pending(projectId: string): Promise<OutboxEnvelope[]>;
  acknowledge(operationId: string, acknowledgedAt: string): Promise<void>;
}

export interface OutboxTransport {
  upload(envelope: OutboxEnvelope): Promise<{ acknowledgedAt: string }>;
}

function cloneEnvelope(envelope: OutboxEnvelope): OutboxEnvelope {
  return { ...envelope };
}

function requiredIdentifier(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
    throw new Error(`${name} is invalid.`);
  }
  return normalized;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]);
    return Object.fromEntries(entries);
  }
  if (
    value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return value;
  }
  throw new Error("Outbox payload must contain only JSON values.");
}

function canonicalPayload(command: OutboxCommand): string {
  const reserved = new Set([
    "schema_version",
    "project_id",
    "device_id",
    "operation_id",
    "base_revision",
    "kind",
  ]);
  for (const key of Object.keys(command.payload)) {
    if (reserved.has(key)) throw new Error(`Outbox payload uses reserved field '${key}'.`);
  }
  const payload = canonicalize(command.payload) as Record<string, unknown>;
  const value = JSON.stringify(canonicalize({
    base_revision: command.baseRevision,
    device_id: command.deviceId,
    kind: command.kind,
    operation_id: command.operationId,
    ...payload,
    project_id: command.projectId,
    schema_version: 1,
  }));
  if (value.length > 64 * 1024) throw new Error("Outbox payload exceeds 64 KiB.");
  return value;
}

export class InMemoryOutboxStore implements OutboxStore {
  readonly #envelopes = new Map<string, OutboxEnvelope>();

  async get(operationId: string): Promise<OutboxEnvelope | null> {
    const value = this.#envelopes.get(operationId);
    return value ? cloneEnvelope(value) : null;
  }

  async put(envelope: OutboxEnvelope): Promise<void> {
    if (this.#envelopes.has(envelope.operationId)) {
      throw new Error("Outbox operation already exists.");
    }
    this.#envelopes.set(envelope.operationId, cloneEnvelope(envelope));
  }

  async pending(projectId: string): Promise<OutboxEnvelope[]> {
    return [...this.#envelopes.values()]
      .filter((item) => item.projectId === projectId && !item.acknowledgedAt)
      .sort((left, right) => (
        left.createdAt.localeCompare(right.createdAt)
        || left.operationId.localeCompare(right.operationId)
      ))
      .map(cloneEnvelope);
  }

  async acknowledge(operationId: string, acknowledgedAt: string): Promise<void> {
    const existing = this.#envelopes.get(operationId);
    if (!existing) throw new Error("Unknown outbox operation.");
    if (existing.acknowledgedAt && existing.acknowledgedAt !== acknowledgedAt) {
      throw new Error("Outbox acknowledgement is immutable.");
    }
    this.#envelopes.set(operationId, { ...existing, acknowledgedAt });
  }
}

export class MobileOutbox {
  readonly #store: OutboxStore;
  readonly #cipher: OutboxCipher;
  readonly #transport: OutboxTransport;
  readonly #now: () => string;

  constructor(input: {
    store: OutboxStore;
    cipher: OutboxCipher;
    transport: OutboxTransport;
    now?: () => string;
  }) {
    this.#store = input.store;
    this.#cipher = input.cipher;
    this.#transport = input.transport;
    this.#now = input.now ?? (() => new Date().toISOString());
  }

  async enqueue(command: OutboxCommand): Promise<OutboxEnvelope> {
    const normalized: OutboxCommand = {
      ...command,
      operationId: requiredIdentifier(command.operationId, "operationId"),
      projectId: requiredIdentifier(command.projectId, "projectId"),
      deviceId: requiredIdentifier(command.deviceId, "deviceId"),
      baseRevision: requiredIdentifier(command.baseRevision, "baseRevision"),
    };
    if (!OUTBOX_KINDS.includes(normalized.kind)) throw new Error("Unsupported outbox kind.");
    const plaintext = canonicalPayload(normalized);
    const requestDigest = await this.#cipher.fingerprint(plaintext);
    const existing = await this.#store.get(normalized.operationId);
    if (existing) {
      if (existing.requestDigest !== requestDigest) {
        throw new Error("Outbox idempotency conflict.");
      }
      return existing;
    }
    const sealed = await this.#cipher.seal(plaintext, {
      projectId: normalized.projectId,
      deviceId: normalized.deviceId,
      operationId: normalized.operationId,
      baseRevision: normalized.baseRevision,
      kind: normalized.kind,
    });
    const envelope: OutboxEnvelope = {
      schemaVersion: 1,
      operationId: normalized.operationId,
      projectId: normalized.projectId,
      deviceId: normalized.deviceId,
      baseRevision: normalized.baseRevision,
      kind: normalized.kind,
      createdAt: this.#now(),
      keyVersion: sealed.keyVersion,
      requestDigest,
      ciphertextDigest: sealed.ciphertextDigest,
      ciphertext: sealed.ciphertext,
    };
    await this.#store.put(envelope);
    return cloneEnvelope(envelope);
  }

  async flush(projectId: string): Promise<{ uploaded: number; remaining: number }> {
    const pending = await this.#store.pending(projectId);
    let uploaded = 0;
    for (const envelope of pending) {
      const result = await this.#transport.upload(envelope);
      await this.#store.acknowledge(envelope.operationId, result.acknowledgedAt);
      uploaded += 1;
    }
    return {
      uploaded,
      remaining: (await this.#store.pending(projectId)).length,
    };
  }
}
