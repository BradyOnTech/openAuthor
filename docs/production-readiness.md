# Production readiness: a novel-writing application

Goal activated: 2026-09-07. Status: **active; production readiness is not established**.

## Required outcome

An author can develop and revise a real novel with manuscript-aware AI, review
consequential changes, and recover their work. The desktop studio and voice/mobile
companion serve the product described in `product-development-plan.md` and the
activated `voice-mobile-build-plan.md`. Neither green unit tests nor a successful
build alone satisfies this goal.

## Acceptance and evidence

| Area | Required proof | Current assessment |
| --- | --- | --- |
| Manuscript safety | Slow/failing saves, rapid scene switching, focus-mode transitions, crash recovery, external edits, and concurrent operations preserve every draft or visibly block conflicting writes | Save and stale-response safeguards plus durable multi-file recovery now have real subprocess-kill evidence; unknown newer writing requires reviewed comparison. Noncooperating writers, physical power loss and full signed-GUI acceptance remain explicit limits |
| Authoring | Create/import a book, draft and organize chapters/scenes, read, search, reopen and export with predictable structure and no unexplained loss | Connected browser/real-Python journey now covers import, planning, chapter reading, Memory, search, local copilot notes and Word export; packaged/full-novel acceptance remains required |
| AI assistance | Real configured provider receives relevant, bounded, attributable context; streaming, cancellation, failures and retries work without lost or duplicated turns | One authenticated October 2 synthetic chapter critique caught a planted knowledge problem; original evidence-offset failure and same-response repair are retained. Author judgment, revisions and broader quality remain unverified |
| Change review | Exact proposed text, selective acceptance, revisions, staleness/conflict checks, multi-scene atomic apply and undo work together through the actual application | Existing core/rendered tests; independent failure-path review and packaged end-to-end coverage required |
| Story knowledge | Author-approved facts are distinguished from suggestions; citations, temporal knowledge, corrections and continuity consequences are useful on real manuscripts | Narrow deterministic fixtures are insufficient evidence of novel-scale creative usefulness |
| Creative experiments | Alternate Storylines isolate work and selectively integrate without overwriting unsaved main-manuscript edits | Existing implementation; concurrent-save and recovery interactions need validation |
| Voice/mobile | Same project context and approval policy; reliable foreground audio, interruptions, encrypted sync, offline capture and desktop review | Local implementation present; deployment, credentials, physical-device and live-provider gates remain |
| Accessibility and usability | Keyboard/assistive navigation, named controls, reliable feedback, readable long-form review, focus restoration, and responsive layouts | Fresh end-user walkthrough and accessibility pass required |
| Reproducible delivery | Fresh-checkout installation, supported toolchains, audited dependencies, all packages gated in CI, bundled runtime and clean-machine distribution | Locked local package checks/builds and current-source unsigned arm64 runtime verification pass. Contracts/desktop/gateway audits are clean; mobile retains one unpatched Forge advisory. Signed artifacts, remote CI and clean-machine acceptance remain gates |
| Recovery and release | Forced-crash drills, signed/notarized artifacts, clean-machine installs and explicit privacy behavior | Real core/packaged-engine SIGKILL recovery, local native backup/restore and restored caret/Plan/tab restart are observed; signed-GUI acceptance, distribution and accessibility are incomplete. No release-ready claim |

## Iteration record

### 2026-10-02 — focused review, durable recovery and completion audit

The six-priority pass is **in progress**. The
[requirement ledger](evaluations/project-completion-2026-10-02/requirements.json)
separates implemented behavior from author, device and distribution acceptance.
The pass starts from `f154d78`. Bundle provenance records the implementation
commit and actual packaged bytes separately from the unobserved manual gates.

Focused read-only Critique now offers explicit review modes for passages and
Plan chapters, source-checked evidence, uncertainty, strengths and minimal
optional interventions. Chapter source changes make the review stale. Approved
Writing Voice enters selection context only through the usable privacy-gated
craft projection; raw unapproved samples stay excluded and profile changes
invalidate reviewed fingerprints before or after provider work.

One authenticated subscription call reviewed the fresh three-scene synthetic
Ferry Ledger chapter. Its raw feedback caught the planted unexplained key
knowledge without flagging the explicit hair-dye change or resolving the ledger
and ferry. The original strict parser withheld its only finding for a one-character
offset error. A reviewed repair re-anchors only a unique exact quote within the
same supplied scene and visibly records the correction; the immutable original
and locally revalidated response remain separate. No extra inference was used
for that repair. The [assistant assessment](evaluations/connected-editorial-2026-10-02/assessment.md)
records absent author acceptance and the limits of one authored fixture.
Generation `gen-74db96940b37` resolved `gpt-5.6-sol` and reports 4,620 input and
2,411 output tokens, one attempt, and a `$0.00` API estimate through the
subscription path. That estimate does not establish subscription billing. The
approved evaluation scope is synthetic content with a maximum `$5` API budget.

Memory review now suppresses selected grammatical false positives, supports
source/version-guarded entity-type correction, and protects conflicting typed
identities. The main workspace retains correction drafts and offers evidence
review and keyboard triage. Saved Plan guidance is compact; passage comparisons
retain exact text and selection actions stay reachable. Fresh extraction and
rendered workflow evidence are linked from the requirement ledger. Broader
language support and observed author review burden remain open.

[Durable manuscript transactions](manuscript-transactions.md) now journal exact
bytes and recover before cooperating reads after real SIGKILL subprocesses at
scene, Revision HEAD, proposal and commit stages. Reviewed recovery fingerprints
protect against third-writer changes. A committed journal preserves successful
writing; a full Revision restore that changes project identity fails before any
writes. The packaged-engine probe exercises embedded tools without system tools
on PATH. Physical power loss, arbitrary noncooperating writers and signed GUI
failure acceptance remain separate limits.

Mobile encrypted restart retention, native cache migration and authentication
cleanup now cover concurrent refresh, vanished legacy files, pending SDK writes
after sign-out, and cross-tab commit fences. Real SQLite/WebCrypto adapters and
the installed Supabase SDK are exercised through test ports. Browser/native
adapter results and all-platform Expo exports do not establish physical iPhone
or Android audio, OS permission, routing, interruption or deployment security.

Current Python 3.13 discovery after the quote-anchor repair reports 494 tests:
493 passed and one optional packaged-runtime contract skipped. The final
packaged-Python run passed all 494 tests with no skip. Desktop passed 374 tests
across 74 files after the caret and immediate-replacement follow-up. Mobile
passed 126 tests across 27 files and all-platform exports; contracts passed 19
tests; gateway passed 28 tests/typecheck/build.
Native tests passed 10 with one macOS Keychain case ignored. The preliminary browser
run passed 13 journeys and exposed a Storyline-regeneration assertion; its corrected
targeted rerun passed 2/2. The final combined Chrome gate passed all 15 journeys.
The unchanged authoring and caret journeys also pass in WebKit. The initial
combined run exposed immediate replacement appending after caret restoration;
the repair now preserves explicit author selection and has regression coverage.
The final current-source arm64 bundle passed its wire contract and five real
SIGKILL recovery stages. Its exact core-source SHA-256 is
`21a409d391575bf281a022fdc2b6bf0e6e6ab4cb33513521db8ae7c0b0f2cc92`.
Local native GUI inspection restored exact synthetic scene bytes from backup,
then recovered both document tabs, active Plan, unsaved Synopsis and new-act
drafts after forced termination. Physical Tab/Shift-Tab and typing resumed at
the restored caret and subsequently retained its updated position. This targeted
unsigned local walkthrough does not certify signed/clean-machine installation
or broader keyboard/assistive accessibility.

The [dependency review](evaluations/project-completion-2026-10-02/dependency-review.md)
records compatible patches to `fast-uri` 3.1.8 and `brace-expansion` 5.0.12.
Contracts, desktop and gateway audits report zero vulnerabilities. Mobile has
five high dependency entries from one unpatched `node-forge` advisory; vulnerable
build-time/runtime reachability was not established. A supported fix or reviewed,
tested mitigation and affected-path analysis is required before clearing that
security gate. No broad Expo downgrade or audit suppression was applied.

Concrete code gaps remain in typed Memory value validation, uncased-name
extraction, specific warnings for lost empty outline containers on re-import,
and fresh-context recovery for stale pending chat. Basic Unicode retrieval,
honest unavailable word metrics, and reviewed initial-plan/merge context already
exist; older missing-feature wording is superseded in the machine ledger.

