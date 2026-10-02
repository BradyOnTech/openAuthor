# openAuthor author workflow review and improvement priorities

Historical September 30 checkpoint. For current implementation and remaining
acceptance work, read the [October 2 quality review](evaluations/project-completion-2026-10-02/review.md)
and [requirements ledger](evaluations/project-completion-2026-10-02/requirements.json).
Open tabs and caret recovery are now implemented and locally verified; broader
editorial usefulness, physical phones and release acceptance remain open.

Reviewed September 30, 2026, on `codex/production-authoring` at `2fbe4f6` plus the current uncommitted changes. The unsigned arm64 app was rebuilt from this checkout and tested with synthetic writing. This report supersedes the earlier [review checkpoint](product-review-current.md), whose failed Unicode and stale Style Profile findings have since been addressed in the working tree.

openAuthor has a useful foundation for reversible editing, but it is not yet a dependable novel-writing assistant. The lost revision-input defect and inconsistent review of edit-plan and reconciliation context have now been fixed in the working tree. Its largest remaining shortcomings are narrow story understanding and unnecessary effort navigating and reviewing a book. More generation features should not outrank those issues.

## What passed

After the input and context fixes, the desktop suite passed all 170 tests. Python discovery ran 272 tests: 271 passed and one opt-in packaged-runtime contract was skipped; that contract passed separately against a local endpoint. All seven Rust tests passed. The frontend build, repository checks, unsigned macOS package and packaged runtime checks passed. npm audit reported zero known vulnerabilities. The earlier audit evidence remains a dated checkpoint; [input and context verification](revision-safety-verification.json) records this follow-up.

The synthetic core author workflow verified that applied text matched the reviewed draft, undo restored exact manuscript bytes, and backup recovery restored book and history exactly. The backend scale gate tested 400 scenes, 300 proposals, 300 generation records and 72 Memory entries and passed all configured budgets. In the isolated rerun, story diagnostics peaked at 418.01 ms over three samples. These checks establish specific behavior, not independent literary quality or complete native failure recovery.

In the rebuilt native app, I added a synthetic scene to the existing 42-scene book, typed nine words and immediately navigated to Plan. Its card showed nine words and the footer increased from 10,276 to 10,285. Editing it to eight words produced a 10,284-word total. The exact prose survived restart.

The following changes already present in the working tree were verified, rather than repeated as unresolved findings:

| Before | After verified |
| --- | --- |
| A background scene save could leave book and Plan word counts behind. | The native immediate-navigation test showed the saved count in both places. Cross-project delayed-response coverage also passes in the desktop suite. |
| Style Profiles had no source freshness and could turn unsupported prose into zero-word advice. | Source changes become visibly stale and excluded. Native explicit freeze, return to current-source protection, and rebuild all worked. Chinese word-based metrics are now unavailable instead of misleading zero targets. |
| The generation badge said HIGH without identifying the assessment. | The rebuilt Changes view says FORMAT SCORE: HIGH. This remains formatting assessment, not evidence of literary quality. |
| An unfinished revision request vanished when Generate unmounted. | Request fields recover per book and Storyline, with visible local-save status and a save-retry action. Native tab switching and full restart retained the instruction, constraints, protected text, scene and provider. |
| Initial edit-plan generation sent a request before context review. | The first action opens a local preview. Every plan and subsequent draft requires its own durable approval; nearby scenes and omitted context are disclosed. |
| Reconciliation ignored saved Plan, Style Profile and reviewed Canon. | It uses the shared bounded author-context policy and a dedicated preview, identifying the checked-out Storyline that supplies guidance. Core exact-payload and failure tests, CLI delivery tests and desktop recovery tests pass; native reconciliation was not exercised in this follow-up. |

Chinese, Russian, Arabic, accented French, decomposed accents and single-character Chinese retrieval cases pass. Long unspaced text returns bounded original excerpts; legacy indexes require rebuilding. This is lexical matching, not proof of semantic or comprehensive multilingual understanding.

## Confirmed shortcomings

**Revision request recovery is fixed; working-location recovery remains.** The original tab-switch loss was reproduced in a shell regression before implementation. The shared recovery journal now retains all request fields, including unfinished custom-pass fields, by book and Storyline. A failed storage write retains the draft in memory across tab navigation and visibly blocks generation until saving succeeds. This does not promise crash recovery while storage is unavailable. Restart still does not restore open tabs, caret or scroll position. See [form state](../desktop/src/components/editor/GenerateProposal.tsx) and [recovery behavior](../desktop/src/recoverableDraft.ts).

**Continuity is too narrow to be a general story review.** Replaying the eight exploratory challenges matched only four expected case outcomes. The checker missed a naturally phrased missing-finger contradiction, conflicting Spanish eye colors, and a hair-color contradiction when unrelated negation appeared in the sentence. It flagged an explicitly explained hair-dye change. These are authored challenge cases, not a general accuracy estimate. The app correctly warns that its checks are limited; keep that warning. Add focused reviews for continuity, character knowledge, motivation, pacing and voice, with exact quotes, uncertainty and minimal suggested corrections. Measure both missed issues and unnecessary warnings. The [challenge corpus](product-review-challenges.json) preserves the examples.

**Memory extraction still needs broader precision evaluation.** The four-sentence probe originally proposed “Beyond,” “Meanwhile,” and the genuine character “Mara.” A new regression reproduces that failure. Contextual filtering now excludes spatial openers such as “Beyond the…” and comma-delimited transitions such as “Meanwhile, …”, while retaining the same spellings when used as names. This targeted correction is not general named-entity understanding. Continue measuring the author's correction burden on new examples. Suggestions remain unconfirmed until the author accepts them.

