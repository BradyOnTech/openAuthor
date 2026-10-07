# openAuthor product testing and improvement priorities

Reviewed September 30, 2026. openAuthor has a useful foundation for safe, reversible revision, but its story understanding and everyday usability are not yet as dependable as its editing safeguards. Fix the unreadable selection panel, incorrect knowledge warnings, and inconsistent AI context before treating an author walkthrough as an acceptance test.

This review covers the current local branch, the existing unsigned macOS app, fresh synthetic challenges, and comparable public GitHub projects. It makes no production-readiness claim. Competitor recommendations are design judgments, not proof that those products produce better fiction.

## What was tested

- Core suite: 242 tests discovered, 241 passed and one opt-in runtime test skipped. The five uncommitted story-grounding tests are included; that does not establish desktop integration.
- Desktop: 152 tests passed, production frontend build passed, seven Rust tests passed, and npm reported zero known dependency vulnerabilities.
- Existing evaluations: seven seeded Canon cases, 16 narrow prose-pattern cases, and seven deterministic editorial cases passed. These do not establish general editorial quality.
- Synthetic author workflow: applied text matched review, undo restored exact bytes, and backup restored both manuscript and history.
- Scale: the first combined run exceeded the 1,500 ms story-check budget at 1,912.318 ms. An isolated rerun passed with a maximum of 347.923 ms on the 400-scene fixture. This is load-sensitive evidence, not a confirmed isolated regression or a measurement of the full UI.
- Native app: inspected manuscript writing, selection and context review, feedback review, Plan, Memory suggestions, and Canon diagnostics. The selection panel has a reproducible dark-theme contrast problem.
- Live model: one new feedback-only request using synthetic prose and the configured subscription succeeded. No API-key billing was used. The request consumed subscription quota: 2,771 input and 371 output tokens, taking 11.485 seconds. The app reported estimated incremental cost of $0; this is not a claim that the subscription itself is free.

No real manuscript was uploaded. No prose was applied in the native app. The synthetic scene SHA-256 before and after was `a82902f0da57a2573bf36015ab2bae3c714f76e47a19aae1885beb3e24ca7108`. No implementation files were changed by this review, and existing uncommitted grounding work was preserved. The packaged app predates that unfinished work; no new package was built in this pass.

## Problems to fix before the walkthrough

### The selection assistant is nearly unreadable in dark mode

Confirmed in the native app: select prose, choose Expand or Critique, and inspect the instructions and context-review controls. The cream editor inherits the dark shell's pale text. The source colors, `#e8e4df` on `#faf6f0`, calculate to roughly 1.18:1 contrast. The problem affects explanatory and privacy text, not only disabled buttons.

