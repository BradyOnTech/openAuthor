# Context for useful editorial review

Updated 2026-09-11. This documents supplied evidence, not a certification of model
judgment, a full-novel review, or mobile-device parity.

## Author-facing behavior

Chat and desktop voice preparation now receive the same editorial context:

- Saved project brief and style guide.
- The approved [Writing Voice](writing-voice.md): named craft traits, prose
  preferences and avoidances. This guides manuscript prose, not the assistant's
  conversational personality. Raw exemplars and analysis observations are not
  automatically included in general context.
- Plan reading order, focused chapters and their authored synopses, scene
  positions and explicit story-time labels. Reading order is not treated as
  in-world chronology; flashbacks remain possible.
- Relevant **accepted** Canon Facts, their subject, evidence excerpts, validity
  ranges, and character knowledge states. Suggested/rejected facts are not canon.
- The currently checked-out Storyline's hypothesis, intended scope, success
  criteria and protected constraints. Returning to Primary removes that
  experiment's intent from new context.

Proposal planning and whole-scene prose drafting use this context too. Previously
drafting received only its edit plan, selected scene and selected style profile;
it now also receives the neighboring scenes and allowed Memory. Generation logs
record the actual one-scene radius and eight-entry Memory limit used by drafting.
Initial edit plans and merge reconciliation also use shared reviewed guidance,
safe Memory, accepted Canon and Plan context, with source fingerprints checked
before and after generation. Hunk regeneration includes approved Writing Voice
through its reviewed revision context.

Replies have an expandable **Context used** receipt: chapters, supplied canon
count, active Storyline, approved voice name, evidence warnings and policy omissions. It records the
inputs for that reply, not a guarantee that every relevant source was available
or that the model used every fact correctly. Older messages have no invented
receipt.

## Selection and trust

`openauthor/review_context.py` is the shared editorial-context module, following
the codebase-design skill's small-interface/shared-implementation guidance.
Scene and explicit/mentioned entity references establish relevance; project or
Storyline scope includes all eligible accepted facts. Subjectless project facts
are available as general constraints.

The module reuses `memory_context.py`. A linked subject must be available under
the current Memory policy, even when the fact's evidence is in a focused scene.
Knowledge rows for unavailable characters are omitted. Ask-before-use needs the
current request's trusted approval; exclusion wins. These checks do not attempt
to redact arbitrary prose or facts copied into independently authored text.

Each evidence excerpt is checked against the saved scene body. Missing scenes or
quotes are marked explicitly and warned about; the author's accepted fact is not
silently deleted or demoted. Presence is an exact-text check, not semantic proof
of the fact or of its validity range. The model must not assume that the author
and every character know the same things.

Authors can correct or withdraw facts in **Story Memory → Canon & Continuity**.
Withdrawn facts keep their identity and recorded sources and can be restored.
Withdrawal excludes them from newly assembled accepted-canon context and
fact-based diagnostics, but does not redact earlier messages or independently
written prose. Saving an accepted correction requires the recorded excerpts to
match current saved scenes; this is not semantic proof. Concurrent corrections
and Storyline changes invalidate the loaded edit version rather than silently
overwriting the saved fact. Unfinished assertion, value, status, validity and
evidence corrections now recover across navigation and app restart, scoped to
the book, Storyline and fact. Recovery retains the original loaded version;
changed saved facts require explicit comparison before keeping the correction.
Failed or delayed saves cannot clear newer correction drafts. See the
[recovery checks](evaluations/canon-correction-recovery-2026-10-02/review.md).

Context and generation selection run under the existing project read/transaction
lock, not across provider calls. Scene neighborhoods now share the Plan-ordered
reading/export source, with unassigned scenes retained last.

## Bounds and remaining work

New editorial constraints, focused scenes and explicit selections are required
budget candidates serialized in full. They fail rather than silently clipping
required content. Optional neighbors may be omitted, with a reason in the
receipt. A shortened manifest preview is not the provider's source text.

