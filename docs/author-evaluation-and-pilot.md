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

**Executable evaluation workflow**

`scripts/evaluate_author_workflow.py` now runs the real import, cold-start heuristic extraction, proposal drafting, hunk review, apply, undo, backup, and restore APIs. It creates a new isolated book, never edits the source manuscript, and refuses to overwrite an existing run. Nothing contacts a provider during preparation. The built-in synthetic mode is local-only and cannot be relabeled as human evidence.

Run the disposable synthetic recovery gate with `make test-author-workflow`. To inspect a persistent synthetic run, use a new output folder:

```sh
python3 scripts/evaluate_author_workflow.py prepare --output /tmp/openauthor-study-run
python3 scripts/evaluate_author_workflow.py generate --run /tmp/openauthor-study-run
```

Read `draft.json`, the imported book, and the original source. Fill `review.json` before proceeding. The runner checks the run, proposal, and draft hashes, requires an explicit accepted/rejected decision for every hunk, and stops if the book changed since intake. An unfilled review never authorizes application.

```sh
python3 scripts/evaluate_author_workflow.py finish \
  --run /tmp/openauthor-study-run \
  --review /tmp/openauthor-study-run/review.json
```

The resulting `report.json` includes per-kind extraction denominators, requested provider/model/settings, all generation-attempt summaries and failures, usage/provenance, reviewed hunk counts, exact application comparison, byte-exact undo, and exact backup/book/history comparison. Provider-reported usage is not a billing receipt; failed-attempt usage may be unknown. A rejected-only draft does not count as a successful apply or undo. Unknown ratings, missing annotations, empty denominators, and absent pilot outcomes remain null. Source bytes and full text-bearing reports stay inside the private run folder; stdout contains only the run identifier and verification summary.

For extraction labels, classify each suggestion as `correct`, `incorrect`, or `uncertain`. Add genuinely missing entities, relationships, and facts to `missed_items`, using entries such as `{"kind":"canon_fact","description":"Ivo is the keeper."}`. Mark `extraction_complete` true only after checking false negatives as well as suggestions. Precision and recall are ungraded when annotations are incomplete or uncertain; separate `entity_create`, `relationship_create`, and `canon_fact` results prevent successful name detection from disguising missing facts. Human ratings and observations are never inferred from token counts or deterministic edits.

**Real-manuscript case manifests**

No such manifest is currently approved. The following is a deliberately disabled intake example, not consent. An authorized person must supply the missing scope and evidence before it can run:

```json
{
  "case_id": "author-case-01",
  "source": "approved-excerpt.md",
  "source_sha256": null,
  "strategy": "headings",
  "target_scene_index": 0,
  "provider": "local",
  "model": "heuristic-v1",
  "instruction": "Tighten pacing while preserving named people and events.",
  "protected_elements": [],
  "consent": {
    "status": "not_approved",
    "authority_ref": null,
    "evidence_ref": null,
    "participant_code": null,
    "local_analysis": false,
    "retain_artifacts": false,
    "retain_until": null,
    "provider_transmission": []
  }
}
```

Use an opaque authority/evidence reference and participant code, not contact details. Once local access is approved, record the exact source SHA-256. Supported intake is one Markdown, TXT, or DOCX file of at most 20 MiB, containing one or more scenes; the target index is zero-based. A case per source/target/provider combination keeps comparisons explicit. Real-author outputs must be outside Git repositories.

For a live run, set the provider and explicit requested model and add that exact pair to `consent.provider_transmission`, for example `{"provider":"openai","model":"the-explicitly-approved-model-id"}` with the actual approved identifier substituted. `retain_until` must be a future timezone-aware ISO timestamp. `retain_artifacts` covers the copied source, prompts, completions, annotations, logs, revision history, and unencrypted backups. The operator remains responsible for restricted access and deleting every retained copy by that deadline; the runner does not provide automatic deletion or legal verification of consent.

```sh
python3 scripts/evaluate_author_workflow.py prepare \
  --manifest /path/to/approved-case.json --output /path/to/new-private-run
python3 scripts/evaluate_author_workflow.py generate \
  --run /path/to/new-private-run --allow-provider
```

Both the retained approval and the original manifest are checked again before generation and finishing. Revoking the original manifest, changing its approved source digest, removing approval, or letting retention expire blocks further processing. `--allow-provider` is an additional deliberate transmission gate, not a substitute for consent. Credentials must be configured through the product's existing provider mechanism; they never belong in case or review files.

An interrupted generation requires explicit `--retry` and may incur another charge if no completed draft was saved. A saved draft is reused instead of creating another proposal. An interrupted apply is left for inspection rather than replayed blindly. The report is not proof of signed-installation readiness or actual remote cancellation/billing behavior.

**Pilot preparation artifact**

Each prepared run includes `pilot-record.json` with task outcomes set to `not_observed`, ratings unset, and outreach/follow-up authorization false. Use it only after separate participant and observation permission. Record task outcomes as unassisted, assisted, failed, declined, or not observed; record actual return to the author's own revision work separately from intention. The runner performs no outreach, scheduling, recording, or automatic retention inference. Filling this form is observational work still required from an approved pilot; no pilot has been conducted.