Remaining acceptance is author review of useful retained/rejected revisions;
physical-phone and approved deployment authorization/revocation/recovery drills;
owner-supplied Developer ID signing and notarization; clean Apple Silicon and
Intel installation; signed-app credential and upgrade checks; and full native
keyboard/VoiceOver, contrast and text-scaling evaluation. A local unsigned GUI
walkthrough and green fixture tests do not complete these gates. Production
readiness remains unestablished.

### 2026-09-07 — baseline and writing safety

- Reviewed the current checkout at `~/Developer/openAuthor`; preserved
  existing voice/mobile changes and manuscript/project files.
- Python baseline: `python3 -m unittest discover -s tests -v` — 166 tests pass.
- Desktop dependencies were absent after the project move; installed from the
  existing lockfile. Baseline suite plus first new regression: 135 tests pass.
- Reproduced a sentence disappearing when the previous save resolved. The editor
  replaced newer local text with an older save acknowledgement and cleared its
  recovery copy. Added a rendered regression before changing the save path.
- Save acknowledgement now preserves newer text and drains pending edits, including
  edits made before closing a scene. Failed saves expose an explicit retry.
- Prose saves now send only title/body instead of stale Inspector metadata.
- Removed the competing focus-mode draft/save implementation. Focus mode now
  presents the same live editor, preserves its text and selection, traps keyboard
  focus, and returns to the workspace without replacing the draft.
- Recovery quota/access failures no longer crash the editor; the author sees a
  warning while unsaved. Old save acknowledgements cannot clear a newer recovery
  copy, and reverting to saved text does not offer discarded prose as recovery.
- Separated manuscript writes from scene-list refresh, so a slow refresh does not
  hold subsequent saves or misreport a completed write.
- Initial clean build failed on missing `contracts` dependencies. Installing that
  package from its lockfile allowed the desktop production build to pass. The
  automated installation and CI path now install shared contracts first and use
  Node 22. CI includes contracts, gateway, mobile, dependency audits and a browser
  workflow in addition to the previous desktop/native gates.
- Updated the vulnerable desktop Browserslist dependency. The mobile audit traced
  eleven reported entries to one old UUID dependency in the Xcode build tooling;
  a scoped patched override retains its CommonJS v4 interface, verified by a
  parse/generate/serialize compatibility test and Expo configuration introspection.
  All four npm audits now report zero known vulnerabilities.
- Added `desktop/e2e/authoring.spec.ts`: a real Chromium UI running the actual
  Python engine through a test-only native-transport adapter, against a disposable
  original scene. Generation uses the deterministic offline provider and does not
  establish live-model creative quality. Write → focus → generate → review → apply
  → undo → reload passes, with screenshots and failure traces retained.
- The browser gate reproduced a startup navigation race: Manuscript clicks were
  ignored until background scene loading completed. Navigation now retrieves the
  inventory when needed. Screenshots also exposed notifications covering focus
  controls; notifications were moved and given semantic status/dismiss controls.

### Latest verification scope

- Python: 166 tests passed.
- Desktop: 145 tests passed, including the final slow-refresh regression.
- Contracts: typecheck and 18 tests passed.
- Gateway: typecheck, 28 tests and production build passed.
- Mobile: typecheck and 34 tests passed; iOS/Android config introspection passed.
- Browser/real Python authoring workflow: passed locally using installed Chrome,
  then passed two consecutive fresh-project runs after the final fixes.
- Desktop production build, all four npm audits, capability registry, and
  400-scene performance budgets passed.
- At this baseline, native Rust and packaged-app gates were not run because the
  moved checkout had no Cargo toolchain or prepared bundled runtime. The later
  native-enrollment iteration below supersedes the Cargo limitation; bundled
  runtime, distribution, and device testing remain separate gates.

### Next unresolved safety/integration work

- Serialize or conflict-check writes across reopened editor instances, Inspector,
  Change Set apply/undo, Revision restore, and Storyline switching. Current save
  serialization covers one mounted editor, not every project writer.
- Preserve/resolve external-file changes while an editor has unsaved work.
- Exercise real Assistant streaming, tool approvals, cancellation, source context,
  and durable promotions through the actual engine, then a configured live model.
- Validate long-form review and authoring on an original novel-scale fixture;
  short deterministic examples do not prove creative usefulness.

## Working sequence

### Priority update — 2026-09-07 mobile companion

The author explicitly requires a mobile voice experience now and confirms the
companion scope. This supersedes the earlier mobile deferral. Manuscript
concurrency work is paused, not resolved; its existing failing regression remains
in `tests/test_manuscript_concurrency.py` for the next manuscript-safety pass.

The native companion now has a shared Expo browser/PWA path, encrypted browser
adapters, explicit browser enrollment, and an offline application-shell cache.
Voice setup passes selected-scene context before unmuting, waits for its data
channel, supports cancellation/timeouts, cleans up late microphone streams, and
clears queued output on interruption. Voice UI cleanup covers leaving its screen
and backgrounding. Browser sign-out now returns to the sign-in/sample screen.

Verification: mobile typecheck and 42 tests, contracts typecheck and 19 tests,
browser production export, and two consecutive fresh phone-sized Chromium
sample-workflow runs. The current iOS JavaScript/Hermes export and desktop
production build also pass; this is not native compilation/signing or device
execution. All four JavaScript dependency audits report zero known issues.
The browser check exercises reading, capture/review, selected-scene scope,
sign-out, preview labeling, and offline shell reopening. The sample disables
voice instead of pretending a backend exists. The browser adapters' persistence
tests cover encrypted reopening, cross-tab key selection, ciphertext record
identity, and immutable outbox acknowledgement.

Unproven at this checkpoint: deployed auth/RLS and browser-platform migration,
desktop device onboarding, actual book publication/enrollment, real OpenAI voice, expired-login
offline reading, physical Safari/Android audio, production headers/hosting, and
complete desktop review of returned mobile work. No live provider calls or
private manuscript uploads were made. Deployment choice/authority has been
requested; no hosted resources have been modified.

The first mobile delivery is not complete until a real phone can discuss a
published book and return a captured idea for desktop review. A local PWA build
or preview walkthrough alone does not satisfy that requirement.

### 2026-09-07 — secure desktop companion enrollment

- Replaced the developer-only pasted-access-token gate with email/password
  sign-in backed by macOS Keychain storage. Local books remain available without
  signing in, including while cloud session restoration is slow or failing.
- Added an app-scoped native credential adapter with trusted-window checks,
  bounded credential slots, content-free errors, and a cross-process lock for
  atomic identity creation. No plaintext or unsupported-platform fallback.
- Desktop enrollment saves the identity and private key before remote
  registration, reuses them after a dropped response/restart, refreshes and
  verifies the device-bound session, enrolls the hosted project, and unseals
  all available project-key versions. Account, device, project, recipient key,
  algorithm, length and digest mismatches fail closed.
- Mobile Inbox now provides Connect this desktop and companion account controls.
  Restored keys enable manual publication/import without retyping recovery
  codes. A rendered regression caught and fixed stale setup state overwriting a
  successful connection. Inbox import still does not apply manuscript changes.
- Authenticated transport obtains a verified current token for each request,
  preventing an old coordinator from operating under a different account.
- Cloud auth and encryption libraries remain lazy-loaded outside local editor
  startup. Corrected build-time environment access and honored explicit local
  registry mode. Legacy pasted tokens are not accepted by any request path.
- Installed Rust through Homebrew rustup, then made build recipes discover either
  standard rustup or Homebrew locations without editing shell configuration.

Verification: desktop TypeScript/Vite production build, 164 desktop tests,
8 native tests (including the real Python write/review/apply/undo bridge), and
two browser/real-Python authoring walkthroughs during this iteration. A separate
real macOS Keychain read/create/update/delete round trip passed; its disposable
credential was removed. Desktop dependency audit reports zero known issues;
repository and prerequisite checks pass. These are local tests, not hosted
account/device tests or signed-app Keychain verification.

Still required for the companion: robust phone/browser registration across a
lost enrollment response, understandable device pairing/key distribution and
recovery, local-book-to-hosted-project onboarding, deployed auth/RLS verification,
actual encrypted book publication and return-trip review, and physical-phone
voice. No deployed resources, live provider calls, or private manuscript uploads
were created. The deployment choice remains unanswered. The broader manuscript
concurrency regression remains unresolved and production readiness is not claimed.

### 2026-09-07 — first-use phone recovery and real encrypted round trip

Mobile enrollment now persists the complete private identity before registration,
retains it for restart/retry, and atomically selects a single identity across
browser tabs. Failed native metadata reads no longer silently turn corruption
into new enrollment. Missing private keys refuse rebind, and failed secret
cleanup retains its index for retry. A different sign-in cannot silently delete
the previous account's encrypted work.

