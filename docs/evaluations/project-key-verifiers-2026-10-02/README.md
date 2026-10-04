# Immutable book-key verifiers — 2026-10-02

The hosted backend now registers a fixed non-prose AES-GCM witness atomically
with a new project key version and its complete reviewed device-envelope set.
An enrolled viewer can retrieve that exact current-version witness without any
snapshot. Clients must still authenticate its bytes with the candidate key and
the fixed project/version/domain protocol before installing or persisting a key.

This packet verifies actual PostgreSQL authorization, metadata, atomicity,
locking and purge behavior. Its opaque fixture ciphertext is deliberately not
cryptographic acceptance evidence. Cross-runtime encryption and actual browser
recovery belong to the separately recorded client integration checkpoint.

## Results

| Check | Result |
| --- | --- |
| Baseline behavior through migration21 | 3 assertions reproduce legacy provision without a witness or snapshot |
| New interface against the baseline | Expected nonzero failure: the new atomic rotation function does not exist |
| Current verifier SQL | 49 assertions passed |
| Queued transaction controls | 12 actual PostgreSQL lock waits passed |
| Isolation control | 1 repeatable-read transaction refused with `25000` |
| Existing SQL regressions | Encrypted-sync/RLS, snapshot recovery and attested project deletion passed |
| Source stability | 27 captured inputs unchanged across final baseline/current runs |
| Archived-source replay | All current controls passed again in a new disposable cluster |

The final cluster runs all 15 migrations through migration22. PostgreSQL17.11
runs in a fresh temporary directory, with fsync enabled, trust authentication
only on its isolated Unix socket, and no TCP listener. Clusters stop even when
the baseline test fails. No existing or deployed database, accounts, actual
Storage backend, providers, credentials or author files were changed. The
synthetic Storage table represents metadata only; its emptiness and attestation
fixture do not certify remote blob purge.

## Protocol and guarantees

The exact contract is specified in the archived
`docs/no-snapshot-key-recovery.md`. The new rotation RPC validates all nine
canonical fields, project/version, fixed lengths and ciphertext SHA-256 before
any mutation. It composes the existing recipient-set/CAS rotation module under
the account/project lifecycle fences and rechecks current authorization after
queued project and recipient waits. Its receipt is exactly
`{project_id,key_version,recovery_verifier}`. A stale replay cannot create the
next version or overwrite the witness; clients must resolve ambiguous outcomes
with exact positive readback, without blindly resubmitting a rotation.

The witness table is private to ordinary actors. Its bytes cannot be updated or
deleted while retaining the parent key version, including through an elevated
direct write. Existing verified project finalization removes versions and
cascades the witness purge in the original dependency order. Historical witness
rows survive retirement but cannot be read through the current-version reader.
The SQL acceptance case removes the viewer's current envelope and confirms the
exact witness is still readable; no snapshot exists in that book.

The lock controls pause real transactions and inspect `pg_stat_activity` to
prove that the competing process is actually waiting. They cover workspace
move, project archival, Auth-session removal, project enrollment/device
revocation and recipient-key replacement during rotation; competing rotations;
two held read preflights followed by rotation; and current-witness reads queued
behind retirement, session removal or project deletion. A committed account
deletion also prevents a queued rotation from reopening authority.

## Legacy and acceptance limits

There is no candidate-driven verifier backfill. Legacy versions remain null
witnesses and need a separately authenticated existing envelope or snapshot.
An OA1 checksum alone never proves book identity. A deliberately reviewed new
rotation restores future access; it cannot recover historical ciphertext or
pending captures encrypted with an unavailable old key. Legacy clients can
still provision unwitnessed keys through the old RPC, which is preserved for
compatibility. Current client provisioning must use the new RPC and must not
fall back after an uncertain or rejected response.

SQL cannot establish that a client's sealed envelopes and verifier use the
same raw key. Correct local provisioning is the existing trusted-client seam;
the server never receives that key. This packet does not claim deployed Auth,
physical-phone, signed Keychain, clean-machine or release acceptance.

## Reproduce

`python3 docs/evaluations/project-key-verifiers-2026-10-02/evaluate.py --pg-bin /path/to/postgresql/bin`

The evaluator checks the archive digest and every recorded input, extracts only
the allowlisted files to a new temporary directory, and runs the archived SQL
and concurrency harness. Add `--baseline-red` to reproduce the intentionally
nonzero missing-interface result. Original output bytes are retained as gzip;
the first green log predates the added regression replay and final baseline
behavior and missing-envelope controls. `postgres-final.txt.raw.gz` is the
current successful run; `archive-replay.txt.raw.gz` is its independent replay.
