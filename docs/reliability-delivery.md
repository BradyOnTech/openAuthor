# Authoring reliability and release delivery

The goal is to complete the September 2026 project review: protect writing and history, make recovery dependable, deliver a verified installation, and establish evidence from real authors. Passing source tests alone does not complete this goal.

**Work and completion evidence**

- [x] Preserve typing during delayed saves, queue newer saves, and verify tab/project changes and failed saves (rendered contract tests).
- [x] Checkpoint ordinary writing automatically, expose Save version, and restore prose, planning, and Story Memory (core and rendered tests).
- [x] Restore Story Memory snapshots and SQLite consistently, with rollback and forced-termination tests.
- [x] Update vulnerable dependencies and add scheduled advisory checks (npm audit: zero findings; workflows need publication).
- [ ] Remove the system-Git installation requirement for Storylines (embedded arm64 runtime verified; Intel still requires its native build).
- [ ] Verify signed/notarized arm64 and x86_64 artifacts, clean-machine installation, packaged GUI flows, crash recovery, and upgrades.
- [x] Add portable backups with integrity verification and recovery of history, Story Memory, and Storyline branches. Desktop controls flush pending writing and reject backups when that save fails.
- [ ] Recover from expired provider sign-in, interrupted generation, cancellation, and retries without duplicate artifacts.
- [ ] Evaluate import, inference, review, apply, and undo with real providers and consented manuscripts.
- [ ] Run a small author pilot measuring change comprehension, trust in undo, and return to revision work.

**External evidence still required**

Signing and notarization require valid Apple credentials. Both architectures require clean-machine installation evidence. Manuscript evaluation requires recorded author consent; the pilot requires participating authors and observed outcomes. These remain open until that evidence exists, regardless of implemented tooling or synthetic tests.

The user is unsure which manuscripts and participants are approved. Do not read private manuscripts for evaluation, send their contents to providers, or contact participants until scope and consent are recorded. Synthetic evaluation and pilot preparation may proceed.

The executable evaluation runner now prepares isolated source-hashed cases, performs cold-start extraction without seeding Canon, requires exact-draft hunk review, measures apply/undo/backup recovery, and separates synthetic decisions from human observations. It checks consent before reading a real source and rechecks both retained and original approvals before generation; a live call additionally requires explicit opt-in. The pilot record starts with no observed outcomes and no outreach authorization. This tooling is preparation, not completion of the real-author requirements.

**Current verification**

172 Python tests and the synthetic author-workflow gate pass, along with repository checks. The merge-recovery slice passed 109 frontend tests, six native bridge tests, and the frontend build; the dependency audit reported zero vulnerabilities. The 400-scene scale gate also passed after merge recovery, including 300 proposals, 300 generation records, and 72 entities. The rebuilt embedded arm64 Python/Git combination passes Storyline create, compare, switch, backup, recovery, and older Story Memory restoration with system tools removed from PATH. These counts describe local source/runtime tests, not signed-installation or author-pilot evidence. The latest completed packaged GUI drill covers hunk-retry restart and forced-process-termination recovery, as detailed below; merge-recovery controls have core and rendered coverage, not a native GUI failure/restart drill.

No Apple signing identities or repository secrets were available in the inspected environment. The unsigned packaging workflow permits native arm64 and Intel verification without signing credentials; neither that new workflow nor a signed release has been run on GitHub in this work.

The September 28 follow-up confirmed that the configured GitHub repository is private, its repository-secret list is empty, and the local keychain still has zero valid code-signing identities. There are no published releases or runs of the signed-release workflow. The inspected runtime configuration reports no credentials for the live providers. Approval has been requested to push the isolated reliability branch and open a PR for native packaging checks; that approval remains pending, and no merge or release is authorized by that request.

**Native GUI evidence: 2026-09-28, local arm64**

Built and launched the actual release-mode `.app`, using a disposable synthetic novel under `/tmp/openauthor-packaged-gui.lyEmrG`. Created a scene, saved prose, observed automatic Revisions, saved a named version, created a verified backup, created an alternate Storyline, edited it, returned to Primary, and verified the existing scene tab showed Primary prose. Restored the archive into a new folder and confirmed it opened without startup repair warnings. Closed immediately after typing, reopened, restored the recovery draft, and saved the exact recovered text. This last drill is application-closure recovery, not a simulated operating-system crash.

The native drill found two gaps that are now regression-tested: stale scene tabs after Storyline switches and missing empty runtime directories after backup recovery. Switching now waits for queued saves, makes prose temporarily read-only during the state change, and refreshes scene and character tabs. Edits made to Primary are also snapshotted before entering an alternate Storyline.

