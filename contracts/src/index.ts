import {Ajv2020, type ErrorObject, type ValidateFunction} from "ajv/dist/2020.js";

import assistantTurnSchema from "../schemas/assistant-turn.v1.schema.json" with {type: "json"};
import commonSchema from "../schemas/common.v1.schema.json" with {type: "json"};
import contextPackProjectionSchema from "../schemas/context-pack-projection.v1.schema.json" with {type: "json"};
import contextPackReferenceSchema from "../schemas/context-pack-reference.v1.schema.json" with {type: "json"};
import deviceEnrollmentSchema from "../schemas/device-enrollment.v1.schema.json" with {type: "json"};
import encryptedSnapshotBlobMetadataSchema from "../schemas/encrypted-snapshot-blob-metadata.v1.schema.json" with {type: "json"};
import mobileSnapshotEnvelopeSchema from "../schemas/mobile-snapshot-envelope.v1.schema.json" with {type: "json"};
import mobileSnapshotManifestSchema from "../schemas/mobile-snapshot-manifest.v1.schema.json" with {type: "json"};
import outboxEnvelopeSchema from "../schemas/outbox-envelope.v1.schema.json" with {type: "json"};
import projectKeyEnvelopeSchema from "../schemas/project-key-envelope.v1.schema.json" with {type: "json"};
import toolCallSchema from "../schemas/tool-call.v1.schema.json" with {type: "json"};
import toolOutcomeSchema from "../schemas/tool-outcome.v1.schema.json" with {type: "json"};
import voiceSessionSchema from "../schemas/voice-session.v1.schema.json" with {type: "json"};

import type {
  AssistantTurn,
  ContextPackProjection,
  ContextPackReference,
  DeviceEnrollment,
  EncryptedSnapshotBlobMetadata,
  JsonValue,
  MobileSnapshotEnvelope,
  MobileSnapshotManifest,
  OutboxEnvelope,
  ProjectKeyEnvelope,
  ToolCall,
  ToolOutcome,
  VoiceSession,
} from "./types.ts";

export type * from "./types.ts";

/** Maximum UTF-8 byte length of the base64 ciphertext object stored in Supabase Storage. */
export const MOBILE_SNAPSHOT_OBJECT_MAX_BYTES = 64 * 1024 * 1024;

export interface ContractValidationIssue {
  readonly path: string;
  readonly keyword: string;
  readonly message: string;
}

export class ContractValidationError extends TypeError {
  readonly contract: string;
  readonly issues: readonly ContractValidationIssue[];

  constructor(contract: string, issues: readonly ContractValidationIssue[]) {
    super(`${contract} validation failed.`);
    this.name = "ContractValidationError";
    this.contract = contract;
    this.issues = Object.freeze([...issues]);
  }
}

export const CONTRACT_SCHEMAS = Object.freeze({
  assistantTurn: assistantTurnSchema,
  common: commonSchema,
  contextPackProjection: contextPackProjectionSchema,
  contextPackReference: contextPackReferenceSchema,
  deviceEnrollment: deviceEnrollmentSchema,
  encryptedSnapshotBlobMetadata: encryptedSnapshotBlobMetadataSchema,
  mobileSnapshotEnvelope: mobileSnapshotEnvelopeSchema,
  mobileSnapshotManifest: mobileSnapshotManifestSchema,
  outboxEnvelope: outboxEnvelopeSchema,
  projectKeyEnvelope: projectKeyEnvelopeSchema,
  toolCall: toolCallSchema,
  toolOutcome: toolOutcomeSchema,
  voiceSession: voiceSessionSchema,
});

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: true,
});
ajv.addFormat("date-time", {
  type: "string",
  validate(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
      && Number.isFinite(Date.parse(value));
  },
});

for (const schema of [
  commonSchema,
  contextPackReferenceSchema,
  contextPackProjectionSchema,
  assistantTurnSchema,
  toolCallSchema,
  toolOutcomeSchema,
  voiceSessionSchema,
  mobileSnapshotManifestSchema,
  encryptedSnapshotBlobMetadataSchema,
  mobileSnapshotEnvelopeSchema,
  deviceEnrollmentSchema,
  outboxEnvelopeSchema,
  projectKeyEnvelopeSchema,
]) {
  ajv.addSchema(schema);
}

