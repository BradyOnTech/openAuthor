# Preserving source meaning during fiction revision

Research checked October 5, 2026. Add a structured semantic audit to the existing critic and verification calls before craft judgment. Check what each changed source passage loses and what each changed candidate passage adds. Require an inspectable trace rather than treating a fluent candidate, a valid quotation, or a model's approval as evidence that meaning survived.

**The observed failure**

The native dialogue experiments already supplied source text, author intent, the candidate, and eventually a diff. Review still approved deleted narration, missing subscriptions and Republic equipment facts, invented causality, and a changed bargaining object. The alternate Terra reviewer found some defects and missed others; it also questioned an arguably permitted rhetorical change. These are development observations, not measured rates or independent literary judgments. Second run assessment (withheld from the public repo because it quotes a private manuscript), Third run assessment (withheld from the public repo because it quotes a private manuscript), Alternate reviewer assessment (withheld from the public repo because it quotes a private manuscript).

The inspected review implementation verifies literal quotes and limits findings to three. Its findings and regressions require a candidate quote. A fully deleted proposition has no such quote. A separate source-side audit can represent that omission directly with a source quote and a null candidate quote, without inventing a candidate receipt. This is a schema limitation, not proof that it caused every missed defect. [Current review implementation](../../openauthor/writing_review.py).

**What the primary research supports**

