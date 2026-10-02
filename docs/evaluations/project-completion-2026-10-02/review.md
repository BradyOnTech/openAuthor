# Project quality pass — 2026-10-02

Status: local implementation and verification advanced; the six acceptance
priorities remain in progress. This is not a release certificate.

The remaining work is primarily literary and delivery acceptance: a connected
chapter assessed by the author, observed Memory review workload, physical phone
use, and signed Mac installation, upgrade and accessibility checks. The
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

The current core suite passes 529 of 530 discovered tests on Python 3.13, with
one optional bundled-runtime check skipped. All 530 pass using the actual packaged Python 3.11 runtime.
Desktop has 406 passing tests across 76 files plus
TypeScript and production build checks; mobile has 126 across 27 files plus
TypeScript, one hosted journey and four preview journeys. Contracts has 19
passing tests; gateway has 28 plus its typecheck/build. All 17 final desktop
browser journeys pass, including book, Memory permission and Storyline
workflows. The unchanged authoring and caret journeys also pass in WebKit.

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

## Concrete code work still open

A current-source review separates these gaps from older defects already fixed:

- Memory extraction still misses uncased names and misclassifies some capitalized
  places. The Inbox now describes those scanning limits. Author review effort
  remains unmeasured.
- The fresh Writing Voice alternatives introduce uncertainty about Ivo leaving,
  while only the boat's departure is uncertain in the source. One adds symbolic
  explanation. Specific refinement feedback is prepared; a fourth subscription
  call awaits approval because the three-call allowance has been used. Read the
  [paired packet](../connected-voice-2026-10-02/review.md) before assessing quality.

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

The latest packaged reopen also retains both tabs, the saved 26-word disposable scene and its unfinished Plan synopsis/new-act title. The [current bundle report](native-bundle.json) identifies commit `4c953ff` and its binary; earlier caret and backup observations keep their distinct binary identities.
