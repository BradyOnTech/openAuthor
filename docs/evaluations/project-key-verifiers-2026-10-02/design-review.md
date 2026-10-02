# Read-only design findings and implemented hosted seam

Reviewed baseline `2ed7f6da2497312d7a52f8734cff550a72dcf9e7` and the current
hosted implementation against `docs/no-snapshot-key-recovery.md`.

## Small, deep interface

Keep user-facing recovery at `unlockRecoveryKey(version, printableKey)` on
desktop and `importRecoveryKey(projectId, version, printableKey)` on mobile.
Behind that interface, one verifier codec owns bounded canonical parsing,
project/version/domain identity, digest checks, fixed-plaintext authentication
and error handling. WebCrypto and Expo are real adapters at the crypto seam.
Callers should not recreate the AAD or decide that a checksum is enough.

Hosted transport exposes one exact current-version read and one atomic
provisioning interface carrying the complete verifier receipt. This earns depth:
authorization, recipient set, CAS, account/project closure, immutable storage and
post-wait revalidation stay inside the hosted module. Deleting that module would
spread those responsibilities across provisioning and both recovery callers.

An AES-GCM verifier fits the existing nonextractable desktop key object. It adds
no raw-key export and no new HMAC key algorithm/import. Use separately random
12-byte nonce, 128-bit tag and fixed nonempty plaintext
`openauthor.mobile.project-key-verifier.v1`; authenticate that same domain,
canonical project UUID and exact positive version as NUL-separated AAD. The
verifier is a registered key witness within the trusted-client provisioning
model. It is not evidence that SQL independently knows or validated the raw key.

## Independent evidence and legacy keys

At the baseline, desktop can prove a candidate against an independently unsealed
envelope or a current snapshot and encrypted manifest. Mobile authenticates the
hosted encrypted manifest before local persistence. OA1 uses CRC32 for typing
errors and has no project/version identity. Neither a valid checksum, a public
ciphertext digest nor an available server version is enough to accept a key.

New provisioning establishes its witness in the same transaction as the exact
reviewed envelopes. Creating a verifier from an unverified candidate later would
merely let the candidate certify itself. No such backfill interface is added.
If verified legacy backfill is ever introduced, its client must first obtain an
independent current envelope or fully authenticate existing snapshot ciphertext,
then bind the same verified key to an immutable first-write witness under fresh
authority/CAS. SQL can require exact evidence identity and receipt but cannot
prove client decryption without receiving the secret; that trust limit must
remain explicit. Concurrent backfills would require exact immutable readback,
with conflict refusal and no replacement.

A legacy key without envelope, snapshot or prior witness is unprovable from its
printable string. The existing `TrustedDevicesPanel` reviewed rotation can
create a new key for current trusted recipients, after which a new snapshot can
be published. It changes future encryption authority. It cannot decrypt old
snapshots or pending old-version outbox when the original key is unavailable.

## Current callers affected

- `desktop/src/mobileSync/projectKeyProvisioning.ts`: generate one witness from
  the same newly imported nonextractable AES key used for recovery/envelopes;
  send it through atomic rotation and require exact project, next version and
  complete witness receipt before returning success.
- `desktop/src/mobileSync/supabaseTransport.ts`: bounded current witness read;
  complete rotation receipt validation; retain guarded self-envelope install
  with full receipt and exact readback after an ambiguous reply.
- `desktop/src/mobileSync/hostedCoordinator.ts`: use non-null witness before the
  old snapshot path; only positive null means legacy. Capture original signed
  account/device/session/current-version authority and recheck before install
  and before candidate acceptance. Preserve publication exclusivity and require
  separate explicit publication.
- `desktop/src/mobileSync/connectDesktop.ts` and
  `desktop/src/cloud/desktopEnrollment.ts`: existing independently unsealed
  envelope path remains a valid witness; recovery seals only to the current
  identity loaded from this desktop's validated Keychain material.
- `mobile/src/core/projectRecovery.ts` and
  `mobile/src/app/hostedRuntime.ts`: non-null verifier authentication before
  persistence, legacy snapshot fallback only on positive null, and final signed
  session/current-key/device checks. The baseline import path does not use its
  runtime access epoch around the verify-to-persist sequence.
- `mobile/src/adapters/supabaseAdapters.ts`,
  `mobile/src/adapters/snapshotManifest.ts` and
  `mobile/src/adapters/expoProjectCipher.ts`: reuse verified-session and real
  Expo AES facilities, with protocol parsing/AAD owned by the shared codec.
- `mobile/src/core/deviceEnrollment.ts` and encrypted secret-store adapters:
  verify-to-persist needs actual commit fencing, since checking before an awaited
  store write alone cannot stop late persistence after sign-out/replacement.
- Existing key authority/recovery SQL in migrations14/15 composes account and
  project lifecycle fences from migrations16/18/21. Migration22 keeps those
  modules and adds immutable witness storage, current reader and atomic wrapper.

## Security and verification requirements

Bind identity to immutable project UUID/version, rather than workspace or Auth
session, so legitimate moves and token refresh do not invalidate a key's
witness. Current membership, active project, enrollment, device key, live signed
session and account/project namespace closure still govern every operation.
A move that removes current permission must refuse after a queued lock; a
still-authorized move of the same book does not change cryptographic identity.

No raw/recovery key or prose is sent in verifier requests or logged. Candidate
acceptance follows authenticated fixed plaintext and final authority; retired
key witnesses cannot revive publication. A malformed or corrupt non-null
witness refuses rather than falling back to a different unreviewed source.
Immutable witness bytes survive retirement and cascade only with version purge.

Meaningful client reds must show a checksum-valid candidate for the correct
book succeeds without any envelope/snapshot after real registered-witness
authentication, while a distinct checksum-valid wrong key, altered AAD, corrupted
ciphertext with recomputed public digest and correctly authenticated wrong
plaintext refuse without key installation. Tests should also exercise real
cross-runtime AES compatibility and queued encrypted local-store commit guards.

SQL acceptance needs a complete actual receipt, atomic rollback on early and
late failure, role separation, legacy null, historical retention/current-only
reads and real post-wait race observations. This packet supplies49 SQL assertions
and13 queue/isolation controls. Its baseline interface red proves only absence
of the new hosted seam, and its opaque metadata fixtures do not prove crypto.

Browser acceptance should use the production coordinator/adapter/enrollment/
crypto path with synthetic outer SDK/secret-store responses. Cover no-snapshot
success without Storage download, wrong-key refusal, exact lost installation
receipt and reconnect/unseal, unresolved outcome remaining locked, same-account
replacement session during paused proof, and separate explicit publication.
Physical phones, deployed services, native Keychain and signing remain distinct.