FENICE extracts claims from a summary and aligns them with source passages using entailment and contradiction scores. Its inspected implementation exposes the aligned claim and passage, making judgments inspectable. However, checking claims that remain in a candidate does not enumerate facts deleted from the source. This direction is useful for unsupported additions, not a complete preservation test. Its T5 claim extractor and DeBERTa aligner would also add model dependencies; adapt the method rather than install the system for this small repair. [FENICE paper](https://aclanthology.org/2024.findings-acl.841.pdf), [Claim extractor](https://github.com/Babelscape/FENICE/blob/9741ec41996f1bf75825d7cdf29e931a066ce4f0/metric/claim_extractor/claim_extractor.py), [Alignment implementation](https://github.com/Babelscape/FENICE/blob/9741ec41996f1bf75825d7cdf29e931a066ce4f0/metric/FENICE.py).

An August 2026 OmissionBench preprint tests the opposite direction: enumerate source facts, then check each for presence. Conventional judges struggle with omissions; structured checks recover some detection. A single-call variant performs enumeration and comparison internally, which fits our call-count constraint. The paper explicitly reports incomplete recovery, sensitivity to reasoning budget, failure of calibrated thresholds to transfer, and surviving vague restatements that defeat the detectors. This is clinical-document evidence, not proof of improvement in fiction. [OmissionBench paper, sections 7–8](https://arxiv.org/html/2608.31016v1#S7).

The actual released prompts distinguish full, partial, and absent capture; preserve uncertainty, negation, and conditions; and require every fact ID exactly once. Its extraction prompt requires a source quotation and prevents ambiguous evidence from becoming a confident fact. The strongest pipeline structurally separates source-only extraction from candidate checking. A single critic call that sees both texts cannot claim that separation. The useful adaptation is an explicit coverage trace with source qualifiers, not a borrowed numerical acceptance threshold. [Extraction prompt](https://github.com/composo-ai/omission-bench/blob/bd64b4e09fc5e84d6fb920c53ecda9f9874a45b9/w2_prompts/pipeline_extract.txt), [Per-fact checker](https://github.com/composo-ai/omission-bench/blob/bd64b4e09fc5e84d6fb920c53ecda9f9874a45b9/w2_prompts/pipeline_check_tri.txt), [Single-call prompt](https://github.com/composo-ai/omission-bench/blob/bd64b4e09fc5e84d6fb920c53ecda9f9874a45b9/gepa/judge_prompt.txt).

STORYSUMM supplies directly relevant narrative evidence. Its human protocols find different errors even with high agreement; model-suggested inconsistencies can also convince annotators of false errors. None of its tested automatic methods exceeds 70% balanced accuracy against its expanded labels. The published prompts include candidate-claim checking and adversarial error proposals. Do not copy the instruction that forces a possible inconsistency: in openAuthor, a faithful rhetorical change must be allowed to pass. Localized explanations are useful for review, but agreement and error confidence do not establish correctness. [STORYSUMM paper, sections 3–4 and appendix B](https://aclanthology.org/2024.emnlp-main.557.pdf).

For bargaining, the primary negotiation work separates intent and arguments from surface realization: an offer or counteroffer has a strategic object as well as wording. Its authors explicitly retain full dialogue history because a coarse act does not capture all semantics. For fiction, adopt that distinction cautiously: a line can remain a question while changing what it demands, what it offers, or whose stakes supply leverage. This research concerns negotiation systems, not literary revision quality. [Decoupling Strategy and Generation in Negotiation Dialogues, section 3](https://aclanthology.org/D18-1256.pdf).

**Small implementation within four draft-stage calls**

Keep draft, critique, refinement, and verification. Change the output contract and review procedure, not the number of calls.

1. The host numbers changed source and candidate passage units using the existing diff, including deletions, insertions, and nearby dialogue context. These are locators; original references remain authoritative. Preserve unchanged surrounding text and the complete candidate so a faithful restatement elsewhere can be found.
2. The critic inventories the source meaning of each changed unit before assessing craft, then matches it against the candidate. It separately checks newly asserted candidate content against the source and allowed story references. Return audit rows independently of the three craft findings.
3. Refinement receives the verified audit receipts and author permissions alongside craft findings. Repair unsupported changes narrowly; do not rewrite a correct rhetorical question merely to recover the source's grammatical form.
4. Verification compares the final candidate to the original source again. Recheck retained qualifiers and acts, including units that previously passed; resolving the supplied findings alone cannot establish that other facts survived.

An audit row should contain a host unit ID, exact source quote, brief source meaning, exact candidate quote or null, comparison status, affected dimension, and permission evidence when claiming an authorized change. Use separate statuses for preserved, authorized, omitted, altered, unsupported addition, and uncertain. A wholly new assertion can have a null source quote plus the named reference scope checked; absence cannot be proven by fabricating a supporting quotation.

For each meaning-bearing unit, examine these dimensions:

| Dimension | Required comparison |
| --- | --- |
| Proposition | Who did or said what to whom; object, quantity, time, and location when relevant |
| Relation | Cause versus sequence, condition versus event, subscription versus generic ongoing operation |
| Knowledge | Narrator-established fact versus a character's statement, belief, suspicion, lie, or unanswered question |
| Qualifier | Negation, possibility, restriction, condition, and attribution |
| Dialogue action | Intended response, bargaining object, offered concession, leverage, and commitment |
| Narration | Embedded action, speaker attribution, and staging that must survive the requested scope |

Do not label grammatical form as a preserved invariant unless the author protected it. An accusation may legitimately become a pointed question; replacing human stakes with trust in a tablet changes a different dimension. A source statement is not automatically objective canon: preserve its speaker and epistemic status. Likewise, preserve a source's uncertainty rather than resolve it through world knowledge.

The host can verify ID coverage, valid statuses, quote presence, and permission-reference existence. It cannot verify that a quoted passage entails the model's paraphrase. Missing audit rows, truncation, unverifiable receipts, or unresolved uncertainty should prevent a model “keep” or “accept” disposition, while retaining the proposal for author inspection. Do not advertise this as a fidelity certificate.

The current critic and verifier reserve 1,800 output tokens each. A trace for many changed passages can exceed that. Keep meanings and quotes short, prioritize the audit over optional praise, and measure whether a modest larger reserve is necessary. Four calls can remain four calls while token usage rises. If a bounded response cannot cover the changed units, expose incomplete review instead of silently certifying a subset. A source-only ledger from an already existing pre-draft planning call could reduce candidate contamination later, but it would still need source-quote validation and omission testing.

**Test the repair rather than its approval language**

Backtest the frozen second and third dialogue candidates and curated control. Count which known defects are localized correctly, missed, or falsely alleged; a generic “revise” does not demonstrate detection. These cases are already development material and cannot be held-out confirmation.

Then freeze the procedure and use new paired passages from separate scenes: faithful paraphrase controls, fully deleted facts, vague partial restatements, changed causal links, hardened uncertainty, switched attribution, lost negation or restrictions, changed bargaining objects, and explicitly authorized tactical changes. Hide the labels from reviewers. Human labels should distinguish a lost proposition from a permissible stylistic change and include source evidence.

Report defect recall, false alarms on faithful controls, and localization correctness separately. Treat incomplete or malformed audits as incomplete, not clean passes. Split by scene so related candidates do not leak into both development and confirmation. Unit tests can establish parsing and receipt validation; they cannot establish semantic detection or writing quality. Even a successful probe would support a bounded source-fidelity improvement, not independent literary preference or market superiority.

**Sources**

- [FENICE paper](https://aclanthology.org/2024.findings-acl.841.pdf) and [pinned source](https://github.com/Babelscape/FENICE/tree/9741ec41996f1bf75825d7cdf29e931a066ce4f0).
- [OmissionBench preprint](https://arxiv.org/abs/2608.31016) and [pinned released prompts](https://github.com/composo-ai/omission-bench/tree/bd64b4e09fc5e84d6fb920c53ecda9f9874a45b9/w2_prompts).
- [STORYSUMM narrative faithfulness evaluation](https://aclanthology.org/2024.emnlp-main.557.pdf).
- [Decoupling negotiation strategy and language generation](https://aclanthology.org/D18-1256.pdf).