**The four revision paths now share an author-context policy.** Edit plans, full-scene drafts, passage revisions and merge reconciliation use saved Plan guidance, permitted Memory, fresh or deliberately frozen Style Profiles, and explicitly approved Canon. Their source scopes still differ intentionally and are disclosed in the preview. External plan and reconciliation calls now require a reviewed fingerprint, including CLI callers; unreviewed legacy reruns must use the preview flow. Tests verify rejection before transport when guidance changes, and no publication when it changes during generation. The native walkthrough produced a local edit plan and two draft hunks only after separate approvals, and both logs contained the saved guidance and Style Profile. This is request-safety evidence, not live-provider editorial-quality evidence. See [context preparation](../openauthor/ai.py) and [shared review UI](../desktop/src/components/editor/RevisionContextReview.tsx).

**Voice support is descriptive measurement, not a convincing model of an author’s voice.** Current profiles contain approximate lengths, quote ratios, punctuation rates and recurring words. They now disclose their limitations, but those numbers cannot capture narrative distance, humor, rhythm, character-specific diction or deliberate exceptions. Add author-approved example passages and editable preferences, with exact source versions and a distinction between preserving facts and exploring new material. Evaluate on fresh synthetic passages before making stronger voice-preservation claims.

## Daily writing experience

The interface review emphasized readable evidence, preserving work and keeping frequent actions visible. These are proposed changes, not new UI implementation in this audit.

| Before observed | After proposed |
| --- | --- |
| The manuscript sidebar is a flat 43-scene list despite the book having two acts and eight chapters. | Collapsible act and chapter navigation using the existing reading order, with current location and POV/status filters. |
| Plan leads with a large expanded brief; Generate places substantial setup above the actual revision request. | Compact saved-guidance summaries; expand settings when needed and keep the author’s current task prominent. |
| Memory triage occupies a narrow sidebar while the main area displays unrelated content. Evidence pushes per-item actions out of view. | A full-width review workspace with readable source passages, persistent accept/correct/defer controls and keyboard next-item navigation. |
| Restart restores the project but none of four open working tabs. | Restore validated tabs, active scene, caret and scroll position; handle deleted and Storyline-specific items safely. |

## Useful ideas from similar GitHub projects

I searched online and inspected public documentation and selected source. I did not install these apps, benchmark their prose, or import their code. Treat them as design references, not proof of greater reliability.

| Project and observed pattern | Recommended adaptation |
| --- | --- |
| [Inscriptor](https://github.com/lukashonke/inscriptor/blob/main/src/components/Common/PromptSelector/PromptContextSelector.vue) implements choices for full file text, summaries and child-file context. | An understandable “What the AI will read” selector with chapter summaries, approved facts and selected passages. Preserve openAuthor’s permission and stale-source protections. |
| [LunaRime NovelForge](https://github.com/LunaRime/novelforge/blob/master/README.en.md) documents chapter, volume and book memories with inspectable summaries and stale-memory exclusion. Its README explicitly describes early development. | Source-backed chapter summaries that visibly become stale after edits, with author-controlled rebuilding. Keep derived summaries distinct from confirmed Canon. See its [invalidation implementation](https://github.com/LunaRime/novelforge/blob/master/src/services/memory/memory-invalidation.ts). |
| [xnovelist’s design](https://github.com/giapnguyen74/xnovelist/blob/main/docs/AI_LEVELS.md) separates reading, editing selected prose and writing new material. | Clearly named Reader, Editor and Co-writer modes. Read-only critique should not become a rewrite; fact-preserving edits should not become exploratory expansion. These are design-document references, not verified shipped behavior. |
| [snowmeth](https://github.com/joelgrus/snowmeth) documents a guided Snowflake planning sequence from premise through characters, structure and scenes. | Optional guided planning prompts for a blank project. Do not force a rigid method on authors who already have a manuscript. |

## Recommended next work

1. Improve editorial judgment on fresh continuity, character-knowledge, motivation and voice cases. Require quoted evidence and clear uncertainty; distinguish intentional changes and count unnecessary warnings alongside missed problems.
2. Give Memory and editorial findings a full-width evidence-first review workspace, with persistent accept/correct/defer actions and next-item navigation. Simplify context review so authors can understand it without reading a large JSON payload.
3. Restore working location and provide collapsible chapter navigation. Keep recovered request content separate from tab, caret and scroll restoration.
4. Add inspectable chapter summaries and approved voice examples with source freshness and explicit context permissions.

The product should differentiate through safe, evidence-backed revision under author control. The next walkthrough should test whether its advice helps the author make better decisions, not force the author to rediscover lost-input and navigation defects.

Only synthetic writing was used. This audit made no external model requests and incurred no API spend. It does not newly validate live-model editorial quality, clean Intel installation, signed distribution, a real-author pilot or exhaustive accessibility and fault recovery. An Apple Developer account is not needed for the product-quality work above.

**Sources and reproduction**

- [Latest machine-readable evidence](product-review-latest-evidence.json)
- [Input and context follow-up verification](revision-safety-verification.json)
- [Earlier review checkpoint](product-review-current.md)
- [Continuity challenges](product-review-challenges.json)
- [Inscriptor context selector](https://github.com/lukashonke/inscriptor/blob/main/src/components/Common/PromptSelector/PromptContextSelector.vue)
- [NovelForge memory behavior](https://github.com/LunaRime/novelforge/blob/master/README.en.md)
- [xnovelist AI roles](https://github.com/giapnguyen74/xnovelist/blob/main/docs/AI_LEVELS.md)
- [snowmeth planning workflow](https://github.com/joelgrus/snowmeth)
