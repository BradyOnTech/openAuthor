# Comparing fiction writing workflows

Research checked October 5, 2026. Run a controlled writing comparison with the existing subscription provider, then use the findings to improve the writing kit. Public documentation lets us test useful methods now; it does not establish that openAuthor produces better books than the actual competing products.

**What competing workflows make concrete**

Novelcrafter generates prose from scene instructions with selectable prompts and models. Its documented prompt functions can select chapter-specific Codex material, recent scene summaries, and prior or future summaries filtered by a character's POV. These are useful, inspectable context-building examples, although they do not expose every deployed default. [Generating prose](https://www.novelcrafter.com/help/docs/write/generating-prose), [Prompt examples](https://www.novelcrafter.com/help/reference/prompts/prompt-examples).

Its October 1 model-selection article separates prose generation from text replacement. For prose, it looks for author voice, plausible dialogue, consistent characters, and correct POV. For replacement, it values making the requested change while preserving the rest. These are vendor criteria, rather than independent evidence of superiority; they provide appropriate tasks and outcomes for our tests. [How Novelcrafter recommends models](https://www.novelcrafter.com/blog/how-we-recommend-ai-models-for-writers).

Sudowrite's Saliency Engine first filters Story Bible information for the task. Authors can hide individual character or worldbuilding traits from AI features, including secrets that should not appear yet. Its templating documentation distinguishes selected context from full visible context, and acknowledges that supplying everything can hurt results. The transferable question is whether a context item belongs in this scene and whether the viewpoint character may use it. The documented behavior does not reveal the exact selection algorithm. [Saliency Engine](https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/saliency-engine/4KL8gFeLZNvk8CEeXpfwB2).

Sudowrite also documents a concrete continuity budget: up to 20,000 previous words across 25 linked documents, with recent text preferred. It displays included documents and word counts. When context overflows, it drops worldbuilding and character information before several other categories. This supports testing context provenance and exclusion order; a large window alone is no guarantee that an important fact survives. [Chapter continuity](https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/chapter-continuity/4KL8gFeLZQ6GSBjDWtSbV6).

For openAuthor, the useful comparison targets are therefore scene-specific context selection, reveal timing, visible context receipts, and revision restraint. These should deepen its existing canon, Writing Voice, and Editorial Pass workflows. This research does not establish that any of those capabilities are absent from the application.

**An inspectable research comparator**

CritiCS is an EMNLP 2024 planning and prose-refinement system with published code. Its study compares against DOC using the same GPT-3.5 backbone and human assessments of 300 stories/plans. Reported gains are evidence for that experimental setting; the prose annotators' fair agreement, older models, and sentence-focused prose evaluation limit broader conclusions. Its prose stage revises a randomly selected sentence per round, rather than evaluating an entire book. [CritiCS paper](https://aclanthology.org/2024.emnlp-main.1046.pdf).

The actual prose prompts request separate imagery and voice suggestions, then ask a leader to choose one. Their criteria include sensory words, bodily sensations, unusual vocabulary, and sentence structure. The sample choice favors intensified sensory description. My assessment is that this could reward ornamentation when a scene needs restraint; that makes it a useful stress comparator, rather than a craft rule to adopt unchanged. [Pinned prompt source](https://github.com/EMNLP-2024-CritiCS/Collective-Critics-for-Creative-Story-Generation/blob/fbf66cbc913012c6f80af1687e27f0ce350475e3/critics/setting/promptDesign/story_template.py).

The source makes three separate model calls for imagery, voice, and selection. A small prompt-only adaptation can test whether separate critics help our provider without installing its dependencies. Label it an adaptation, because changing the model, passage scope, or stop rule changes the experiment. The repository is MIT licensed; copying substantial material requires retaining its notice. [Refinement implementation](https://github.com/EMNLP-2024-CritiCS/Collective-Critics-for-Creative-Story-Generation/blob/fbf66cbc913012c6f80af1687e27f0ce350475e3/critics/text/text.py), [License](https://github.com/EMNLP-2024-CritiCS/Collective-Critics-for-Creative-Story-Generation/blob/fbf66cbc913012c6f80af1687e27f0ce350475e3/LICENSE).

**First comparison with no new paid accounts**

Use four tasks, three arms, and two fresh runs per task: 24 final candidates. Calls consume the existing subscription allowance. Use a copied fixture, never the active manuscript, and preserve every first output, revision, failure, and retry.

| Arm | What it measures |
| --- | --- |
| Current workflow | A frozen version of openAuthor before the writing kit |
| Documented workflow comparator | Our implementation of selected canon, recent summaries, scene beats, POV, and style guidance from public methods |
| Writing kit | The new craft references, scene contract, critique, and verification process |

The second arm is a public-method comparison. Do not call its output “Novelcrafter” or “Sudowrite”: their deployed prompts, selection behavior, models, and user choices are not reproduced by this approximation. Keep the inspected CritiCS adaptation as a later targeted fourth arm if critique itself needs testing.

Freeze the resolved model, reasoning effort, input facts, style excerpts, passage boundaries, and word range. Give each arm the same maximum generation/revision budget; a baseline can use its existing generic revision within that budget. Report actual calls and latency alongside quality. If comparing each workflow at its natural budget instead, report that as a separate practical comparison. Otherwise, an extra round of model work can be mistaken for a better skill.

**Fixture inputs**

Derive the first three tasks from verified test manuscript material, choosing moments the author actually intends. The examples below describe test pressures, not proposed canon events. Each fixture needs a frozen source excerpt, relevant accepted facts, forbidden inventions, character knowledge, reveal boundaries, intended scene change, and a short approved voice sample.

| Task | Required pressure | What would expose a weak system |
| --- | --- | --- |
| Scene generation, 500–700 words | A practical conflict involving Tobin and a concrete constraint from the outline | Added generic technology, contradictory logistics, or description that never affects a choice |
| Dialogue, 500–700 words | Two characters with competing immediate aims and different knowledge | Interchangeable voices, explanatory speeches, premature disclosures, or agreement without a credible concession |
| Quiet aftermath, 500–700 words | A character processing a consequence without an obligatory new crisis | Forced action, formulaic body cues, inflated emotion, or banning useful summary |
| Local revision, supplied 300–500-word passage | One precise dialogue or motivation improvement with protected surrounding prose | Changed meaning, new plot, unnecessary rewriting, or a revision worse than the original |

For revision, include the original passage as a blind candidate. For generation, assess both the draft and final candidate so we can see whether revision improves anything. Start with these development tasks, then add held-out briefs from other genres and narrative distances before drawing broader conclusions. Do not keep tuning against the same four scenes and treat their later scores as independent validation.

**How to judge the candidates**

First check objective requirements separately: accepted facts, character knowledge, POV, protected disclosures, requested edit scope, and required events. Record exact violating passages and relevant source facts. Then judge narrative purpose, specificity of voice and perception, credible dialogue and choices, emotional effect, pacing, and continuity. A beautiful sentence cannot compensate for revealing a protected secret.

Use anonymous pairwise comparisons, allow ties and uncertainty, and ask for passage-level evidence supporting each choice. Present each pair in both A/B orders to model judges in fresh calls. Keep position-sensitive verdicts visible. The public Lech Mazur writing benchmark provides an inspectable example of direct comparison, required-element integration, order effects, and uncertainty; its prompt asks for concrete evidence and strengths on both sides. We should write our own book-specific briefs rather than importing its unusual sentence-by-sentence word-count format. [Benchmark methodology](https://github.com/lechmazur/writing), [Actual comparison prompt](https://github.com/lechmazur/writing/blob/c8d5b3524af3bfe897a20a8ae51a81df54fdd6d2/data/methodology/comparison_prompt.txt), [Actual generation prompt](https://github.com/lechmazur/writing/blob/c8d5b3524af3bfe897a20a8ae51a81df54fdd6d2/prompts_wc/prompt_wc_0.txt).

Model judging is useful triage, not ground truth. LitBench's EACL 2026 study reports only about 73% human-preference agreement for its strongest tested general-purpose judge, versus about 78% for its trained approach. Its Reddit-derived short-story preferences also do not establish what this author wants for a novel. The author should make the first blind preference decisions; later claims need independent qualified readers. [LitBench paper](https://aclanthology.org/2026.eacl-long.362.pdf).

The pilot should find regressions and useful mechanisms, not produce a decisive ranking. After fixes, freeze the kit and run new held-out tasks. If a larger comparison favors it, remove the scene contract, craft references, and critique in separate ablations to learn which parts help. Report ties, failed generations, uncertainty intervals, and results by task; do not count multiple ratings of the same passage as independent stories.

**What a market-leading claim would require**

A defensible claim needs actual current competitors' native outputs, their supported fiction models and configured workflows, comparable author effort and resource budgets, and versioned settings. It needs multiple genres, authors, and several linked chapters, with separate checks for long-range continuity and reader experience. Use held-out tasks, anonymous independent human judging, enough independent samples for uncertainty estimates, and disclosed retries and failures. State the scope and date of the result.

The current evidence is documentation, inspected public code, and published studies in limited settings. We have not obtained native competing-product outputs or independent reader judgments in this research. Public-workflow tests on our subscription provider can support a claim that the kit improves openAuthor under the tested conditions; they cannot yet support “best writing on the market.”

**Sources**

- [Novelcrafter prompt examples](https://www.novelcrafter.com/help/reference/prompts/prompt-examples) and [current model-selection criteria](https://www.novelcrafter.com/blog/how-we-recommend-ai-models-for-writers).
- [Sudowrite Saliency Engine](https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/saliency-engine/4KL8gFeLZNvk8CEeXpfwB2) and [chapter continuity](https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/chapter-continuity/4KL8gFeLZQ6GSBjDWtSbV6).
- [CritiCS paper](https://aclanthology.org/2024.emnlp-main.1046.pdf) and [source repository](https://github.com/EMNLP-2024-CritiCS/Collective-Critics-for-Creative-Story-Generation).
- [Lech Mazur writing benchmark](https://github.com/lechmazur/writing) and [LitBench paper](https://aclanthology.org/2026.eacl-long.362.pdf).
