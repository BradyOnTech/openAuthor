# Project quality pass — 2026-10-02

Status: local implementation and verification advanced; the six acceptance
priorities remain in progress. This is not a release certificate.

Remaining work includes editorial/Voice judgment, fresh-prose Memory evaluation,
deployed companion voice enforcement, safe deletion and device acceptance. Physical
phone use and signed Mac installation, upgrade and accessibility checks are
also required. The
[requirements ledger](requirements.json) records each outcome and its remaining
gate separately.

## What changed

Chapter and passage critique now return bounded editorial findings with exact
source passages, uncertainty, strengths and suggested minimal intervention.
Invalid evidence is withheld. Unique exact quotations can recover inaccurate
provider offsets with a visible correction; ambiguous quotations remain
withheld. Approved Writing Voice guidance reaches the
selection workflow; source and context versions reject stale requests. Critique
remains read-only. A fresh synthetic chapter includes an unexplained knowledge
claim, an explicitly explained change, and protected unresolved events. Its
[local packet](../connected-editorial-2026-10-02/local-results.json) verifies
source preservation and refusal to apply critique, not literary judgment.
One authenticated subscription review caught the planted knowledge concern
without inventing a communication or resolving the ending. Its one off-by-one
quote offset initially withheld the finding; local verification of that same
retained response now validates it with a correction warning. See the
[assistant assessment](../connected-editorial-2026-10-02/assessment.md). Author
review and approved Writing Voice revision quality remain open.

The main editor now includes a Memory suggestion inbox with source evidence,
correctable entity types, retained corrections and guarded decisions. Grammar
filters remove several unwanted opener/modifier entities. In 12 authored
extraction cases, expected-name matches increased from 23 to 25 of 27 and extra
names fell from six to zero. Two uncased names remain missed and two capitalized
places remain misclassified. Those narrow cases do not measure full-novel
accuracy or author review effort. See the
[Memory evidence](../memory-review-2026-10-02/extraction.json).

Saved planning guidance is compact, unfinished Plan drafts stay visible and
recoverable, selection actions remain reachable, and continuity review supports
keyboard navigation and exact passage comparisons. Reviewed chat permission and
regeneration now require the current disclosure before sending. The browser
journeys exercise these paths against the real Python engine.

Book writes now use a durable journal under the shared project lock. Interrupted
multi-file mutations recover original files; a committed journal preserves the
completed operation. Unknown newer writing blocks automatic resolution and
requires an exact reviewed choice. Cross-project configuration restores are
rejected before mutation. Packaged-engine probes use actual SIGKILL at five
stages, verify rollback/commit behavior, and exercise apply, undo and portable
backup restoration without system runtimes on PATH. Physical power loss and
noncooperating writers remain explicit limits.

The companion retains encrypted reading position and unfinished capture across
cold restart, including revision and retry identity. Native snapshot/auth data
uses atomic SQLite replacement and verified migration. Conditional migration
preserves a concurrent newer publication; auth leases prevent a delayed SDK
refresh from restoring signed-out credentials. Hosted and preview browser
journeys pass, along with iOS/Android/web exports. Real device keys, microphone
behavior, interruption, reconnect and accessibility remain unobserved.

## Verification and its limits

The latest core suite discovers 548 tests on Python 3.13: 547 pass and one
optional bundled-runtime check is skipped. Desktop passes 465 tests across 79
files plus TypeScript and the production build. All 19 combined desktop browser
journeys pass against the real core, including the new reviewed Memory scan and
Canon correction recovery/delayed-completion journey. Gateway passes 33 tests
with no skip against the disposable PostgreSQL fixture, plus typecheck/build and
the existing encrypted-sync authorization checks. The 19 browser journeys
precede the final transport-only publication repair; its 61 affected sync tests
and the final full desktop suite pass afterward.

All 548 tests pass without a skip using the rebuilt application's actual
packaged Python 3.11 runtime. Mobile's unchanged checkpoint has 126 across 27 files, TypeScript, one hosted journey and
four preview journeys. Contracts' unchanged checkpoint has 19 passing tests.
The unchanged authoring and caret journeys previously passed in WebKit.
The refreshed unsigned arm64 bundle matches committed core source byte-for-byte
and passes its runtime contract and five forced-termination recovery stages.
These interpreter and browser counts overlap and are not additive quality measures.

The refreshed arm64 application contains byte-for-byte committed core source and pinned
Python/Codex/Git runtimes. The [bundle report](native-bundle.json) records hashes,
architecture and the unobserved manual gates. It is an unsigned development
bundle. No Developer ID identity is available locally, and no clean Intel or
Apple Silicon installation, signed upgrade, VoiceOver acceptance or deployed
authorization drill has been certified.

