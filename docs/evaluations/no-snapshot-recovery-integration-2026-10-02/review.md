# Independent implementation review

Fixed point: `2ed7f6da2497312d7a52f8734cff550a72dcf9e7`.
Tracked diff: `git diff 2ed7f6da -- <scoped files>`; new files read in full.
No source commits after the fixed point existed at initial review; these were
working-tree additions. Final commit association is recorded only after matching
captured hashes. No author project files are in the review scope.

## Standards

Root independently reviewed the provider agent's five gateway files against
`CLAUDE.md`, `docs/independent-voice-control.md`, `gateway/README.md` and the documented
local-first/private-control boundaries. No hard documented-standard violation
or actionable Fowler heuristic was found. Tool-enforced formatting/type rules
are outside this report. All twelve heuristics were considered: Mysterious Name,
Duplicated Code, Feature Envy, Data Clumps, Primitive Obsession, Repeated Switches,
Shotgun Surgery, Divergent Change, Speculative Generality, Message Chains,
Middle Man and Refused Bequest. Journal startup reconciliation is one operation
in the existing control module; correlation uses the existing lease identity
and upstream interface. Tests use actual existing fixture boundaries, exercise
closure refusal and preserve immutable scope.

The provider agent independently reviewed contracts/schema/AAD, desktop
provisioning/verifier/transport/coordinator/UI/browser controls, migration 22,
SQL/concurrency/shared harnesses and the final frozen mobile Auth/identity
monitor, App redaction, native/browser key and local-authorization commits,
rollback and downloaded-mode controls. Against `CLAUDE.md` and repository
rules: zero documented violations and zero actionable Fowler findings across
all 12 heuristics. Platform-specific crypto/storage seams are justified by their
commit mechanisms. This review excluded that agent's own five gateway files
and unrelated author data; it made no edits, tests or network calls.

## Spec

The mobile agent independently reviewed desktop/contracts/SQL/gateway/shared
harness against the recovery spec and the six-priority readiness requirements;
it excluded its own mobile implementation and repeated no completed root
suites. Zero actionable findings remain. Exact verifier contract/crypto and
no-bad-proof fallback, current original authority, complete self-envelope receipt,
atomic reviewed recipient rotation, immutable active-version SQL authority and
parent cascade, actual queued controls, and closed-first journal reconciliation
match the requirements. It infers no author, physical, deployed, signed or
provider media/billing acceptance.
The backend agent independently reviewed final mobile against
`docs/no-snapshot-key-recovery.md`: two initial findings, both repaired, zero
outstanding. P1: a started native key write could retain the rejected candidate;
post-write native guard and in-queue restoration, plus browser post-commit
ciphertext-CAS rollback, now cover it while preserving newer records. P2:
SDK identity replacement rejected pending proof but retained OA1/title in the
mounted form; the persistent verified online identity monitor now closes the
App view through the existing notification seam. App browser controls check
both entered-form and paused-proof redaction, with no late key persistence.
Idempotent closure fixes the development notification loop; guarded explicit
local authorization and retiring the observer on awaited downloaded entry
preserve the intended lock/offline boundary. The reviewer read source/controls
and matched150 input hashes but executed no tests or edits. Native controls
use platform mocks; Expo crypto is the installed web implementation. Root
independently agrees with those mobile findings and repair boundaries.

This review distinguishes local implementation compliance from required author,
physical-device, deployed-service, signed-native and release acceptance, all of
which remain open. Authoring one's own code or evidence is not an independent
review. The root's desktop implementation receives peer review from the mobile
and provider agents; the mobile agent's implementation is reviewed by backend
and provider agents; the gateway receives root and mobile peer review.

Final outcome: Standards 0 open; Spec 2 initial, 2 repaired, 0 open.

## Documentation consistency

Four initial contradictions in current tables/ledger counts, legacy recovery
wording and platform export scope were repaired. Independent rereview found all
four resolved and no new contradictions in the corrected sections. This was a
read-only consistency review, with no source edits or tests.
