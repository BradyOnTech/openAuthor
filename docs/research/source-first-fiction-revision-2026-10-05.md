# Source-first meaning inventory for fiction revision

Research checked October 5, 2026. Test a compact source-only inventory before candidate generation. Record nested knowledge and appearance relationships, their speakers, and their uncertainty separately from proposed editorial changes. Reuse that frozen inventory during drafting and review. This removes one route for candidate wording to influence the inventory, but its semantic accuracy still requires evaluation.

**The specific gap**

In the quoted-editing experiment, the critic considered a change from “People need to know someone is still trying” to “People need someone to keep trying” permissible. Its own summaries shifted from public evidence to a persistent representative. The first line makes awareness of effort part of the speaker's argument; the second emphasizes continued effort itself. The evaluating agent retained the original line. That is one consequential interpretation in a development case, not independent author validation. Native assessment (withheld from the public repo because it quotes a private manuscript).

The earlier [source-fidelity report](source-fidelity-in-fiction-revision-2026-10-05.md) covers bidirectional auditing, nullable omission receipts, and broad fact retention. This follow-up concerns the relationship around a proposition: who knows, believes, appears, claims, or wants someone else to believe it. Merely retaining the subject and the action can lose that relationship.

**Four primary sources and what they establish**

OmissionBench's released extraction builder accepts only the transcript; its audit builder accepts transcript and extracted facts. Candidate notes are outside those functions. Extracted records are cached with prompt identity, and the checker receives stable fact IDs. This is a concrete implementation of candidate-blind inventory construction. The preprint reports only partial omission recovery, and its combined pipeline does not isolate the benefit of blindness alone. Applying it to fiction is a testable inference. [Pinned pipeline code](https://github.com/composo-ai/omission-bench/blob/bd64b4e09fc5e84d6fb920c53ecda9f9874a45b9/judges/w2_pipeline.py), [Study](https://arxiv.org/abs/2608.31016).

Its extraction prompt also preserves conditionality and attribution and prevents ambiguous evidence from becoming a confident fact. The pipeline's substring-based blindness check assumes generated notes differ from transcripts. Fiction revisions intentionally share source wording, so that particular guard would produce false alarms here. Enforce separation through input types and call order instead. [Extraction prompt](https://github.com/composo-ai/omission-bench/blob/bd64b4e09fc5e84d6fb920c53ecda9f9874a45b9/w2_prompts/pipeline_extract.txt), [Blindness guard](https://github.com/composo-ai/omission-bench/blob/bd64b4e09fc5e84d6fb920c53ecda9f9874a45b9/judges/w2_pipeline.py#L135).

FANToM distinguishes shared facts from each participant's accessible information and beliefs. Its benchmark asks related factual, belief, answerability, and information-access questions; successful answers in one format can conceal failure in another. The inspected evaluator computes consistency across the related questions. This supports testing a relationship in several ways, rather than relying on a general “preserved” label. Its 2023 model results concern conversational reasoning, not present-day fiction quality. [FANToM paper](https://aclanthology.org/2023.emnlp-main.890.pdf), [Pinned evaluator and prompt construction](https://github.com/skywalker023/fantom/blob/1cae6fa30f5ba04ca0fff5f5716b5ba7055e2e85/eval_fantom.py).

