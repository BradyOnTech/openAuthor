# Terra subscription writing comparison — assistant assessment

2026-09-12. Partial result, not a writing-quality certification.

## Outcome and method

The existing `openai-codex` ChatGPT-authenticated connector was used with explicit
`gpt-5.6-terra`. Seven recorded generation calls produced six accepted candidates:
three dialogue and three introspection variants. The action comparison stopped
after its first call because a self-review excerpt was absent from its candidate,
even after the narrow presentation-quote repair. It is a failed workflow case,
not a low literary score or a usable action sample. No API-key provider, private
manuscript or default-provider change was used. Source scenes remained unchanged.

This assessment was written after reading [the anonymous packet](review.md),
before consulting the direction key. It is the development assistant's critique,
not a human author's review or an independent external judge. The assistant knew
the available presets and helped prepare the corpus; hiding labels does not remove
those biases. The separate earlier diagnostic exposed one action response but no
dialogue or introspection responses from this run. The persisted `author_review`
fields remain empty. Sample labels apply within each scene, not across scenes.

The manifest and safe per-call provenance are in [record.json](record.json).
The model field records the explicit requested identifier; these artifacts do not
independently attest a resolved model snapshot. Token counts describe subscription
usage, not an API bill. The corpus is small and deliberately constrained; no
statistical ranking, controlled prompt-effect estimate or book-length claim follows.

## Dialogue: The spare key

Fact-by-fact reading (P = preserved; U = uncertain or weakened):

| Required fact | A | B | C |
| --- | --- | --- | --- |
| Spare key hidden in the bellows before dawn | P: “Before dawn, Ivo had hidden the spare key inside the bellows.” | P: “Before dawn, he had tucked the spare key inside the bellows.” | P: “Before dawn, he had tucked the spare key into the bellows.” |
| Ivo did not open the storehouse and gave the other key to Mara's brother | P: “No.” / “That, at least, was true.” / “He had given the other key to her brother.” | P: same truthful denial; “The other key he had given to her brother.” | U: truthful denial survives, but “The other key was with her brother” removes Ivo's act of giving and asserts current possession instead. |
| Ivo is unsure what Mara knows; her private knowledge is not established | P: “Unless she had come back.” and uncertainty about how the bellows hung | P: “Unless she had come back.”; both bellows details are things he tries to remember, not facts about Mara's knowledge | P: “Unless she had come back.”; no disclosure of Mara's private thoughts |
| No confession or discovery of the spare key | P: closes on Mara cutting bread, “as if the matter had already been decided” | P: closes on bread, “as though the matter had settled itself around them” | P: closes on bread, “as though the matter had already decided itself” |

- **A:** Clear and close to the original. Mara's short questions and Ivo's
  evasive drawer/letter joke still distinguish them without decorative tags.
  “The tea found the sore place behind his teeth” is a plausible tactile
  revision, and “without drinking” preserves the small action. The separately
  paragraphed coat refusal adds emphasis, but is not an obvious improvement.
  The final “matter ... decided” is more general than the original “question.”
  This is a viable alternative, not evidence of substantially better writing.
- **B:** The added “whether the leather mouth had gaped” stays inside Ivo's
  uncertain memory, so it does not establish Mara's knowledge. It adds a physical
  detail of debatable value. “The matter had settled itself around them” is more
  abstract than the original ending. More importantly, “He set it down again,
  untouched” follows tea reaching the sore place behind his teeth. If “untouched”
  means undrunk, that needs clearer wording; the surface reading contradicts the
  physical action. The four declared facts alone would miss this problem.
- **C:** The clipped opening and “Stay, it said” are distinct, but the cup's
  implication becomes an explicit symbolic command. The original evasive joke
  survives, so the speakers do not collapse into one voice. “The other key was
  with her brother” weakens an important event into a different state claim.
  “He set it down untouched” repeats B's physical ambiguity. Shorter is not
  automatically clearer or more faithful. Do not choose this version without
  repair.

**Blind preference: source/A tie.** A is a usable, conservative alternative;
neither it nor the others establishes a clear improvement over the source. B
needs a small physical-detail repair; C also needs the act of giving restored.
These are manual semantic findings, not automated check results.

## Introspection: The second place

