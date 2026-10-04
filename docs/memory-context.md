# Story Memory in AI context

Updated 2026-09-07. This contract describes application-selected source material,
not retroactive removal of transcripts or a release certificate.

## Author controls

- **Use automatically:** eligible for relevance selection. Private author notes
  are never part of the projected record. Only included details are automatic.
- **Ask before using:** omitted from automatic selection. An explicit reference
  alone is not permission. Desktop chat asks before releasing the entry or its
  ask-before-use details for that request.
- **Keep out of AI context:** not releasable by one-request approval. Explicit
  references fail with an explanation, leaving the unsent question available.
- Unknown visibility values fail closed. Older records without a visibility
  field keep the store's documented `include` default.

Approval is a separate trusted request field, intersected with explicit entry IDs.
It is not a saved thread preference, and model tool arguments cannot grant it.
The local CLI equivalent is `chat send --codex-id ID --allow-memory-once ID`.
Cancelling the desktop review preserves the question. Regenerating a Character
turn retains its selected context and asks again. The notice explains that replies
may remain in chat history.

## Shared implementation

`openauthor/memory_context.py` projects an allowlist of useful fields without
changing the author store. Context selection, revision generation, retrieval and
Assistant read/write tool results use it. The codebase-design skill guided this
shared module so additional callers do not independently interpret access rules.

The shared [editorial context](editorial-context.md) also checks accepted Canon
Facts against current subject visibility and filters character-knowledge rows.
Evidence in a selected scene cannot override a subject's exclusion. Approval for
an `ask` subject applies only to the current request; private notes remain out.

Retrieval builds index only projected Memory. Queries also compare indexed
source digests against current projected records, even when stale scene retrieval
is allowed. Revoked, changed or legacy unverified Memory excerpts are withheld.
Old indexes report a Memory-policy freshness change and can be rebuilt locally.

Prepared voice context carries a versioned Memory access stamp. Before opening a
new provider session, the runtime rejects a legacy pack or a changed access/content
stamp and requests fresh preparation. Read tools independently check current
access. There is no desktop/mobile voice one-entry consent UI yet; automatically
allowed Memory remains available, while `ask` sources are withheld there.

Mobile snapshots remain complete, encrypted author-owned downloads. Their
model-facing search/context projects Memory at read time, including older downloads,
and searches allowed typed details as well as descriptions. This does not rewrite
or remove the downloaded author records. Permission state is as of that snapshot;
desktop changes require a newly synced snapshot on the phone.

## Evidence and limits

`tests/test_ai_context_privacy.py` exercises raw context manifests, actual chat
prompt construction, voice preparation, tool results, revision-generation context,
stale/legacy indexes and pre-session voice revocation. Native provider calls are
intercepted in tests; only original disposable fixtures are used.

`desktop/e2e/memory-permission.spec.ts` crosses the rendered author controls and
real Python engine: cancel, approve, regenerate with fresh permission, exclude,
verify the saved context, and retain both private notes and the unsent question.
The chapter journey also verifies regeneration retains selected chapter scenes.
Mobile tests exercise search/context against previously downloaded raw records.

This does not erase previous transcripts, redact user-supplied prose, retract data
already sent to an active session, or replace provider/hosting privacy review.
Full concurrent metadata transactions, whole-prompt budget accounting, meaningful
novel-scale AI quality and physical-device voice acceptance remain release gates.