Reading Subtext uses skilled writers to assess summaries of their unpublished stories. It finds problems with specificity, subtext, unreliable narration, actions, and feelings. Its released writer interface separates coverage, factual faithfulness, readability, and interpretation; its error-label script distinguishes feeling, causation, action, character, and setting. This supports keeping literal retention and literary interpretation separate. It does not validate a rigid invariant list for revision. [Paper](https://aclanthology.org/2024.tacl-1.71.pdf), [Writer interface](https://github.com/melaniesubbiah/reading-subtext/blob/f6576cb60ccab3c1278d1797ea08fc08ba9c200a/streamlit_interface/story_eval/pages/1_Summary_1.py), [Error-label script](https://github.com/melaniesubbiah/reading-subtext/blob/f6576cb60ccab3c1278d1797ea08fc08ba9c200a/model_scripts/get_model_error_labels.py).

Novelcrafter's documented progressions supply story changes only at or after their scene placement and exclude them from earlier scenes. This is a useful narrative-workflow example of bounding context by story position. It does not establish per-character knowledge tracking or prove semantic fidelity. Our inventory should similarly state which source scene and moment it describes, while continuing to use openAuthor's existing knowledge constraints. [Progressions documentation](https://www.novelcrafter.com/help/docs/codex/progressions-additions).

**A small proposed inventory**

Use host-assigned source passage IDs and exact evidence. Each relevant item records the speaker or narrator, holder or audience, relation, embedded proposition, and qualifier. Separate explicit relationships from inferred strategy. An inferred tactic should carry uncertainty and supporting context, with room for more than one plausible reading.

| Field | Application to the observed line |
| --- | --- |
| Attribution | The character says this; it is not automatically narrator-established truth |
| Holder or audience | People, in the public-role context |
| Relation | Need to know |
| Embedded proposition | Someone is still trying |
| Consequential distinction | Awareness of effort is part of the stated need |
| Possible strategy | Justifying a public representative or visible effort; interpretation needs neighboring evidence |

The inventory must not infer that the public already knows, that effort succeeds, or that the speaker is truthful. Preserve the source's claimed relation while leaving those points unresolved. Apply the same treatment to seeming versus being, wanting versus doing, suspicion versus confirmation, permission versus capability, and an assurance versus a commitment.

For dialogue strategy, record what the speaker wants the listener to do or believe, the offered or withheld object, and the grounds used as leverage when the text supports them. Keep those arguments distinct from grammatical form. A question can preserve an accusation or challenge; two questions can pursue different bargains. Rhetorical changes need contextual judgment and the author's permitted scope.

**Where to put it in openAuthor**

Generate the inventory in an existing pre-draft planning call, from the frozen source and necessary approved context. Keep it as a separate derived record from the edit plan. Exclude candidate prose, prior rejected candidates, and reviewer praise from that input. If a workflow has no pre-draft call, a separate source-only model inventory adds a call; ordering sections inside one candidate-aware prompt does not provide structural blindness.

Persist the inventory before drafting, including source and context hashes, scope, prompt version, model, and actual output. Validate IDs and quotations. Supply it to the writer and reviewers while retaining original passages as the authority. Never promote model summaries to accepted canon or let the inventory override an explicit author permission. Verification should revisit the original text and expose errors in the inventory itself.

For each flagged relationship, ask brief comparison questions inside the current review response: whose state is described; whether the line concerns actuality, perception, knowledge, or intended response; what proposition falls under that relation; and what the candidate adds or removes. For the observed pair, both statements mention trying, but only the source explicitly makes knowing about it the need. These questions are our proposed diagnostic, not a demonstrated treatment effect.

**False alarms and literary limits**

An inventory can confidently misread irony, indirect requests, politeness, an unreliable speaker, or a sentence that supports several interpretations. Automatically protecting every occurrence of “think,” “seem,” or “know” would block useful paraphrase and authorized tightening. Protect meaning-bearing relations in context, allow equivalent wording, and mark doubtful strategy readings as uncertain. Preserve ambiguity when it is part of the scene; do not force the prose to state the ledger explicitly.

A source-first record can also omit the very relationship we want to preserve. Matching quotation receipts verifies provenance, not interpretation or completeness. Feeding the same mistaken inventory to writer and critic can correlate their errors. Keep separate measures for inventory accuracy, reviewer detection, false alarms, and author preference.

**A focused experiment**

First freeze human-labeled pairs from new scenes: faithful paraphrases, knowledge-to-action drift, appearance-to-reality drift, desire-to-commitment drift, attribution changes, and authorized tactical changes. Include ambiguous controls that should remain uncertain. Keep the known quoted-editing example as development material.

Create source-only inventories without access to those candidates. On identical frozen candidates, compare the current audit against an audit supplied the frozen inventory, holding model and reasoning settings constant. This isolates review behavior from any effect on prose generation. Then run a separate generation comparison to test whether the inventory helps the writer preserve meaning. Reuse existing planning calls where applicable and disclose actual token and call usage.

Score whether each consequential relation was inventoried correctly, whether each real drift was localized, and whether faithful controls were falsely rejected. Split by scene, retain every result, and obtain author or independent qualified readings. A valid inventory schema, complete row coverage, or a favorable model verdict establishes protocol behavior; literary improvement remains a separate question.

**Sources**

- [OmissionBench preprint](https://arxiv.org/abs/2608.31016) and [pinned source-only pipeline](https://github.com/composo-ai/omission-bench/blob/bd64b4e09fc5e84d6fb920c53ecda9f9874a45b9/judges/w2_pipeline.py).
- [FANToM paper](https://aclanthology.org/2023.emnlp-main.890.pdf) and [pinned evaluator](https://github.com/skywalker023/fantom/blob/1cae6fa30f5ba04ca0fff5f5716b5ba7055e2e85/eval_fantom.py).
- [Reading Subtext paper](https://aclanthology.org/2024.tacl-1.71.pdf) and [released writer interface](https://github.com/melaniesubbiah/reading-subtext/tree/f6576cb60ccab3c1278d1797ea08fc08ba9c200a/streamlit_interface/story_eval).
- [Novelcrafter progressions](https://www.novelcrafter.com/help/docs/codex/progressions-additions).
