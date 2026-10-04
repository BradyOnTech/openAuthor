# Editorial review and writing continuity — October 1, 2026

The latest `origin/main` (`2b343703`) is integrated with the existing local Writing Voice, guarded scene saves, and mobile work. Local source changes were checkpointed before resolving the divergent histories. This pass delivers a wider continuity review, working-location recovery, and measured improvements to a limited set of continuity checks.

## Author-visible changes

- Continuity review uses the main workspace, with a findings list and the selected finding's evidence visible together. Paired passages open by default. Record forms sit below the review and expand when needed. Narrow windows dismiss the navigation overlay when entering the editor or resizing.
- Evidence opens the exact current passage when its offsets or unique excerpt can be verified. The jump is consumed once; later caret movement survives tab navigation. An untouched revision request retains its chosen scene and evidence instruction after restart.
- Tab bookmarks retain the active tab and split layout per book and Storyline. Scenes and other artifacts load from current source files. Missing artifacts are dropped. Manuscript drafts remain in the separate guarded recovery journal.
- Caret, selection direction, and scroll positions are remembered. A unique surrounding passage can relocate after an external edit. Ambiguous or stale locations do not authorize replacement prose.
- Scene save queues survive navigation, retain conflict comparisons, and drain newer typing during a pending write. Each split pane updates its own tab. Version, apply, undo, and Storyline operations flush pending writing behind the book-change barrier.
- Reviewed chat uses only approved, current Canon grounding. Legacy Memory approval is scoped to the current turn and its retries. Chapter questions use their chosen chapter, even when another scene is open. Context-limit errors preserve the editable question.
- Failed chat attempts can retry under the same delivery identity. Results and pending messages are durable before a turn becomes complete; saved receipts recover interrupted publication without regenerating an already saved answer. Regeneration publishes a replacement atomically.

## Editorial evidence and limits

The eight original cases in `docs/product-review-challenges.json` now match their expected outcomes. Fresh checks cover natural finger-count paraphrases, Spanish eye-color descriptions, unrelated negation, explicit dye changes, hypothetical changes, quoted statements, ambiguous attribution, another person's change, and Unicode evidence offsets. A later explicit change ends a comparison interval without erasing unresolved contradictions from earlier intervals.

These are deterministic continuity checks. They establish behavior for the recorded cases, not a general precision or recall estimate across novels. They do not assess plot, character motivation, narrative effectiveness, or literary quality. No paid or external model calls were used in this pass. The offline Writing Voice baseline explicitly reports literary quality as unassessed.

Next evaluate the broader editorial judgment on a connected, author-reviewed chapter: compare supported findings and omissions, usefulness of revision instructions, and invented explanations. Heuristic Memory extraction still needs a larger false-positive assessment. Packaged GUI restart and physical-device release acceptance remain separate gates.

## Review axes

| Standards review | Spec review |
| --- | --- |
| Reproduced and fixed lost reconciliation controls, unapproved Canon context, retry failures, and turn completion before durable result storage. | Reproduced and fixed recurring evidence jumps, discarded pre-change contradictions, and lost seeded revision targets/instructions. |
| Guarded writes, one-turn permissions, durable delivery, and fresh source loading remain explicit. | The broader literary-quality priority remains open; synthetic passing checks do not claim to finish it. |

## Verification

The browser journey uses disposable books and the real Python engine with the offline provider. It verifies restart, external source refresh, caret relocation, exact evidence jumps, navigation after a jump, and layout at 1400 and 900 pixels. Additional journeys cover context limits, reviewed revision/apply/undo, and Storyline comparison/integration. Native bridge checks use disposable projects; signed distribution and a fresh packaged GUI acceptance pass are outside this evidence.

Recorded challenge outcomes are in [challenges.json](challenges.json); check results are in [verification.json](verification.json).

| Check | Result |
| --- | --- |
| Python suite | 454 passed, one opt-in runtime test skipped (455 discovered). |
| Desktop suite | 337 passed across 67 files. |
| Native bridge | 10 passed, one opt-in real macOS Keychain check ignored. |
| Browser authoring journeys | All five passed. The final Storyline assertion verifies restored scene text; both Storyline journeys passed after that assertion update. |
| Shared contracts / gateway / mobile | 19 / 28 / 96 passed; type checks passed. |
| Frontend production build | Passed; existing large-chunk advisory remains. |
| Repository checks | Passed, including capability claims and marker scan. |
| Editorial and workflow evaluations | Passed offline; original product challenges have zero extra or missed expected findings. |

Saved workspace views: [wide](evidence-workspace.png) and [narrow](evidence-workspace-narrow.png). These screenshots show the continuity review, not a native packaged-app certification. The broader suggestion inbox still needs author evaluation for review burden and false positives.