Native GUI testing confirmed recovered Plan drafts and open tabs after forced
termination, but caught a caret bug missed by Chromium: the correct saved offset
survives scene activation, then resets when keyboard focus first enters prose.
The fix now passes the original physical-keyboard insertion after actual
SIGKILL, and later keyboard re-entry retains the latest caret. Immediate text
replacement respects explicit author selection. [Native observations](native-gui.json)
distinguish the tested development bundles from release gates.

Compatible dependency patches remove the fast-uri and brace-expansion findings.
Contracts, desktop and gateway audits are clean. Mobile still reports five high
entries propagated from one unpatched node-forge advisory. The
[dependency review](dependency-review.md) records the remaining release gate.

## Current implementation and remaining code

A current-source review separates these gaps from older defects already fixed:

- The automatic local Memory heuristic still misses uncased names and
  misclassifies some capitalized places. An optional reviewed AI scan now
  supports language-independent, exact-source candidates and uncertain types;
  malformed evidence is withheld and unresolved type ambiguity requires author
  confirmation. Local provider-response fixtures verify the workflow, not model
  accuracy. Fresh prose and observed author review effort remain required. See
  the [scan checks](../memory-semantic-scan-2026-10-02/core-review.md).
- Direct accepted-fact corrections now recover across navigation and restart,
  retain their loaded version, and preserve newer edits during delayed saves.
  The [real-core journey](../canon-correction-recovery-2026-10-02/review.md)
  verifies recovery, stale refusal, explicit comparison and guarded save.
- The fresh Writing Voice alternatives introduce uncertainty about Ivo leaving,
  while only the boat's departure is uncertain in the source. One adds symbolic
  explanation. Specific refinement feedback is prepared; a fourth subscription
  call awaits approval because the three-call allowance has been used. Read the
  [paired packet](../connected-voice-2026-10-02/review.md) before assessing quality.

Companion production issuance quotas now use an atomic database-owned counter
shared across devices, books and gateway replicas. A queued request rechecks
device/project authority after obtaining its quota lock. Real PostgreSQL checks
cover concurrent gateways, restart, lost responses and queued revocation; see
the [quota evidence](../shared-gateway-limiter-2026-10-02/review.md). The migration
and matching database policy must be adopted in the approved deployment before
running this production gateway. The later local cleanup checkpoint is recorded
below; target backing, deployment and device acceptance remain open.

The separate `2a4f015` authority checkpoint rejects deleted, expired and
wrong-subject Auth sessions, removed workspace membership and archived books.
It protects the periodic Realtime check and existing encrypted-sync/Storage
predicates, while a new checked key-state RPC distinguishes an active publishing
key from retained historical envelopes. The
[authority regression](../mobile-active-authority-2026-10-02/review.md) retains the
old-migration failure and 26 passing SQL assertions, including installed
PostgreSQL Storage RLS against a minimal metadata schema. That fixture does not
exercise the Supabase Storage HTTP/backend or complete the deletion lifecycle.
The `f32a435` gateway/mobile checkpoint adds server-owned short leases, immutable
hard call deadlines, periodic authority checks and durable known-call cleanup,
plus client teardown on account/book/scene changes and ignored late events.
Gateway passes 50 tests with no skips against the disposable database; mobile
passes 167 tests and the actual hosted App browser journey. Independent gateway
review passes 21 affected real HTTP/SIGKILL controls. The
[server packet](../voice-session-enforcement-2026-10-02/review.md) and
[mobile packet](../../../mobile/evidence/2026-10-02-continuous-voice/review.md)
retain source hashes and failed-before-fixed probes. Production still needs
independent outage call control for strict wall-clock limits; allocation before
durable call identification, final media/billing, immutable provider settings
and actual deployment/phones remain unverified. Earlier suite/bundle counts
above retain their original checkpoint scope.

The `58395c3` trusted-device checkpoint adds explicit per-book revocation,
reviewed exact-recipient/key-version rotation and separate publication. Failed
operations retain drafts and require a deliberate refresh; account changes
redact typed and late-returned recovery material. A key from another book cannot
replace the verified current key. At that checkpoint recovery without a verified
current envelope was refused; the later snapshot-proof recovery is recorded
below. Full desktop checks pass
494 tests across 81 files, typecheck/build, 82 affected tests and the final
1024×768 synthetic rendered browser journey. Independent review of the final
recovery and account-reset fixes is clean. See the
[device packet](../trusted-companion-devices-2026-10-02/README.md).
Those source checks originally used the earlier `d5aea8a` development bundle.
Later rebuilt native checkpoints retain their own binary identity; none certifies
a release installation.

## Current cloud lifecycle and native checkpoint