Book unlocking is reachable before downloading a snapshot. Recovery validates
the supplied version and authenticates the candidate against the selected
encrypted manifest before persisting it; wrong keys do not overwrite local
keys. Failed project opening now exposes retry/back/recovery instead of an
indefinite spinner. Long revision IDs no longer push the phone review layout
offscreen, as caught by screenshot inspection with a real revision fixture.

Evidence: 55 mobile tests and typecheck, browser production export, and two
consecutive fresh phone-sized Chromium encrypted round trips. The browser uses
the actual Supabase SDK, browser encryption, storage and runtime with simulated
HTTP hosting. An original fixture book is produced by the real Python engine
and encrypted by the desktop implementation. The test loses a registration
response after simulated commit, restarts with the same identity, rejects a
wrong recovery key, opens/reopens the book, captures an idea, uploads ciphertext,
and imports it through the desktop/Python inbox. It asserts the original scene
is unchanged and request bodies contain no recovery key or captured prose.
No real hosted account, provider call, or private manuscript is involved.

The first configured build exposed Metro reusing transforms with missing public
environment values. Browser exports now clear that cache. The simulated-hosting
build is separate from distributable `dist` and has its own CI test target.
The ordinary preview/offline-shell walkthrough also passes after a fresh export.
The current iOS JavaScript/Hermes export succeeds (869 modules, 2.9 MB); this is
not native compilation, signing, or device execution. Mobile dependency audit
and repository checks pass. Preview and simulated-hosting screenshots/traces
are retained in separate directories under `mobile/test-results`.

Still incomplete: live deployment/authorization and phone voice; easy trusted
device pairing/key distribution; readable encrypted pending-item previews and
offline/expired-session access; multi-version key-index concurrency and full
revocation/recovery drills; and all broader manuscript/AI-quality release gates.
The design skill kept retry and recovery behavior behind shared, testable
interfaces rather than screen-specific implementations.

### 2026-09-07 — readable, authenticated companion review queue

Pending captures now reopen as readable text rather than an opaque encrypted-item
label. A shared review module selects the current project/device, authenticates
the AES payload, checks both digests and every payload identity field, and
formats notes, dictation, Story Memory suggestions, change requests, conversation
turns and review intent. Key lookup is per queued key version, including older
versions. No plaintext preview is persisted. Per-item decryption/payload failures
show a content-free warning and leave ciphertext intact without hiding healthy
items. Hosted runtime access still requires the signed-in enrolled device.

The UI now differentiates local upload from desktop import/review, reports queue
loading/retry states, avoids duplicate capture/sync submissions, and refreshes
the queue even after a partial upload failure. Capture input is temporarily
locked while saving so a late acknowledgement cannot clear newly typed text.
Async results from unmounted capture/review screens no longer change navigation.
The design skill kept verification and display decoding together behind the
same interface used by the runtime and tests.

Evidence: 66 mobile tests and typecheck pass. Two consecutive phone-sized Chrome
round trips reopen a persisted capture, assert ciphertext-only storage, corrupt
the actual AES payload while recomputing its public digest, verify the safe
unreadable state, restore the original fixture envelope, then upload and import
through the real desktop/Python inbox with the original manuscript unchanged.
The pending-capture screenshot was visually inspected. Hosting is simulated;
this does not establish live auth/RLS, native-device behavior, or voice quality.
The browser test was also corrected to wait for the saved Review screen before
reloading, not merely match the text still present in the capture input.
The fresh preview browser export and offline-shell walkthrough pass, as does
the iOS JavaScript/Hermes export (870 modules, 2.9 MB; not a signed native build).
The mobile production-dependency audit reports zero known vulnerabilities and
repository checks pass. Local browser runs use the installed Chrome executable;
the default Playwright-managed browser is not installed on this machine.

Offline finding remains open: `restoreSession`, project listing and capture
attempt online device validation before a cached-book fallback. An expired login
or unavailable network can therefore prevent reading downloaded books. The next
change needs explicit device/account-bound local access, an encrypted downloaded
library index, and a durable sign-out lock, separate from online authorization.
Expired credentials must never authorize sync, enrollment or voice. Remote
revocation cannot be discovered while disconnected and needs an honest policy.
No such offline access grant or auth-storage change was introduced in this turn.

### 2026-09-07 — downloaded books with expired sessions

Implemented a separate local-access record bound to deployment, account, device
and device-key identity. It is created only after verified online enrollment and
checked against the retained private device key. Automatic restoration cannot
overwrite a persistent sign-out lock; only deliberate online sign-in unlocks it.
Library metadata is encrypted in browser IndexedDB or native SQLite with a
SecureStore-held wrapping key. Per-book records avoid a shared mutable title
index and avoid native secure-store payload-size limits.

Downloaded mode persists across cold restarts and does not instantiate the
Supabase client. Reading, pending-item previews and capture use local snapshot
and key access with no network fallback. An explicit reconnect refreshes and verifies
credentials before returning to online mode; voice, sync and key recovery stay
blocked in downloaded mode. Mode changes are serialized and stale async restores
cannot override the user's newer selection. Captures and voice turns retain the
actual context snapshot's base revision for desktop conflict detection.

