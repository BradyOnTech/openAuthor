# Story writing kit

openAuthor now supplies focused fiction craft guidance to scene planning, drafting, passage editing, critique and Writing Voice. The guidance works with the selected provider and the sources the author permits. Its aim is prose shaped by this story's circumstances, characters and voice. Writing quality remains a matter for the author and readers to assess.

**Author workflow**

Open Changes and create a Change Set. Describe the change, or choose an Editorial Pass. Under “What this scene should accomplish,” optionally specify its purpose, what changes, where it stops, and a word target. This intent travels from the edit plan to the draft and its review. Leave the fields blank when the existing scene already supplies the direction.

“Review and refine the draft” is enabled for new requests. Review the actual context before planning and again before drafting. The draft stage uses two calls when the critic recommends keeping the first candidate, and up to four when it makes a focused revision and verifies it. It uses the same permitted story sources and the generated candidates. Provider budgets apply to each call. Local deterministic generation skips creative review and labels that limitation.

Review the hunks before applying. The craft review shows strengths, supported concerns, uncertainty and any verification result. Expand the retained candidates to compare them. Choosing another candidate rebuilds the hunks and resets their decisions; it does not change the manuscript. You can also edit or reject individual hunks. Apply and undo use the existing revision workflow.

**What is included**

The bundled fiction skill selects references for story integrity, scene purpose, prose, dialogue, viewpoint, pacing, setup/payoff and evidence-based review. Explicit Editorial Passes select their relevant specialist reference. The host records the resource paths, version and content hash, and includes the actual guidance in the context preview. Changing the kit or authored intent invalidates the reviewed request.

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

The [research](research/ai-fiction-writing-skills-2026-10-04.md) and [comparison plan](research/fiction-writing-comparison-plan-2026-10-05.md) informed the design. Development evaluation uses copied test manuscript fixtures and discloses the source voice as provisional AI-written QA prose. The public-method comparator is our adaptation of documented methods. It is not native Novelcrafter or Sudowrite output. Passing software tests, model reviews or a small development comparison does not establish market superiority.

**Sources**

- [Writing skills research](research/ai-fiction-writing-skills-2026-10-04.md).
- [Fiction writing comparison plan](research/fiction-writing-comparison-plan-2026-10-05.md).