| Required fact | A | B | C |
| --- | --- | --- | --- |
| Father missing eleven days; death not established | P: “Her father had been missing for eleven days.”; no declaration of death | P: same eleven-day statement; no declaration of death | P: same eleven-day statement; no declaration of death |
| Market day yesterday; letter unsealed | P: “She had not sealed it.” / “Market day had been yesterday.” | P: “The letter to his sister lay on the table, unsealed.” / “Market day had been yesterday.” | P: same explicit unsealed/yesterday statements as A |
| Bowl marked, not cracked | P: “a white mark on the glaze. Not a crack.” | P: “a white mark in the glaze. Not a crack.” | P: “a white mark on the glaze. Not a crack.” |
| First line crossed out with no replacement; one covered bowl remains on table | P: “left the other on the table, covered with a clean cloth” / “She did not write another.” | P: “The other she left on the table beneath a clean cloth” / “She did not write another.” | P: same covered-bowl and no-replacement wording as A |

- **A:** Nearly all of the original emotional structure is preserved. Splitting
  the rice sentence adds a beat without changing the action. “Now she listened
  through the pause” slightly reorders emphasis. Neither establishes that the
  prose needed improvement. Repeated rinsing, checking twice, the restrained final
  line and uncertainty all survive.
- **B:** The clearest alternate texture: “worried it loose with her thumbnail”
  and “listened into the pause” remain anchored in Mara's immediate experience.
  It compresses some wording but preserves the repeated washing and checking.
  “One went into the cupboard” modestly reduces the emphasis on her agency.
  This is a coherent optional variation, without generic grief imagery or an
  invented resolution, not a clear winner over the source.
- **C:** Almost unchanged. “Across” becomes “over” and the bowl becomes “covered”
  rather than “covering it.” Those tiny adjustments supply no meaningful evidence
  of a distinct voice, but retaining this passage is appropriate to the explicit
  preservation-control instruction. There is no emotional label pasted onto the
  closing gesture. Character-distinct dialogue is not assessable in this scene.

**Blind preference: source/C tie, with B a viable alternate.** C's near-identity
is not a defect in this control. It also cannot demonstrate broad stylistic range.
All three preserve the four declared facts in this manual reading.

## Product conclusions

1. Subscription generation is real and reaches the public Writing Voice workflow.
   It is not yet reliable across this tiny corpus: only two complete comparisons
   were accepted after the quote-format repair. The remaining action rejection
   needs its own captured-response diagnosis; do not broaden normalization on a
   guess or count rejected samples as successful.
2. Exact evidence checks are necessary but do not prove semantic fidelity. The
   dialogue's “untouched” ambiguity and changed key-transfer event pass lexical
   presence checks. Keep author review and the source visible beside candidates.
3. Preserve-good-prose behavior looks promising in this narrow control. A setting
   should not force a rewrite where the original already works. A near-identical
   result must not be marketed as an improvement merely because generation ran.
4. Existing controls produced modest, readable variations, not strong evidence of
   compelling style range or better prose. Do not add more sliders or claim
   author-like writing on this basis. Next improve result-contract reliability,
   retain narrowly scoped rejected-response diagnostics, collect the author's
   blind preferences, and test varied held-out scenes with explicit agency,
   uncertainty and physical-action checks.
5. No author approval, automatic learning, full-book drift validation, physical
   mobile validation or release-readiness upgrade follows from this run.

## Direction key — consulted after the assessment above

| Scene | A | B | C |
| --- | --- | --- | --- |
| Dialogue | Clear, structured epic | Quiet and atmospheric | Kinetic, emotionally intense |
| Introspection | Kinetic, emotionally intense | Quiet and atmospheric | Clear, structured epic |

All six accepted samples satisfy the mechanical length, protected-phrase and
lexical-marker checks. That does not overturn the semantic concerns above.
The seven recorded calls used only `openai-codex` with requested model
`gpt-5.6-terra`, reporting 87,682 input and 4,285 output tokens in total. This
includes the rejected action call and excludes earlier attempts and the diagnostic.
The first attempt's precise usage was not retained; no exact whole-session total
is claimed. The direction key fits the observed changes, but a single small run
cannot establish a stable ranking or isolate the effect of the strengthened prompt.