Sign-out first persists a local lock and stops refresh, then clears only this
deployment's auth records, retaining encrypted books and unsynced captures.
Downloaded-mode sign-out does not attempt or claim remote revocation. Online
sign-out explicitly uses [Supabase local scope](https://supabase.com/docs/reference/javascript/auth-signout)
so it does not sign out the author's other devices. Background refresh is stopped
using the SDK's [public method](https://supabase.com/docs/reference/javascript/auth-stopautorefresh).
These behaviors do not imply remote erasure of downloaded copies; UI/docs explain
the local-copy policy. Native auth records still use the prior SQLite adapter
and require encrypted-storage migration before release.

Evidence: 85 mobile unit/regression tests and typecheck; two consecutive fresh
phone-sized Chrome PWA/desktop/Python round trips. With the real service worker,
the test expires the persisted SDK session, disconnects, cold-reopens the book,
reads prose, rejects voice/sync, captures and reopens another idea, and observes
zero hosted attempts while in downloaded mode. Reconnection invokes the real
SDK token refresh without uploading captures automatically. Offline sign-out
locks reopening and removes auth records while both ciphertext captures remain.
After same-account sign-in, both captures import through the actual Python inbox
with manuscript prose unchanged. Hosting/auth HTTP responses are simulated;
no private manuscript or live provider is used. The offline queue screenshot was
visually inspected.
The fresh preview PWA export/walkthrough passes, as does the iOS JavaScript/Hermes
export (873 modules, 2.9 MB). The latter is not native compilation or physical
device verification. Repository checks pass.

The test exposed Chrome 152 resetting `navigator.onLine` on reload despite
offline emulation; a separate blank-page reproduction confirms this is not
application code. The replacement CDP override also reset. The implementation
therefore persists explicit downloaded mode instead of relying on that hint.
The test independently rejects hosted HTTP calls while disconnected and observes
request attempts; it does not patch `navigator` or bypass production auth.

Still open: physical Safari/Android and signed native execution; native auth
encryption and legacy migration; native snapshot-cache key-creation and project
key-index concurrency; cross-tab sign-out redaction and in-flight lifecycle
cleanup; quota/eviction, full deletion/revocation and recovery drills; approved
live hosting and phone voice; manuscript concurrency and novel-scale AI/review
quality. The design skill concentrated local access rules behind one module;
this checkpoint is progress, not production readiness.

### 2026-09-07 — manuscript transaction isolation

Reproduced the recorded rollback regression: a failed AI apply replaced a newer
author save already on disk with the original scene. A targeted read immediately
before rollback proved this was a write-isolation failure, not stale rendering or
revision lookup. Four further regressions reproduced the same loss in a separate
Python process, coordinated apply, undo and revision restore. All five failed
before the fix and passed after it.

Added a shared, reentrant project-access module around the initial state read,
preconditions, writes and rollback. It combines thread serialization with POSIX
file locking, uses a persistent workspace lock file, releases on exceptions and
process exit, handles fork ownership, and fails closed if locking is unavailable.
Scene reads, proposal review mutations, revision operations, manuscript import,
Git/Storyline mutations and local mobile snapshot projection participate.
Provider calls are outside the protected scope. Different books remain independent.
The codebase-design skill guided this shared interface rather than UI-specific
protection; [the module contract](manuscript-transactions.md) records usage and limits.

Additional competing-caller tests catch duplicate scene IDs for simultaneous
different titles, provisional prose leaking to readers, and a revision containing
only half of a coordinated apply. Disabling protection in an in-memory test probe
made all three fail; no source modification or debug instrumentation was retained.
A further red-before-fix test caught mobile projection pairing an old revision ID
with newly applied prose; the projection now holds the same project lock.

Fresh verification: 181 Python tests, including 15 manuscript/lock regressions;
164 desktop tests and the production frontend build; eight native bridge tests
(the separately opted-in real Keychain test was not rerun); the browser/real-Python
write → focus → AI draft → review → apply → undo → reopen workflow; and the
phone-sized encrypted companion/desktop/Python round trip with expired-session
offline reading, capture and deliberate reconnect. Hosted HTTP remains simulated
in the companion test; no physical phone or live provider was used. The 400-scene,
300-proposal, 300-generation scale gate passed all configured budgets, with scene
save at most 16.125 ms and project load at most 72.418 ms in that run. Repository
checks and whitespace checks pass.

This does not establish production readiness. Remaining manuscript gates include
save-time content/Storyline preconditions, external-editor conflict recovery,
durable multi-file crash recovery, proposal/revision metadata reconciliation, and
coordination of Codex/planning/other versioned stores. Raw export/retrieval and
initialization paths need further coverage. The existing mobile anchor also needs
verification against unrevisioned working text. Native credential migration,
physical-device voice, approved hosting and novel-scale AI quality remain open.

### 2026-09-07 — guarded saves and recoverable conflict review

The next browser/real-Python regression reproduced an older loaded editor
silently overwriting another writer's saved prose. This was not only a missing
warning: the test read the replaced sentence from the scene file. Inspection of
the actual scene-read and save-request fields confirmed the cause: no loaded
version crossed the editor-to-engine interface. The reduced browser check failed
in 5.4 seconds before the implementation.

Added `scene_edits.save_scene_edit`, using the shared project lock to compare
project/Storyline scope and digests of the submitted fields, write, and return
the exact saved version. Prose and Inspector updates can merge when they affect
different fields; competing changes to the same field require review. Completed
external edits are detected even if `updated_at` is unchanged. Same-content
retries do not rewrite the file. A queued save checks after acquiring the lock,
and its acknowledgement cannot adopt another writer's later scene.

Conflicts preserve the submitted draft and current scene in a local workspace
JSON backup before returning a structured failure. The editor pauses autosave,
retains live writing, and shows a saved-versus-draft review. Reconciled saves are
checked again; another intervening edit triggers another conflict. A Storyline
transfer requires an explicit destination choice. Inspector edits use the same
guard and retain entered fields when background refreshes arrive. Recovery
records carry their original edit version; restoring a draft cannot silently
authorize overwriting newer prose. Legacy records without a version require
comparison. Optional Story Memory scan failures produce a warning alongside the
committed save response. The design skill guided a shared guarded-save interface
and the separation of saved state from a dirty editor's baseline.

Verified: 191 Python tests (including 10 guarded-save regressions), 174 desktop
tests and production frontend build, and nine native bridge tests including a
real guarded-save/conflict-backup path. Two fresh browser runs passed writing,
focus, deterministic AI review/apply/undo, stale save rejection, reload/recovery,
a third writer during comparison, explicit reconciliation and reopening. The
conflict screen was visually inspected. The 400-scene scale gate passed; its
existing save metric exercises the internal save path, not the complete UI or
every guarded conflict path. Repository and whitespace checks pass. The opt-in
real Keychain test and live provider/physical-phone voice were not rerun.
Shared contracts (19 tests), gateway (28 tests and build), and mobile (85 tests)
also pass their fresh typechecks and test gates.

Not yet production-ready: unsent recovery entries still share a project/scene
slot across windows and Storylines; newer writing after an initial conflict is
not in that earlier engine-written copy until submitted. Multi-draft durable
recovery and a usable archive browser are the next safety work. Full crash
recovery, unsaved-navigation policy, concurrent external-file races, legacy
unconditional CLI callers and metadata-store coordination remain open. So do
native credential migration, mobile voice/device/hosting gates and realistic
novel-scale AI quality. See [the updated save contract](manuscript-transactions.md).

### 2026-09-07 — connected author journey and chapter reading

Following the author's request to balance bug fixing with a functional, sufficiently
complete product, the task-oriented assessment is now in
[Author journey readiness](author-journey-readiness.md).

The bounded recovery fix supersedes the shared-slot limitation above. Each editor
owns a separate browser journal slot with monotonic sequences; retirement receipts
cannot erase another owner's or a later sequence's writing. A chooser exposes
multiple drafts and preserves original guarded-save preconditions. Corrupt bytes
are retained. Browser storage eviction, native forced-crash recovery and a full
disk archive are still not solved.

The new browser/real-Python journey imports an original two-scene fixture, saves
the project brief, builds a chapter in the reverse of file order, adds a beat,
reads the chapter, creates/edits Story Memory, searches prose and Memory, sends a
scene-scoped local copilot turn through stdio, promotes its answer to a note,
exports Word, re-reads export order and reopens the saved plan and note. Only the
native transport is adapted; the Assistant test process forwards actual core
events but does not certify persistent native streaming/interrupt lifecycle.

That journey exposed an unclickable copilot promotion menu and export ignoring
Plan order. The menu now expands inline; both Word and Markdown export use the
same ordered-scene function as the new reader. Planning mutations and export are
covered by the existing project lock. Source manuscript files remain unchanged
by reading/export. Export is still scene-oriented, not full document typesetting.

The new read-only manuscript view is reachable from Manuscript and Plan, provides
chapter navigation, retains unassigned scenes, renders at most 25 scenes per page,
waits for pending scene saves and opens fresh scene state for editing. Screenshots
of chapter reading and the corrected chat sidebar were inspected.

Fresh verification: 193 Python tests, 181 desktop tests, desktop production build,
85 mobile tests plus typecheck, and nine native tests pass. The real Keychain test
remains deliberately ignored. Both browser journeys passed twice on fresh books
(four passing runs). No live providers, cloud deployment, private manuscript,
physical phone, signing or clean-machine installation was exercised. Production
readiness remains unestablished.

### 2026-09-07 — alternate ending, copilot focus and chapter navigation

Completed a browser/real-Python creative exercise on an original six-scene,
three-chapter manuscript: create an alternate-ending Storyline, revise two scenes,
discuss the ending chapter while a different chapter is open, return to Primary,
compare, select only the ending for integration, review/apply, verify the other
scene is unchanged, and undo. The fixture is small and the provider is offline;
this establishes connected mechanics, not novel-length editorial judgment.

The reduced browser test reproduced a clean cached scene tab retaining Primary's
guarded-save version after entering a Storyline. A shared scene activation module
now reloads saved state before editing; dirty tabs retain their original baseline.
Tests cover load failure/retry and late completion after closing a tab. The guards
were not relaxed. This is not a complete unsaved-navigation or crash policy.

The chapter-context regression was also reproduced in a direct core test. Explicit
chapter scene membership now determines primary context instead of an unrelated
open scene being prepended. Empty chapter selection fails clearly. The saved
project brief/style guide now reaches shared text and desktop-voice context; the
whole brief is budgeted or rejected. Existing other payload/budget mismatches
still need a separate audit and correction.

Added a chapter-aware manuscript sidebar: saved Plan order, act/chapter grouping,
scene/word counts, collapse, current-scene highlighting, title/chapter/POV filtering
and unassigned-scene access. Failed Plan reads retain a flat fallback with retry;
outdated asynchronous responses cannot replace a newer Storyline's navigation.
The codebase-design skill guided reuse of the existing Plan as the source of
order. The connected book journey now verifies reversed file ordering, collapse
and filtering in the actual browser. Navigation, Storyline comparison and applied
change screenshots were visually inspected.

Fresh verification: 197 Python tests, 191 desktop tests, 19 contract tests,
28 gateway tests plus build, 85 mobile tests, nine native tests and the desktop
production build pass. The real Keychain test remains ignored. All four desktop
browser journeys pass together against disposable local projects. Repository and
whitespace checks pass. No live provider, private manuscript, deployment, physical
phone, signing or clean-machine install was exercised.

Next context work is a release gate, not an inferred success: code inspection found
raw Story Memory records entering Assistant context without visible enforcement
of entity/detail AI visibility or private-note exclusion. Retrieval and tool
results need equivalent verification. Some item accounting clips serialized text
while retaining a larger raw provider payload. Accepted canon, active Storyline
intent and Plan-order neighboring context also need deeper usefulness checks.
These findings are recorded for direct reproductions and shared fixes; current
tests do not certify provider privacy or complete context budgeting. The app is
not yet production-ready. Continue these gates alongside substantial-book review,
reading-position/planning-draft ergonomics and mobile companion delivery.

### 2026-09-07 — Memory access, consent and scoped regeneration

The previous source-privacy finding now has direct failing-before-fix evidence:
an excluded Memory entry and an included entry's private author notes entered
raw context packs. The reduced two-test loop took 24 ms, without retrieval,
history or scenes. Storage preserved the settings; context construction and
downstream prompts did not project them. The same raw read paths existed in
revision generation and Assistant tools.

Added `memory_context.py`, a shared allowlisted projection, following the
codebase-design skill's shared-interface guidance. Excluded entries/fields and
private notes are not model-facing records. Ask-before-use requires a separate
trusted, per-request approval intersected with explicit references, not a model
argument or persistent thread preference. Approved mutations do not implicitly
approve reading ask-before-use details in their results.

Desktop chat now presents an explicit allow/cancel review, retains unsent questions
on cancellation/failure, checks current access and asks again for regeneration.
The browser/real-Python exercise verifies those actions and a later exclusion,
reads the actual context pack and confirms private author records remain intact.
Typed-detail and forged tool-argument cases have core/rendered regressions.

Retrieval now indexes projected Memory and validates per-source digests against
current allowed content before returning even stale results. Old indexes signal
a policy freshness change and require rebuilding for Memory excerpts. A prepared
voice pack must pass a current Memory-access stamp before new provider negotiation;
legacy packs or later revocation require re-preparation. Mobile applies its
projection at read time to older downloaded snapshots and includes permitted
typed details in search. Complete encrypted author records are retained.

The connected editorial journey also found regeneration dropping chapter-picker
targets because it recovered only textual mentions. It now retains the previous
chapter/character targets and obtains new permission where needed. Visual QA found
the two scope selectors squeezed the character question box to 26.6 pixels;
selectors now occupy their own row, and the browser asserts usable input width.
The corrected permission/composer screenshot was inspected.

Fresh verification: 206 Python tests, 196 desktop tests, 19 contract tests,
28 gateway tests plus build, 86 mobile tests, nine native tests, desktop production
build and mobile PWA export pass. The real Keychain test remains ignored. All five
desktop browser journeys pass together after the final layout change. Repository
and whitespace checks pass. No live provider, private manuscript, deployment or
physical phone was used.

See [Memory context](memory-context.md) for the bounded contract. This work does
not erase old transcripts, retract already-sent voice context or update permissions
inside an offline phone snapshot without sync. Voice has no one-entry consent UI
yet; `ask` sources stay withheld there. Provider-level privacy review, complete
prompt/budget alignment, accepted-canon and Storyline context, meaningful
novel-scale reviews, long-session drafting and physical-device voice still need
work. Production readiness remains unproven.

### 2026-09-07 — Book-aware editorial context through prose drafting

Four fast failing checks established missing accepted canon/Storyline intent,
file-ordered context neighbors and absent protection for required editorial
constraints. Added a shared review-context module for relevant accepted facts,
evidence status, validity, character knowledge, authored chapter intent, Plan
order and the active Storyline brief. Memory subject access and per-request
approval are reused; suggested/rejected facts and inaccessible subjects are not
promoted into context. Exact excerpt checks flag evidence that no longer exists.

Chat, desktop voice preparation, proposal planning and whole-scene prose drafting
now receive these inputs. The drafting path also receives allowed Memory and
Plan-ordered neighbors; its logs report the actual context settings. A collapsed
Context used receipt makes chapters, supplied canon count, Storyline, omissions
and evidence warnings visible beneath replies. No claim of completeness is made.

The original alternate-ending browser journey now verifies a saved accepted fact,
protected Storyline constraints, chapter context and the visible receipt before
regeneration/selective integration/undo. Its screenshot was inspected. Six new
core tests cover the shared selection and actual prompt paths, including separate
ask-subject permission, and two rendered tests cover the receipt.

Verification: 212 core tests, 198 desktop tests, 19 contracts, 28 gateway tests
and build, 86 mobile tests, and desktop production build. All five desktop browser
journeys pass together. Repository and whitespace checks pass. Only disposable
original fixtures and the offline/local provider were used.

See [Editorial context](editorial-context.md) for exact limits. This is not novel-
scale model-quality certification, mobile rich-context parity, general prepared-
voice freshness or whole-prompt budget closure. Hunk/merge context, full-payload
accounting, longer-book judgments, daily drafting ergonomics and physical-device
voice remain next steps. Production readiness is still unproven.

### 2026-09-07 — Approved next milestones, input budgeting and recoverable chat

The author approved the product vision and requested a durable plan plus resumed
implementation. The approved sequence and acceptance criteria now live near the
top of `product-development-plan.md`. Mobile remains an active companion track.
A running-desktop connection, possibly through Tailscale, is recorded as an
option to investigate alongside hosted snapshots and a hybrid. No claims about
ChatGPT/T3Code implementation were verified, no architecture replacement was
chosen and no hosting/network exposure was authorized or performed.

Completed the paused assistant input-accounting work. The shared estimate now
measures assembled prompts, history and tools rather than clipped manifest
previews; response reserve is numeric. Required scene prose and selected passages
remain complete or fail admission; oversized optional neighbors are omitted with
receipt reasons. Recent history keeps complete contiguous exchanges. Text tool
rounds recheck accumulated inputs before a provider call. Desktop voice connects
with its prepared instructions, tools and output limit rather than rebuilding a
different input. Eight targeted payload-budget tests cover these behaviors.

The resumed browser regression first failed because a fixed error notification
intercepted clicks on Send. A geometry assertion reproduced the overlap in seven
seconds. Notifications now occupy reserved layout space with bounded, scrollable
text and an explicit dismissal control. Narrow sidebars anchor inside the
remaining workspace. The getting-started guide also uses reserved space rather
than a fixed overlay with an invalid bottom variable. A new send clears the old
error; failed input and cancellation preservation remain intact.

The capacity journey uses two repetitive original scenes, not an author's book.
It verifies rejection before any messages are saved, retained question, reachable
controls at 1400/1000/820-pixel widths, a successful Scene retry with full prose,
optional-neighbor omission, a visible estimated-input receipt and unchanged
manuscript text. Error/retry screenshots were inspected. This is not a literary
quality evaluation.

Verification: `make test-all` passes 220 core, 198 desktop, 19 contract, 28 gateway
and 86 mobile tests, with package typechecks and the gateway build. Desktop tests
and production build were rerun after the final onboarding layout change and
pass. The six desktop browser journeys pass together. Repository and whitespace
checks pass. Browser execution uses the real Python core with native transport
adapted and an offline provider; no live calls, deployment or physical-device
verification took place.

Limits: token values are heuristic estimates, not exact model tokens, provider
wire-format accounting or billing guarantees. Initial voice admission and an
output limit do not bound continuous session growth, later client policy changes
or session spending. Existing tool-result clipping remains; hunk/merge context,
prepared scene/canon freshness, richer mobile editorial context, substantial-book
judgment and release certification remain open. The next product task is the
longer-book editorial loop, not another standalone feature inventory.

### 2026-09-07 — Book-sized coordinated review and desktop-companion research

Advanced the approved editorial-workflow milestone with a 36,476-word, 64-scene,
16-chapter synthetic workload. Original anchor passages plant an early secret,
premature character knowledge, later disclosure and a protected deadline. The
surrounding prose uses recurring generated patterns: this is book-sized mechanical
evidence, not an authored novel or a literary-quality benchmark. See
`editorial-workload.md` for the independent expectations and limits.

The connected browser/real-core journey exposed and fixed three review UI faults:
late scene loading left the composer disabled despite a displayed scene; switching
proposal tabs retained the previous review; and group apply updated the queue
without updating open reviews. The composer now initializes late defaults without
resetting author choices. Reviews are keyed by tab and use its current proposal
record. Group results update open tabs and scene summaries, with a pending guard
on group submission. Hunk edit buttons have distinct accessible names.

A 337-millisecond rendered regression reproduces the delayed selection fault.
The small coordinated rendered contract also failed on missing Undo after group
apply. Both pass after the fixes. The real browser journey checks correct review
identity, refuses a group with a deliberately damaged protected phrase without
changing either scene, restores the phrase, applies both scenes in one Revision,
shows immediate Undo and explicitly undoes each member. It then verifies distant
citations and accepted canon in Book-scoped chat, opens the cited scene and reads
all 64 scenes through the CLI to confirm original prose is restored.

The longer text also exposed the local fallback removing “rather” from “rather
than.” A 29-millisecond public drafting regression reproduced the broken sentence;
the modifier rule now preserves that comparison. This narrow repair does not
establish general grammar or editorial quality. Screenshots of coordinated review
and cited-source navigation were inspected.

Fresh verification: 221 Python, 199 desktop, 19 contract, 28 gateway and 86 mobile
tests pass, along with typechecks, gateway build, desktop production build and
repository/whitespace checks. All seven desktop browser journeys pass together
after the final changes (about 61 seconds). Only disposable fixtures and the
offline provider were used; no live inference, manuscript upload, deployment or
physical-device testing occurred.

In parallel, first-party source research evaluated desktop-connected mobile.
`research/desktop-connected-mobile.md` verifies T3 Code's running-host/pairing/
Tailscale HTTPS precedent and distinguishes private network reachability from
per-device/project app authorization. It recommends testing a narrow loopback
context/capture bridge while retaining encrypted offline reading/capture, before
any separately authorized network/device stage. The main agent checked the pinned
T3 source and Tailscale Serve documentation. ChatGPT's architecture remains
unverified; no installation or service exposure was performed.

Next author outcomes: explicit coordinated undo, retained review/reading state,
and a non-templated multi-chapter editorial exercise with independently judged
issues. Live evaluation requires an agreed manuscript scope and spending cap.
Mobile bridge prototyping remains a bounded candidate, not a selected replacement
for hosted sync. Production readiness remains unproven.

### 2026-09-11 — One-action coordinated undo

Delivered the next author task: undo an applied multi-scene Revision together
from Changes, with the affected scenes listed before the action. The shared core
resolves membership from the applied Revision, checks both snapshots and current
history, verifies every proposal and exact scene-file content, and enforces the
recorded workspace/Storyline scope. The desktop and CLI pass one Revision id, not
a hand-built sequence of scene restores. There is no group force override.

Newer saved prose or metadata, a missing/corrupt member, partial prior undo or a
changed Storyline stops all restoration. Other scenes' newer work is preserved.
Success records one Undo Revision, updates every member and refreshes open reviews
and scene tabs. The button is disabled while pending or when an affected scene
tab has unsaved changes. Partial prior undo has an individual-review explanation.

Thirteen new core tests cover the public group interface, real CLI dispatch,
unchanged unrelated work, reused group labels, retry, malformed recipes, snapshot
integrity, Storyline scope, newer writing/metadata, missing proposals, failures in
scene/proposal/HEAD writes, activity-log warnings and a competing reader. The
rendered workflow now exercises failure/retry and pending/open-review state.
The 64-scene, 36,476-word browser workload restores its two distant changes in one
action and confirms all original prose. A new browser case verifies that newer
author writing in one member leaves both scenes, proposals and history untouched.
Review, undo and refusal screenshots were inspected for usability.

Fresh final-code verification: `make test-all` passes 234 Python, 199 desktop,
19 contract, 28 gateway and 86 mobile tests (566 total), with shared/package
typechecks and gateway build. The desktop production build passes. All eight
desktop browser journeys pass together (about 90 seconds). `git diff --check`
and `make check` pass; the capability registry remains at zero release-ready
capabilities. These are local browser/engine checks with native transport adapted
and deterministic offline providers, not signed-native or real-phone evidence.

Limits: older groups without the newly recorded membership/workspace recipe are
not retroactively guessed; they retain individual review. Moving the book changes
its workspace scope. Exact-file protection intentionally refuses even frontmatter
changes. Caught failures roll back scene/proposal files and HEAD; unreferenced
Revision records/objects may remain. Crash interruption, failed rollback and raw
external writers still need durable recovery. This checkpoint does not repair
all older single-apply/undo or coordinated-apply transaction failure paths.

Next: retain reading position and unfinished review/Plan drafts, advance the
non-templated editorial-quality exercise, and test the bounded desktop-connected
mobile companion candidate. No live inference, manuscript upload, new network
exposure, deployment or physical-device testing was performed in this pass.

### 2026-09-11 — Writing Voice and review-first prose quality

Implemented the author's approved [Writing Voice workflow](writing-voice.md):
editable per-book craft preferences, three original presets, natural-language
briefs, evidence-linked suggestions from author-selected exemplars, short
two/three-direction samples, saved human assessments and explicit Change Set
handoff. Approving a profile changes future manuscript guidance, not existing
prose or the copilot's conversational personality. Samples and inferred traits
never apply themselves or become automatic learning.

The shared profile projection reaches desktop text/voice context, proposal
planning, whole-scene drafting, hunk regeneration and merge generation. Context
receipts identify the profile; stale desktop voice preparation must be refreshed
after a profile change. This does not establish full hunk/merge editorial parity
or add the profile to the independent mobile snapshot/context adapter.

Profile saves use optimistic profile/workspace checks and verify exemplar hashes
and quoted evidence. Samples are bounded, saved separately, and handed off only
against their exact original scene version. Failed draft/link writes recover the
same proposal on retry rather than resetting reviewed work or creating duplicates.
The UI retains profile drafts and promoted briefs, handles invalid recovery data,
keeps saved assessments current in comparison history, and can expand/restore
the side-by-side layout. Preset changes clear obsolete exemplar hashes and select
other comparison directions. Local mode is explicitly a noncreative baseline.

The broad browser run exposed a pre-existing Plan load race: a late initial
response could replace newly typed synopsis text. Using the diagnosing-bugs
workflow, a minimal Strict Mode component test reproduced the blank value twice
(85–187 ms) before Save. A request-sequence guard rejects obsolete completions;
the regression and connected import/Plan/export/reopen journey pass after repair.
The prevention is the same lifecycle rule used in newer editors: obsolete async
reads must not overwrite current author input. This is not full Plan draft
retention or a solution to every Plan mutation race. No diagnostic instrumentation
or disposable debug harness remains; the focused test is retained as a regression.

Fresh final-code `make test-all` passes 255 Python, 209 desktop, 19 contract,
28 gateway and 86 mobile tests (597 total), including package typechecks and
gateway build. After correcting a test-only query option caught by TypeScript,
all 209 desktop tests pass again, the desktop production build passes, and all
nine browser/real-Python journeys pass together (about 84 seconds). The final
Writing Voice profile and expanded comparison screenshots were inspected.
Repository and whitespace checks pass; no capability is labeled release-ready.
At the commit checkpoint, the 597 package tests pass again. Native compilation
and `make tauri-test` also pass: nine tests, with the real-Keychain round-trip
test intentionally ignored because it requires explicit execution. This verifies
the native bridge locally, not a signed application, physical phone or release.
No live inference, private manuscript uploads, deployment, new network exposure
or physical-device tests were performed. Literary quality still needs independent
author judgment on original or authorized prose with an agreed evaluation budget.

### 2026-09-12 — Session continuity and original-scene quality evaluation

Implemented shared local working-copy retention for Plan briefs, act/chapter/beat
drafts, scene planning metadata and unfinished Writing Voice assessments. Reading
restores a chapter/page and scene-relative scroll offset, including locating a
moved scene. Saves preserve newer typing and use original-value/Storyline
preconditions; stale drafts require explicit comparison and reconciliation.
See [session continuity](session-continuity.md) for storage and concurrency limits.

The connected reload journey revealed a late first-scene fetch taking focus from
the reader. A 13 ms hook/real-editor-context regression reproduced the wrong
active tab before repair. Editor-owned navigation receipts now invalidate that
obsolete completion when a later tab/navigation choice occurs. The original
browser journey and focused regression pass. The full desktop suite also caught
a saved-metadata card display regression, repaired without weakening its test.
No temporary diagnostic instrumentation remains.

The [writing-quality exercise](writing-quality-evaluation.md) uses three original
action/dialogue/introspection scenes, nine blinded samples, explicit scene facts,
and independent human craft judgments. The actual run at this checkpoint was
offline: nine unchanged baselines and zero inference calls. The existing ChatGPT
subscription connector and priority logic were confirmed present; its account
check was unauthenticated, not a missing implementation. No API-key provider,
credential copying or private manuscript upload was used. Subsequent authorized
sign-in and live results must be recorded separately from this offline evidence.

Fresh final-code verification: `make test-all` passes 267 Python, 230 desktop,
19 contract, 28 gateway and 86 mobile tests (630 total), including package
typechecks and gateway build. The desktop production build passes. All ten
desktop/real-Python browser journeys pass together (1.9 minutes); recovered Plan,
resumed reading and recovered-assessment screenshots were inspected. Native tests
pass nine cases; the explicit real-Keychain round trip remains ignored. Repository
and whitespace checks pass. No capability is marked release-ready.

This is not physical-mobile, signed-distribution or power-loss recovery evidence.
Local drafts are plaintext, per-device working data, not encrypted synchronization.
The strengthened craft instructions have reached the provider interface in tests,
but their effect on generated prose still requires a subscription run and author
judgment. Full-book style evaluation and companion context parity remain open.

### 2026-09-12 — Authenticated Terra evaluation and quote-format repair

After author-requested sign-in, the existing app-server reported authenticated
ChatGPT mode and listed both approved models, Luna and Terra. The evaluation used
explicit `gpt-5.6-terra` through `openai-codex`; it did not change provider defaults
or use API-key providers/private manuscripts. The first failed attempt exposed
loss of partial evaluation reports. The runner now records rejected comparisons,
retains safe per-call provenance, continues only the fixed remaining scene cases
without retry, and exits nonzero for a partial result.

A one-call diagnostic showed an exact evidence sentence surrounded by extra
presentation quotes. The public preview now removes one matching quote pair only
when all enclosed text occurs verbatim in the candidate. Existing dialogue quotes
remain intact; fabricated, empty and ellipsis-shortened evidence stays rejected.
The captured case's focused public-workflow regression failed before the repair
and passes after it. No diagnostic instrumentation remains in application code.

The final run made seven recorded subscription calls and accepted six candidates
across dialogue and introspection. Action still failed its evidence check; its
remaining mismatch is not diagnosed. The
[label-blind assistant assessment](evaluations/writing-voice-terra-2026-09-12-attempt-3/assessment.md)
notes preserved restraint but modest style differences and some dialogue detail
slippage. Author assessments remain empty. This is partial live integration and
creative-output evidence, not a passed literary-quality gate or model comparison.

Fresh verification after the repair: `make test-all` passes 270 Python, 230 desktop,
19 contract, 28 gateway and 86 mobile tests (633 total), including package checks.
The desktop production build and repository/whitespace checks pass. The earlier
ten connected desktop browser journeys and native tests were not rerun in this
follow-up; no native or frontend behavior was changed by the quote-format repair.
No physical-mobile or release-readiness claim is added.

### 2026-09-13 — bounded voice review, proposal loop and context receipts

The remaining Writing Voice action case was rerun as a bounded, best-effort
Terra preview using only the original fixture scene and the authenticated
ChatGPT subscription. Three variants were retained for human review in the
[action packet](evaluations/writing-voice-terra-2026-09-13-action/review.md),
with an [assistant assessment](evaluations/writing-voice-terra-2026-09-13-action/assessment.md).
The app now preserves valid generated prose when provider self-review metadata
is malformed, while the strict evaluator continues to reject that metadata.
One variant advances the interrupted count and remains unsafe to select without
author repair; no author verdict is inferred.

The real-Python browser journeys for proposal review/apply/undo, conflict-safe
reconciliation, distant evidence and context receipts pass. Chat receipts now
show scope, included scene titles, nearby scenes, whether a selected passage was
included and the number of retrieved evidence results, so an author can inspect
what reached the response rather than trusting an opaque context label.

Fresh verification passes: `make test-all` (274 Python, 230 desktop, 19
contract, 28 gateway and 86 mobile tests), desktop and gateway builds,
`make check`, and the phone-sized mobile PWA build plus Chromium companion
journey. This is local/browser evidence only. Published hosting, deployed auth
and RLS, physical-device voice, signed native builds, and author judgments on
creative quality remain open release gates.

### 2026-09-22 — saved ideas back into revision

Saved notes are now searchable and filterable within Plan, beside the brief.
Copilot provides a direct **View saved note** link. A note can open its scene or
prefill the existing Change Set form with its exact text and scene, allowing the
author to edit both before generation. The handoff creates no changes until the
author requests them; generated prose remains pending ordinary review.

New rendered checks cover search/filter behavior, exact note handoff, unavailable
scenes and a note refresh while the author has an unfinished Plan brief. Plan
navigation reactivates an already-open scene instead of replacing its draft;
asynchronous scene loads respect later navigation. Note-specific generation tabs
close correctly when their Change Set is ready.

Verification: all 234 desktop tests pass, the desktop production build passes
(with Vite's advisory about a bundle above 500 kB), and the expanded connected
book journey passes through saved-note search, revision preparation, offline
generation, export and reopening. The 64-scene coordinated-review journey also
passes. An initial browser run correctly rejected a no-op offline revision; the
final fixture explicitly selects a passage supported by the deterministic
provider. No live inference was used. Python/mobile/gateway suites were not
rerun for this frontend-only change. No deployment or physical-device result is
implied.

### 2026-09-22 — continuity evidence, review decisions and revision handoff

Canon Facts and Continuity Diagnostics expose their recorded excerpts and named
source-scene links. The diagnostics view separates findings needing attention
from reviewed findings; deferred decisions remain actionable. Authors can save
review notes, change an earlier decision and prepare a scene-specific revision
in the ordinary Change Set form. The request carries the finding and author
notes and explicitly asks for validation before revision. It does not generate,
apply, change canon or mark a finding fixed automatically. For several affected
scenes, the author chooses the target first.

The browser/real-Python 64-scene workload now verifies the knowledge-leak path:
early and later evidence, scene opening, review decision/reason persistence across
reload, return to Needs attention and the editable revision handoff. All scene
bodies and the existing proposal count remain unchanged by those actions.
Rendered tests cover multiple-scene selection, missing sources, deferred and
reviewed filtering, dirty-tab preservation, failed-save note retention and report
failure/retry. Recorded excerpts are labeled as such and are not a current-source
verification claim. The existing diagnostic engine remains heuristic.

Final-code verification: 239 desktop tests pass, the production build passes
with the existing Vite bundle-size advisory, and the expanded 64-scene browser
journey passes. Repository and whitespace checks pass. The screenshot of the
evidence/review screen was inspected. No live inference or deployment was used;
Python/mobile/gateway suites were not rerun for these frontend changes.

### 2026-09-22 — correctable and withdrawable Canon Facts

Canon & Continuity now offers **Correct or withdraw fact**, with editable
predicate/value, validity boundaries and existing evidence passages. Filters
separate accepted, needs-review and withdrawn facts. Withdrawal preserves the
record and sources while removing it from new accepted-canon context and
fact-based diagnostics. Restoration checks exact excerpts against current saved
scenes. Earlier conversations retain their original context; this is not semantic
verification or a complete fact-history interface.

The CLI requires a fact/workspace/Storyline edit version. Conflicting updates are
rejected without overwriting the current record; failed UI saves retain entered
text while the editor remains open. All public Memory read/write operations now
cooperate with the existing project lock so concurrent questions, facts, setups,
arcs and decisions do not lose each other's records. No schema migration or new
storage service was needed. Unfinished fact edits are not durable across
navigation/restart, and fact corrections do not create named Revisions.

The expanded 64-scene browser/real-engine journey verifies withdrawal, reload,
invalid-evidence rejection and successful restoration, with all 64 scene bodies
unchanged. It also exposed a Change Set form whose 100% minimum height collapsed
the tab bar. The diagnosing-bugs workflow reduced that to a separate browser
regression; making the form fill and scroll within the available editor space
fixes the navigation failure. Both browser journeys now pass, and the restored
canon screenshot was inspected.

Verification: 281 Python tests, 242 desktop tests, production frontend build,
repository checks and whitespace checks pass. The existing Vite bundle-size
advisory remains. No live inference, API spending, deployment or physical-device
testing was used. Mobile/gateway suites were not rerun for this desktop/core change.

### 2026-09-22 — approved Writing Voice in the mobile companion

New mobile snapshots reuse the core's approved `voice_context` projection. Name,
description, traits, guidance and avoidances are covered by the snapshot's
content digest and existing encryption. Exemplar analysis, preview drafts and
filesystem-scoped edit versions are not added. The mobile reader allowlists and
validates these fields, retaining compatibility with older snapshots that lack
the optional profile. Unknown extra profile fields cannot reach model context.

The phone Assistant identifies the downloaded profile and distinguishes its
manuscript guidance from Copilot's conversational voice. Refresh requires an
explicit desktop publication, online phone reopening and a new session; this is
not live desktop synchronization. Existing controller wiring supplies the full
profile before enabling microphone input. The 12,000-character local content
limit now admits the profile and selected scene in full or rejects before
transport creation. The author can clear scene focus in Assistant to retry.
Optional search excerpts remain bounded; full-request/token/session accounting,
Plan/canon parity and physical-device audio are separate gates.

Verification: 282 Python tests, mobile typecheck and all 91 mobile tests pass.
The locally simulated hosted browser journey uses real Python projection,
desktop encryption, phone SDK/storage/decryption and verifies profile display,
reopening and encrypted capture handoff. Hosted HTTP is simulated; neither live
provider voice nor production authorization is certified. The preview PWA build
and phone-sized browser/offline-shell journey pass. The profile screen screenshot
was inspected. Repository/whitespace checks pass. No paid inference, deployment
or network exposure beyond local test servers was used. Desktop/gateway unit
suites were not rerun; their production code was unchanged in this iteration.

### 2026-09-22 — accepted story facts in mobile voice context

Published mobile snapshots now reuse `build_review_context`'s accepted-only,
privacy-filtered facts without granting one-request Memory permissions. Projection
is bounded to 5,000 eligible facts by default. The phone rechecks local subject
and character visibility, selects facts relevant to the focused scene (or all
eligible facts without focus), and preserves validity, knowledge, confidence,
scope and exact source passages. It recomputes evidence presence against the
downloaded prose; matching text is not semantic proof or desktop freshness.
Suggested/withdrawn facts and facts linked to unavailable/private subjects cannot
enter the new canon context. This does not redact independently authored prose.

The initial session context includes the complete selected canon alongside Writing
Voice and focused prose, or refuses connection when they exceed the existing
local content budget. There are no new model tools, storage services or mobile
editing screens. The Assistant displays a selected-fact count and missing-source
warning; older snapshots explicitly say accepted facts are unavailable. Existing
read tools still retrieve scenes/entities, not additional canon. Plan/Storyline
intent and broader on-demand canon retrieval remain separate work.

Verification: 283 Python tests, mobile typecheck and 95 mobile tests pass, including
privacy, scene relevance, knowledge preservation, source revalidation, malformed
records, whole-content budgeting and pre-transport refusal. The real-encryption
browser journey verifies an outdated fact remaining in an open downloaded copy,
then disappearing after desktop withdrawal, publication and phone reopening.
Its stale-source warning clears and scene prose remains intact. The hosted HTTP
backend is simulated; no live voice or production authorization is certified.
PWA build and preview/offline browser checks pass. The refreshed-facts phone
screenshot was inspected. Repository and whitespace checks pass. No paid model
calls, deployment or physical-device testing occurred. Desktop/gateway unit
suites were not rerun for this mobile/core change.

### 2026-09-22 — mobile reading order and scene-to-discussion navigation

Snapshot publication now reuses `get_manuscript_reading`: the same ordered saved
prose used by the desktop reader, with unassigned scenes retained at the end.
Only act/chapter labels and a Plan-order marker are added to the mobile payload;
local workspace identity and full Plan documents are not copied. The snapshot
digest changes when chapter placement/order changes even without a new Revision.

The phone scene list shows chapter labels and searches those labels. The reader
shows scene position, Previous/Next controls and **Discuss this scene**, opening
Assistant with that exact scene selected. Changing scenes remounts the reader at
the top. Existing voice scene-list reads use the same order and chapter labels,
with an explicit warning that reading order need not be story chronology. Older
snapshots retain and identify their existing downloaded order; publishing again
is required for current Plan order. No new service, model tool, manuscript write
path or reading-position storage was introduced.

Verification: 284 Python tests, mobile typecheck and 96 mobile tests pass. The
local encrypted-publication browser journey verifies reversed file order,
chapter search, both navigation directions, first/last boundaries, unassigned
prose and reader-to-Assistant scope. The preview PWA build and offline browser
journey exercise navigation and discussion handoff with a legacy snapshot.
The phone reader screenshot was inspected. Repository/whitespace checks pass.
Hosted HTTP remains simulated; no paid inference, deployment or physical-device
audio test occurred. Mobile position restoration across restarts, richer Plan
intent and actual device acceptance remain open. Desktop/gateway unit suites
were not rerun for this mobile/core change.

### 2026-09-22 — author walkthrough and navigation repairs

The [walkthrough report](evaluations/2026-09-22-author-walkthrough.md) records
reproductions, fixes and the next product priorities. Browser testing exposed
unfinished captures disappearing on tab changes, loss of mobile reading focus,
desktop tab labels shrinking to 13 pixels, and mobile voice status falling below
the visible area. Passive reading/capture views now retain their open-book state;
leaving unfinished captures requires confirmation and pending saves block exit.
Desktop tabs scroll with readable widths and reveal the active document. Mobile
status/privacy feedback stays beside voice controls, with expandable context
details and browser-supported accessibility states.

This is in-memory navigation retention, not restart/crash recovery. Only passive
views are kept mounted; leaving Assistant still stops voice. A failed local
outbox insert retains the text and error, and retry produces one encrypted item.
No new service, persistence schema, paid inference, network exposure or deployment
was introduced. Computer controls were not available; this was a browser/Python
walkthrough with screenshot inspection, not native or physical-device acceptance.

Verification: 284 Python tests, 242 desktop tests, 96 mobile tests/typecheck,
11 desktop browser journeys and 5 mobile browser journeys pass. Desktop and PWA
builds, repository checks and whitespace checks pass; the existing desktop
over-500-kB chunk advisory remains. Gateway/native tests were not rerun in this
UI-focused pass. Physical-device audio and creative writing quality remain open.

### 2026-09-22 — voice preflight and writing comparison

The
[voice preflight](evaluations/2026-09-22-voice-preflight.md) records a repaired
stale-session UI bug and simulated-browser coverage of microphone cancellation,
mute, interruption, disconnect/playback retry and foreground cleanup. Mobile's
96 tests/typecheck, gateway's 28 tests/typecheck/build, 15 desktop voice tests,
nine offline evaluation tests, all five mobile browser journeys and the PWA build
pass. Expo Doctor reports 20/21 checks, with eight
patch-version mismatches documented for the next native-build preparation.
The nine-sample Luna subscription evaluation completed; literary quality and
fidelity still need author review. No live voice, physical-phone acceptance,
deployment or paid API inference occurred. Approved HTTPS/backend setup and
separate live-voice spending permission remain prerequisites for paired audio.

### 2026-09-29 — author directed writing refinement

Writing Voice now displays the saved original, permits targeted feedback on one
candidate and saves the refined prose as a new, unreviewed attempt. The previous
attempt and feedback remain visible. Feedback drafts use the existing recovery
journal; generator self-review is collapsed rather than placed ahead of author
judgment. No new model service, automatic learning or manuscript write path was
introduced. The shared core and CLI preserve the original scene/version through
repeated attempts and use the ordinary Change Set review/apply/undo path.

Validation: 289 Python tests, 243 desktop tests, all 11 desktop browser journeys,
the production desktop build, repository checks and whitespace checks pass.
Core tests use provider-boundary responses to exercise refinement, invalid
feedback/output, unchanged prior assessments, different Storylines, pre-call
staleness, edits during generation, exact application and undo. The browser
journey uses real Python with offline baselines and confirms the source display,
refinement, retained assessment, unchanged prose and reopening. Its screenshot
was inspected. These mechanics do not establish creative quality.

The initial full desktop run failed one existing scene-save shortcut test; that
test passed three isolated runs and the complete rerun. No save behavior or test
assertion was changed to hide the intermittent failure. Keep it on the regression
watchlist. Python emitted subprocess/file ResourceWarnings around a sandboxed
authentication check; tests passed, but this is not a clean lifecycle audit.
The existing over-500-kB bundle advisory remains. Mobile/gateway suites were not
rerun for this desktop/core writing change.

The [dialogue followup](evaluations/writing-voice-luna-2026-09-29-dialogue/assessment.md)
records three subscription-only Luna samples: the old added-ending behavior was
absent, while staging and restraint concerns remain. This is not proof of full-book
quality. A separate [fresh-scene live refinement](evaluations/writing-refinement-luna-2026-09-29/assessment.md)
used three more Luna subscription calls and verified exact apply/undo on a
disposable book. Its feedback compliance was partial, so creative quality remains
an author-review gate. This pass used six subscription calls in total, no API-key
inference and no real-manuscript edits. Author acceptance across a connected
chapter, actual phone delivery and clean-machine distribution remain open.

### Full-product sequence

1. Establish manuscript safety across all editing surfaces and pending operations.
2. Make fresh-checkout setup and multi-package verification reproducible.
3. Exercise the real desktop/Python write → assist → review → apply → undo loop,
   including cancellation, provider errors and conflicting edits.
4. Improve context usefulness, review ergonomics, onboarding and accessibility
   against a substantial original fixture manuscript.
5. Verify voice/mobile parity and deployment/device gates without weakening the
   desktop workflow or approval boundaries.
6. Run the full requirement-by-requirement completion audit and distribution tests.

Credentialed publishing, spending, and use of an author's private manuscript require
appropriate authorization. Such gates do not prevent independent local progress.
