# Original-scene writing-quality evaluation

2026-09-12. This evaluates the public Writing Voice preview workflow, not a
private regex helper. It separates functionality, fidelity and literary judgment.

## What is implemented

Three original scenes in `tests/fixtures/writing_quality.json` cover action,
dialogue and introspection. Each has explicit facts, close-third POV, a scene
instruction, protected wording, craft questions and a semantic calibration trap.
The introspection scene is a preservation control: a more aggressive rewrite
is not automatically an improvement. No private manuscript or imitation of a
named author is used.

The runner calls `preview_voice` with the three existing original directions,
giving nine short samples. It makes a disposable book, verifies source prose
remains unchanged and produces anonymous A/B/C samples in a review packet.
Directions are shuffled reproducibly and revealed only in the keyed JSON record.
Generator self-reviews are omitted from the blinded packet. The manifest records
corpus and implementation hashes, seed, requested model, call count and unchanged
candidate count. It does not assert a pinned resolved model behind
`codex-recommended`; record that separately when comparing subscription runs.

```bash
make test-writing-quality
python3 scripts/evaluate_writing_voice.py --output /path/to/new-local-evaluation

# Only when openAuthor's existing ChatGPT subscription connection is authenticated:
python3 scripts/evaluate_writing_voice.py --provider openai-codex --output /path/to/new-subscription-evaluation
```

The output directory must not already exist. It contains `review.md` (blinded)
and `record.json` (directions, checks, provenance and source). Live mode permits
only `openai-codex`, checks the existing connection, never logs in, and has no
API-provider fallback. The fixed corpus bounds a successful run to nine
generation calls with provider retries disabled. A rejected comparison stops that
scene without retry; the runner continues the other fixed cases and exports a
partial packet with failures and safe generation summaries. Its command exits
nonzero when any case fails. Counts come from recorded provider attempts, not an
assumed nine successes. A successful transport is not necessarily an accepted
Writing Voice comparison. Interrupted processes and unexpected errors still do
not checkpoint a partial packet. Local mode makes zero inference calls.

## Subscription constraint

