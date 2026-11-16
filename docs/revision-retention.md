# Revision retention: thinning old automatic saves

The editor records a Revision two seconds after typing stops. Nearly all of a
book's history is therefore automatic saves seconds apart, and each occupies
two filesystem blocks whatever its size. `openauthor/revision_retention.py`
thins those saves once they are old. It is the only code that removes history,
and it never runs on its own: nothing calls it except `revision compact`.

The store format it works on is described in
[manuscript-transactions.md](manuscript-transactions.md#revision-store-format--2026-11-16).

## Policy

The policy belongs to the book and is stored in
`.openauthor/revision_retention.json` (`enabled`, `keep_all_days`,
`daily_after_days`; defaults `true`, `7`, `90`). It is written atomically,
travels with a portable backup, and is not part of any Revision, so restoring
an old version never changes it. A file that cannot be understood stops
thinning instead of falling back to the default, because it may have said
"disabled". `keep_all_days` below 1, or `daily_after_days` not greater than
`keep_all_days`, is refused.

- Every Revision from the last `keep_all_days` days is kept.
- Older than that, automatic editor saves are thinned so that, within each
  uninterrupted run of them, the last save of each clock hour survives.
- Older than `daily_after_days`, the last save of each day survives.

Hours and days are UTC, taken from each Revision's recorded `created_at`.
Ages are measured back from the book's most recent Revision or from now,
whichever is earlier: a clock that jumped forward cannot make last week's work
look old, and a book left alone for a month still has its last week of saves.
A Revision whose time is missing, unparseable, without a time zone or in the
future is kept.

## What can be removed, and what never is

Only an **editor save** is ever removed or rewritten: a Revision of kind
`author_edit` whose message begins `Scene update`, which is what
`scene update` records for prose autosaves and Inspector saves. Everything
else is kept whatever its age, including kinds this version does not know:

- the current head;
- named versions (`manual`), backups, imports and restores with their
  pre-edit snapshots;
- every Revision made by applying, undoing or snapshotting before a Change Set
  or a coordinated group;
- other author edits that share the kind `author_edit` but are single
  deliberate actions (Plan, Story Memory, Style, adding a scene);
- every `author_edit_before`. That kind is recorded only when the book was
  found changed outside a recorded edit, which is the only trace a Storyline
  switch or merge leaves in Revision history (those operations record no
  Revision of their own). Keeping it, and the Revision before it, keeps both
  sides of every such change;
- any Revision something else still points at (below).

A run of saves never crosses a kept Revision. The saves on each side are
thinned separately, and the last save of a run always survives, so the state
immediately before every kept Revision is still there and still its parent.

### References

A Revision id is held as text wherever it is held, so instead of trusting a
list of fields, every file under `.openauthor/` (outside `revisions/`),
`codex/` and `manuscript/` is searched for id-shaped strings, and any that
names a stored Revision keeps it. That covers what exists today and whatever
is added later:

| Where | Field |
| --- | --- |
| `workspace/proposals/*.json` | `vcs_base_commit` (the head a Change Set was written against), `pre_apply_snapshot`, `applied_revision`, `undo_revision`, `restored_revision` |
| `workspace/storylines.json` | `base_revision` |
| `workspace/mobile-outbox/` journals and inbox items, and the Change Sets they create | `base_revision`, `imported_revision`, `mobile-base-revision:<id>` |
| `retrieval/index.json` | `git_head` (despite the name, the Revision head when the index was built) |
| Assistant turn, reference and context records, where they are saved under `workspace/` | `source_revision`, `project_revision` |
| `workspace/author-edit.json` (legacy interrupted-edit journal) | `before` |
| Revision records themselves | ids in the metadata or message of any Revision that is not an editor save: `before_revision`, `restored_from`, `applied_revision`, `restored_revision` |
| A record outside the listed history (left by a rolled-back operation) | the Revision it follows, which it reads through |

An editor save's own `before_revision` does not count: it names the save
before it, and counting it would keep every save. Chat threads and
reconciliation receipts hold Git commits, not Revision ids. The book-edit
journal (`workspace/book-transaction.json`) is always recovered before thinning
can take the project lock; if one is present anyway, nothing is thinned.

## How a survivor keeps its id

A Revision id is the hash of its parent id, timestamp, message, kind, complete
manifest and nonce, so a surviving record cannot simply be given a new parent.
The Revision that follows a thinned run is instead rewritten as **record
format 3**: every field the id was computed from is carried over unchanged,
`parent` included even though that parent is gone, the complete manifest is
stored in the record, and a separate `ancestor` names the nearest surviving
older Revision. History (`revision list`, verification, ancestry checks) follows
`ancestor`; `parent` remains only an input to the id. `thinned` counts the
Revisions removed between the two. Callers receive `parent` as the nearest
surviving Revision, so comparing a version with the previous one works, plus
`recorded_parent` and `thinned`.

The rewritten record still reproduces its id, and that is checked before it is
written and whenever it is read. Because it carries its whole manifest it
depends on no other record, and the records after it read through it as
before. Only the Revision after a thinned run is ever rewritten, and it is
always itself an editor save; named versions and Change Set Revisions are never
touched.

Format-1 records in a thinned run are removed like any other editor save. A
format-1 editor save that survives one is rewritten to format 3 with its
manifest copied unchanged and an empty nonce: like every format-1 record, its
id could never be recomputed. Format-1 Revisions that are not editor saves stay
byte for byte as they were. An openAuthor that predates format 3 refuses such a
record with its "Update openAuthor" message.

An object is deleted when no remaining record names it and no remaining stored
object was packed against it. A base that only removed saves named stays for
as long as a surviving object needs it. Objects that no record ever named
(left by an interrupted save) are not looked for.

## Order of work

1. **Survey, without the project lock.** Read every record and scan for
   references. Records are immutable to every other writer and only one
   thinning run exists at a time (`.openauthor/revisions/retention.lock`), so
   this stays true except for what step 3 re-reads.
2. **Verify before removing anything.** Every Revision that will remain is
   rebuilt (its manifest must reproduce its id) and every object any of them
   uses is read back against its digest. A failure stops the run with nothing
   changed and names the Revision or object.
3. **Remove in short holds of the project lock.** Each hold first re-reads the
   head, any records added since, and the reference scan (only files that
   changed are read again). A step is skipped if anything it would remove has
   since been pointed at; an object a new save has started using again is
   kept. Then, in this order:
   1. write and sync an intent journal (`retention-journal.json`);
   2. write and sync each relinked record, and read it back;
   3. remove the thinned records, newest first, and sync the directory;
   4. remove the objects nothing uses any more, packed objects before their
      bases, and sync;
   5. retire the journal.

Everything new is durable before anything is deleted, and deletion runs from
the newest record back, so a record still on disk always has everything it
reads through. An interruption therefore leaves either the old history, or the
new history plus some detached records that still read correctly. The journal
is what lets the next run tell those apart from records a rolled-back edit left
behind (which are kept): it removes the listed records that are no longer in
the listed history, re-checking references first, and the listed objects that
are still unused. `tests/test_revision_retention.py` interrupts a run before
every single disk change, and kills a process outright, and checks each time
that every record on disk reads, that the author can save, and that the next
run finishes with exactly the result of an uninterrupted one.

**Lock holds.** A hold takes a bounded number of steps, adjusted after every
hold towards 0.15 s of work; a long run of saves is detached in pieces of at
most 256 Revisions. On top of that each hold pays a fixed re-check: one listing
of the records directory and one `stat` per workspace file. Between holds the
lock is left free for 60 ms, longer than a waiting save's 50 ms retry interval,
so a save always gets in. One invocation thins for at most 30 s
(`--max-seconds`) and then returns `complete: false`.

Manuscript files, the Plan, Story Memory and every other file outside
`.openauthor/revisions/` and the policy file are never written or deleted.

## Commands

```sh
openauthor revision retention --json
openauthor revision retention --enabled true --keep-all-days 7 --daily-after-days 90 --json
openauthor revision compact --dry-run --json
openauthor revision compact --if-due --json
```

`retention` prints `policy`, `store` (`revisions`, `bytes`, `allocated_bytes`
of `.openauthor/revisions/`), `last_run` (the last run that completed; the
counts include earlier invocations that stopped at their bound) and `due`
(enabled, and no run completed in the last 24 hours).

`compact` prints `ran`, `reason`, `removed_revisions`, `kept_revisions`,
`removed_objects`, `freed_bytes`, `freed_allocated_bytes` and `complete`.
`reason` is one of `thinned`, `nothing_to_thin`, `dry_run`, `not_due`,
`disabled`, `work_bound` (stopped at `--max-seconds`; call again),
`history_changed` (something new pointed into the plan more often than it
would re-plan; call again), `already_running`, or `policy_unreadable: …`.
`--dry-run` writes nothing and reports exactly what a run would remove.
`--if-due` does nothing unless thinning is enabled and due. With thinning
disabled, a plain `compact` exits with an error; `--dry-run` still answers.
Freed bytes are net of the relinked records, which grow.

## Limits

- Hours and days are UTC, so an evening of writing that crosses midnight UTC
  keeps two daily saves.
- A relinked record stores a complete manifest: about 100 bytes per book file,
  so roughly 6 KB for 64 scenes and 40 KB for 400. That is the price of each
  surviving old save depending on nothing else.
- A relinked editor save keeps its original metadata, so its
  `before_revision` may name a save that no longer exists. Use `parent`.
- A reference held outside the project folder cannot be seen. The one known
  case is the mobile companion: a phone's queued change names the Revision of
  the snapshot it was based on, and snapshot anchors are not recorded locally.
  If that Revision was an editor save and has since been thinned, importing the
  queued change is refused as an unknown Revision. Desktop-side state kept in
  browser storage is likewise invisible.
- A save that is pointed at splits its run, so the save before it survives as
  well. Every Change Set and Assistant turn records the head it was written
  against, so a heavily assisted day keeps more than one save per hour.
- Detached records left by an interruption are finished by the next run, not
  by startup repair. Until then they are readable and harmless.
- Verification reads every object that remains in use on each run that has
  something to remove. That is done outside the lock, but it is the bulk of a
  run's time on a large book.
- The single-run lock and the project lock are POSIX advisory locks, as
  elsewhere; a host without them refuses to thin.
