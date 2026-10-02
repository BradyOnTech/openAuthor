# Reviewed Memory interpretation — 2026-10-02

This adds an optional interpretation workflow alongside the automatic local
capitalization scan. It supports candidates in any source language without
requiring capitals, and distinguishes author-reviewable entry types. No live
provider calls were made in this pass. The authored provider replies exercise
the actual completion, validation, queue and approval path; they do not measure
a model's extraction accuracy. The older twelve-case local heuristic evaluation
retains its two missed uncased names and two place classification errors.

Authors select one to six nonempty saved scenes, at most 36,000 characters, and
review complete prose and the included accepted identity names/types/aliases
before sending. No prose is silently clipped. All other Memory content is
omitted, including private notes and Ask first/excluded identities. The selected
prose is author-controlled source text and is not automatically redacted.

The same fingerprint checks source versions, visible identities, the suggestion
queue and Storyline before and after completion. Provider work holds no project
lock. Returned analyses are stored locally in the book workspace independently
of the metadata-only generation log, even when a result is malformed or stale.

Candidates require supported names/aliases in exact selected-source quotations.
Unique exact quotations can repair offsets with a warning; repeated/absent
quotations cannot. Unsupported candidates are withheld. Exact evidence checks
passage presence, not semantic truth. Suggested descriptions, identities and
classifications still need author judgment. A later model response cannot
remove unresolved classification uncertainty; an author must explicitly confirm
the type. Accepting a matching separate suggestion cannot bulk-confirm it.

AI candidates survive automatic local rescans without receiving a fresh source
stamp or a new guessed type. Previous decisions and author corrections stay
owned by the author. Changed source evidence still refuses acceptance.

Core checks: an earlier 72-test focused privacy/Memory/Canon checkpoint; 23
public Memory/CLI/review tests; final full suite 548 discovered, 547 passed, one
optional runtime skip. The added recovery-storage-failure regression is included
in the full suite and separately independently verified with all 14 scan tests.
A completed response whose local recovery copy cannot be stored queues nothing
and reports the completed usage without claiming the response was retained.
Rendered/real-core browser checks are recorded separately. Native packaging and
model/author quality remain separate acceptance outcomes.