The existing subscription connector and desktop subscription-first default are
reused, not replaced. At the initial checkpoint openAuthor's own account status
reported unauthenticated, so that first evaluation was offline. The author then
requested a sign-in link and completed the existing login flow. The subsequent
account check reported authenticated ChatGPT mode. No API-key providers were
called, no credentials were copied, and no provider preference was changed.
OpenAuthor's app-specific account home
is distinct from a login in the Codex application running this development task.
The official app-server documentation distinguishes ChatGPT account mode from
API-key mode and provides `account/read` for status. See
[Codex app-server authentication](https://learn.chatgpt.com/docs/app-server#authentication-modes).

The authenticated runtime's `model/list` returned both `gpt-5.6-luna` and
`gpt-5.6-terra`. The author approved either; the live exercise explicitly requests
Terra. This is availability observed through the subscription connector, not an
inference from the API model catalog. Discovery follows
[the documented model-list method](https://learn.chatgpt.com/docs/app-server#list-models-modellist).

## Live validation failure and repair

The first Terra attempt stopped at an exact-quotation validation error before
export. Its temporary results were not retained, so its precise call count and
prose quality cannot be reconstructed. This exposed a runner defect: an expected
provider-result rejection discarded the report. A deterministic public-workflow
regression reproduced that failure; the runner now retains failures and completed
comparisons without treating rejected prose as usable evidence.

The [second attempt](evaluations/writing-voice-terra-2026-09-12-attempt-2/record.json)
recorded three subscription calls, one per scene, and zero accepted comparisons.
All three failed the quotation guard. A separate one-call diagnostic captured the
actual response: the candidate contained `The count broke off before the boy.`
while its self-review excerpt was `“The count broke off before the boy.”`. The
extra presentation quotes made the formerly strict substring test fail. This
diagnostic explains the captured response; it does not reconstruct the missing
raw responses from the earlier attempts.

The repair removes exactly one matching pair of surrounding quotation marks only
if the entire enclosed text already occurs verbatim in the candidate. Genuine
dialogue quotations already present are unchanged. Fabricated text, omitted words,
ellipsis substitutions and empty quotations remain rejected. Two public-workflow
regressions cover accepted formatting and rejected evidence; no fuzzy matching,
silent rewritten quotations, prompt weakening or provider fallback was introduced.
Normal app previews now keep valid prose when one self-review observation is
malformed, omit that observation and show a warning. The evaluation runner passes
an explicit strict-review flag, so malformed evidence remains a failed evaluation
case rather than being counted as a successful sample.

## Post-repair Terra result

The [third attempt's blinded packet](evaluations/writing-voice-terra-2026-09-12-attempt-3/review.md)
contains six accepted revisions: three dialogue and three introspection. Seven
recorded subscription calls ran; action was still rejected for an absent excerpt,
and the command correctly exited nonzero with a partial report. No further live
calls were made after this result. The remaining rejected response was not retained
as raw prose, so its exact mismatch is still undiagnosed; do not generalize the
presentation-quote repair to it without fresh evidence.

The [assistant's label-blind assessment](evaluations/writing-voice-terra-2026-09-12-attempt-3/assessment.md)
finds modest rather than compelling dialogue improvements. Two alternatives make
the tea action ambiguous; one weakens the explicit key-transfer event. All six
accepted samples pass lexical and protected-phrase checks, illustrating why those
checks cannot certify fidelity. The introspection variants preserve the important
uncertainty and restrained ending; retaining strong prose is appropriate to that
control. Author judgments remain unrecorded. Neither this small corpus nor the
assistant's critique establishes general literary quality or a model ranking.

The targeted best-effort action rerun is available in
[the anonymous action packet](evaluations/writing-voice-terra-2026-09-13-action/review.md)
with an [assistant assessment](evaluations/writing-voice-terra-2026-09-13-action/assessment.md).
It produced three Terra variants and preserved all three despite incomplete
self-review metadata on two. The assistant's blind preference is source/A tie;
one kinetic variant advances the interrupted count and should not be selected
without repair. The author's review is still required.

## Findings and honest limits

### September 29 dialogue followup

The [new anonymous dialogue packet](evaluations/writing-voice-luna-2026-09-29-dialogue/review.md)
uses three Luna subscription calls, zero retries and no API fallback. All three
stop at the source's ending after adding an explicit endpoint/staging instruction.
The [assistant assessment](evaluations/writing-voice-luna-2026-09-29-dialogue/assessment.md)
still flags repeated cup staging, changed recollection and a missing refusal to
drink. Prefer source/A tie; author review is pending. No simultaneous old-prompt
control was run, so do not attribute the change solely to the instruction or
generalize to full-book quality. No further taste-based prompt tuning was done.

The app's new one-sample refinement loop has core, rendered and browser workflow
coverage. A [fresh-scene experiment](evaluations/writing-refinement-luna-2026-09-29/assessment.md)
used three additional Luna subscription calls and verified live prose through
exact apply/undo. Refinement reduced some invented material but only partly
fulfilled the craft feedback. Author comparison and connected-chapter evaluation
remain necessary; neither successful requests nor these small samples certify
the full writing vision.

### September 22 subscription-only Luna comparison

The [Luna packet](evaluations/writing-voice-luna-2026-09-22/review.md) contains all
nine variants from nine single-attempt calls on original scenes, with no API-key
fallback. This run explicitly used `--best-effort`, matching app preview behavior:
action A retained its prose with incomplete self-review evidence omitted and a
warning. It is not a strict evidence-validation pass. Mechanical marker/phrase
checks pass on all nine, but do not establish semantic fidelity.

The [assistant assessment](evaluations/writing-voice-luna-2026-09-22/assessment.md)
prefers source/A tie for action, source for dialogue, and retaining the source
for introspection. All dialogue variants add ending beats; some introduce
redundant cup staging or make refusal to drink less definite. Similar added
imagery across action directions suggests limited differentiation on this fixture.
Author review remains pending, and no model ranking or prompt improvement is
claimed. An interrupted partial count is not itself a completed recount; assess
the actual sequence rather than treating added counting words as proof of error.

### Baseline and remaining limits

The offline run produced nine unchanged samples, zero inference calls, and zero
creative variations. All assessments remain unreviewed. This establishes an
inspectable baseline and exercises the workflow; it does **not** establish that
openAuthor produces better prose or that one direction is superior.

The existing seven-fixture editorial evaluation counts deterministic pattern
changes. Its improvement and canon-error metrics must not be read as literary
quality or semantic-fidelity scores. The new calibration test deliberately adds
false character knowledge while retaining every protected marker; lexical checks
still pass and the semantic verdict correctly remains pending human review.

The preview instructions now explicitly preserve incomplete actions, uncertain
beliefs, withheld knowledge, distinct speaker habits, purposeful repetition and
strong existing passages. They ask for concrete attention and subtext rather
than uniformly short sentences or generic imagery. Tests verify those instructions
reach the existing provider interface. A subsequent subscription run now provides
inspectable generated prose and an assistant critique, but human assessment and a
controlled comparison are still needed to validate any claimed prompt improvement.

## Human review and next decision

1. Read source and candidates without direction labels or generator opinions.
2. Mark each scene fact preserved, contradicted or uncertain, quoting evidence.
   Missing lexical markers flag inspection; present markers do not establish truth.
3. Assess voice fit, readability, character differentiation, emotional effect and
   consistency. Give reasons tied to passages, not a composite numeric score.
4. Choose A/B/C, the original, a tie, or none. Do not select a fact-breaking
   candidate just because its prose is attractive. An unchanged control can win.
5. Have the author judge and, where practical, ask a second independent reader.
   Keep disagreements and uncertainties visible. Revisit prompt changes against
   the same corpus before broadening to a varied held-out set.

Saving an assessment in the app now retains unfinished notes safely, but importing
an external packet's judgments into the book is not automatic. Automatic learning,
character subprofiles and book-length drift diagnosis remain later features.
