# Cooperating manuscript operations

The engine uses `openauthor.project_locks` to serialize cooperating operations on
one project's working manuscript. Its interface is `project_lock(paths)` for an
explicit scope and `@serialized_project_access` for an engine function with a
`paths: ProjectPaths` argument. Callers use the same engine functions as before;
the desktop, CLI and persistent Assistant server cannot bypass protection simply
by running in different Python processes.

## Contract

Acquire before reading state or checking staleness, and retain ownership through
the final write or rollback. Locking only `atomic_write_text` is insufficient:
atomic replacement prevents torn files, not an older transaction overwriting a
newer save. Readers that must not observe provisional prose participate too.

The implementation combines a canonical-path, per-project reentrant thread lock
with a POSIX advisory file lock at `.openauthor/workspace/locks/project.lock`.
Nested engine calls reuse ownership. Different projects remain independent.
Exceptions release ownership, process exit releases the OS lock, and forked
children discard inherited ownership and descriptors without unlocking the
parent. The lock file is retained: unlinking it would allow two processes to
lock different inodes for the same project. Git snapshots and normal Storyline
switches do not version or replace this workspace file.

Acquisition failures stop the operation before its body runs. Hosts without
POSIX locking fail closed; this is verified on macOS, not a Windows support
claim. A read also needs access to the project's workspace lock file.

Do not hold this lock across provider/network calls. If an Assistant operation
also needs a thread lock, acquire the Assistant thread lock first, then the
project lock. Project-locked code must not acquire an Assistant thread lock.

## Current coverage

- Scene allocation, update, lookup and inventory reads.
- Proposal creation, review decisions, draft edits, staleness checks, individual
  and coordinated apply, and undo.
- Revision creation, HEAD reads and restore.
- Manuscript import/export, chapter-reading snapshots, and Git mutations.
- Plan read/normalization and brief, act, chapter, scene-placement, beat and note mutations.
- Codex entity/relationship reads, mutations, snapshot publication and runtime replacement.
- Storyline operations, including compare/list paths that can persist state.
- Local mobile snapshot projection, keeping its revision read and scene reads
  together while a cooperating manuscript transaction runs.

`tests/test_manuscript_concurrency.py` tests actual engine operations, including
a competing writer in a separate process, failed apply/batch/undo/restore,
duplicate scene allocation, dirty reads, half-applied revisions, and mobile
projection consistency. `tests/test_project_locks.py` covers lock lifetime,
reentrancy, path aliases, independent books, fail-closed acquisition, process
termination and fork ownership. The regression loop is:

```sh
PYTHONPATH=. python3 -m unittest discover -s tests -p 'test_manuscript_concurrency.py' -v
PYTHONPATH=. python3 -m unittest discover -s tests -p 'test_project_locks.py' -v
```

## Guarded editor saves

`get_scene` now includes an `edit_version`: a project/location/Storyline scope and
content digests for title, prose, summary, POV and status. The version is computed
under the project lock. It does not rely on `updated_at`, so a completed external
text edit with an unchanged timestamp is detected. Git HEAD is read locally,
including gitdir pointers, without spawning Git for each scene.

`scene_edits.save_scene_edit(paths, scene_identifier=..., expected_version=...,
changes=...)` checks that version and returns its own committed scene while still
holding the lock. Only submitted fields are compared, allowing an Inspector
summary change and a prose change to coexist. Retrying an already-written value
is idempotent. A changed Storyline is a conflict even with identical prose.

The desktop prose editor and Inspector always use this guarded interface through
`scene update --expected-version <edit_version JSON> --json`. A conflict returns
exit status 3 and a structured `scene_edit_conflict` error, never a successful
scene response. Desktop calls without a loaded version fail before invoking a
write. The older CLI command without this flag and internal `update_scene` calls
remain unconditional cooperating mutations for existing engine/script workflows;
they are not stale-editor protection and must not be used by editor callers.

