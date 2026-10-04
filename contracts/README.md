# `@openauthor/contracts`

Versioned JSON contracts shared by the openAuthor desktop runtime, hosted
services, and mobile clients. The package exposes TypeScript types, strict
runtime parsers, and the corresponding JSON Schemas from `src/index.ts`.

## Mobile dependency

Add the local package to the mobile application's `package.json`:

```json
{
  "dependencies": {
    "@openauthor/contracts": "file:../contracts"
  }
}
```

Parse untrusted transport or persisted data before using it:

```ts
import {
  ContractValidationError,
  parseMobileSnapshotEnvelope,
  type MobileSnapshotEnvelope,
} from "@openauthor/contracts";

function receiveSnapshot(value: unknown): MobileSnapshotEnvelope {
  try {
    return parseMobileSnapshotEnvelope(value);
  } catch (error) {
    if (error instanceof ContractValidationError) {
      throw new Error(`Snapshot metadata was rejected: ${error.issues.length} issue(s).`);
    }
    throw error;
  }
}
```

Every parser accepts `unknown`, validates a cloned JSON tree, enforces the v1
schema and cross-record identity invariants, and returns a deeply frozen value.
Validation errors expose paths, keywords, and safe messages without echoing
contract values.

## v1 contracts

| Contract | Public parser | Purpose |
| --- | --- | --- |
| Context Pack Reference | `parseContextPackReference` | Content-addressed link to context selected for a turn or voice session |
| Context Pack Projection | `parseContextPackProjection` | Bounded mobile-readable evidence without local filesystem paths |
| Assistant Turn | `parseAssistantTurn` | Durable turn identity, status, project revision, and linked artifacts |
| Tool Call | `parseToolCall` | Channel-aware tool request and canonical arguments digest |
| Tool Outcome | `parseToolOutcome` | Success or failure result with mutually exclusive payload semantics |
| Voice Session | `parseVoiceSession` | Device-bound WebRTC session lifecycle and retention policy |
| Mobile Snapshot Manifest | `parseMobileSnapshotManifest` | Exact v1 shape emitted by the Python mobile snapshot projector |
| Encrypted Snapshot Blob Metadata | `parseEncryptedSnapshotBlobMetadata` | Device-bound AES-GCM object metadata and ciphertext integrity |
| Mobile Snapshot Envelope | `parseMobileSnapshotEnvelope` | Hosted manifest/blob association with identity consistency checks |
| Device Enrollment | `parseDeviceEnrollment` | Project/device enrollment containing public key material only |
| Sealed Project Key Envelope | `parseProjectKeyEnvelope` | One versioned project key sealed to an enrolled X25519 device key |
| Immutable Outbox Envelope | `parseOutboxEnvelope` | Encrypted, replay-safe mobile capture aligned with the desktop importer |

The JSON Schema values are exported together as `CONTRACT_SCHEMAS`; their
source files live under `schemas/`. Known-good fiction fixtures live under
`fixtures/` and are suitable for non-TypeScript parity tests.

## Security and identity rules

- Contract objects reject undeclared properties. Tool arguments and results
  remain open JSON objects because their shapes are owned by individual tools.
- Inputs reject accessors, cycles, non-plain objects, non-finite numbers,
  excessive depth/size, and prototype-pollution keys before schema validation.
- Identifiers cannot contain paths. Snapshot object keys must be relative and
  cannot contain parent-directory traversal.
- Context, turn, voice, snapshot, and outbox records bind project and revision
  identity. Snapshot delivery additionally binds the recipient device.
- Hosted snapshot records contain identifiers, sizes, digests, project key
  versions, and ciphertext locations—not manuscript text, prompts,
  transcripts, provider credentials, or private keys.
- Snapshot and outbox payload encryption uses `aes-256-gcm-v1` with a 32-byte
  versioned project key, a unique 12-byte nonce, and the 16-byte GCM tag
  appended to the ciphertext. The transported object is standard RFC 4648
  base64 of `nonce || ciphertext || tag`. X25519 public keys and sealed boxes
  use unpadded base64url.
- Device public keys are raw 32-byte X25519 keys. A project key envelope is the
  complete 80-byte output of libsodium `crypto_box_seal` for a 32-byte project
  key (`crypto_box_SEALBYTES` is 48); it has no external nonce. Private keys
  never leave platform-secure storage.
- Snapshot-object AAD v1 is UTF-8 with literal `|` separators:
  `openauthor.snapshot.v1|project_id|revision|project_key_version`. Outbox AAD
  v1 is UTF-8 with NUL separators over `openauthor.mobile.outbox.v1`,
  `project_id`, `device_id`, `operation_id`, `base_revision`, `kind`, and
  decimal `project_key_version`. Hosted-manifest AAD is UTF-8 with NUL
  separators over `openauthor.mobile.snapshot.manifest.v1`, `snapshot_id`,
  `project_id`, `revision`, and decimal `project_key_version`. AAD is derived
  from these authenticated identities and is not duplicated in hosted
  metadata.
- The outbox `operation_id` is the immutable replay identity expected by the
  desktop importer. Plaintext request digests stay local. Hosted
  `ciphertext_sha256` values are lowercase raw 64-character hex over the exact
  uploaded UTF-8 base64 bytes, and `ciphertext_byte_length` measures those same
  bytes. Encrypted snapshot objects use the same digest and length convention
  and are capped at 64 MiB across contract, database, Storage, desktop, and
  mobile boundaries.

## Versioning

Every contract has a fixed schema discriminator, `schema_version: 1`, and a
versioned `$id`. Additive changes that remain optional may extend v1 only when
all readers preserve the same validation meaning. A required field change,
field rename, semantic reinterpretation, or enum removal requires a new schema
version, parser, type, fixture, and `$id`; v1 parsers continue rejecting it.

Run the package gates with:

```sh
npm run check
```
