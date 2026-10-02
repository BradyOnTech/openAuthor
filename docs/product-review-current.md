# openAuthor product gaps and improvement priorities

Historical checkpoint: the [latest rebuilt-app review](product-review-latest.md) supersedes the status below. Unicode retrieval, stale Style Profiles, the format-score label and native word-count refresh now have passing evidence. The latest review also confirms lost unfinished revision requests during tab switching. Earlier observations are retained here for traceability.

Reviewed September 30, 2026, against the current checkout and the existing unsigned macOS app. openAuthor has a useful foundation for safe, reversible editing. Its biggest shortcomings are unreliable story understanding, inconsistent AI context, and too much navigation and review effort for daily novel writing. More generation features would not address those problems.

This is a testing and product review, not an implementation pass. Four pre-existing modified files were preserved. Source checks include the uncommitted word-count fix; native inspection used the previously built app, so that fix is not newly verified in a packaged build. Only synthetic manuscripts were used, with no external model requests or API spending in this review. Earlier dated reviews remain historical records; the results below supersede their test counts and the claim that whole-scene drafting lacks context review.

## Fresh test results

| Check | Result and limits |
| --- | --- |
| Desktop suite | All 161 tests passed across 29 files. This includes background-save count refresh and rejection of a delayed scene list from a different project. |
| Python suite | 257 tests discovered: 255 passed, one skipped, and one test errored in three Unicode-query subcases. The suite is not green. |
| Packaged subscription boundary | The skipped opt-in test passed separately against a local endpoint. No external provider was contacted. |
| Build and native bridge | Frontend production build and seven Rust tests passed. Repository checks passed. npm audit reported zero known vulnerabilities. |
| Synthetic author workflow | Applied text matched the review; undo restored exact scene bytes; backup restored book and history exactly. This is an automated core workflow, not a fresh native test of every step. |
| Backend scale | 400 scenes, 300 proposals, 300 generation records and 72 Memory entries passed every configured performance budget. Story diagnostics peaked at 400.654 ms over three samples. This does not establish native UI responsiveness at that scale. |
| Harder continuity cases | Four of eight expected case outcomes matched: three contradictions missed and one false alarm. This small adversarial corpus is not a general accuracy benchmark. |
| Native product inspection | Used the 42-scene, eight-chapter synthetic book. Inspected Plan, Memory suggestions, evidence navigation, manuscript navigation, Changes and continuity. An evidence link opened the correct scene and selected its source word. Restart restored the project but none of four open working tabs. |

## Confirmed shortcomings

**Style Profiles can mislead generation.** A Chinese exemplar produced zero words and instructions to aim for 0.0 words per sentence and paragraph. Replacing that scene with English prose left the profile identical, without a stale-source warning. A subsequent local proposal-generation record still contained the obsolete zero-word guidance. This is not merely a display defect: bad derived advice enters generation context. Store source versions, disclose measurement limits, and offer explicit rebuild or frozen-reference choices. See [Style Profile calculation](openauthor/style_profile.py:38), [profile loading](openauthor/style_profile.py:19) and [generation consumption](openauthor/ai.py:2281).

**AI retrieval rejects several writing languages.** Exact queries `夜雨`, `разговор` and `المدينة` errored even with those passages indexed. The tokenizer only recognizes ASCII letters and digits. A matching accented Latin test passed, but that does not establish correct accent handling. Implement Unicode-aware matching and bounded chunks for unspaced prose; invalidate old indexes when tokenization changes. Until supported, disclose limitations without giving an English-centric result a universal label. See [tokenizer](openauthor/retrieval.py:18).

**Story understanding is still a narrow heuristic.** The challenge corpus missed a lost-finger contradiction expressed naturally, conflicting Spanish eye colors, and an English hair-color contradiction with unrelated negation in the same sentence. It flagged an explicitly explained hair-dye change. The app correctly warns that its local checks are limited; preserve that honesty. The product gap is that an author still needs a deeper review, not that every narrow rule is incorrectly implemented. Reproduce with [the challenge corpus](docs/product-review-challenges.json) and `scripts.evaluate_canon_diagnostics.evaluate`.

**Memory extraction creates avoidable cleanup.** Native suggestions included “Beyond” as a character. A fresh four-sentence probe proposed “Beyond,” “Meanwhile,” and the real character “Mara,” each with confidence 0.61. Repeated capitalization is not enough to establish character identity. Improve candidate filtering and evidence, expose uncertainty meaningfully, and measure false-positive burden as well as recall. Keep author confirmation; do not turn heuristic suggestions directly into Canon. See [name extraction](openauthor/story_memory.py:44) and [candidate confidence](openauthor/story_memory.py:482).

**Context review is improved but not consistent everywhere.** Whole-scene drafting and passage regeneration now have the reviewed-context flow, and their desktop tests pass. Initial edit-plan generation still assembles context separately without that review step. Merge reconciliation builds a prompt from the three scene versions rather than the shared Plan, Style and approved Canon context. An author should not have to learn which button honors which guidance. Extend the same preview, permission and freshness checks to both. This is a source-confirmed gap, not a newly observed remote data disclosure. See [initial plan context](openauthor/ai.py:1776), [draft review UI](desktop/src/components/editor/GenerateProposal.tsx:185) and [merge context](openauthor/ai.py:2946).

**The HIGH badge can imply more than it measures.** A local generation containing stale zero-word guidance received a score of 100 and tier “high.” The score checks output structure and normalization, not factual correctness, voice preservation or literary quality. The native Changes view shows a bare HIGH badge. Rename it to a format-validation result, explain its scope, and reserve quality claims for actual evaluation. See [score calculation](openauthor/ai.py:857) and [badge](desktop/src/components/editor/ProposalReview.tsx:417).