Before reporting a conflict, the engine saves the submitted draft fields and
the current scene to `.openauthor/workspace/scene-conflicts/<digest>.json`.
Repeated identical conflicts reuse that copy. These are local, plaintext authoring
files, excluded from normal book revisions and mobile snapshot payloads. They are
not automatically pruned. If backup creation fails, the manuscript is untouched
and the author is told to keep the editor open.

The UI pauses autosave, keeps the draft editable and shows the saved version.
“Save reconciled version” checks the displayed version again; a third writer
causes another conflict, not an unconditional force-write. After a Storyline
change, the author must switch back and refresh the comparison or explicitly
select the current Storyline as the transfer destination. Inspector review uses
the same rule. Recovery records retain the original edit version; restoring a
draft does not silently adopt the newly loaded version as permission to replace
it. Legacy recovery drafts without a version require review before saving.

The guarded CLI response is captured before optional Story Memory extraction;
failure of that derived scan produces a save warning rather than falsely reporting
that a committed scene failed. Tests cover the core guard, real native command
response and backup, rendered conflict UI, and a browser/real-Python conflict →
reload → restore → newer conflict → reviewed save → reopen sequence.

## Coordinated undo checkpoint — 2026-09-11

`proposals.undo_proposal_batch(paths, applied_revision=...)`, exposed through
`proposal undo-batch --revision <id> --json`, resolves the entire group from the
applied Revision. New coordinated applies record proposal-to-scene membership,
paths and the guarded-edit workspace scope in both their before/apply records.
The desktop passes only the applied Revision id; it does not loop through
individual undo calls or select an arbitrary subset.

Before writing, the engine checks matching before/apply records, current history
ancestry, all proposal records, scene locations and Storyline scope, integrity of
both snapshots, and exact current scene-file content against the applied snapshot.
Any newer saved prose or frontmatter, already-undone member, missing record or
changed workspace stops the entire operation. Unrelated scenes may have changed;
they are not restored. There is no coordinated force option. Older groups without
the recorded recipe require individual review; they are not guessed or migrated.
A moved project also changes workspace scope and requires individual review.

Success creates one `change_group_undo` Revision and marks every member with that
same undo id. Caught scene-write, proposal-write and Revision HEAD failures roll
back the affected scene files, proposal records and original HEAD while holding
the project lock. Unreferenced Revision objects/records may remain; they are not
shown in the active history. Activity-log failure is returned as a warning after
success, not a false undo failure. The October 2 journal below now also protects
process termination and interrupted rollback for these operations.

`tests/test_coordinated_undo.py` covers these conditions through the shared engine
interface, CLI dispatch, injected write failures and a competing reader. Desktop
workflow tests exercise error/retry, pending state and open-review updates. The
book-sized browser journey restores two distant scenes in one action; a separate
browser journey verifies newer writing prevents either scene from being restored.

## Durable book-edit recovery — 2026-10-02

`book_transactions.recoverable_book_edit(paths)` is the shared interface for one
recoverable edit. Individual/coordinated apply and undo use its decorator;
`checkpointed_edit` uses it for Revision restore and checkpointed author actions.
The atomic writer records each participating file before replacing it. New scenes
use an exclusive, complete-file publication rather than writing a partial file.

The local `.openauthor/workspace/book-transaction.json` contains the original
bytes and all intended bytes for touched manuscript scenes, versioned book
metadata, proposal records, and Revision HEAD. It is private plaintext author
data, excluded from normal revisions and mobile snapshots. It never contains
provider credential stores. Every journal replacement, file replacement, commit
marker and retirement synchronizes the file and containing directory before
continuing. Immutable Revision records/objects may remain unreachable after
rollback; they are validated normally when reachable from HEAD.

An outer project-lock acquisition recovers before its operation runs. Without a
durable commit marker, it restores the exact original participating files and
HEAD. With the marker, it preserves the completed edit. When the Codex snapshot
participates, recovery also rebuilds runtime SQLite before allowing normal reads.
An interruption during recovery is repeatable: original bytes remain legitimate
recovery values. Readers using this lock never receive the half-recovered book.

