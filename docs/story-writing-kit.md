# Story writing kit

openAuthor now supplies focused fiction craft guidance to scene planning, drafting, passage editing, critique and Writing Voice. The guidance works with the selected provider and the sources the author permits. Its aim is prose shaped by this story's circumstances, characters and voice. Writing quality remains a matter for the author and readers to assess.

**Author workflow**

Open Changes and create a Change Set. Describe the change, or choose an Editorial Pass. Under “What this scene should accomplish,” optionally specify its purpose, what changes, where it stops, and a word target. This intent travels from the edit plan to the draft and its review. Leave the fields blank when the existing scene already supplies the direction.

An empty scene asks the planner to prepare new prose from the supplied direction. Its plan stays separate from the original instruction and does not establish author voice or new canon. An existing scene retains the editorial planning role. Inspect either plan before drafting; a detailed plan alone does not establish that the resulting prose will be stronger.

“Review and refine the draft” is enabled for new requests. Review the actual context before planning and again before drafting. The draft stage uses two calls when the critic recommends keeping the first candidate, and up to four when it makes a focused revision and verifies it. It uses the same permitted story sources and the generated candidates. Provider budgets apply to each call. Local deterministic generation skips creative review and labels that limitation.

With the ChatGPT provider, optionally choose “Review reasoning effort.” Model default preserves the existing behavior; low, medium and high apply only to critique, focused revision and verification. The first writer call keeps the model default. Higher effort may take longer; explicit high effort allows up to three minutes for each review turn unless a longer timeout is configured. The chosen setting appears in the context review, and completed review attempts show the model and effort the runtime actually selected. This is a controllable execution choice, not a promise of stronger prose. A fresh comparison using an experimental review reminder caught one disputed motive becoming narrator fact at high effort, but full high-effort drafts still added unsupported detail; inspect the complete candidate yourself.

An existing manual Change Set offers the same review choice when building or regenerating its draft. The selected mode travels into the context preview and the recoverable request; retry keeps the original setting.

For a dialogue revision that must keep narration exactly, select “Preserve text outside quotation marks.” Inspect the identified passages in the context preview. The AI can replace only contents of paired “…” or "…" quotes; openAuthor retains all outside text, delimiters and passage order while drafting and refining. This literal scope includes quoted signs and messages. It requires an AI provider and paired, unnested quotes. An incomplete or ambiguous source needs a fresh passage selection or a whole-scene request without this scope. The option stays in the saved request and authored intent.

Quote scope protects editing locations, not meaning. Read for lost facts, altered uncertainty and changed tactics inside the quotes. A malformed edit reply or quotation-boundary escape is logged with its reported usage and delivers no draft; retrying that saved failed response does not silently generate again. Start a new draft for another attempt. AI hunk regeneration is unavailable in this mode because hunk fragments may contain incomplete quotes; regenerate the complete scene, edit manually or select a fresh passage instead.

Review the hunks before applying. The craft review shows strengths, supported concerns, uncertainty and any verification result. Expand the retained candidates to compare them. Choosing another candidate rebuilds the hunks and resets their decisions; it does not change the manuscript. You can also edit or reject individual hunks. Apply and undo use the existing revision workflow.

Quoted-text drafts use one hunk per changed quoted passage. Rejecting a passage retains its original contents while accepting another changes only that passage. Applying individual or coordinated Change Sets checks the selected result against the current scene's outside text and quotation boundaries. Older sentence-based drafts that cross those boundaries must be rebuilt before applying. Rebase retains passage decisions when the quoted anchors remain unchanged and reports a conflict when a targeted passage or quote count changes.

To iterate on an unapplied whole-scene draft, enter “Feedback for this draft” and choose “Review draft revision.” This creates a separate Change Set with a frozen copy of the draft and your comment. Review that candidate, the original scene direction and the permitted story context before sending. The previous Change Set remains available; the new prose is also unapplied. Its “Previous draft” section lets you compare the source with the result. This uses the existing writer and optional creative-review calls, without generating another edit plan.

“Revision focus” can select dialogue, character motivation, viewpoint and knowledge, pacing, setup and payoff, or prose clarity. The selected focus is saved with the feedback and appears in the request preview. It adds the corresponding craft reference to the writer's guidance; it does not change the original scene permissions or supply missing character facts. General retains the original direction's guidance. Choosing a focus is an instruction to consider that aspect, not a guarantee that the resulting prose improves it.

“Writing model (optional)” lets you select a model for drafting or revising a Change Set. A saved draft initially uses its recorded model; leaving the field empty requests the provider default. Review the selected model in the context preview before sending. An unsupported model can fail; it is not silently replaced.

Creative review compares a feedback revision with the saved draft as well as the original scene evidence and intent. Your comment can explain which change you want; a generated plan alone cannot authorize one. Private notes and excluded Memory remain outside the request. Quoted-text scope, when present, also applies to feedback revisions. Local deterministic generation does not support this prose-feedback workflow.

Change Set receipts label draft generation and edit-plan generation separately, each with its own model, usage and timing. When creative review ran, “Draft and review” shows the stored aggregate for that workflow; expand the review attempts for individual calls. The plan's format score belongs to the instruction block; it does not assess the drafted fiction.

For a local change, select the passage in the scene editor and choose Rewrite, Shorten or Expand. Give a concrete direction and review its context before generating. Acceptance replaces only that selected range; a newer scene makes the proposal stale. Read the result with the surrounding scene and undo it if it weakens the passage. A whole-scene model review can miss lost facts or changed tactics even when it accepts a revision.

An unchanged passage reply is saved as “No replacement suggested,” with the original text and its generation record. It offers no Apply action. Dismiss it or keep it for reference; recovery reuses the saved result. This lets a conditional request, such as correcting grammar only when an error exists, finish without encouraging another rewrite. The label reports the returned text, not an independent judgment that the prose is ideal.