Rebuilt the app after provider recovery changes. In the same synthetic book, a deliberately restrictive local-only budget rejected a chat prompt. The recovery card retained the exact prompt, survived quitting/reopening the packaged app, and retried successfully after restoring the test book's original budget. The final conversation contained one user message and one assistant reply. No live provider was called.

Replaced the previous local development build with the newly rebuilt `.app` and verified that the existing synthetic book, saved prose, and eight Revisions remained accessible. This is development-build replacement evidence, not an upgrade from a published signed release.

For a forced-process-termination drill, made only the disposable book's scene directory temporarily unwritable, entered a new synthetic sentence, and verified the UI reported a failed save with unsaved text. Sent `SIGKILL` to the verified packaged app process, then restored the original directory permissions (`755`). The scene file's SHA-256 remained unchanged across termination. On restart, startup health detected the interrupted transaction; Run Safe Repair succeeded. The scene then offered the unsaved recovery draft, restored the exact sentence, and saved it successfully. A preceding timed attempt autosaved before termination and is not counted as proof of unsaved recovery.

For native hunk recovery, created one local-provider Change Set, temporarily reduced the synthetic book's input-token budget to one, and submitted a passage comment. The UI retained the feedback with Retry/Discard controls. Quit and reopened the app, restored the original unlimited budget, and retried the retained request. The same proposal gained one successful hunk-generation record with the exact original feedback. The recovery card cleared and the manuscript was not automatically changed. Both the budget and file permissions were restored after these drills; no author manuscript or remote provider was involved.

**Provider recovery evidence and limits**

Chat deliveries now have durable request receipts, staged transcript publication, and per-thread locking. Retrying after a lost sidecar response or transcript-write failure recovers the same completed result without another generation. Cancellation and failures publish no partial chat turns or pending tools. The desktop saves the prompt and context locally before sending and retains one logical delivery id across explicit retries and application restarts. CLI clients can supply `chat send --request-id` for the same guarantee.