Give the assistant a coherent surface and text palette. Test both themes, keyboard focus, selected text, errors, and a long context preview in the packaged app. Keep the primary action visible without scrolling through raw prompt JSON. The relevant styles begin at [design-system-v2.css](../desktop/src/design-system-v2.css#L904).

### Knowledge diagnostics can accuse correct prose

Three fresh cases reproduced incorrect knowledge warnings:

- A character marked unaware in scene one and informed in scene two is still flagged in scene three.
- A secret value of `key` is matched inside `monkey`.
- A sentence explicitly stating that the character does not know where the key is hidden triggers a knowledge-leak warning.

The implementation iterates every historical `does_not_know` entry and searches for a case-insensitive substring. It does not resolve the latest knowledge state or distinguish mention from knowledge. See [canon.py](../openauthor/canon.py#L418).

Resolve knowledge at the target scene, honor fact validity, avoid substring matches, and distinguish assertions, questions, negation, and dialogue. Keep ambiguous findings tentative. Acceptance: all three cases above are quiet, a genuine disclosure remains detectable, and every warning cites an exact current passage.

### AI actions do not consistently use the same story context

A fresh deterministic request confirmed that whole-scene drafting includes the saved style guide but regenerating a changed passage drops it. The latter asks the model to preserve voice without providing the saved voice guidance. See [ai.py](../openauthor/ai.py#L2730).

The packaged selection assistant explicitly excludes Canon and relationships. The checkout contains a promising explicit-approval implementation for selection and chat, but the desktop controls are absent and the chat bridge does not forward the new approval field. These are unfinished integrations, not shipped capabilities. See [server.py](../openauthor/server.py#L37).

Use one shared context contract across selection, scene drafting, individual-change regeneration, chat, and merge reconciliation. Show included and omitted guidance, applicable facts, character knowledge, relationships, and cost estimates. Never silently share private notes or turn an expired permission into a persistent grant. Acceptance: a saved constraint survives each workflow, an unavailable or stale source is disclosed, and changed context requires renewed review.

## Where the product falls short

### Story understanding remains a narrow heuristic

The new eight-case challenge set produced the expected result only for the simple literal control. It missed a naturally paraphrased finger-count contradiction, Spanish eye-color descriptions, and a hair-color contradiction when unrelated negation appeared in the same sentence. It warned about an explicitly explained hair-dye change and the three knowledge cases above.

The dye warning is consistent with the current conservative wording, but still creates avoidable review work. The other examples distinguish genuine implementation defects from broader unsupported language understanding. This deliberately difficult, small set is not an independent benchmark; its precision and recall output must not be used as product-wide accuracy claims.

Preserved cases: [product-review-challenges.json](product-review-challenges.json). Reproduce from the repository root:

```bash
python3 -c 'import json; from pathlib import Path; from scripts.evaluate_canon_diagnostics import evaluate; print(json.dumps(evaluate(Path("docs/product-review-challenges.json")), indent=2))'
```

Recommended direction: keep fast local checks for narrow, reliable rules; offer a separately approved AI review for meaning, knowledge, causality, and motivation. Require quotes and author confirmation before promoting extracted material to Canon. “No findings” must remain distinct from “the story is consistent.”

### Generic critique asks too much of the author

The earlier generic native critique missed the conflict between Mara knowing the key's location and the claim that nobody in the square knew it. In this pass, a focused request to check factual consistency and character knowledge found both passages, identified the location ambiguity, and proposed a minimal correction. It also correctly distinguished knowing that a key was found from knowing its hiding place.

This is evidence that a targeted mode can help, not proof that a prompt change solves continuity. The new run is `gen-b3c0bbb063e4`, resolved model `gpt-5.6-sol`, with feedback in `proposal-7d6e999472783528002d48e0` in the synthetic QA book. The response remained feedback only. Earlier expansion testing also invented a hook material and a blue wall; see [selection editorial evaluation](selection-editorial-evaluation.json).

Add clear review modes: continuity, character knowledge, motivation, pacing, and voice. Separate “preserve all facts” from “explore new possibilities.” For each finding, show evidence, uncertainty, and the smallest suggested edit. Validate those modes on fresh passages rather than tuning only to this scene.

### Planning and Memory demand too much administration

Observed in the native app: the writing sidebar lists scenes flat even when the Plan has chapters; the expanded Project Brief consumes most of the initial planning viewport; a long Memory suggestion card confines several evidence passages and actions to a narrow sidebar. The product already has hierarchy, relationships, arcs, and reversible changes. Adding another disconnected panel is less valuable than making these existing tools easier to use together.

Recommended improvements: expose chapter hierarchy while writing; collapse the saved brief; offer a full-width review inbox with compact evidence and keyboard triage; allow selected manuscript text to prefill a proposed fact or setup; present current character knowledge alongside scene planning. These are usability recommendations, not claims of data loss.

### Voice and language support are weaker than their labels suggest

A Chinese-only synthetic scene produced a Style Profile with zero words and guidance to aim for zero words per sentence. Searching the retrieval index for the exact Chinese term already in that scene failed with “query must include at least one searchable token.” The retrieval and Style Profile tokenizers are ASCII-oriented. See [retrieval.py](../openauthor/retrieval.py#L18) and [style_profile.py](../openauthor/style_profile.py#L39).

Even for English, average sentence length, punctuation rates, and frequent words are not a full model of author voice. Add language-aware measurement or clearly report unsupported input instead of producing misleading guidance. Use author-approved voice examples and explicit preferences, with a way to refresh them when source scenes change. Semantic retrieval is worth evaluating after fixing basic Unicode handling and maintaining source freshness and sharing controls.

## Useful ideas from similar GitHub projects

I read repository documentation and selected implementation files; I did not install competitors or benchmark their models. Several unrelated projects share the name NovelForge, so owners are included below.

| Project and observed pattern | Recommendation for openAuthor |
| --- | --- |
| [Inscriptor](https://github.com/lukashonke/inscriptor) has a context picker with removable items, full-text versus summary choices, warnings, and saved selections in its [implementation](https://github.com/lukashonke/inscriptor/blob/main/src/components/Common/PromptSelector/PromptContextSelector.vue). | Keep exact prompts available, but lead with understandable context items and reasons for omission. Any saved preset must revalidate permissions rather than save consent forever. |
| [LunaRime NovelForge](https://github.com/LunaRime/novelforge/blob/master/README.en.md) documents chapter, volume, and book memory. Its [invalidation code](https://github.com/LunaRime/novelforge/blob/master/src/services/memory/memory-invalidation.ts) tracks affected memory, and its [context display](https://github.com/LunaRime/novelforge/blob/master/src/components/panels/agent/ContextBudgetBar.tsx) separates memory, history, and current context. | Add inspectable chapter summaries and a compact context-budget explanation, with stale summaries excluded until refreshed. Do not treat generated summaries as author-confirmed facts. |
| [RhythmicWave NovelForge](https://github.com/RhythmicWave/NovelForge) uses structured cards and a [field-level reference picker](https://github.com/RhythmicWave/NovelForge/blob/main/frontend/src/renderer/src/components/cards/CardReferenceSelectorDialog.vue). | Let an author reference a character, beat, or specific fact directly. Reuse existing Memory and Plan records; do not expose a programming language or require duplicate story-bible entry. |
| [sheengoa NovelForge](https://github.com/sheengoa/novelforge) presents evidence, severity, and suggested action in an audit workflow. Its inspected [auditor module](https://github.com/sheengoa/novelforge/blob/main/crates/novelforge-engine/src/auditor.rs) also contains a fixed secret phrase and an ASCII-count rule. | Borrow the review presentation, not its quality claims or fixed logic. A named “auditor” is not evidence of broad story understanding. |

These are design references, not a recommendation to copy code. No third-party code was imported. Avoid automatically writing an entire novel, large agent orchestration, prompt marketplaces, billing, cloud sync, or collaboration until the core author workflow earns trust.

## Recommended work order

1. Fix the selection panel's contrast and the three incorrect knowledge warnings. Add native visual checks alongside behavior tests.
2. Finish one consistent, permission-aware context flow across all AI actions, including the already-started Canon work. Verify style preservation in passage regeneration.
3. Add focused editorial review modes and evaluate fact preservation, missed contradictions, unnecessary warnings, and voice changes on unseen synthetic passages.
4. Reduce everyday writing friction with a hierarchical manuscript sidebar, compact Plan, and full-width evidence review. Preserve existing keyboard and recovery behavior.
5. Add inspectable chapter memory and language-aware retrieval and voice measurement, with current-source checks and clear unsupported-language handling.
6. Automate the packaged author journey: import, plan, revise, accept partially, undo, restart, recover a failed request, switch Storylines, export, and restore a backup. Test normal and failure paths on a novel-sized project.

The next author walkthrough should focus on usefulness and preferences once the first two items are fixed. The Apple Developer account affects distribution certification, not whether we can perform this product-quality work now. Clean-machine distribution, broader live-provider evaluation, and real-author validation remain unverified.
