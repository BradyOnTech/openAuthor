# Terra action-scene comparison — assistant assessment

2026-09-13. Targeted best-effort result, not a writing-quality certification.

The existing ChatGPT subscription connector generated three Terra variants for
`The brake`. The normal preview path retained all three. Samples A and C have a
provider self-review warning because one or more cited observations were not
verifiable; those observations were omitted, but the prose remains reviewable.
Sample B has complete self-review metadata. The source scene was not changed.

This is a label-blind assistant reading performed before consulting the direction
key. It is not the author's judgment or an independent reader's assessment. The
source facts and calibration warning were visible, so this has evaluator bias.

## Fact and craft review

All three retain the visible required phrases and lexical markers, but those
mechanical checks are not enough to certify the scene.

- **A:** The physical sequence is the clearest of the three. The brake, chain,
  boy and failed belt throw are easy to follow, and the interrupted count stays
  interrupted. Ivo's dry “Splendid plan.” remains distinct from Mara's commands.
  The added “his shoulder against the rail,” “before it tore free,” and “braced
  one hand” are plausible but unsupported physical details. “She was very
  frightened” repeats the source's direct label rather than deepening the choice.
  It is readable and conservative, but not obviously stronger than the source.
- **B:** This has the richest sensory texture: “wet iron complaint” and the
  twitching belt make the ferry feel present. The lever release is also legible.
  However, “the boy ... crouched ... on the other side,” the woman's stare, and
  the belt twitch are additions rather than preserved facts. “Fear came cleanly”
  explains Mara's interior state in a more authorial way than the source. The
  phrase “narrow gap” may understate that the space is wider than her body. It is
  atmospheric, but its additions need author approval.
- **C:** The short rhythm creates urgency and the choice remains trackable. The
  line “Mara counted them—one, two, three” is the largest fidelity risk: the
  calibration warning says the recount is interrupted before she reaches the boy,
  and this version visibly advances the count before restarting. “The lever tore
  at her palms,” “the ferry answered,” and “If she let go” add intensity but also
  move toward explanatory or melodramatic emphasis. The ending remains unresolved
  and the belt still falls short, but this is not the safest continuity choice.

**Blind preference: source/A tie.** A is the most usable generated alternative,
but the source remains competitive because it already has clear mechanics and a
strong unresolved turn. B is a possible atmospheric direction after fact and
interior-detail repair. C should not be selected without restoring the interrupted
count's exact status.

## Direction key and result status

| Sample | Direction | Self-review status |
| --- | --- | --- |
| A | Clear, structured epic | Partial; warning shown |
| B | Quiet and atmospheric | Complete metadata |
| C | Kinetic, emotionally intense | Partial; warning shown |

The three-call record is in [record.json](record.json), and the anonymous packet is
in [review.md](review.md). This run demonstrates that the best-effort app path can
preserve usable prose despite provider metadata defects. It does not prove that
Terra, any direction, or the strengthened prompt improves the author's writing.

Next quality step: have the author mark each unsupported addition and choose source,
A, B, C, tie or none. If A is preferred, stage it through the existing Change Set
review flow rather than applying the preview directly. Do not tune the prompt from
this one action scene alone.