`e80ff81` restores a desktop's missing current key envelope only after the
entered key authenticates both the exact current committed snapshot and its
project/snapshot/revision/version manifest. The client validates the plaintext
book identity, installs only its own reviewed current-device envelope, and
confirms exact SQL identity/ciphertext after a lost reply without another write.
Session/account/device/version changes refuse stale completion. No current
verifiable snapshot means recovery stays refused; a reviewed new rotation or
future key commitment remains necessary. The
[recovery packet](../book-key-recovery-2026-10-02/README.md) records 547 desktop
tests across 84 files, 140 affected tests and three synthetic public-panel browser
journeys. These checks retain their synthetic account/Keychain/HTTP boundaries.

`5fe9d7c` adds a permanent cloud project UUID tombstone, privileged upload
completion fence, durable leased orphan-inclusive cleanup and separate verifier
role. The bounded worker saves exact pending paths before Storage DELETE and
reconciles them before retry. SQL independently checks unfiltered pending-path
absence and namespace emptiness. The worker stops awaiting external backing
verification; a separately authorized database operator must attest before
encrypted child/project metadata removal. That attestation is not independent
SQL proof of physical purge. The
[cleanup packet](../project-deletion-2026-10-02/README.md) records 31 deletion and
13 recovery SQL assertions, eight actual database concurrency controls, 66/66
gateway tests with no skips, two actual worker SIGKILL stages and an actual
RPC-to-PostgreSQL worker fixture. Its Storage HTTP effects represent metadata;
there is no local backing store or failed-upload queue. Target verification and
multi-project account-deletion orchestration remain required.

The unsigned arm64 app was rebuilt from clean tracked native source at
`5fe9d7c`. [Bundle provenance](native-bundle-5fe9d7c.json) records exact core and
binary hashes, the bundled runtime contract and five real packaged-engine
SIGKILL recovery stages. The native read-only reopening check retains both
tabs, unfinished Plan drafts and saved synthetic writing. It does not exercise
live recovery, signed Keychain, clean machines, upgrades or VoiceOver. The earlier
19 real-core browser workflows, 548 packaged Python tests and 167 mobile tests
retain their original checkpoint scopes; this pass does not relabel them as new
end-to-end cloud, physical-device or literary acceptance.

A separate publication repair prevents deletion of committed ciphertext after a
lost metadata response. It validates exact committed metadata and uses one
positive-only readback after an uncertain reply, without retrying publication
or deleting the object. Definite rejection can still leave an orphan, requiring
the full trusted lifecycle above. See the
[publication regression](../mobile-publication-recovery-2026-10-02/review.md).

Typed Memory values now reject invalid numbers, booleans, dates, lists and
references before mutation, while preserving untouched legacy values and invalid
editor drafts. Empty parts/chapters survive public Markdown and marked DOCX
round trips, including outline-only books, without phantom scenes. Stale chat
now reconciles old receipts without inference before fresh review, durably closes
old delivery IDs, and resets one-time context grants. Those three code gaps are
closed; broader author and delivery acceptance remains open.

Live Voice analysis also exposed a version-field defect: a generated profile
kept empty source digests after receiving verified exemplar digests. Saving it
left the profile unverified and omitted it from revision context. Fresh analysis
now aligns both captured version maps. The completed response was repaired
locally and retained alongside the original; no repeat analysis call was made.

Basic Unicode retrieval, honest unavailable word metrics, and reviewed context
for initial edit plans and merge reconciliation are already implemented. They
are superseded historical findings, not current missing features. Source-backed
chapter summaries remain a future long-book context improvement rather than a
broken current workflow.

## Next acceptance work

1. Have the author assess the connected chapter and fresh approved Voice revisions
   for omissions, false alarms, invented facts and kept/rejected edits.
2. Observe Memory triage on fresh original prose and improve the remaining
   extraction/classification gaps according to that evidence.
3. Exercise long sessions, keyboard navigation, VoiceOver and full multi-scene
   recovery in the signed packaged GUI.
4. Test reading, encrypted capture, live voice and cold restart on iPhone and
   Android using the approved deployment.
5. Validate signing/notarization, clean installs and upgrades on both Mac
   architectures; resolve the remaining dependency security gate.
6. Run deployment-specific authorization, device revocation, key rotation and
   deletion drills before exposing the companion to users.

Successful requests, synthetic fixtures, exports and passing tests cannot
substitute for these author, physical-device and clean-machine outcomes.

The latest packaged reopen retains both tabs, the saved 26-word disposable scene and its unfinished Plan synopsis/new-act title. Its read-only Memory preview shows the full selected source and keeps the footer reachable after scrolling, with the suggestion count unchanged and no inference request. The [current bundle report](native-bundle.json) identifies commit `d5aea8a` and its binary; [native preview observations](native-gui-memory-preview.json) record this bounded walkthrough. Earlier caret and backup observations keep their distinct binary identities; the prior [4c953ff bundle report](native-bundle-4c953ff.json) is retained.
