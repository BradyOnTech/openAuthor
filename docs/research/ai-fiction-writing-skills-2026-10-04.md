# AI fiction writing skills research

Research date: 2026-10-04. This compares inspected writing skills, the motion-video-kit workflow, research evidence, and current openAuthor code. The recommendation is to deepen existing Editorial Passes with reusable craft procedures and book-specific guidance, then evaluate the writing itself.

**The need**

The useful goal is prose that could only belong to this book: characters notice different things, dialogue changes a relationship or decision, world details create pressure, and revisions preserve the author's voice. Fluent sentences and correct lore are necessary but insufficient. A skill should supply a repeatable craft process, task-specific references, and evidence for accepting a revision. The recommendations below are design judgments from inspected sources, not measured quality claims about openAuthor.

## Matt Pocock's writing skills

Yes, Matt now has writing skills. His live repository includes `writing-fragments`, `writing-shape`, and `writing-beats` under `skills/in-progress/`. They are promising author collaboration patterns, but their instructions repeatedly frame the deliverable as an article. In the repository tree inspected at commit `24fe0ef7737efae15c87225755e9f6f5965e4888`, I did not find a dedicated novel drafting or fiction revision skill. That is a bounded observation about this repository, not a claim that Matt has never published one elsewhere. [Repository](https://github.com/mattpocock/skills/tree/24fe0ef7737efae15c87225755e9f6f5965e4888/skills).

| Skill inspected | Actual task | Useful adaptation for a novelist |
| --- | --- | --- |
| `writing-fragments` | Interview the author and collect unstructured observations, lines, vignettes, dialogue, and half-thoughts; postpone structure. | An idea notebook that preserves the author's specific material before the model imposes a conventional plot. |
| `writing-shape` | Read the source pile, establish what readers know, offer different openings, then build an article paragraph by paragraph while preserving author edits. | A collaborative scene shaping mode, especially reader grounding and explicit gaps; the article argument model needs adaptation. |
| `writing-beats` | Offer two or three starting or next beats, let the author choose the path, and track which concepts each beat establishes. | Guided discovery for a scene or reveal sequence. These are rhetorical article beats, not automatically dramatic fiction beats. |

The actual instructions preserve the raw material, reread files before changes, and give the author control over the direction. Those mechanics are more useful than simply adopting an expert-writer persona. [Fragments](https://github.com/mattpocock/skills/blob/24fe0ef7737efae15c87225755e9f6f5965e4888/skills/in-progress/writing-fragments/SKILL.md), [Shape](https://github.com/mattpocock/skills/blob/24fe0ef7737efae15c87225755e9f6f5965e4888/skills/in-progress/writing-shape/SKILL.md), [Beats](https://github.com/mattpocock/skills/blob/24fe0ef7737efae15c87225755e9f6f5965e4888/skills/in-progress/writing-beats/SKILL.md).

His `grilling` skill offers a reusable interview process for resolving dependent decisions. It could clarify what a scene should accomplish, but using its exhaustive interview literally for every passage would create substantial friction. `writing-for-agents` concerns instructions consumed by agents: invocation, progressive disclosure, and checkable completion criteria. It is useful for building our skill system, rather than directly writing fiction. The current `to-spec` skill produces engineering specifications; older locally installed names such as `to-prd` should not be mistaken for prose craft skills. [Grilling](https://github.com/mattpocock/skills/blob/24fe0ef7737efae15c87225755e9f6f5965e4888/skills/productivity/grilling/SKILL.md), [Writing for agents](https://github.com/mattpocock/skills/blob/24fe0ef7737efae15c87225755e9f6f5965e4888/skills/productivity/writing-for-agents/SKILL.md), [To spec](https://github.com/mattpocock/skills/blob/24fe0ef7737efae15c87225755e9f6f5965e4888/skills/engineering/to-spec/SKILL.md).

Matt's repository is MIT licensed. Adapted substantial portions should retain its notice. [License](https://github.com/mattpocock/skills/blob/24fe0ef7737efae15c87225755e9f6f5965e4888/LICENSE).

## Fiction skills worth studying first

`wgwtest/novel-writing` is the closest drafting and revision fit I inspected. Its skill routes planning, drafting, review, and manuscript handoffs to separate references. It loads hard constraints, nearby full prose, and distant structural summaries selectively. It distinguishes character knowledge from author knowledge and protects dialogue, interiority, deliberate ambiguity, and rhythm during revision. [Actual skill](https://github.com/wgwtest/novel-writing/blob/838729695148008d42c01bd7c3c0c1a5c15de830/novel-writing/SKILL.md).

Its dialogue reference is especially relevant to the private test manuscript used during development: equipment movement or a nod does not make a technical exchange dramatic. An action should reveal an agenda, test a lie, change access, or force another tactic. The reference also allows rapid untagged dialogue and meaningful silence, rather than mechanically inserting a gesture after every line. Its style reference requires a reason for deleting expressive material and favors local repairs over general smoothing. [Dialogue and behavior](https://github.com/wgwtest/novel-writing/blob/838729695148008d42c01bd7c3c0c1a5c15de830/novel-writing/references/dialogue-and-behavior.md), [Style fidelity](https://github.com/wgwtest/novel-writing/blob/838729695148008d42c01bd7c3c0c1a5c15de830/novel-writing/references/style-fidelity.md).

It also records exact AI deliveries and author edits before interpreting feedback. That is a useful basis for learning which revisions this author prefers. It explicitly avoids creating a competing version system. Its published before/after cases are labeled teaching examples, not measured model comparisons. The repository is MIT licensed. I would adapt selected craft references and feedback principles into openAuthor's existing storage and review process. [Manuscript and feedback reference](https://github.com/wgwtest/novel-writing/blob/838729695148008d42c01bd7c3c0c1a5c15de830/novel-writing/references/manuscript-lifecycle-and-feedback.md), [Example qualification](https://github.com/wgwtest/novel-writing/tree/838729695148008d42c01bd7c3c0c1a5c15de830), [License](https://github.com/wgwtest/novel-writing/blob/838729695148008d42c01bd7c3c0c1a5c15de830/LICENSE).

`Calliope-Editor/writing-skills` is the strongest editorial reference inspected. It deliberately does not generate replacement prose. The line editor identifies two or three recurring habits, quotes examples, explains their effect, and gives a direction for repair. It evaluates filtering and exposition against intended narrative distance, rather than banning them universally. [Line editor skill](https://github.com/Calliope-Editor/writing-skills/blob/2fad031982cbbcb00c4da14c2fc9712d2daa78da/skills/editorial/line-editor/SKILL.md).

The developmental editor first declares what kind of book it is judging and which craft principles it applies, modifies, or sets aside. It then ranks root problems with scene evidence. The continuity editor compares both conflicting passages, tracks knowledge and object states, labels uncertainty, and leaves canon decisions to the author. These are useful critic contracts even when a separate drafting step is allowed to propose edits. [Developmental editor](https://github.com/Calliope-Editor/writing-skills/blob/2fad031982cbbcb00c4da14c2fc9712d2daa78da/skills/editorial/developmental-editor/SKILL.md), [Continuity editor](https://github.com/Calliope-Editor/writing-skills/blob/2fad031982cbbcb00c4da14c2fc9712d2daa78da/skills/editorial/continuity-editor/SKILL.md).

Calliope's skill files can analyze supplied text without its product account; its MCP integration adds manuscript access and subscription-dependent notes. This is an editorial aid, not a direct solution for generating chapters. Its repository has an MIT license. The repository's own reviewed/live-tested labels are not independent evidence that it improves fiction quality. [Repository scope](https://github.com/Calliope-Editor/writing-skills/tree/2fad031982cbbcb00c4da14c2fc9712d2daa78da), [License](https://github.com/Calliope-Editor/writing-skills/blob/2fad031982cbbcb00c4da14c2fc9712d2daa78da/LICENSE).

## Other inspected community candidates

`howells/fiction` supplies a complete fiction workflow with writer, chapter reviewer, continuity, and editing roles. The writer reads existing prose, character documents, beats, and the tone guide. The reviewer distinguishes fixed constraints from evolving notes and records resolved versus persistent issues. Its prose-smells reference treats recurring rhetorical devices as frequency problems rather than inherently bad sentences. These are practical patterns to study. Its fixed literary sensibility, absolute craft instructions, and named-author critic personas should not define every openAuthor book. [Writer](https://github.com/howells/fiction/blob/2e7d4e1bdd0c309d8d8eb8dbfb457a8e5e25b66a/agents/writer.md), [Reviewer](https://github.com/howells/fiction/blob/2e7d4e1bdd0c309d8d8eb8dbfb457a8e5e25b66a/agents/chapter-reviewer.md), [Prose smells](https://github.com/howells/fiction/blob/2e7d4e1bdd0c309d8d8eb8dbfb457a8e5e25b66a/skills/references/prose-smells.md).

Its README says MIT, but the inspected tree did not contain a license file and GitHub's license endpoint returned 404. Verify the intended notice before copying its files. No comparative fiction quality evaluation was found in the inspected material. [README license statement](https://github.com/howells/fiction/tree/2e7d4e1bdd0c309d8d8eb8dbfb457a8e5e25b66a).

`alt-code-ai/agent` has an extensive `fiction-writing-prose` skill covering POV, perception, rhythm, sensory detail, dialogue, and macro-to-micro revision. Its useful idea is to establish a narrator-specific sample before drafting and make details serve that character's attention. However, it also requires a ten-percent cut and indirectness in every dialogue line. Those blanket rules could flatten intentional direct speech, narration, or unusual rhythms. This is an opinionated reference, not a safe universal default. I did not verify a repository-wide license for this skill. [Inspected prose skill](https://github.com/alt-code-ai/agent/blob/8693ecd0e1e320f7063be13e6c2ec8dffac82f6b/skills/fiction-writing-prose/SKILL.md).

## Established product workflows

Novelcrafter's first-party documentation demonstrates deliberate context assembly: scene summaries describe prior events, codex additions track developments through the story, and prompt functions can select context by act, chapter, scene, or character POV. It distinguishes scene summaries from instructions for a moment of prose and supports inspecting the final prompt before generation. These are useful design patterns, not published evidence of superior prose. I would study the interaction and context rules rather than copy proprietary prompt text. [Summaries and beats](https://www.novelcrafter.com/help/faq/plan/where-do-i-put-my-scene-chapter-act-book-summary-what-about-my-beats), [Subplot progressions](https://www.novelcrafter.com/help/docs/write/subplots), [Prompt examples](https://www.novelcrafter.com/help/reference/prompts/prompt-examples), [Prompt preview](https://www.novelcrafter.com/help/docs/prompts/prompt-preview).

Sudowrite similarly separates story bible, scene instructions, and prose generation. Its docs identify which fields affect each stage, note that explicitly mentioned characters and worldbuilding are used by Draft, and describe a scene check before drafting. The reusable idea is clear stage inputs and visible story references. The docs themselves call the output a first draft requiring author direction; they do not establish that this workflow will outperform openAuthor. [Story Bible dependencies](https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/what-is-story-bible/jmWepHcQdJetNrE991fjJC), [Scenes and Draft](https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/scenes--chapter-prose/49p5MTVxTKkVFEC5rVUzpY).

## Research with measured outcomes

DOC, published at ACL 2023, provides stronger evidence for an architectural approach than a skill README. It separates a detailed hierarchical outline from a controller that keeps generated passages aligned with it. In its human pairwise evaluation against Re3, the paper reports absolute improvements of 22.5 percentage points for plot coherence, 28.2 for outline relevance, and 20.7 for interestingness. Those are results for several-thousand-word stories using that system and baseline, not a claim about full novels or current models. [DOC paper](https://aclanthology.org/2023.acl-long.190.pdf).

The simpler public DOC v2 exposes prompts containing a premise, relevant entities, earlier summaries, the current event, nearby events, and immediate prose. Its code generates alternatives and scores coherence, event fulfillment, and accidental commentary. The source is Apache 2.0 licensed. It is an older research codebase, not a plug-in-ready openAuthor component; its planning/context/evaluation separation is the useful starting point. [Prompts](https://github.com/facebookresearch/doc-storygen-v2/blob/d092b42686bfc29ef2d610d5563e822ebf9d1451/scripts/story/prompts.json), [Story writer](https://github.com/facebookresearch/doc-storygen-v2/blob/d092b42686bfc29ef2d610d5563e822ebf9d1451/storygen/story/story_writer.py), [License](https://github.com/facebookresearch/doc-storygen-v2/blob/d092b42686bfc29ef2d610d5563e822ebf9d1451/LICENSE).

Dramatron is an additional screenplay-focused example of hierarchical co-writing. Its authors report professional writers finding it useful for exploration while also describing formulaic output and reluctance to use it for an entire play. That limitation reinforces the need for author-controlled quality checks. It is less directly applicable to novel prose; software is Apache 2.0 and other materials are CC BY 4.0. [First-party repository and limitations](https://github.com/google-deepmind/dramatron).

## What the motion-video-kit pattern contributes

The kit uses a short entry skill that routes tasks to focused references. Its workflow establishes a brief and reference mechanisms before building; its review process gives a fresh critic the artifact and brief, then checks the revised artifact against previous findings. It also distinguishes mechanical checks from creative judgment and records revisions. These are useful patterns to adapt to writing, rather than video-specific measurements or a promise that extra agents guarantee quality. [Entry skill](https://github.com/echris6/motion-video-kit/blob/255562b04b1e5ecaa4ba98e5c9aa191d5ba7f6fa/business-motion-film/SKILL.md), [Gauntlet](https://github.com/echris6/motion-video-kit/blob/255562b04b1e5ecaa4ba98e5c9aa191d5ba7f6fa/business-motion-film/references/gauntlet.md), [quality bar](https://github.com/echris6/motion-video-kit/blob/255562b04b1e5ecaa4ba98e5c9aa191d5ba7f6fa/business-motion-film/references/quality-bar.md). Its text, scripts and templates are MIT licensed. [License](https://github.com/echris6/motion-video-kit/blob/255562b04b1e5ecaa4ba98e5c9aa191d5ba7f6fa/LICENSE).

My proposed fiction adaptation is: scene intent → relevant story evidence → task-specific craft instructions → candidate prose → fresh critique → focused revision → verification → author comparison. Review the actual passage, quote the weak or successful wording, and explain its effect against this book's intentions. A fresh call separates drafting from evaluation, but does not establish that the critic is unbiased or correct.

## What openAuthor already has

Current local `main` inspected at `48f57b7dcb82b7020fe0aaf010f854e17f3b2a69` already provides seven built-in Editorial Passes and custom passes. Their saved instructions are short goals with criteria and context policy; they are a natural place to attach richer reusable procedures. [editorial.py](../../openauthor/editorial.py#L10).

Writing Voice already represents craft traits, guidance and avoidances. Its preview prompt preserves unfinished actions, uncertainty, individual speaker habits, strong wording and existing ending beats; it also supports focused feedback refinement. General voice context omits raw exemplars. A proposed improvement is to supply small author-selected examples for the particular character/task, within the existing context and Memory rules. [style_profile.py](../../openauthor/style_profile.py#L17), [preview instructions](../../openauthor/writing_voice.py#L244), [Writing Voice documentation](../writing-voice.md).

The shared editorial context includes Plan order and chapter intent, accepted canon with source evidence, validity and character knowledge, plus active Storyline constraints. It warns about missing evidence rather than treating all saved facts as verified. Focused passage/chapter critique already produces source-checked quotations, uncertainties and strengths to preserve. We should deepen and connect these features. [review_context.py](../../openauthor/review_context.py#L27), [editorial_review.py](../../openauthor/editorial_review.py#L17), [selection_editing.py](../../openauthor/selection_editing.py#L67).

The recorded live refinement evaluation describes added staging and abstract atmosphere, partial compliance with craft feedback, and no unqualified win over the source. Earlier comparisons also contain semantic changes that passed lexical checks. These are small, assistant-assessed experiments with author judgments pending, but they directly illustrate the need the user identified. [Refinement assessment](../evaluations/writing-refinement-luna-2026-09-29/assessment.md), [writing-quality evaluation](../writing-quality-evaluation.md).

Installing a skill in the coding assistant would not automatically improve openAuthor's model requests. Its subscription transport explicitly disables inherited skill instructions and orchestrator skills. The app needs to select and supply writing instructions itself, consistently across providers. The open Agent Skills format supports loading a skill body and relevant resources on demand, including programmatic injection when an agent cannot read files. [Runtime configuration](../../openauthor/codex_app_server.py#L54), [Agent Skills integration guide](https://agentskills.io/client-implementation/adding-skills-support).

## Proposed openAuthor writing kit

This is a design recommendation, not an implemented feature or a demonstrated quality improvement.

Use a small reusable craft library alongside a per-book writing pack. The library defines procedures; the book pack supplies the authority and taste for this manuscript. Keep the visible author workflow focused on actions such as develop this scene, draft from these beats, sharpen this exchange, and revise this passage.

| Task | Required preparation | What the result must demonstrate |
| --- | --- | --- |
| Develop a scene | Purpose, POV, competing goals, pressure, intended change, permissible invention and stopping point | A causal beat plan with a meaningful choice or consequence; alternatives when the creative direction is unresolved |
| Draft or revise prose | Relevant canon, character knowledge, selected voice examples, scene plan and protected material | Perception and language belonging to this viewpoint; concrete details that serve the scene; rhythm appropriate to the moment |
| Shape dialogue | What each speaker wants, knows, conceals and refuses; examples of their speech | Distinct speech and tactics; subtext where useful; understandable exchanges without gratuitous exposition |
| Review and refine | Actual candidate, authoritative source/brief, relevant craft reference and prior findings for verification | Quoted evidence, ranked concerns, strengths to retain, small useful changes and explicit unresolved issues |

A book pack should collect author-approved voice examples, character perception and speech habits, motivations and knowledge at the scene's time, relevant world rules, unresolved promises/reveals, and feedback the author deliberately wants reused. Existing canon, Plan and Writing Voice should remain their sources of truth; do not create competing copies that drift.

For the private test manuscript, the source profile establishes what the viewpoint character wants and whom he distrusts. A technically fluent but conciliatory reform speech could therefore sound polished while missing the character. His attention to infrastructure and failure mechanisms is a plausible craft direction to develop from that profile, not a newly established canon fact.

Before drafting a confrontation between two established characters, make explicit what each wants from the exchange, what each knows at this point, what leverage is available, and how the relationship must change. Treat this preparation as a scene contract, not a rigid plot formula. Permit deliberate exceptions, quiet scenes, exposition, direct dialogue and purposeful repetition when they serve the author's intent.

Skills should load only for the selected task. Start with vetted, versioned text and reference resources attached to existing Editorial Passes, and record which skill version and book evidence produced a candidate. A complete plugin marketplace, fine-tuning, background learning and a large permanent agent cast are unnecessary for the first experiment.

Use one fresh focused critic call on a candidate and, when supported concerns warrant it, a bounded refinement and verification. A critic may find no issue. The original can remain the best option. Preserve the existing Change Set review/apply/undo workflow; the critic's preference is advice for the author.

## First quality experiment

Compare the current prompt with the proposed skill-guided workflow using the same model, complete story evidence and explicit task. Include a third condition with critique/refinement if the aim is to separate instructional benefit from the benefit of extra calls. Record model identity, requests, tokens and latency; a more expensive pipeline must earn its cost.

Use a small varied set of original scenes: a two-character conflict, two contrasting character voices, a scene with a withheld reveal, a quiet passage where restraint should survive, and connected scenes with distant setup or knowledge. Reserve fresh scenes to check that improvements extend beyond the examples used to tune instructions. The existing test book is an experimental fixture; its invented plot is not automatically the author's intended canon.

Present anonymous candidates alongside the original. Have the author assess character fit, scene relevance, earned emotion, voice, clarity, and facts/knowledge preserved, quoting the passages behind a preference. Include original, tie and none as valid choices. Exact names and quotations can help flag problems but cannot certify meaning. Success means prose the author would keep for this book with supported fidelity, not merely a completed generation or the generator's own score.

**Research limits**

Repositories and product documentation demonstrate workflow design and available features. They do not establish that any kit reliably produces exceptional fiction or beats openAuthor. The research studies provide bounded evidence for their particular systems and tasks. No skills were installed, no provider inference was run for this research, and no application source or manuscript was edited.

**Sources**

- [Motion Video Kit skill](https://github.com/echris6/motion-video-kit/tree/255562b04b1e5ecaa4ba98e5c9aa191d5ba7f6fa) and [Gauntlet workflow](https://github.com/echris6/motion-video-kit/blob/255562b04b1e5ecaa4ba98e5c9aa191d5ba7f6fa/business-motion-film/references/gauntlet.md).
- [Matt Pocock's skill repository](https://github.com/mattpocock/skills).
- [Novel Writing skill and references](https://github.com/wgwtest/novel-writing).
- [Calliope writing skills](https://github.com/Calliope-Editor/writing-skills).
- [Howells fiction workflow](https://github.com/howells/fiction).
- [Novelcrafter prompt examples](https://www.novelcrafter.com/help/reference/prompts/prompt-examples).
- [Sudowrite Story Bible documentation](https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/what-is-story-bible/jmWepHcQdJetNrE991fjJC).
- [DOC paper](https://aclanthology.org/2023.acl-long.190.pdf) and [DOC v2 code](https://github.com/facebookresearch/doc-storygen-v2).
- [Dramatron](https://github.com/google-deepmind/dramatron).
- [Agent Skills integration guide](https://agentskills.io/client-implementation/adding-skills-support).
- [openAuthor writing-quality evaluation](../writing-quality-evaluation.md).
