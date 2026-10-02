# Recovery integration — 2026-10-02

Status: locally implemented and verified at `8aaf17d`; production readiness remains in progress.

New key provisioning records an immutable authenticated witness in the same
transaction as its complete device envelopes. Desktop recovery now verifies a
candidate before any snapshot exists, then installs only its own envelope and
confirms the exact receipt before unlocking. Publication remains explicit.
The shared contract binds fixed non-prose plaintext to the book and key version;
wrong keys, corrupt witnesses and changed authority cannot establish success.
A positively absent legacy verifier permits the existing authenticated snapshot
path; an unavailable RPC or rejected current witness does not.

The gateway now correlates managed provider allocation with its durably stored
lease UUID. Startup closes a journaled call that crashed before SQL attachment,
attaches only the exact known ID, and requires independent accepted closure.
Unknown identities still need positive operator/provider reconciliation.

## Frozen integration results

| Check | Result |
| --- | --- |
| Desktop | 657 tests in 90 files; TypeScript and production build pass |
| Shared contracts | 22 tests; TypeScript passes |
| Actual Chrome and WebKit | 11 journeys each, zero failed/skipped |
| Gateway | 100 tests, zero failed/skipped; TypeScript/build pass |
| Actual PostgreSQL | 10 SQL suites and 37 aggregate concurrency/isolation controls |
| New verifier lane | 49 SQL assertions; 12 actual queued lock controls + 1 isolation refusal |
| Actual voice/database/HTTP lane | 9 cases, including pre-attachment SIGKILL and lost receipt controls |
| Captured inputs | All 364 unchanged across final integration checks |

Six account journeys, three legacy recovery journeys and two new no-snapshot
journeys run in each browser. Their rendered panel, client, enrollment and
cryptography are production code; SDK, native vault, RPC and Storage boundaries
are synthetic. The laptop WebKit screenshot was visually inspected: recovery
limits and inputs remain readable, publication remains separate, and the panel
has no horizontal overflow. The database is a disposable fsynced PostgreSQL 17.11
cluster with its own Unix socket and no TCP listener; existing services are untouched.
Synthetic Storage metadata is not proof of backing object purge.

Mobile key verification and actual encrypted-store controls are verified in the
[mobile packet](../../../mobile/evidence/2026-10-02-no-snapshot-recovery/README.md):
243 tests in 34 files and TypeScript, two full Chrome App journeys and one selected
WebKit recovery/redaction journey using the same built bundle. All 150 captured
inputs remained unchanged and 42 evidence hashes match. Native race tests use
mocked platform storage; actual Expo crypto runs through its web implementation.
Independent Standards and Spec reviews have zero open findings after the two
mobile regression repairs; see [review.md](review.md). Current mobile/native platform results must retain that
packet's exact scope. No new native application, signed Keychain, physical phone,
provider media/billing, deployed credentials or author acceptance is claimed here.

## Evidence and earlier failures

`source-sha256.json` and `tested-source.tar.gz` contain selected frontend,
contracts, gateway, SQL and verification inputs. Installed dependencies, core and
native source are outside this archive. Exact original log bytes are retained
as gzip with raw fingerprints in `results.json`. This is an integration input
snapshot, not a full clean-install or independent archived-build certificate.
The dedicated [SQL packet](../project-key-verifiers-2026-10-02/README.md) and
[voice packet](../voice-allocation-recovery-2026-10-02/README.md) provide their own
bounded archived-source baseline and final replays. Those prior archives retain
their original pre-integration shared-runner bytes; this packet captures and tests
the expanded runner. All 364 current inputs match the source commit exactly.

Development regression traces retain nine coordinator behavior failures,
missing provisioning proof and twelve transport controls before implementation.
Contract export/digest, frozen test-fixture mutation and test BufferSource typing
failures are separately retained. An intermediate Chrome pass was 10/11 because
its new legacy-null verifier fixture incorrectly cleared a pause intended for
Storage proof. The fixture was repaired without removing any original journey;
final Chrome and WebKit both pass 11/11. These development traces predate final
freeze and do not claim an archived baseline replay.

## Remaining boundaries

Legacy keys with no independently loaded envelope, authenticated snapshot or
immutable verifier remain unprovable. A reviewed new rotation restores future
access; it cannot recover historical ciphertext or pending captures encrypted
with an unavailable old key. SQL cannot prove that an authorized provisioning
client used the same raw key for its envelopes and witness; correct local
provisioning remains the existing trusted-client seam.

Provider allocation before a valid Location or durable journal remains
unresolved. Correlation is not idempotency or discovery. Lost accepted hangup
receipts and complete controller/state/control-network outages remain explicit
limits. Fresh-author judgment, physical-device and approved deployed drills,
VoiceOver/long sessions, signed clean-machine acceptance and the unpatched
mobile dependency advisory still prevent a release-ready claim.

## Verify

Run `python3 docs/evaluations/no-snapshot-recovery-integration-2026-10-02/verify.py`
to validate declared artifacts, original log bytes, archived inputs and current
source. Final commands and scope are in `results.json`; no external action is
performed by this verifier.
