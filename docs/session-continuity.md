# Session continuity

Implemented 2026-09-12 for desktop reading, Plan and Writing Voice assessments.
Recovery restores a local working copy. It never approves a voice, changes prose,
creates an act/beat, or saves an assessment automatically.

## Author behavior

- Reading reopens the selected chapter and scene page, with a scene-relative
  scroll offset. A scene moved to another chapter is located there. A deleted
  scene falls back to its chapter beginning; a deleted chapter falls back to the
  first available chapter. Pixel accuracy can change with fonts, window size or
  revised prose. Unsaved scene editors still block the saved reading copy.
- Plan retains the project brief, new-act title, chapter titles, beat text, and
  each scene's story time and labels. Structure refreshes do not reset the brief.
  Failed saves retain input; successful saves clear only the submitted field,
  preserving edits made while the request was in flight. Inspect retained Plan
  text to copy drafts whose scene or act no longer exists.
- Writing Voice retains unfinished ratings and assessment notes per preview and
  direction, and remembers the chosen recent comparison. Saving an assessment
  does not train a profile. The existing five-comparison history limit remains;
  older locally retained assessments are not a searchable archive.
- Recovery notices distinguish restored text from saved book content. Other
  retained window copies can be selected explicitly. Discard asks for
  confirmation and leaves other copies and saved book content intact. Storage
  failures warn the author to keep the screen open and save or copy their work.

## Shared persistence and save checks

`workspaceRetention.ts` and `useRetainedDraft.ts` own the working-copy journal.
Inputs write synchronously at the edit event rather than waiting for unmount or
a debounce. Records are keyed by project path, backend workspace identity and
resource. Each mounted writer has its own slot; recovering another writer's copy
forks it on edit. Immutable receipts acknowledge only a specific writer/sequence,
so an older save cannot retire newer typing. This is not collaborative editing:
other windows' copies are discovered when the editor is reopened, not merged live.

The backend workspace identity includes project identity and Git HEAD reference,
reusing the scene editor's scope. Commits on a branch do not reset it; changing
Storylines, moving a book or replacing its identity changes it. Transient Plan
scope is added by `get_plan_workspace`, not persisted into manuscript structure.

Desktop brief and scene-metadata saves send the original saved value plus scope.
The core compares them under the project lock before writing. Act/chapter/beat
creation and scene moves send the original scope. Assessment saves compare the
original saved assessment per direction and verify the preview's Storyline.
Conflicts retain local work and require comparison with the saved version and an
explicit author decision before rebasing. Unrelated structural changes do not
invalidate a brief; another direction's assessment does not conflict with this one.
CLI callers omitting optional Plan/assessment preconditions retain legacy behavior.

Local drafts remain plaintext webview/browser storage, not encrypted backups,
Revision history or mobile synchronization. Clearing site data or losing the
device can lose them. A successful local write is not a power-loss durability
guarantee. Receipts and damaged records are preserved; storage exhaustion is
reported rather than silently dropping author text. Concurrent same-field edits
still require human reconciliation. A lost response after an add succeeded can
leave a retained title whose retry creates a duplicate; add operations do not
claim durable idempotency.

## Verification

Tests cover the journal's public interface, project/Storyline isolation, damaged
storage, quota failures, multiple writers, older save receipts, late completion
after remount, changed baselines, structure-refresh preservation, and rendering
of recovered assessments. The browser journey in
`desktop/e2e/session-continuity.spec.ts` exercises reload recovery against the
real Python engine with an isolated offline account home and disposable book.
See the dated checkpoint in [production readiness](production-readiness.md) for
the final verification result and remaining release limits.
