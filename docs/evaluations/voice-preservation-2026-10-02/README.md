# Writing Voice preservation contract — October 2

This packet uses original synthetic prose and retained synthetic provider output. It made **zero additional provider calls**. No private manuscript was read or changed, and no replayed alternative was staged. Human author acceptance and live quality after this change remain unobserved.

## Diagnosis

The retained chapter asks whether the **boat** will go. Its selected passage concerns hesitation over a sealed letter. The earlier evaluation retained the explicit constraint “The boat's departure remains undecided; the second bell has not sounded” in its request packet, but did not pass it to `preview_voice`. Provider-visible instruction, scene summary and style guide instead referred broadly to an unresolved or unfinished departure. Voice preview supplied the selected prose and authored metadata, without neighboring prose.

Both retained alternatives broadened that ambiguity to Ivo's personal departure: one introduced “when he meant to leave”; the other introduced “before he left—if he meant to leave at all.” Candidate-only consistency quotations were accepted even while their comments praised the broadened uncertainty. Alternative B also added an explanatory image, “pinned, but not broken,” contrary to the stated preference for implication through practical attention. This is a bounded reading of these two alternatives, not a general model quality estimate.

The ranked explanations were lost explicit constraints, insufficient surrounding evidence for the departure's referent, and self-review that cited only the candidate. The first and third are directly reproduced in [contract-red.txt](contract-red.txt). The wider context limit is retained explicitly; this change does not silently send more manuscript prose.

## Implemented contract

The optional public `preservation` list contains `{kind, text}` rows. Kinds are `fact`, `knowledge`, `uncertainty`, `protected_text` and `end_beat`; limits are 12 rows, 400 characters per row and 3,000 characters total. Explicit malformed data is refused before generation. Exact authored strings survive preview, successive refinement and proposal provenance. Protected wording must occur literally in the selected original.

The preview's `preservation_fingerprint` binds those clauses to its original scene identity/version, source and instruction. Refinement cannot replace the original contract. Refinement and staging accept an optional `expected_preservation_fingerprint` for reviewed callers. Staging accepts the saved contract, and the CLI refuses a replacement list. Existing staged handoffs are checked before being returned.

An immutable local metadata binding is atomically written **before** the preview under the project lock. It contains only preview ID, schema version and fingerprint. Interrupted creation can leave an orphan binding, which cannot silently become a legacy preview or be overwritten by a duplicate ID. Genuine older previews without either record remain compatible. This detects accidental contract loss or edits to one record; it is **not adversarial integrity against someone editing both files**. No additional manuscript prose is placed in the binding.

The generation prompt preserves each uncertainty's subject, domain and degree, and treats background context as a consistency constraint. Consistency self-review now pairs a literal `source_excerpt` with its candidate `excerpt`. Invalid or missing evidence is omitted with a warning while usable prose stays reviewable; strict review refuses invalid evidence. Literal quotation membership does **not** verify meaning. Facts, knowledge, uncertainty and end beats still require human judgment.

Missing `protected_text` produces an exact actionable preview warning and blocks staging until repaired. This is the only new mechanically enforced prose constraint. The other kinds do not receive a fabricated semantic pass/fail result.

## Evidence and limits

[provider-inputs.json](provider-inputs.json) contains the two current prompt payloads, including all six exact reviewed fixture constraints. [replay-preview.json](replay-preview.json) retains the same earlier alternatives through the current core; [replay.json](replay.json) records the bounded checks. Because this is replay, the personal-departure ambiguity remains in the prose. The earlier candidate-only consistency observations are now omitted with an evidence warning. This demonstrates delivery and review mechanics; it does not demonstrate better generated prose.

[focused-tests.txt](focused-tests.txt) records 51 passing core tests: 19 new preservation tests plus 32 existing Writing Voice tests. They exercise public preview/refine/stage and real CLI dispatch, exact payloads, source privacy, legacy compatibility, changed scene/Storyline refusal, paired evidence, semantic limits, protected wording, interrupted binding writes, duplicate IDs, contract downgrade and completed handoff recovery. [public-red.txt.gz](public-red.txt.gz) archives the initial failing public tests; some initial malformed-input failures also contain repetitive adapter errors because the absent validation reached a synthetic adapter. The tight contract red above is the direct diagnostic evidence.

Reproduce locally, without a provider:

```sh
python3 -m unittest tests.test_voice_preservation tests.test_writing_voice
PYTHONPATH=. python3 scripts/evaluate_voice_preservation.py --output /private/tmp/voice-preservation-replay
```

[results.json](results.json) binds the focused result and packet to source hashes. The parent completion ledger owns broader suites and packaged/runtime verification. A new live revision and an author's qualitative acceptance remain separate, unobserved work; the fourth live call beyond the prior three-call allowance is still unapproved.