const validators = {
  assistantTurn: ajv.getSchema("https://openauthor.dev/contracts/assistant-turn/v1"),
  contextPackProjection: ajv.getSchema("https://openauthor.dev/contracts/context-pack-projection/v1"),
  contextPackReference: ajv.getSchema("https://openauthor.dev/contracts/context-pack-reference/v1"),
  deviceEnrollment: ajv.getSchema("https://openauthor.dev/contracts/device-enrollment/v1"),
  encryptedSnapshotBlobMetadata: ajv.getSchema("https://openauthor.dev/contracts/encrypted-snapshot-blob-metadata/v1"),
  mobileSnapshotEnvelope: ajv.getSchema("https://openauthor.dev/contracts/mobile-snapshot-envelope/v1"),
  mobileSnapshotManifest: ajv.getSchema("https://openauthor.dev/contracts/mobile-snapshot-manifest/v1"),
  outboxEnvelope: ajv.getSchema("https://openauthor.dev/contracts/outbox-envelope/v1"),
  projectKeyEnvelope: ajv.getSchema("https://openauthor.dev/contracts/project-key-envelope/v1"),
  toolCall: ajv.getSchema("https://openauthor.dev/contracts/tool-call/v1"),
  toolOutcome: ajv.getSchema("https://openauthor.dev/contracts/tool-outcome/v1"),
  voiceSession: ajv.getSchema("https://openauthor.dev/contracts/voice-session/v1"),
} as const;

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 100_000;
const MAX_STRING_CODE_UNITS = 8_400_000;
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

interface CloneState {
  readonly ancestors: WeakSet<object>;
  nodes: number;
  stringCodeUnits: number;
}

function invalidJson(message: string, path = ""): never {
  throw new ContractValidationError("JSON input", [
    Object.freeze({path, keyword: "json", message}),
  ]);
}

function cloneJson(value: unknown, state: CloneState, path: string, depth: number): JsonValue {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES) {
    return invalidJson(`exceeds ${MAX_JSON_NODES} JSON nodes`, path);
  }
  if (depth > MAX_JSON_DEPTH) {
    return invalidJson(`exceeds maximum JSON depth ${MAX_JSON_DEPTH}`, path);
  }
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    state.stringCodeUnits += value.length;
    if (state.stringCodeUnits > MAX_STRING_CODE_UNITS) {
      return invalidJson("contains too much string data", path);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return invalidJson("contains a non-finite number", path);
    }
    return value;
  }
  if (typeof value !== "object") {
    return invalidJson(`contains unsupported ${typeof value} data`, path);
  }
  if (state.ancestors.has(value)) {
    return invalidJson("contains a cyclic reference", path);
  }
  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item, index) => cloneJson(item, state, `${path}/${index}`, depth + 1));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalidJson("contains a non-plain object", path);
    }
    const clone: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const key of Object.keys(value)) {
      if (UNSAFE_KEYS.has(key)) {
        return invalidJson(`contains unsafe object key '${key}'`, path);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) {
        return invalidJson("contains an accessor property", `${path}/${key}`);
      }
      clone[key] = cloneJson(descriptor.value, state, `${path}/${key}`, depth + 1);
    }
    return clone;
  } finally {
    state.ancestors.delete(value);
  }
}

function normalizedJson(value: unknown): JsonValue {
  return cloneJson(value, {
    ancestors: new WeakSet<object>(),
    nodes: 0,
    stringCodeUnits: 0,
  }, "", 0);
}

