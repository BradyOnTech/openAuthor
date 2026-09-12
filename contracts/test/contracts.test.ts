import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ContractValidationError,
  MOBILE_SNAPSHOT_OBJECT_MAX_BYTES,
  parseAssistantTurn,
  parseContextPackProjection,
  parseContextPackReference,
  parseDeviceEnrollment,
  parseEncryptedSnapshotBlobMetadata,
  parseMobileSnapshotEnvelope,
  parseMobileSnapshotManifest,
  parseOutboxEnvelope,
  parseProjectKeyEnvelope,
  parseToolCall,
  parseToolOutcome,
  parseVoiceSession,
} from "../src/index.ts";

const FIXTURES = new URL("../fixtures/", import.meta.url);

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(name, FIXTURES), "utf8")) as Record<string, unknown>;
}

const cases = [
  ["context-pack-reference.v1.json", parseContextPackReference, "openauthor.context-pack.reference"],
  ["context-pack-projection.v1.json", parseContextPackProjection, "openauthor.context-pack.projection"],
  ["assistant-turn.v1.json", parseAssistantTurn, "openauthor.assistant.turn"],
  ["tool-call.v1.json", parseToolCall, "openauthor.assistant.tool-call"],
  ["tool-outcome.v1.json", parseToolOutcome, "openauthor.assistant.tool-outcome"],
  ["voice-session.v1.json", parseVoiceSession, "openauthor.voice.session"],
  ["mobile-snapshot-manifest.v1.json", parseMobileSnapshotManifest, "openauthor.mobile.snapshot.manifest"],
  ["encrypted-snapshot-blob-metadata.v1.json", parseEncryptedSnapshotBlobMetadata, "openauthor.mobile.snapshot.blob"],
  ["mobile-snapshot-envelope.v1.json", parseMobileSnapshotEnvelope, "openauthor.mobile.snapshot.envelope"],
  ["device-enrollment.v1.json", parseDeviceEnrollment, "openauthor.mobile.device-enrollment"],
  ["outbox-envelope.v1.json", parseOutboxEnvelope, "openauthor.mobile.outbox-envelope"],
  ["project-key-envelope.v1.json", parseProjectKeyEnvelope, "openauthor.mobile.project-key-envelope"],
] as const;

test("every v1 fiction fixture parses through its public contract seam", () => {
  for (const [name, parse, schema] of cases) {
    const parsed = parse(fixture(name));
    assert.equal(parsed.schema, schema, name);
    assert.equal(parsed.schema_version, 1, name);
  }
});

test("browser companion enrollment uses an explicit platform, not a native impersonation", () => {
  const raw = fixture("device-enrollment.v1.json");
  assert.equal(parseDeviceEnrollment({ ...raw, platform: "web" }).platform, "web");
  assert.throws(() => parseDeviceEnrollment({ ...raw, platform: "unknown" }), ContractValidationError);
});

test("snapshot manifest preserves the existing Python v1 producer shape", () => {
  const parsed = parseMobileSnapshotManifest(fixture("mobile-snapshot-manifest.v1.json"));
  assert.deepEqual(Object.keys(parsed).sort(), [
    "byte_length",
    "content_sha256",
    "project_id",
    "revision",
    "schema",
    "schema_version",
  ]);
});

test("outbox envelope carries the desktop importer identity and supported fiction actions", () => {
  const raw = fixture("outbox-envelope.v1.json");
  const supportedKinds = [
    "capture_note",
    "change_set_request",
    "dictated_passage",
    "review_decision",
    "story_memory_suggestion",
    "thread_turn",
  ] as const;
  for (const kind of supportedKinds) {
    const parsed = parseOutboxEnvelope({...raw, kind});
    assert.equal(parsed.operation_id, "operation_mara_note_0042");
    assert.equal(parsed.kind, kind);
  }
});

test("every parser rejects unknown top-level fields", () => {
  for (const [name, parse] of cases) {
    assert.throws(
      () => parse({...fixture(name), unexpected_private_field: "do not accept me"}),
      ContractValidationError,
      name,
    );
  }
});

test("parsers reject unsupported schema versions", () => {
  for (const [name, parse] of cases) {
    assert.throws(() => parse({...fixture(name), schema_version: 2}), ContractValidationError, name);
  }
});

test("hosted snapshot metadata rejects plaintext and credential fields", () => {
  const manifest = fixture("mobile-snapshot-manifest.v1.json");
  const blob = fixture("encrypted-snapshot-blob-metadata.v1.json");
  const envelope = fixture("mobile-snapshot-envelope.v1.json");

  assert.throws(() => parseMobileSnapshotManifest({...manifest, manuscript_text: "The bell rang."}), ContractValidationError);
  assert.throws(() => parseEncryptedSnapshotBlobMetadata({...blob, api_key: "sk-fiction"}), ContractValidationError);
  assert.throws(() => parseMobileSnapshotEnvelope({...envelope, prompt: "Reveal the harbor."}), ContractValidationError);
});

