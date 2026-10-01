# openAuthor testing findings and improvement priorities

Reviewed September 30, 2026. openAuthor is stronger at protecting an author's edits than at helping them navigate, understand, and improve a whole novel. The safe revision loop worked in fresh native testing. The next investment should be consistent AI context, useful editorial findings, and a smoother daily writing experience, not more providers or autonomous book generation.

This follow-up assesses checkout `59b2c24` plus the existing, uncommitted passage-context work. Native testing used the existing unsigned arm64 app, which predates that uncommitted work. The frontend build tested the current checkout; it does not establish native verification of the new passage-review UI. No production behavior was changed during this review. Existing edits were preserved.

## What passed and what did not

| Check | Current evidence |
| --- | --- |
| Python | 251 passed, one opt-in check skipped. The skipped packaged subscription-runtime contract then passed separately against a local endpoint. |
| Desktop | 154 passed, one failed. The new passage-review test installs an empty native bridge; a temporary diagnostic with a working bridge passed the same strict-mount and permission-recovery scenario. The existing test remains unfixed, so the suite is not green. |
| Build and native bridge | Frontend production build passed; seven Rust tests passed; npm audit reported zero known vulnerabilities. No new native bundle was built in this review. |
| Backend scale | 400 scenes, 300 proposals, 300 generation records, 72 Memory entries. All configured budgets passed. Story diagnostics peaked at 432.113 ms across three samples. This is not a native UI latency measurement. |
| Existing evaluations | Seven seeded Canon cases, 16 narrow prose cases, seven mechanical editorial cases, and the synthetic apply/undo/backup workflow passed. These are regression checks, not broad writing-quality benchmarks. |
| Harder continuity cases | Four of eight expected outcomes matched. Three contradictions were missed and an explicitly explained hair-dye change was flagged. The three earlier character-knowledge false alarms now pass. |

In the native app I opened a synthetic 40-scene, eight-chapter, two-act manuscript, then added two disposable test scenes. Saving while immediately switching scenes preserved the prose. A local Shorten request produced a reviewable replacement; accepting wrote exactly the reviewed text. Undo restored the entire scene file byte-for-byte. Restart preserved the manuscript and the Undo result.

One new, feedback-only subscription request tested a 75-word synthetic passage. The model identified a paraphrased missing-finger contradiction and distinguished unexplained character knowledge from a definite contradiction. It quoted evidence and proposed minimal corrections without inventing a backstory. The scene file remained byte-identical. The request reported 3,756 input tokens, 229 output tokens and 9.839 seconds, versus an 841-token app-context estimate. The app disclosed provider overhead. No API-key request was made; subscription quota was consumed. The app reported estimated incremental cost of $0, not a free subscription. One focused example is promising evidence, not a quality score.

## Confirmed defects and incomplete behavior

**Style guidance can become stale without warning.** I built a Style Profile, rewrote its source scene, and fetched the profile again. It remained identical, without a freshness indicator. An intentionally frozen reference could be useful, but the product must distinguish that from a current-source profile. Show the source version, flag changes, and offer explicit refresh or keep-frozen choices. See [style_profile.py](openauthor/style_profile.py:19).

**Language handling produces misleading results.** The Chinese passage `夜雨落在长街。小林看见蓝色的灯。她没有回头。` produced a zero-word profile and guidance to aim for zero words per sentence. Retrieval rejected the exact query `夜雨` as having no searchable token. Support Unicode/language-aware segmentation, or state the limitation and suppress misleading advice. This finding concerns AI retrieval, not every search feature. See [style_profile.py](openauthor/style_profile.py:38) and [retrieval.py](openauthor/retrieval.py:18).

**The book word count can lag behind saved writing.** Adding 41 words and immediately navigating away saved the scene correctly, but the footer remained at 10,160 rather than 10,201. Applying a later proposal refreshed it. The save callback only refreshes the scene list while its editor is mounted. Refresh project-level derived state when a background save completes, without targeting a different project. See [SceneEditor.tsx](desktop/src/components/editor/SceneEditor.tsx:44).

**AI context remains inconsistent across workflows.** The uncommitted passage-regeneration work now includes saved guidance and reviewed permissions in Python tests, addressing the earlier omission; native verification of that work remains pending. However, whole-scene drafting and merge reconciliation still do not share the selection/chat review contract. The merge prompt is assembled from three scene versions without the shared Plan/Style/Canon builder. Complete one context contract and verify it through the native UI. See [ai.py](openauthor/ai.py:2544) and [merge reconciliation](openauthor/ai.py:2924).

**The current desktop test failure must be resolved before another release candidate.** The error is `window.__TAURI_INTERNALS__.invoke is not a function`, not evidence that the packaged app has that failure. Supply the working native boundary and retain the permission-recovery assertions. See [RevisionContextReview.test.tsx](desktop/src/RevisionContextReview.test.tsx:22).

## Daily writing improvements

These are proposed changes, not changes made in this review. The interface-review skill focused this assessment on visible actions, readable feedback and navigation effort.