OpenAI-style streams must reach `[DONE]`; Anthropic streams must reach `message_stop`. Dropped streams, invalid JSON/UTF-8, in-stream errors, socket timeouts, and truncated HTTP bodies are errors rather than successful partial answers. HTTP 401 retains its authentication category and sign-in guidance. Local HTTP fixtures exercise the real adapters without transmitting manuscript data. The completion signals follow the [OpenAI streaming API reference](https://developers.openai.com/api/reference/resources/chat) and [Anthropic streaming documentation](https://platform.claude.com/docs/en/build-with-claude/streaming).

Repeated approval of the same tool returns its recorded result, including for older transcripts. If the process fails after a potentially mutating tool starts but before its result is durably saved, replay is refused and the author is asked to inspect the book and Revisions. This is a fail-closed uncertain result, not a claim that every external action is transactional.

Standalone Change Set planning and drafting now support `--request-id`. Durable receipts and artifact-embedded delivery identities recover saved results after response loss, including failure before the final receipt write. The desktop journals each step in a coordinated or alternative batch and resumes unfinished steps instead of recreating successful proposals. The review panel uses the same mechanism for explicit regeneration. Receipts travel with portable backups. Core, CLI, and rendered tests cover repeated requests, application-session restart, failed storage, stopped batches, response loss, and backup recovery. A late draft is refused if the scene or review changed while the provider was working; a retry also refuses to overwrite a review changed since its first attempt.

Individual-hunk regeneration now uses the same delivery receipts and desktop journal, including the author's feedback. Replays recover the current saved proposal without another completed provider attempt, and changed input requires a new request identity. Publication refuses intervening scene or review changes. Authentication and budget failures retain categorized generation logs without altering the reviewed hunk. Regression tests cover loss after artifact publication but before receipt completion, CLI replay, concurrent author edits, synthetic authentication failure followed by retry, desktop restart, and the rendered comment/retry flow. The native budget-failure/restart drill independently exercises the packaged path.

Merge reconciliation now uses durable delivery identities and a restart-safe desktop request journal. Lost responses recover the same saved proposal instead of generating another. Reconciliation reads pinned Git commits, refuses publication if either Storyline advances during generation, and marks completed reconciliations stale after either revision changes. Merge refuses stale or legacy unanchored resolutions, protecting newer prose. Core regressions reproduce response loss and intervening author edits; rendered tests cover retained Retry/Discard controls, changed branch selection, and recovery of the original request without automatically merging. Branch creation, switching, and merging also flush pending editor saves and refresh open book tabs. These are local contract tests, not live-provider or native merge-failure proof.

Chat cancellation is checked before provider calls, on incoming deltas, and before publication; a silent provider connection may still wait for its transport timeout. Standalone batch stopping is explicitly **after the current step**, not cancellation of an in-flight remote call. A crash before a result is durably saved may require another paid provider attempt. Live expired ChatGPT sign-in, network cancellation/billing behavior, and real-provider quality remain unverified. The parent recovery task stays open for those gaps.

**Completion boundary**

Writing protection, ordinary Revisions, consistent Story Memory restoration, dependency remediation, and portable recovery are implemented and locally verified. Provider recovery has local adapter, failure-injection, rendered, and selected native GUI evidence. Embedded Git has arm64 packaged-runtime evidence. None of these substitutes for a signed, notarized dual-architecture release, clean-machine installation, an upgrade from a published release, actual-provider failure behavior, consented manuscript evaluation, or observed pilot outcomes.

The next external steps require branch-publication approval, release credentials and native installation environments, an explicitly approved live-provider configuration, and manuscript/participant consent. No private manuscript was read for evaluation, no private excerpt was transmitted, and no participant was contacted. Additional synthetic runs cannot establish those missing external outcomes.

**Interface changes**

| Before | After |
| --- | --- |
| Save responses could replace newer typing or disappear on navigation. | Project-scoped save queues preserve newer prose, expose save failure/retry, and retain recovery drafts. |
| No named ordinary-writing version control. | Changes includes a labeled version-name field and Save version action. |
| Only changed scenes were offered for restoration. | Named versions expose unchanged restorable files, Plan, and Story Memory, and refresh open tabs after restoration. |
| Backup and recovery required missing functionality. | Settings has labeled, wrapping backup controls with 40px minimum targets, busy/disabled feedback, privacy warnings, and pending-save checks. |
| Project chooser could only create/open books. | A collapsible recovery form verifies archives and restores only into new or empty folders. |
| Storyline switching left cached scene text behind. | It waits for saves, temporarily protects prose inputs, and refreshes/ closes tabs to match the destination book state. |
| Failed chat sends cleared the only visible copy of the prompt. | A local recovery card retains the prompt and context, exposes 40px Retry/Discard controls, and explains possible charges and discard semantics. |
| Navigation could show a stream or stale message refresh in another conversation. | Per-book/thread delivery sessions and refresh guards keep recovery and responses with their originating conversation. |
| Repeated tool approvals could create duplicate Change Sets. | Completed tool calls display their recorded outcome and replay safely; uncertain interrupted writes require inspection. |
| A failed draft followed by Create restarted planning and duplicated proposals. | A per-book recovery panel retains the original instructions, shows a tabular progress count, and offers 40px Retry/Open results, stop-after-step, and new-request controls. Saved steps are reused and pending inputs are disabled. |
| Closing a generation view lost its in-memory progress; late results could reopen unrelated tabs. | Recovery journals survive restarts, sessions continue outside the view, and result-opening guards check the originating book and mounted view. |
| Regenerate Change Set had no retained retry identity. | The review panel retains the draft request, exposes a 40px Retry draft action and explicit discard control, and explains possible retry charges. Intentional regeneration after success uses a fresh identity. |
| A failed passage revision lost its retry identity and comment after restart. | `ProposalReview.tsx` displays the retained feedback, a wrapping error/charge explanation, and 40px Retry passage revision/Discard passage request controls. Successful recovery clears the card. |
| Authors could change the passage comment while its submitted request was pending. | The submitted comment is preserved in the journal; its input and new regeneration actions remain disabled until completion or explicit discard. Regenerate and Revise hunk controls have 40px minimum height. |
| A failed reconciliation lost its request identity across restart. | Storylines retains the original branches and scene path, with wrapping error/charge guidance and 40px Retry/Discard controls. Recovery does not automatically merge. |
| Compatibility results could remain visible for another branch selection, and an older reconciliation could overwrite newer prose. | Selection changes invalidate compatibility results; exact revision anchors reject outdated reconciliations at publication and merge. |

The interface-polish skill informed the backup, chat, standalone generation, and reconciliation recovery controls' labels, layout, stable progress numerals, and minimum hit targets; existing application styling is retained.

**Baseline**

Reviewed main commit `3fde8c9`. Existing checks passed: 123 Python tests, 86 desktop tests, six Rust tests, frontend build, capability validation, and the 400-scene performance gate. Dependency audit failed with four findings. Focused review probes reproduced save-response text loss, ordinary saves without Revisions, and Codex restoration overwritten by the runtime database.
