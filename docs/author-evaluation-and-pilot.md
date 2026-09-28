# Author evaluation and pilot

Prepare the study without using unapproved manuscripts or contacting authors. The current deterministic tests verify code behavior; they do not establish real-manuscript extraction accuracy, preservation of author voice, or willingness to return to the product.

**Current boundary**

No author manuscript or participant list is approved. The user is unsure which material is covered by consent. Existing private projects must not become a test corpus by default. There are no pilot outcomes to report. Start with newly written synthetic passages for tooling and reserve all real-author claims for observed, approved sessions.

**Intake before any provider call**

- Identify the exact manuscript files/excerpts and the person authorized to approve their use.
- Record permission for local import and analysis separately from permission to send text to the named AI provider and model.
- Record whether evaluation artifacts may retain prompts, completions, excerpts, revision history, and backups; define who may access them and when they must be removed.
- Record whether findings may be shared, and whether quoted examples require another approval.
- Let participants omit sensitive passages and decline recording. Use participant codes in result files; keep contact details outside the repository.

Unclear or missing permission means no transmission. A provider sign-in is not consent to upload a particular manuscript. A future consent record is not an instruction to contact anyone; participant outreach needs user authorization.

**Manuscript evaluation**

Use a fresh local project per case. Preserve the supplied source file unchanged and record its hash. Start with at least three differently styled manuscripts and multiple scenes per manuscript, expanding only after the workflow is reliable. Include dialogue, limited point of view, intentionally unresolved facts, aliases, and timeline changes where the authors approve those passages.

1. Import the approved selection and compare scene count, ordering, paragraphs, and prose against the source. Record losses rather than silently normalizing them away.
2. Run the product's Story Memory scan. Its current extraction engine is heuristic, not a live-model extractor. Label its results independently of editorial model results.
3. Have the author label the suggested entities, relationships, and facts against their own manuscript. Count missing items as well as incorrect suggestions. Do not preload the ground truth as Canon and then call the result extraction accuracy.
4. Choose one concrete editorial goal and protected facts. Record provider, exact model, date, sampling settings, context selection, and task instructions.
5. Generate a Change Set using the approved provider. Stop at review: the author identifies supported/unsupported claims, unwanted voice changes, and accepted/rejected hunks before application.
6. Apply only the selected hunks in the isolated evaluation project. Compare the applied prose with those decisions. Undo, then compare the complete scene bytes against the pre-apply checkpoint.
7. Create a portable backup, restore into a separate folder, and confirm prose, Plan, Story Memory, and accessible history match the approved state.

Report entity/fact precision and recall against human annotations, broken protected facts, unsupported additions, accepted/rejected hunks, voice ratings, import losses, byte-exact undo success, provider failures, elapsed review time, and actual reported usage. Human ratings stay separate from automated checks. Always report denominators; a case with no labeled facts is not evidence of perfect recall.

**Failure drills**

Use synthetic passages for expired credentials, dropped connections, application closure, cancellation, and retry tests. Track whether requests reach the provider, whether the book changes, and whether retries create duplicate messages, proposals, or applied artifacts. A local simulated failure proves the recovery contract only; it does not establish a provider's billing or cancellation behavior.

**Small author pilot**

After consent and participants are approved, aim for three to five authors. Treat the results as exploratory usability observations, not a population estimate. Each initial session should take roughly 25 minutes. Observe without teaching the expected answer before each task.

- Ask the author to import or write an approved scene and find their saved version.
- Ask them to describe a proposed change in their own words, reject one unwanted hunk, apply the remainder, and undo it.
- Ask them to try an alternate Storyline, return to Primary, and explain which text they are now editing.
- Ask them to make a backup and locate the recovery action.
- Ask whether they would trust the app with their next revision and what specifically would prevent that trust.

With separate permission for a follow-up, check about a week later whether they returned to revise their own work. Record return behavior separately from stated intention. Do not infer retention from a successful first session or from a synthetic activity signal.

**Result record**

For each participant code, record task completion without help, assistance required, misunderstood changes, undo confidence before/after, observed data-loss incidents, return-to-revision behavior, blockers, and short approved quotations. Include explicit values for not observed and declined; never convert missing answers into success. Record only the minimum approved content and keep raw manuscript artifacts outside Git.

The next decision is whether authors can identify the current book state, understand proposed edits, and recover confidently. Any observed lost writing, cross-Storyline contamination, or unreliable undo blocks a release recommendation even if preference ratings are positive.