Passage context prioritizes permitted Memory subjects named in the selection, the scene's viewpoint character, and subjects in the included neighboring prose before other allowed records. Saved aliases count as names. This prevents unrelated entries from crowding out the viewpoint record under the existing allowance. It preserves source permissions and omits complete entries rather than clipping their facts.

**What is included**

The bundled fiction skill selects references for story integrity, scene purpose, prose, dialogue, viewpoint, pacing, setup/payoff and evidence-based review. Explicit Editorial Passes select their relevant specialist reference. The host records the resource paths, version and content hash, and includes the actual guidance in the context preview. Changing the kit or authored intent invalidates the reviewed request.

Edit-plan formatting preserves complete instructions and all supplied items. Author intent and protected source facts take precedence over a generated plan. Creative review outcomes appear before the plan and change hunks; a retained draft whose review failed or rejected a refinement remains available for author judgment and is identified as uncleared.

Review stages receive the complete candidate, permitted original references and a bounded comparison highlighting changes from the source. The comparison helps locate omissions and changed meanings; findings must still cite actual candidate wording and authoritative source evidence. A model can miss a problem or approve an unsuccessful revision, so its disposition does not replace reading the changes.

The critic and verifier now report their reading of every supplied changed passage before judging craft. Each pairs original and candidate quotations with a short meaning comparison; a wholly deleted passage can have no candidate quotation. Claimed permission must cite the author's instruction or constraint. Source concerns remain separate from the three prioritized findings, and can trigger a focused repair even when no candidate quotation exists for a deletion. The verifier repeats the comparison against the original source. Expand the source review to inspect these interpretations and cited directions.

The comparison includes up to 24 complete changed passages and 12,000 characters. Omitted passages, uncertain meaning or missing receipts prevent a favorable review disposition; the first draft stays available. Critique and verification each reserve 4,200 output tokens, disclosed in the preview and checked through the existing per-call provider budget. For ChatGPT-backed Codex, this is a target rather than a hard output limit; actual usage is logged and can exceed the estimate. These calls can still misread a passage or overlook a specific loss. The visible trace helps the author inspect the judgment; it is not a fidelity certificate.

These are original, adaptable craft instructions. They allow quiet scenes, useful exposition, deliberate distance and direct dialogue. They do not prescribe a universal literary style, require a new crisis in every scene, ban ordinary words, or require every sentence to carry subtext. Existing approved style guidance remains descriptive and respects its source freshness.

In Writing Voice, inspect the quoted observations, enable “Include the quoted exemplar evidence in AI writing,” then approve and save. This lets bounded, approved evidence accompany drafting, review and voice requests. Existing profiles retain their trait-only writing projection until that choice is saved; companion snapshots retain the trait summary. Traits describe a preference; an actual chosen passage shows how the prose realizes it. Stale current profiles remain excluded. A frozen profile uses its stored approved quotations, without substituting newer scene text. Exemplar events guide craft and do not become the new scene's facts.

**Review and recovery**

A fresh model invocation critiques the candidate without the generated edit plan's explanation. Findings must quote real candidate text. Fidelity and intent concerns also need real reference evidence. Unsupported finding quotations and malformed review output stop refinement and retain the first candidate with a visible failure. Unverified strengths are omitted with a visible warning. Line-wrapped quotations resolve to their actual source spans; a citation can use the reviewed scene's declared file path without reading any additional file. Reference validation establishes that the quotation exists; it does not prove that the critic's interpretation is correct.

Craft findings can cite the actual candidate. An unsupported optional craft reference is omitted with a warning while the finding remains attached to its verified candidate quotation. Candidate text cannot substitute for the authoritative evidence required by fidelity and intent findings.

A focused revision addresses the supported findings. Verification must account for each finding and may reject the revision or remain uncertain. The author still chooses the result. Word targets use actual whitespace-separated counts; a model's favorable verdict cannot override a failed count. These mechanical checks are separate from literary assessment.

Physical staging checks follow access, movement and object handling through the scene. A repair must account for nearby actions rather than inventing a way to reach through a locked door. A real quoted regression prevents selection even when an optional reference citation is invalid; that citation is omitted with a warning while the concern remains visible.

Completed draft, critique, refinement and verification stages are checkpointed for recoverable requests. Retry reuses saved responses. A response lost before its checkpoint can still require a paid retry. Scene, Change Set, source permissions and guidance changes require another context review. Each retained prose candidate carries the generation provenance for the call that wrote it.

Whole-scene drafting now sizes its default output allowance to the scene and any supplied word target, within an automatic ceiling. Oversized requests require a narrower passage or an explicit allowance. The context and allowance remain visible before sending.

**Implementation and evidence**

The package includes a normal `SKILL.md` and selective Markdown references, compiled by `openauthor/writing_craft.py`. It does not enable inherited Codex skills, local memories, tools or file access. `openauthor/writing_review.py` owns evidence validation and stage recovery; callers own provider access, budget enforcement and source-state checks.

The [research](research/ai-fiction-writing-skills-2026-10-04.md) and [comparison plan](research/fiction-writing-comparison-plan-2026-10-05.md) informed the design. Development evaluation uses copied fixtures from a private test manuscript and discloses the source voice as provisional AI-written QA prose. The public-method comparator is our adaptation of documented methods. It is not native Novelcrafter or Sudowrite output. Passing software tests, model reviews or a small development comparison does not establish market superiority.

**Sources**

- [Writing skills research](research/ai-fiction-writing-skills-2026-10-04.md).
- [Fiction writing comparison plan](research/fiction-writing-comparison-plan-2026-10-05.md).
