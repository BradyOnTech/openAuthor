# Writing Voice and prose quality

Implemented 2026-09-11. This is an author-controlled craft workflow, not a claim
that generated prose has passed independent literary evaluation.

## Use it

Open **Assistant → Writing Voice**, or **Edit Writing Voice** in the Change Set
composer. A chat reply's **Save as… → Writing Voice brief** carries the discussion
into the same workspace without approving a profile or changing the manuscript.

1. Define a named voice for the book. Start from clear structured epic, kinetic
   emotionally intense, or quiet atmospheric prose, then edit the description,
   eight craft controls, preferred techniques and things to avoid. The controls
   cover prose, description, emotional expression, narrative distance, dialogue,
   pacing, imagery and humor. These are original-voice starting points, not
   imitation presets for named living authors.
2. Optionally describe the intended voice in natural language and select your
   own exemplar scenes. **Propose a voice profile** returns editable suggestions.
   AI analysis is asked to examine rhythm, dialogue habits, distance, imagery,
   humor and emotional expression, with uncertainty and exact source quotations.
   Verify those interpretations before **Approve and save Writing Voice**.
3. Compare your draft voice with one or two preset directions using a short,
   exact excerpt of a saved scene. Selecting a preset automatically chooses
   other directions for comparison. Expand the comparison to view three samples
   side by side; leaving restores the previous workspace layout.
4. Judge voice fit, readability, emotional effect, character distinction and
   factual/POV/tense consistency. **Save assessment** retains your notes and
   judgments with the sample. Sentence and dialogue counts are descriptive,
   not quality scores; provider self-review is not independent validation.
5. **Use as draft voice** copies a direction into the editable profile. It still
   needs approval. **Queue sample as Change Set** creates a pending, ordinary
   hunk-reviewable revision of that passage. It does not apply prose or change
   the book's approved voice. Existing review, apply and undo remain the author
   control points.

The workspace reopens its five most recent comparisons for the current book and
Storyline. Unsaved profile edits and natural-language briefs are retained locally.
Assessments have an explicit Save action; unfinished assessment edits do not yet
have the profile draft's recovery behavior.

## Provider behavior and boundaries

- A configured AI writing provider produces literary interpretations and actual
  prose variations. The existing provider selection, generation logging and
  budget checks are reused. No separate model API or provider credentials were
  introduced for this feature.
- Local mode copies the brief into the description and measures selected prose.
  It does not interpret humor or other literary qualities. Its comparisons repeat
  the source as clearly labeled baselines, and unchanged baselines cannot be
  queued as revisions. This makes the workflow available offline without claiming
  creative generation occurred.
- Analysis permits up to six nonempty exemplar scenes totaling 36,000 characters.
  The brief is limited to 4,000 characters; local copying allows 2,400 to fit the
  description. Oversized sources fail rather than being silently shortened.
- A preview source must appear exactly once in the saved scene and contain at
  most 400 words / 6,000 characters. There must be two or three distinct craft
  directions; changing only the profile's name does not create a new direction.
  Candidate prose is bounded to 500 words / 8,000 characters. The current UI
  initially selects up to 180 words, which the author can adjust.
- Each AI analysis or candidate request uses an estimated assembled-input ceiling
  of 16,000 tokens and a 2,600-token response reserve/output maximum. Existing
  provider budget checks can reject it earlier. Comparing three directions makes
  three requests; this is not a single-request price guarantee. These are estimates,
  not exact billing or a quality threshold.
- Invalid structured responses, unknown controls, excessive output and fabricated
  quotations are rejected. A failed comparison does not save a partial set or
  alter the manuscript. Completed provider calls can still have incurred cost.

## Shared integration

`openauthor/style_profile.py` owns validation, approved-profile persistence and
the small `voice_context` / `voice_prompt` projection. `writing_voice.py` owns
suggestions, bounded comparisons, author assessments and the Change Set handoff.
The desktop and CLI use these same operations. This shared boundary follows the
codebase-design skill rather than duplicating style interpretation in each UI.

New copilot text requests and desktop voice preparation receive the approved
profile, as do proposal planning and whole-scene drafting. Hunk regeneration and
merge generation receive the same manuscript-voice guidance. Raw exemplar scenes,
analysis quotations and measurements are not part of this general profile
projection. The copilot's conversational personality stays conversational; a
scene-specific request can adjust prose without silently updating the book's
saved voice. Style preferences never authorize changes to story facts.

The chat context receipt names the supplied profile. Required Writing Voice
context is budgeted in full, not silently clipped. Desktop voice connection
refuses a prepared pack if the approved profile changed after preparation.
Already-sent context is not recalled; a running voice session should be restarted
to use a newly approved profile.

The separate encrypted mobile snapshot/context builder has not gained this
profile projection in this iteration. Nor does shared voice guidance establish
full canon/Plan parity for hunk or merge generation. Those remain explicit
integration tasks; desktop coverage is not a mobile-parity claim.

## Storage, approval and safety

- `.openauthor/style_profile.json` stores the approved profile. Legacy version-1
  measurements remain readable without rewriting the file; an explicit save
  normalizes to version 2. The legacy `style build` command still explicitly
  approves a measurement profile. New discovery uses review-first `style suggest`.
- Profile saves check the originally loaded profile version and book/Storyline
  scope under the project lock. A conflicting save retains the local draft and
  requires reconciliation. Exemplar digests and exact quotations are checked
  again before approval; revised evidence cannot be silently approved as current.
- `.openauthor/workspace/voice-previews/*.json` stores candidate prose, source
  excerpts, profiles, observations and saved author assessments. Preview handoff
  checks the original scene version and exact passage before staging. A newer
  scene or Storyline requires fresh previews, even if another Storyline has the
  same prose. Retrying a handoff recovers its existing proposal if writing its
  draft or preview link failed; it does not reset reviewed hunks.
- Unsaved profile drafts and briefs use the desktop webview's local storage,
  keyed by project path, with their original save scope. Corrupt recovery data
  produces a notice and falls back to the approved profile without crashing.
  These drafts and preview records contain author text; they are local working
  data, not encrypted vaults or content-free telemetry.
- AI analysis sends the brief and selected exemplar text only. AI preview sends
  the selected passage, selected direction and relevant authored book context,
  subject to existing Memory policy. Generation logs retain their existing
  privacy configuration. No new upload, publication or background learning runs
  merely because a profile is edited or approved.
- Locks cover snapshots and writes, not network inference. Caught retry paths
  are tested; this feature does not claim multi-file crash recovery or protection
  against non-cooperating external filesystem writers.

## Evidence and next quality work

Core tests exercise the public profile/discovery/preview/review/staging interfaces,
legacy compatibility, bounds, source evidence, stale scope, interrupted handoff
recovery, provider input, context admission and apply/undo. AI-shaped responses
are injected at the existing provider transport seam; there is no live inference.
Rendered component tests cover explicit approval, profile/brief recovery, corrupt
recovery data, distinct comparisons, retained assessments and expanded layout.
The real-Python browser journey covers the connected offline workflow, reopening,
the copilot receipt and chat-brief promotion; its screenshots were inspected.

Next evaluate short original or authorized scenes with deliberately different
POVs, dialogue habits and emotional aims. Compare the three directions blindly
where practical, retain the author's judgments, and measure preserved facts and
instruction adherence separately from taste. Agree on manuscript scope and spend
before live-provider evaluation. Automatic learning from accepted prose,
character-specific subprofiles, richer mobile context and full-book style-drift
diagnostics are future work, not implied by the current controls.