test("outbox hosted envelope rejects plaintext payloads and is deeply immutable", () => {
  const raw = fixture("outbox-envelope.v1.json");
  assert.throws(
    () => parseOutboxEnvelope({...raw, payload: {...(raw.payload as object), plaintext: "Meet at the lighthouse."}}),
    ContractValidationError,
  );

  const parsed = parseOutboxEnvelope(raw);
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.payload), true);
  assert.throws(() => {
    (parsed as {kind: string}).kind = "capture";
  }, TypeError);
});

test("snapshot envelope rejects mixed project, revision, snapshot, and device identities", () => {
  const raw = fixture("mobile-snapshot-envelope.v1.json");
  const manifest = raw.manifest as Record<string, unknown>;
  const blob = raw.blob as Record<string, unknown>;
  const mutations = [
    {...raw, manifest: {...manifest, project_id: "project_other"}},
    {...raw, manifest: {...manifest, revision: "rev_other"}},
    {...raw, blob: {...blob, snapshot_id: "snapshot_other"}},
  ];
  for (const mutated of mutations) {
    assert.throws(() => parseMobileSnapshotEnvelope(mutated), ContractValidationError);
  }
});

test("Assistant and voice contracts reject context references from another project revision", () => {
  for (const [name, parse] of [
    ["assistant-turn.v1.json", parseAssistantTurn],
    ["voice-session.v1.json", parseVoiceSession],
  ] as const) {
    const raw = fixture(name);
    const contextPack = raw.context_pack as Record<string, unknown>;
    assert.throws(
      () => parse({...raw, context_pack: {...contextPack, project_revision: "rev_stale"}}),
      ContractValidationError,
    );
  }
});

test("context projection rejects local paths and stale item revisions", () => {
  const raw = fixture("context-pack-projection.v1.json");
  const [item] = raw.items as Record<string, unknown>[];
  assert.ok(item);
  assert.throws(
    () => parseContextPackProjection({...raw, items: [{...item, source_path: "/Users/mara/novel.md"}]}),
    ContractValidationError,
  );
  assert.throws(
    () => parseContextPackProjection({...raw, items: [{...item, source_revision: "rev_stale"}]}),
    ContractValidationError,
  );
});

test("digest, identifier, timestamp, and encrypted byte metadata are strict", () => {
  const reference = fixture("context-pack-reference.v1.json");
  assert.throws(() => parseContextPackReference({...reference, content_sha256: "sha256:not-a-digest"}), ContractValidationError);
  assert.throws(() => parseContextPackReference({...reference, project_id: "../other-project"}), ContractValidationError);

  const enrollment = fixture("device-enrollment.v1.json");
  assert.throws(() => parseDeviceEnrollment({...enrollment, enrolled_at: "yesterday"}), ContractValidationError);
  assert.throws(
    () => parseDeviceEnrollment({
      ...enrollment,
      public_key: {...(enrollment.public_key as object), value: "AQEBAQEBAQEBAQEB"},
    }),
    ContractValidationError,
  );

  const blob = fixture("encrypted-snapshot-blob-metadata.v1.json");
  assert.throws(() => parseEncryptedSnapshotBlobMetadata({...blob, ciphertext_byte_length: 0}), ContractValidationError);
  assert.equal(
    parseEncryptedSnapshotBlobMetadata({
      ...blob,
      ciphertext_byte_length: MOBILE_SNAPSHOT_OBJECT_MAX_BYTES,
    }).ciphertext_byte_length,
    MOBILE_SNAPSHOT_OBJECT_MAX_BYTES,
  );
  assert.throws(
    () => parseEncryptedSnapshotBlobMetadata({
      ...blob,
      ciphertext_byte_length: MOBILE_SNAPSHOT_OBJECT_MAX_BYTES + 1,
    }),
    ContractValidationError,
  );
});

test("tool outcomes enforce success and failure payload semantics", () => {
  const succeeded = fixture("tool-outcome.v1.json");
  assert.throws(() => parseToolOutcome({...succeeded, result: undefined}), ContractValidationError);
  assert.throws(
    () => parseToolOutcome({...succeeded, status: "failed", result: undefined, result_sha256: undefined}),
    ContractValidationError,
  );

  const failed: Record<string, unknown> = {...succeeded, status: "failed"};
  delete failed.result;
  delete failed.result_sha256;
  failed.error = {code: "scene_not_found", message: "The referenced scene was not found.", retryable: false};
  assert.equal(parseToolOutcome(failed).status, "failed");
});

