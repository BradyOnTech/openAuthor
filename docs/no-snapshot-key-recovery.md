# Book key recovery before a snapshot exists

A recovery key's OA1 checksum detects typing errors. It cannot establish which
book or key version the key belongs to. New desktop key provisioning records a
small authenticated verifier in the same hosted transaction as its exact device
envelopes. This lets desktop and mobile authenticate the entered key before any
snapshot has been published, without sending a raw key or prose to the server.

## Required behavior

- Use existing AES-256-GCM with a separately generated 12-byte nonce and 128-bit
  tag. Plaintext is exactly UTF-8 `openauthor.mobile.project-key-verifier.v1`
  (41 bytes). Additional authenticated data is that domain, the lowercase project
  UUID and decimal positive key version, separated by NUL. The ciphertext plus
  tag is exactly 57 bytes. The nonce is independent of snapshot encryption.
- Establish the verifier atomically with the new key version and complete reviewed
  device-envelope set. Validate canonical fixed fields, project/version and
  ciphertext digest before mutation. Require the same current live Auth, account,
  workspace, project, device, recipient-set and compare-and-swap fences as rotation,
  including authority checks after waits. A failure leaves no new version,
  envelopes or verifier. Never silently fall back to legacy rotation after failure.
- Verifiers are immutable and bound to one project/version. Authenticated,
  anonymous and routine worker actors cannot write them directly. Only current
  active enrolled viewers or stronger roles can read the exact active-version
  verifier. Retired versions, revoked devices, frozen accounts, closed namespaces
  and foreign sessions refuse. Project-key version deletion owns its cascade.
- The client must parse a bounded exact verifier, check the expected project and
  version, recompute the ciphertext digest, authenticate with the candidate key,
  and compare the exact fixed plaintext. Wrong-book keys, altered AAD, malformed
  metadata, ciphertext corruption and a different authenticated plaintext refuse.
  A public ciphertext digest or an OA1 checksum alone cannot establish success.
- Desktop imports AES keys as nonextractable. It installs only the local current
  device envelope through the existing guarded self-envelope RPC after proof.
  The full immutable envelope receipt and original account/device/session/current
  key authority must be confirmed before the candidate unlocks publication.
  Lost replies use exact positive readback without another mutation; unresolved
  outcomes stay locked. Publication remains a separate explicit action.
- Mobile persists a candidate only after proof and final same account, device,
  key and signed Auth-session checks. Ordinary token refresh within the same
  session is allowed; same-account replacement sessions are distinct. A queued
  local secret write cannot commit after sign-out/device replacement or overwrite
  a newer conflicting current key. Use actual encrypted storage commit guards.
- No recovery key, raw candidate, identifying hosted review material or decrypted
  prose is logged or stored in browser plaintext. Recovery redacts on account or
  scope replacement; no late completion reopens old authority.

## Interface

The shared `ProjectKeyVerifier` contract has exactly these fields:

```text
{ schema: "openauthor.mobile.project-key-verifier", schema_version: 1,
  project_id: <lowercase UUID>, key_version: <positive SQL integer>,
  algorithm: "aes-256-gcm-v1", aad_version: 1,
  nonce_hex: <24 lowercase hex>, ciphertext_hex: <114 lowercase hex>,
  ciphertext_sha256: <64 lowercase hex> }
```

`mobile_rotate_project_key_with_verifier(p_requesting_device_id, p_project_id,
p_expected_previous_version, p_reason_code, p_envelopes, p_verifier)` returns
`{ project_id, key_version, recovery_verifier }`. Desktop validates the complete
receipt against its locally created verifier. It never infers acceptance merely
from a new current version.

`mobile_get_project_key_verifier(p_requesting_device_id, p_project_id,
p_expected_key_version)` returns that exact contract or null for an active legacy
version lacking a verifier. A stale or unauthorized request refuses. The client
uses a non-null verifier as the witness; failed proof does not fall back to some
other unreviewed witness. A positively null legacy verifier permits the existing
current authenticated snapshot proof. An unavailable RPC is not a null witness.

## Legacy keys and acceptance limits

There is no candidate-driven backfill. A legacy key with an independently loaded
envelope or authenticated current snapshot retains those existing recovery paths.
A legacy key with no envelope, snapshot or immutable verifier has no independent
witness and cannot be proven from its printable string alone. The author can
explicitly review a new rotation for trusted recipients to restore future access;
that does not recover historical ciphertext or pending captures encrypted with
an unavailable old key. Existing legacy clients can still create unwitnessed
versions through the original RPC; current desktop provisioning always uses the
new atomic verifier interface.

SQL cannot prove that a provisioning client encrypted its verifier and sealed
all recipients with the same key without seeing that key. Correct provisioning
remains the existing trusted-client seam. Cross-runtime crypto compatibility,
real database atomicity/races, wrong-key and late-session controls, actual browser
no-snapshot recovery and encrypted local-store fencing provide local evidence.
Physical iOS/Android, deployed services, signed Keychain and clean-machine
acceptance remain separate gates.