Unknown newer file content or a different Storyline blocks recovery before file
replacement. The author can inspect an exact comparison without triggering
normal reads:

```sh
openauthor project recovery-status --json
openauthor project recovery-resolve --fingerprint <reviewed-fingerprint> --decisions '{"manuscript/scenes/0001-opening.md":"keep_current"}' --json
```

The comparison includes readable original/current/intended text plus base64 exact
bytes. Choose `keep_current` or `restore_before` for every conflicting file;
the fingerprint checks the reviewed journal and current bytes again. Newer edits
invalidate that comparison. Return to the original Storyline before resolving.
Kept external writing remains author-owned working content outside the restored
HEAD; keeping it does not create or approve a new Revision. A normal interrupted
transaction with no conflicting files recovers automatically on the next read.
An already committed journal can only be retired with empty recovery decisions;
it retains completed files and newer external writing. It never enters the
rollback phase, and nonempty recovery decisions are refused. Normal reads also
retire committed journals without restoring their original files.

Project identity is part of the guarded workspace scope. Revision restore
validates selected project metadata before creating a checkpoint or writing any
live file: a different, missing or blank `project_id` is refused. Restore selected
scene/Memory files while excluding `.openauthor/project.json` to use such older
history. This leaves the owning project identity explicit and unchanged. The
transaction writer also rejects identity-changing metadata before replacement,
so earlier participating writes can roll back without changing their scope.

`tests/test_book_transactions.py` uses disposable projects and actual child
processes terminated with SIGKILL at write-ahead publication, first scene, new
Revision HEAD, first proposal record, and immediately before/after the commit
marker. It checks single and coordinated apply/undo, restore, new scene creation,
interrupted recovery, runtime Codex recovery, exact-byte results, safe retries,
external-edit comparison and changed-Storyline refusal. These engine checks do
not certify a signed GUI, storage eviction or physical power loss. Additional
subprocess regressions exercise legacy/different-identity restore refusal before
any write, rollback of an attempted identity mutation after prose writes, and
explicit recovery of a committed apply killed during journal retirement.

## Remaining limits

The shared interface provides durable recovery for the participating edits;
it is not a transaction for every filesystem operation. In particular:

- Recovery now uses independent editor-owned browser slots and sequence-specific
  retirement receipts. A recovered source is retired only after successful save;
  newer writing from that source owner remains available. Multiple drafts have
  an explicit chooser. This is not a disk archive or an eviction/crash guarantee.
  Drafts changed after a conflict remain in the editor/browser journal until
  submitted; the earlier engine disk copy does not contain those later edits.
- External editors and raw filesystem operations do not honor advisory locks.
  A completed edit is checked by the guard, but an external write racing between
  that comparison and file replacement is not protected by the advisory lock.
  There is still a narrow race between comparison and replacement for raw
  external writes; POSIX advisory locking cannot force another editor to cooperate.
  A conflicting completed external edit is retained for explicit comparison.
- Direct file writes outside the atomic-writer/scene-create interface, directory
  initialization and migrations, deletions, and Git worktree/Storyline operations need
  separate transaction coverage. The legacy `author-edit.json` repair path is
  retained for older projects; new checkpointed edits use the new journal.
- Raw retrieval readers and project initialization/migration paths need a
  separate coverage audit. A scene-file path returned by lookup is not a lease
  that protects a later direct filesystem read.
- A mobile snapshot's existing revision anchor is not proof that every working
  edit was captured in that revision. Anchor/content verification remains a
  separate requirement; this change prevents the tested concurrent-apply gap.
- Journals rely on the operating system honoring fsync and atomic filesystem
  operations. Damaged/missing journals or immutable objects, whole-device loss,
  signed-app forced-termination drills and verified backup recovery remain gates.

The prevention rule for future manuscript operations is to enter through the
shared transaction interface and add a competing-caller regression, not introduce
an independent per-screen mutex. Expanding coverage must include lock-order and
failure-path tests, not only additional decorators.