test("device enrollment accepts public key material but rejects private key material", () => {
  const raw = fixture("device-enrollment.v1.json");
  const publicKey = raw.public_key as Record<string, unknown>;
  assert.throws(
    () => parseDeviceEnrollment({...raw, public_key: {...publicKey, private_key: "fiction-private-key"}}),
    ContractValidationError,
  );
});

test("project keys use one complete libsodium sealed box with no external nonce", () => {
  const raw = fixture("project-key-envelope.v1.json");
  const parsed = parseProjectKeyEnvelope(raw);
  assert.equal(parsed.algorithm, "x25519-xsalsa20-poly1305-sealedbox-v1");
  assert.equal(parsed.sealed_project_key_byte_length, 80);
  assert.throws(
    () => parseProjectKeyEnvelope({...raw, nonce: "AQEBAQEBAQEBAQEB"}),
    ContractValidationError,
  );
  assert.throws(
    () => parseProjectKeyEnvelope({...raw, sealed_project_key: "AQEBAQEBAQEBAQEB"}),
    ContractValidationError,
  );
});

test("snapshot and outbox ciphertext bind to a versioned AES-256 project key", () => {
  const snapshot = parseEncryptedSnapshotBlobMetadata(
    fixture("encrypted-snapshot-blob-metadata.v1.json"),
  );
  const outbox = parseOutboxEnvelope(fixture("outbox-envelope.v1.json"));
  assert.deepEqual(
    [snapshot.encryption.algorithm, snapshot.encryption.project_key_version, snapshot.encryption.aad_version],
    ["aes-256-gcm-v1", 4, 1],
  );
  assert.deepEqual(
    [outbox.payload.algorithm, outbox.payload.project_key_version, outbox.payload.aad_version],
    ["aes-256-gcm-v1", 4, 1],
  );
});

test("encrypted snapshot metadata matches the desktop Storage upload wire model", () => {
  const parsed = parseEncryptedSnapshotBlobMetadata({
    schema: "openauthor.mobile.snapshot.blob",
    schema_version: 1,
    snapshot_id: "60000000-0000-4000-8000-000000000001",
    project_id: "30000000-0000-4000-8000-000000000001",
    project_revision: "revision-0004",
    object_bucket: "mobile-encrypted-sync",
    object_key: "projects/30000000-0000-4000-8000-000000000001/snapshots/60000000-0000-4000-8000-000000000001.bin",
    content_type: "text/plain;charset=utf-8",
    encryption: {
      algorithm: "aes-256-gcm-v1",
      project_key_version: 4,
      aad_version: 1,
    },
    ciphertext_sha256: "8".repeat(64),
    ciphertext_byte_length: 48_208,
  });

  assert.equal(parsed.ciphertext_sha256, "8".repeat(64));
  assert.equal(parsed.ciphertext_byte_length, 48_208);
});

test("outbox envelope matches the mobile upload and desktop pull wire model", () => {
  const nonce = Buffer.alloc(12, 1);
  const combinedCiphertext = Buffer.concat([nonce, Buffer.alloc(17, 2)]).toString("base64");
  const parsed = parseOutboxEnvelope({
    schema: "openauthor.mobile.outbox-envelope",
    schema_version: 1,
    project_id: "30000000-0000-4000-8000-000000000001",
    device_id: "40000000-0000-4000-8000-000000000001",
    operation_id: "70000000-0000-4000-8000-000000000001",
    base_revision: "revision-0004",
    kind: "capture_note",
    created_at: "2026-08-30T15:05:00.000Z",
    payload: {
      algorithm: "aes-256-gcm-v1",
      project_key_version: 4,
      nonce: nonce.toString("base64"),
      aad_version: 1,
      ciphertext: combinedCiphertext,
      ciphertext_sha256: "c".repeat(64),
      ciphertext_byte_length: Buffer.byteLength(combinedCiphertext, "utf8"),
    },
  });

  assert.equal(parsed.payload.ciphertext, combinedCiphertext);
  assert.equal(parsed.payload.ciphertext_byte_length, combinedCiphertext.length);
});

test("outbox envelope rejects non-canonical combined ciphertext framing", () => {
  const raw = fixture("outbox-envelope.v1.json");
  const payload = raw.payload as Record<string, unknown>;
  const ciphertext = payload.ciphertext as string;
  const nonCanonicalPadBits = `${ciphertext.slice(0, -2)}J=`;

  assert.throws(
    () => parseOutboxEnvelope({
      ...raw,
      payload: {...payload, ciphertext: nonCanonicalPadBits},
    }),
    ContractValidationError,
  );
});