## Daily writing experience

These are proposed improvements, not UI changes made in this review. The interface-review skill directed attention to readable evidence, visible actions and preserving the author's working location.

| Before | After proposed |
| --- | --- |
| The manuscript sidebar is a flat list of 42 scenes despite the book having acts and chapters. | Collapsible act and chapter navigation, with current location, POV and status filters. Use the existing reading order rather than introducing a second ordering system. |
| Project Brief editing occupies most of the initial Plan viewport; scene work starts near the bottom. | A compact saved-brief summary that expands for editing. Put chapter and scene work in the first viewport. |
| Memory review stays in the narrow sidebar while the main editor shows unrelated content. Evidence consumes the sidebar before item actions are visible. | A dedicated review workspace with readable evidence, persistent accept/correct/defer controls and keyboard next-item navigation. |
| Restart restores the book but loses the open scene, proposal and Plan tabs. | Restore validated working tabs, active scene, caret and scroll position; handle renamed, deleted and Storyline-specific items safely. |
| The generation badge says HIGH without saying what was assessed. | Label format validation separately from story correctness, author preference and measured review outcomes. |

The existing word-count fix passed its focused source tests and the full desktop suite. It still needs verification in a rebuilt native app before being called fully finished. The current continuation message promises a return to the sentence where the author left off, but restart does not provide that behavior. See [editor state](desktop/src/contexts/EditorContext.tsx:40).

## Useful ideas from similar GitHub projects

I searched online and inspected public documentation and selected source files. I did not install competing applications or benchmark their writing. These are design references, not endorsements of their reliability or prose quality. No third-party code was imported.

| Project | Observed pattern | Proposed use in openAuthor |
| --- | --- | --- |
| [Inscriptor context selector](https://github.com/lukashonke/inscriptor/blob/main/src/components/Common/PromptSelector/PromptContextSelector.vue) | Source distinguishes full file text, summaries and child-file context. | Let authors select understandable context items, see what each contributes, and reuse selections with renewed privacy and freshness validation. |
| [LunaRime NovelForge](https://github.com/LunaRime/novelforge/blob/master/README.en.md) | Documents chapter, volume and book summaries with inspection and rebuilding. Its [invalidation source](https://github.com/LunaRime/novelforge/blob/master/src/services/memory/memory-invalidation.ts) marks affected memory files stale. It explicitly describes itself as early-development software. | Build source-linked chapter summaries that become stale after relevant manuscript changes. Keep summaries distinct from confirmed facts and never silently feed obsolete summaries into AI. |
| [xnovelist AI roles](https://github.com/giapnguyen74/xnovelist/blob/main/docs/AI_LEVELS.md) | Defines reader, editor and co-writer roles with different authority over prose. | Make “analyze only,” “edit while preserving facts,” and “explore new possibilities” explicit. Keep AI optional and make generated additions visibly different from corrections. |
| [snowmeth](https://github.com/joelgrus/snowmeth) | Documents guided Snowflake planning, scene tables, character development and chapter refinement. | Offer optional guided planning and useful next-step prompts. Do not force a single method or automatically clear later author work when an earlier plan changes. |

## Recommended implementation order

1. Fix trust defects first: stale Style Profiles, invalid language advice, Unicode retrieval, ambiguous quality badges and the remaining context-review gaps. Acceptance: changed sources trigger a visible decision; unsupported measurements cannot become writing instructions; every external writing workflow uses the approved context.
2. Reduce Memory and diagnostic noise. Acceptance: natural paraphrases and explained changes are covered by an expanded corpus; false positives, misses and invented facts are reported separately. Candidate review must save time compared with entering the facts manually.
3. Improve the daily writing loop. Acceptance: navigate a 40-scene book by chapter, review Memory without sidebar hunting, and restart at the previous working location. Verify the background-save count fix in a fresh native bundle.
4. Make editorial review useful before adding more generation. Existing Editorial Pass presets are a start. Add structured findings for continuity, character knowledge, motivation, pacing and voice, with source quotes, uncertainty, jump-to-text and author resolution. Acceptance: no manuscript changes in analyze-only mode; proposed fixes preserve protected facts and intentional ambiguity.
5. Add inspectable chapter summaries and author-approved voice examples. Acceptance: authors can see exact sources and versions, exclude private material, and choose refresh versus an intentional frozen reference. Evaluate on fresh passages instead of only mechanical rewrite patterns.

My recommendation is to finish the trust fixes and the most disruptive navigation problems before your walkthrough. Then your time can go toward whether the assistant understands your writing preferences, rather than rediscovering known defects. The differentiator should remain safe, evidence-backed revision under author control, not autonomous book generation.

An Apple Developer account is not needed for this product-quality work. Signed distribution, clean Intel installation, comprehensive native fault recovery, and an independent real-author writing-quality evaluation remain unverified. The passing tests do not establish production readiness.

**Sources and reproduction**

- [Current review evidence](docs/product-review-current-evidence.json)
- [Earlier native context-review evidence](docs/revision-context-evaluation.json)
- [Inscriptor context implementation](https://github.com/lukashonke/inscriptor/blob/main/src/components/Common/PromptSelector/PromptContextSelector.vue)
- [NovelForge memory invalidation](https://github.com/LunaRime/novelforge/blob/master/src/services/memory/memory-invalidation.ts)
- [xnovelist role definitions](https://github.com/giapnguyen74/xnovelist/blob/main/docs/AI_LEVELS.md)
- [snowmeth planning workflow](https://github.com/joelgrus/snowmeth)