The assistant now estimates its assembled model input, including prompt text,
history and tool definitions, plus a numeric response reserve. Complete recent
exchanges are retained as a contiguous history suffix; packing does not jump over
an oversized exchange to include unrelated older messages. Text provider calls
remeasure messages, tool arguments and returned results before each round.
Existing tool-result clipping remains a separate behavior; this change does not
promise full-length results for every tool.

Desktop voice connection uses the prepared instructions and response limit, and
checks the input estimate and registered tools before negotiation. The broker
requests disabled automatic context truncation. The estimate uses the larger of
word- and UTF-8-byte-based heuristics, not a provider tokenizer; it is not exact
wire-format accounting, billing or a guarantee against model context errors.
Per-response limits and initial admission do not bound a continuously growing
voice session, later client control events or total session spending.

The mobile snapshot reader has its own device-local context builder. New snapshots
now carry the approved Writing Voice projection; the Assistant names the
downloaded profile, and complete profile plus focused prose must fit before
starting a session. Older snapshots have no inferred profile. Refresh requires
desktop publication, phone reopening and a new session. This local content budget
does not bound full requests, later tool reads or session cost. Its Memory
privacy projection remains tested. New snapshots now include accepted facts
through desktop's existing privacy-filtered review projection, with no `ask`
permissions. Mobile rechecks subject/character visibility, selects scene-relevant
facts and verifies exact evidence against downloaded scene bodies. The selected
facts retain scope, confidence, validity and character knowledge. They are
required context: none are clipped or silently dropped for budget. The Assistant
shows their count and missing-source warnings; older snapshots explicitly lack
this field. With no focused scene all eligible facts are selected. Subjectless
facts are always relevant; focused subject/character mentions or source scenes
make linked facts relevant. Selection is not proof of exhaustive relevance.

Publication/reopening is required to pick up corrections or withdrawals. Offline
copies cannot discover newer desktop edits or permission changes. Selection
does not redact freely authored prose mentioning the same information. New mobile
snapshots preserve desktop Plan reading order and act/chapter titles; the existing
scene-list tool exposes that order without treating it as in-world chronology.
Chapter synopses, authored timeline labels and Storyline intent, and retrieval of additional Canon Facts during a running mobile
session, remain unimplemented; existing read tools still serve scenes and entity
search. Saved desktop voice packs may also become
stale after author edits; the existing pre-session Memory stamp is not a general
scene/canon/Storyline freshness certificate. A new profile check refuses desktop
voice negotiation when Writing Voice changed since preparation. Already sent
context is not recalled.

## Verification

- `tests/test_review_context.py`: Plan order, chapter intent/timeline labels,
  accepted-versus-suggested facts, evidence changes, validity, character
  knowledge, subject access and one-request approval, active Storyline/Primary,
  required-content bounds, actual chat/voice/planning/draft prompt construction
  and draft provenance. Local deterministic provider only.
- `ReviewContextReceipt.test.tsx`: displayed evidence limits, old-message
  compatibility, empty and malformed optional fields.
- `tests/test_assistant_payload_budget.py`: full source versus manifest previews,
  numeric response reserve, assembled agent input including tools, exact prepared
  voice instructions at connection, later tool-round rejection, intact focused
  prose/selection, contiguous complete history and non-word-heavy input estimates.
- `desktop/e2e/context-budget.spec.ts`: an oversized two-scene chapter is rejected
  before messages are recorded; the question survives; narrowing to Scene retries
  with its complete prose, omits an oversized optional neighbor and shows the
  estimated-input receipt. Notices remain above recovery controls at 1400-,
  1000- and 820-pixel window widths. The repetitive capacity fixture is not an
  editorial-quality benchmark.
- `desktop/e2e/storyline-journey.spec.ts`: the original six-scene alternate-ending
  journey supplies accepted canon and protected Storyline constraints, displays
  the context receipt, preserves chapter scope on regeneration, selectively
  integrates the ending, leaves the other scene unchanged, and undoes.

The browser screenshot was inspected. The small fixture proves the connected
workflow and inputs, not substantive novel-scale editorial quality. Next evaluate
longer, deliberately flawed original chapters and multi-scene review outcomes,
with approved live-provider and physical-device validation when authorized.