function issue(error: ErrorObject): ContractValidationIssue {
  return Object.freeze({
    path: error.instancePath,
    keyword: error.keyword,
    message: error.message ?? "is invalid",
  });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

function requireValidator(validator: ValidateFunction | undefined, contract: string): ValidateFunction {
  if (validator === undefined) {
    throw new Error(`Contract validator '${contract}' is not registered.`);
  }
  return validator;
}

function parseWith<T>(contract: string, validator: ValidateFunction | undefined, input: unknown): T {
  const candidate = normalizedJson(input);
  const validate = requireValidator(validator, contract);
  if (!validate(candidate)) {
    throw new ContractValidationError(contract, (validate.errors ?? []).map(issue));
  }
  return deepFreeze(candidate as T);
}

function semanticError(contract: string, path: string, message: string): never {
  throw new ContractValidationError(contract, [
    Object.freeze({path, keyword: "identity", message}),
  ]);
}

function requireBase64urlBytes(
  contract: string,
  path: string,
  value: string,
  expectedBytes: number,
): void {
  if (value.length % 4 === 1 || Math.floor(value.length * 6 / 8) !== expectedBytes) {
    semanticError(contract, path, `must encode exactly ${expectedBytes} bytes`);
  }
}

function requireBase64Bytes(
  contract: string,
  path: string,
  value: string,
  expectedBytes: number,
): void {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  if ((value.length * 3 / 4) - padding !== expectedBytes) {
    semanticError(contract, path, `must encode exactly ${expectedBytes} bytes`);
  }
}

function requireCanonicalBase64(contract: string, path: string, value: string): void {
  const paddedByTwo = value.endsWith("==");
  const paddedByOne = !paddedByTwo && value.endsWith("=");
  const terminalIndex = paddedByTwo ? value.length - 3 : value.length - 2;
  if (!paddedByTwo && !paddedByOne) return;
  const terminalValue = BASE64_ALPHABET.indexOf(value[terminalIndex] ?? "");
  if (
    terminalValue < 0
    || paddedByTwo && (terminalValue & 0x0f) !== 0
    || paddedByOne && (terminalValue & 0x03) !== 0
  ) {
    semanticError(contract, path, "must use canonical RFC 4648 base64 padding bits");
  }
}

function requireContextIdentity(
  contract: string,
  projectId: string,
  projectRevision: string,
  reference: ContextPackReference,
): void {
  if (reference.project_id !== projectId) {
    semanticError(contract, "/context_pack/project_id", "must match the parent project_id");
  }
  if (reference.project_revision !== projectRevision) {
    semanticError(contract, "/context_pack/project_revision", "must match the parent project_revision");
  }
}

export function parseContextPackReference(input: unknown): ContextPackReference {
  return parseWith("Context Pack Reference v1", validators.contextPackReference, input);
}

export function parseContextPackProjection(input: unknown): ContextPackProjection {
  const parsed = parseWith<ContextPackProjection>(
    "Context Pack Projection v1",
    validators.contextPackProjection,
    input,
  );
  for (const [index, item] of parsed.items.entries()) {
    if (item.source_revision !== parsed.project_revision) {
      semanticError(
        "Context Pack Projection v1",
        `/items/${index}/source_revision`,
        "must match project_revision",
      );
    }
  }
  return parsed;
}

export function parseAssistantTurn(input: unknown): AssistantTurn {
  const parsed = parseWith<AssistantTurn>("Assistant Turn v1", validators.assistantTurn, input);
  if (parsed.context_pack !== undefined) {
    requireContextIdentity("Assistant Turn v1", parsed.project_id, parsed.project_revision, parsed.context_pack);
  }
  if (["completed", "failed", "interrupted", "superseded"].includes(parsed.status) && parsed.completed_at === undefined) {
    semanticError("Assistant Turn v1", "/completed_at", "is required for a terminal turn");
  }
  if (parsed.status === "failed" && parsed.error === undefined) {
    semanticError("Assistant Turn v1", "/error", "is required for a failed turn");
  }
  if (parsed.status === "superseded" && parsed.superseded_by === undefined) {
    semanticError("Assistant Turn v1", "/superseded_by", "is required for a superseded turn");
  }
  return parsed;
}

export function parseToolCall(input: unknown): ToolCall {
  return parseWith("Tool Call v1", validators.toolCall, input);
}

export function parseToolOutcome(input: unknown): ToolOutcome {
  return parseWith("Tool Outcome v1", validators.toolOutcome, input);
}

export function parseVoiceSession(input: unknown): VoiceSession {
  const parsed = parseWith<VoiceSession>("Voice Session v1", validators.voiceSession, input);
  requireContextIdentity("Voice Session v1", parsed.project_id, parsed.project_revision, parsed.context_pack);
  if (parsed.state === "ended" && parsed.ended_at === undefined) {
    semanticError("Voice Session v1", "/ended_at", "is required when state is ended");
  }
  if (parsed.state !== "ended" && parsed.ended_at !== undefined) {
    semanticError("Voice Session v1", "/ended_at", "is only allowed when state is ended");
  }
  return parsed;
}

export function parseMobileSnapshotManifest(input: unknown): MobileSnapshotManifest {
  return parseWith("Mobile Snapshot Manifest v1", validators.mobileSnapshotManifest, input);
}

export function parseEncryptedSnapshotBlobMetadata(input: unknown): EncryptedSnapshotBlobMetadata {
  const parsed = parseWith<EncryptedSnapshotBlobMetadata>(
    "Encrypted Snapshot Blob Metadata v1",
    validators.encryptedSnapshotBlobMetadata,
    input,
  );
  const expectedObjectKey = `projects/${parsed.project_id}/snapshots/${parsed.snapshot_id}.bin`;
  if (parsed.object_key !== expectedObjectKey) {
    semanticError(
      "Encrypted Snapshot Blob Metadata v1",
      "/object_key",
      "must match the project and snapshot identity",
    );
  }
  return parsed;
}

export function parseMobileSnapshotEnvelope(input: unknown): MobileSnapshotEnvelope {
  const parsed = parseWith<MobileSnapshotEnvelope>(
    "Mobile Snapshot Envelope v1",
    validators.mobileSnapshotEnvelope,
    input,
  );
  const identities = [
    ["/manifest/project_id", parsed.manifest.project_id, parsed.project_id],
    ["/manifest/revision", parsed.manifest.revision, parsed.project_revision],
    ["/blob/project_id", parsed.blob.project_id, parsed.project_id],
    ["/blob/project_revision", parsed.blob.project_revision, parsed.project_revision],
    ["/blob/snapshot_id", parsed.blob.snapshot_id, parsed.snapshot_id],
  ] as const;
  for (const [path, actual, expected] of identities) {
    if (actual !== expected) {
      semanticError("Mobile Snapshot Envelope v1", path, "must match the envelope identity");
    }
  }
  return parsed;
}

export function parseDeviceEnrollment(input: unknown): DeviceEnrollment {
  const parsed = parseWith<DeviceEnrollment>("Device Enrollment v1", validators.deviceEnrollment, input);
  requireBase64urlBytes(
    "Device Enrollment v1",
    "/public_key/value",
    parsed.public_key.value,
    parsed.public_key.byte_length,
  );
  if (parsed.status === "revoked" && parsed.revoked_at === undefined) {
    semanticError("Device Enrollment v1", "/revoked_at", "is required for a revoked enrollment");
  }
  if (parsed.status !== "revoked" && parsed.revoked_at !== undefined) {
    semanticError("Device Enrollment v1", "/revoked_at", "is only allowed for a revoked enrollment");
  }
  return parsed;
}

export function parseOutboxEnvelope(input: unknown): OutboxEnvelope {
  const parsed = parseWith<OutboxEnvelope>(
    "Immutable Outbox Envelope v1",
    validators.outboxEnvelope,
    input,
  );
  requireBase64Bytes(
    "Immutable Outbox Envelope v1",
    "/payload/nonce",
    parsed.payload.nonce,
    12,
  );
  const ciphertext = parsed.payload.ciphertext;
  requireCanonicalBase64(
    "Immutable Outbox Envelope v1",
    "/payload/ciphertext",
    ciphertext,
  );
  const padding = ciphertext.endsWith("==") ? 2 : ciphertext.endsWith("=") ? 1 : 0;
  const decodedByteLength = (ciphertext.length * 3 / 4) - padding;
  if (ciphertext.length !== parsed.payload.ciphertext_byte_length) {
    semanticError(
      "Immutable Outbox Envelope v1",
      "/payload/ciphertext_byte_length",
      "must equal the UTF-8 byte length of the base64 ciphertext",
    );
  }
  if (decodedByteLength < 29) {
    semanticError(
      "Immutable Outbox Envelope v1",
      "/payload/ciphertext",
      "must contain a 12-byte nonce and AES-GCM ciphertext with tag",
    );
  }
  if (!ciphertext.startsWith(parsed.payload.nonce)) {
    semanticError(
      "Immutable Outbox Envelope v1",
      "/payload/ciphertext",
      "must begin with the declared nonce",
    );
  }
  return parsed;
}

export function parseProjectKeyEnvelope(input: unknown): ProjectKeyEnvelope {
  const parsed = parseWith<ProjectKeyEnvelope>(
    "Sealed Project Key Envelope v1",
    validators.projectKeyEnvelope,
    input,
  );
  requireBase64urlBytes(
    "Sealed Project Key Envelope v1",
    "/sealed_project_key",
    parsed.sealed_project_key,
    parsed.sealed_project_key_byte_length,
  );
  return parsed;
}