| Before | After proposed |
| --- | --- |
| The writing sidebar presents a flat list despite two acts and eight chapters in Plan. | Collapsible act/chapter navigation, with scene status, POV filtering and an obvious current location. Reuse the existing reading order. |
| The expanded Project Brief takes most of the first planning viewport. | A compact saved-brief summary; expand to edit. Make chapter and scene work visible immediately. |
| Selection instructions, preview and buttons share a 48vh scrolling region. Main actions fall below the visible area. | Keep Review/Generate/Back visible; show compact context items before optional exact prompts. Preserve permission review. |
| Selection comparisons show entire before/after passages without highlighting changed words. | Highlight changes and protected surroundings so small edits are fast to verify. |
| Critique renders literal Markdown markers in a narrow feedback column and is labeled Pending with a Reject action. | Readable findings with severity, uncertainty, source quotes, jump-to-passage and resolve/dismiss actions. Keep critique non-mutating. |
| Restart restores the project but loses open tabs and the last working location. | Restore validated tabs, active scene, caret and scroll position, accounting for renamed/deleted scenes and Storyline changes. |

The earlier selection-panel contrast defect is visibly improved in the tested dark theme. This was not a comprehensive accessibility or light-theme audit.

## Useful patterns from similar GitHub projects

I reviewed public repository documentation and selected source files, not installed competitors or benchmarked their prose. Their feature descriptions establish design ideas, not proven accuracy or production readiness.

| Project | Observed pattern | Recommendation for openAuthor |
| --- | --- | --- |
| [Inscriptor](https://github.com/lukashonke/inscriptor) | Its [context picker](https://github.com/lukashonke/inscriptor/blob/main/src/components/Common/PromptSelector/PromptContextSelector.vue) distinguishes full files, summaries and child-file context. | Let authors choose understandable context items and see why something is excluded. Revalidate permissions whenever a saved selection is reused. |
| [LunaRime NovelForge](https://github.com/LunaRime/novelforge/blob/master/README.en.md) | Documents chapter/volume/book memory, inspection and rebuild. Its [invalidation implementation](https://github.com/LunaRime/novelforge/blob/master/src/services/memory/memory-invalidation.ts) marks affected summary files stale. | Add source-linked chapter summaries with explicit freshness and approval. Keep generated summaries separate from confirmed Canon. The project itself describes its early-development status. |
| [xnovelist](https://github.com/giapnguyen74/xnovelist) | Separates reader, editor and co-writer roles and uses accept/reject proposals. Higher autonomy levels are described as scaffolded, not all complete. | Make “analyze only,” “preserve facts while editing,” and “explore new possibilities” explicit choices. Keep a first-class AI-off editor. |
| [snowmeth](https://github.com/joelgrus/snowmeth) | Organizes planning around the Snowflake Method, character charts, scene tables and chapter refinement. | Offer optional guided planning templates and next-step prompts. Do not force every author through a fixed method or clear later work automatically. |

No third-party code was imported. Do not equate a longer feature list with better fiction. openAuthor's reviewed edits and exact Undo are worth keeping central.

## Recommended work order

1. Restore green desktop tests; finish shared reviewed context and stale-source handling. Acceptance: identical approved constraints reach selection, drafting, passage regeneration, chat and merge; changed sources require renewed review.
2. Fix misleading word/style counts and unsupported-language behavior. Acceptance: counts match persisted text after navigation; unsupported input never generates zero-word writing advice.
3. Improve the daily writing loop with chapter navigation, resume-at-last-location, compact Plan and visible review actions. Acceptance: a 40-scene project can be navigated and revised without losing place or hunting for controls.
4. Add focused continuity, character-knowledge, motivation, pacing and voice reviews. Distinguish evidence, inference and intentional ambiguity. Acceptance: fresh unseen passages test missed problems, false alarms, invented facts and unnecessary voice changes; “no findings” never means “proven consistent.”
5. Add inspectable chapter summaries and author-approved voice examples, with source versions and privacy controls. Acceptance: editing a source invalidates dependent context or clearly retains a frozen version by choice.

Before calling the next build ready for your walkthrough, I would complete the first two items and address the most disruptive navigation/review friction. Then the walkthrough can focus on writing preferences and usefulness rather than rediscovering known defects.

Not established here: full current-bundle failure recovery, disk-full behavior, every import/export edge, clean Intel installation, signed distribution, or an independent real-author evaluation. An Apple Developer account is not needed to continue this product-quality work.

**Sources and reproduction**

- [Detailed probe evidence](docs/product-review-followup-evidence.json)
- [Continuity challenge corpus](docs/product-review-challenges.json)
- [Inscriptor context picker](https://github.com/lukashonke/inscriptor/blob/main/src/components/Common/PromptSelector/PromptContextSelector.vue)
- [NovelForge memory invalidation](https://github.com/LunaRime/novelforge/blob/master/src/services/memory/memory-invalidation.ts)
- [xnovelist documented scope](https://github.com/giapnguyen74/xnovelist)
- [snowmeth planning workflow](https://github.com/joelgrus/snowmeth)
