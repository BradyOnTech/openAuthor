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

**Current verification**

145 Python tests, 99 desktop tests, and six native bridge tests pass, along with the frontend build and repository checks. The dependency audit reports zero vulnerabilities. The 400-scene scale gate passed before the provider-recovery slice. The rebuilt embedded arm64 Python/Git combination passes Storyline create, compare, switch, backup, recovery, and older Story Memory restoration with system tools removed from PATH. These counts describe local source/runtime tests, not signed-installation or author-pilot evidence.

No Apple signing identities or repository secrets were available in the inspected environment. The unsigned packaging workflow permits native arm64 and Intel verification without signing credentials; neither that new workflow nor a signed release has been run on GitHub in this work.

**Native GUI evidence: 2026-09-28, local arm64**

Built and launched the actual release-mode `.app`, using a disposable synthetic novel under `/tmp/openauthor-packaged-gui.lyEmrG`. Created a scene, saved prose, observed automatic Revisions, saved a named version, created a verified backup, created an alternate Storyline, edited it, returned to Primary, and verified the existing scene tab showed Primary prose. Restored the archive into a new folder and confirmed it opened without startup repair warnings. Closed immediately after typing, reopened, restored the recovery draft, and saved the exact recovered text. This last drill is application-closure recovery, not a simulated operating-system crash.

The native drill found two gaps that are now regression-tested: stale scene tabs after Storyline switches and missing empty runtime directories after backup recovery. Switching now waits for queued saves, makes prose temporarily read-only during the state change, and refreshes scene and character tabs. Edits made to Primary are also snapshotted before entering an alternate Storyline.

Rebuilt the app after provider recovery changes. In the same synthetic book, a deliberately restrictive local-only budget rejected a chat prompt. The recovery card retained the exact prompt, survived quitting/reopening the packaged app, and retried successfully after restoring the test book's original budget. The final conversation contained one user message and one assistant reply. No live provider was called.

**Provider recovery evidence and limits**

Chat deliveries now have durable request receipts, staged transcript publication, and per-thread locking. Retrying after a lost sidecar response or transcript-write failure recovers the same completed result without another generation. Cancellation and failures publish no partial chat turns or pending tools. The desktop saves the prompt and context locally before sending and retains one logical delivery id across explicit retries and application restarts. CLI clients can supply `chat send --request-id` for the same guarantee.

OpenAI-style streams must reach `[DONE]`; Anthropic streams must reach `message_stop`. Dropped streams, invalid JSON/UTF-8, in-stream errors, socket timeouts, and truncated HTTP bodies are errors rather than successful partial answers. HTTP 401 retains its authentication category and sign-in guidance. Local HTTP fixtures exercise the real adapters without transmitting manuscript data. The completion signals follow the [OpenAI streaming API reference](https://developers.openai.com/api/reference/resources/chat) and [Anthropic streaming documentation](https://platform.claude.com/docs/en/build-with-claude/streaming).

Repeated approval of the same tool returns its recorded result, including for older transcripts. If the process fails after a potentially mutating tool starts but before its result is durably saved, replay is refused and the author is asked to inspect the book and Revisions. This is a fail-closed uncertain result, not a claim that every external action is transactional.

Cancellation is checked before provider calls, on incoming deltas, and before publication; a silent provider connection may still wait for its transport timeout. A crash before the completed receipt is saved may require another paid provider attempt. Live expired ChatGPT sign-in, network cancellation/billing behavior, standalone generation retries, and real-provider quality remain unverified. The parent recovery task stays open for those gaps.

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

The interface-polish skill informed the backup and chat recovery controls' labels, layout, and minimum hit targets; existing application styling is retained.

**Baseline**

Reviewed main commit `3fde8c9`. Existing checks passed: 123 Python tests, 86 desktop tests, six Rust tests, frontend build, capability validation, and the 400-scene performance gate. Dependency audit failed with four findings. Focused review probes reproduced save-response text loss, ordinary saves without Revisions, and Codex restoration overwritten by the runtime database.
