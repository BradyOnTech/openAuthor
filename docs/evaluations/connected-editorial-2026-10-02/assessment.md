# Connected editorial assessment — 2026-10-02

**Assessment by the assistant; author review and acceptance were not observed.** One live subscription-backed critique recognized the planted character-knowledge problem, avoided the explicit-change false alarm, and respected the chapter's unresolved ledger and ferry. Its original structured finding was withheld because one exact quotation had an incorrect offset. The semantic observation and the original product delivery must be assessed separately. This small result does not establish novel-scale editorial quality or improved prose.

## Material and scope

The original synthetic [Ferry Ledger fixture](../../../tests/fixtures/ferry_ledger_chapter.json) contains three connected scenes, 5,733 characters and approximately 1,061 whitespace-delimited words. No private manuscript was used. Its SHA-256 is `317d6bbff3d10773c17a3fef5084476ddf542468f9b4bac370a21c790c8d304a`, matching the recorded request. The review focused on character knowledge across the chapter while targeting the final scene.

The reviewed context included the fixture's saved style guide: close third person; emotion carried by objects and practical choices; Leah's short literal questions contrasted with Jonas's dry humor; no invented backstory, decorative symbolism or appended resolution. It explicitly protects uncertainty about the ferry and unopened ledger. No learned/approved Writing Voice profile was present (`style_profile_status.freshness=absent`), so this run evaluates the saved guide and prose, not successful use of a learned profile. The exact input is retained in [live-preview-reviewed.json](live-preview-reviewed.json).

The [immutable original result](live-results-original.json) preserves the raw provider response and the original parser outcome. [Local revalidation](live-results-verified.json) uses the same response after the evidence-anchor repair; it is not a second provider run. Do not substitute it for the original delivery result.

## Findings against the planted controls

| Evaluation target | Assistant assessment |
| --- | --- |
| Unexplained knowledge of the key | Caught in raw feedback. Jonas conceals it after Leah leaves; Leah later knows its exact hiding place despite the prose ruling out observation, discussion and a message. The model cites both scenes and distinguishes an error from a possibly intentional uncanny event. |
| Black-to-green hair | No false alarm in this response. The text supplies both Jonas's dye explanation and Leah hearing it. This one control does not measure a general false-positive rate. |
| Unopened ledger and missing ferry | Preserved. The response recognizes the unresolved ending as a strength and does not invent ledger contents, a ferry outcome, or explanatory backstory. |
| Stopped clock | No erroneous current-time inference or clock finding was emitted. The response does not discuss this control, so correct temporal reasoning was not independently demonstrated. |
| Motivation, pacing and voice | Not evaluated broadly. The focused critique notices differentiated dialogue and practical object handling, but does not supply enough independent craft analysis to judge the chapter's overall pacing or literary success. |

The key observation is useful because it makes a specific author decision inspectable: provide an observable basis, soften certainty into an impression, or retain impossible knowledge with a restrained cue that it is intentional. The last option respects deliberate ambiguity. These are alternatives for author judgment, not permission to add a clue or supernatural explanation. No revision was generated, accepted or rejected, so the alternatives' effect on actual prose remains untested.

The summary calls the problem a knowledge break more confidently than the finding's uncertainty supports. The longer finding appropriately allows an intentional mystery and the limitations acknowledge absent external canon. Authors should receive that qualification alongside the concern; this assistant assessment does not declare the passage objectively wrong.

## Evidence-delivery failure and repair boundary

The scene 2 quote is exact at zero-based codepoint interval `[134, 238)`. The scene 3 quote is also exact and occurs once, at `[527, 707)`, but the provider supplied `[526, 706)`. Independent comparison against the original fixture confirms both quotation texts and the one-character displacement. The original strict validator withheld the sole finding and retained a visible warning and raw response. Thus the live run showed meaningful chapter interpretation but failed to deliver an actionable structured concern in the normal findings list.

The repair locates a unique exact quote only within the supplied reviewed source windows for the same scene and discloses the corrected anchor. It continues withholding absent, altered or ambiguous quotations, including self-overlapping repeats; overlapping source windows deduplicate the same absolute location. Independent replay of the immutable raw response produces one finding with exact intervals `[134, 238)` and `[527, 707)` plus one correction warning. Independent editorial/profile regression verification passed 19 tests. This establishes the local delivery repair for this response; it does not establish a new model-quality result, justify fuzzy evidence, or erase the original failure. Chapter source freshness and ordinary review/apply protections remain required.

All three scene bodies remained unchanged. Attempting to apply the critique was refused as feedback-only. These observations verify that this run preserved manuscript bytes; they do not verify application or exact undo of a subsequently generated revision.

## Usage and remaining acceptance

Generation `gen-74db96940b37` used provider `openai-codex`, requested `codex-recommended`, and recorded resolved model `gpt-5.6-sol`. It reports 4,620 input tokens, 2,411 output tokens, 65,875 ms latency and one provider attempt. The generation's estimated API cost is `$0.00` because it used the subscription path. That reported estimate is not proof of subscription billing, exact monetary cost, or free usage. The approved evaluation scope was synthetic material with a maximum `$5` API budget; this assessment made no additional provider calls.

The result supports a narrow, qualified instance of evidence-aware critique: one supported cross-scene concern, no observed invention, and restraint around two explicit ambiguity controls. No paired baseline was run, so comparative improvement is unestablished. Remaining acceptance requires the author's judgment of the critique, comparison of retained/rejected revisions against the original, additional fresh connected material with subtler clues and negative controls, and independent assessment of voice, pacing, unnecessary intervention and missed issues. One authored fixture and one model response are not a benchmark or a novel-quality certificate.
