# Live prose refinement assessment

September 29, 2026. The fresh original scene **The survey ribbon** exercised two
Luna alternatives and one focused refinement through the subscription connector.
The workflow worked, but the refined prose only partly fulfilled the evaluator's
feedback. This is assistant judgment, not author approval or general quality
certification. The feedback was prepared for the experiment, not supplied by the
author after reading the initial samples.

## What changed in the writing

Both initial samples preserve the unresolved fence/water distinction, intact
seal, Noor's ignorance, stopped clock and interrupted reach. Neither appends a
new ending. Both also add material the source did not establish. Sample 1 adds
“kept her hands clear” and a motive about pretending she only agreed to delivery.
Sample 2 adds a trembling ribbon, repeated cart noises and paper holding silence.
The latter is atmosphere without a clear gain in character-specific perception.

The refinement removes the added hand movement and the invented delivery motive.
It retains Soren's dry river joke, Noor's short questions, the uncertain time and
the final ruler/thread image. The seal remains intact and Noor still does not
know what the permit says. However, the explicit statement that she has not
opened it is lost; intact seal plus ignorance support the reading, but the
original was more definite.

The opening moves attention to the existing permit, yet retains “asking him
directly would make the question hers.” That is still an abstract explanation
rather than the concrete, restrained attention requested. The feedback was
therefore followed partially, not fully. The physical glance at the permit is
minor added staging and should be distinguished from the forbidden invention of
a consequential new action. No new action resolves the scene.

My preference is **refined over initial sample 1**, but **no unqualified winner
over the source**. The source's explicit emotion labels remain a valid target;
replacing them with vague interpretation is not enough. A further author-led
edit should restore the clear unopened-permit fact and decide whether the
abstract opening line earns its place. Do not accept the whole passage merely
because the second attempt looks more polished.

## Workflow evidence

[run.py](run.py) permits only the existing subscription connection with the
explicit Luna model and zero provider retries. It created a disposable original
book, generated two previews, refined one, and checked:

- The source scene and approved profile were unchanged after generation.
- Queueing created a Change Set without applying prose.
- Applying wrote exactly the refined text.
- Undo restored the original scene body.

The [record](results/record.json) retains both preview records, feedback, provider
provenance and workflow outcome. The [reading packet](results/review.md) omits
generator self-reviews and direction labels. The experiment used three calls;
including the separate dialogue followup, this iteration used six subscription
calls and no API-key inference. These are core workflow checks with live prose,
not a packaged-app or physical-device test. No real manuscript was modified.

Best-effort review was used. Initial sample 2 has incomplete/unverifiable
self-review evidence, which was omitted with a warning; the prose was retained.
The other two samples have no malformed-evidence warning. This experiment is
not a strict evidence-validation pass. The assessment separates workflow checks
from literary judgment, consistent with the distinction between deterministic
tests and variable model behavior in OpenAI's
[evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices).

## Next acceptance test

Have the author compare original, initial and refined prose and identify which
changes they would actually keep. Then evaluate a connected original chapter,
including character-specific dialogue and facts established in another scene.
Keep the current author controls and avoid new scoring frameworks, model
orchestration or repeated prompt tuning against these two familiar scenes.
