import { OUTBOX_KINDS, type OutboxEnvelope, type OutboxKind, type OutboxStore } from "./outbox";

export interface OutboxReadCipher {
  fingerprint(value: string): Promise<string>;
  open(envelope: OutboxEnvelope): Promise<string>;
}

export type OutboxReviewItem = {
  operationId: string;
  kind: OutboxKind | "unreadable_item";
  summary: string;
  createdAt: string;
  status: "local";
  unreadable: boolean;
};

function requiredText(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Capture text is missing.");
  return value.trim();
}

function summary(kind: OutboxKind, payload: Record<string, unknown>): string {
  if (kind === "change_set_request") return requiredText(payload.instruction);
  if (kind === "thread_turn") {
    if (payload.role !== "user" && payload.role !== "assistant") throw new Error("Conversation role is invalid.");
    return `${payload.role === "user" ? "You" : "Copilot"}: ${requiredText(payload.content)}`;
  }
  if (kind === "review_decision") {
    if (!["accepted", "rejected", "deferred"].includes(String(payload.decision))) throw new Error("Review decision is invalid.");
    if (payload.target_kind !== "proposal" && payload.target_kind !== "story_memory_suggestion") throw new Error("Review target is invalid.");
    return `${payload.decision}: ${payload.target_kind.replaceAll("_", " ")} ${requiredText(payload.target_id)}`;
  }
  return requiredText(payload.content);
}

async function readSummary(envelope: OutboxEnvelope, cipher: OutboxReadCipher): Promise<string> {
  if (envelope.schemaVersion !== 1 || !OUTBOX_KINDS.includes(envelope.kind)
    || !Number.isSafeInteger(envelope.keyVersion) || envelope.keyVersion < 1
    || !/^[0-9a-f]{64}$/.test(envelope.ciphertextDigest) || !/^[0-9a-f]{64}$/.test(envelope.requestDigest)
    || typeof envelope.ciphertext !== "string" || envelope.ciphertext.length > 350_000
    || await cipher.fingerprint(envelope.ciphertext) !== envelope.ciphertextDigest) {
    throw new Error("Capture envelope is invalid.");
  }
  const plaintext = await cipher.open(envelope);
  if (plaintext.length > 64 * 1024 || await cipher.fingerprint(plaintext) !== envelope.requestDigest) {
    throw new Error("Capture contents could not be verified.");
  }
  const payload: unknown = JSON.parse(plaintext);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Capture payload is invalid.");
  const value = payload as Record<string, unknown>;
  if (value.schema_version !== envelope.schemaVersion || value.project_id !== envelope.projectId
    || value.device_id !== envelope.deviceId || value.operation_id !== envelope.operationId
    || value.base_revision !== envelope.baseRevision || value.kind !== envelope.kind) {
    throw new Error("Capture identity does not match.");
  }
  return summary(envelope.kind, value);
}

/** Decrypt only for display. Never persist a plaintext preview or discard unreadable work. */
export async function readPendingOutbox(input: {
  projectId: string;
  deviceId: string;
  store: Pick<OutboxStore, "pending">;
  cipherForKeyVersion(version: number): Promise<OutboxReadCipher>;
}): Promise<OutboxReviewItem[]> {
  const ciphers = new Map<number, Promise<OutboxReadCipher>>();
  const result: OutboxReviewItem[] = [];
  for (const envelope of await input.store.pending(input.projectId)) {
    // Identity selection precedes key access, including with a faulty store.
    if (envelope.projectId !== input.projectId || envelope.deviceId !== input.deviceId || envelope.acknowledgedAt) continue;
    let text = "This saved item could not be read. Its encrypted copy is still on this device. Check the book key or retry; nothing was deleted.";
    let unreadable = true;
    try {
      if (!Number.isSafeInteger(envelope.keyVersion) || envelope.keyVersion < 1) throw new Error("Invalid key version.");
      let cipher = ciphers.get(envelope.keyVersion);
      if (!cipher) {
        cipher = input.cipherForKeyVersion(envelope.keyVersion);
        ciphers.set(envelope.keyVersion, cipher);
      }
      text = await readSummary(envelope, await cipher);
      unreadable = false;
    } catch {
      // Crypto, key-storage and JSON errors can include private input. Do not
      // surface them, and let other healthy items remain usable.
    }
    result.push({
      operationId: envelope.operationId,
      kind: OUTBOX_KINDS.includes(envelope.kind) ? envelope.kind : "unreadable_item",
      summary: text,
      createdAt: Number.isFinite(Date.parse(envelope.createdAt)) ? envelope.createdAt : "",
      status: "local",
      unreadable,
    });
  }
  return result;
}
