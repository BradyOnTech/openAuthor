# Book-sized editorial workflow evidence

Updated 2026-09-11. Mechanical workflow evidence, not a literary-quality score.

## Fixture and independent expectations

`tests/fixtures/editorial_workload.py` creates an original synthetic workload of
64 scenes, 16 chapters and 36,476 prose words through the real core. It refuses
an existing manuscript. Six recurring paragraph patterns vary locations,
witnesses, objects and survey entries; this repetition exercises storage,
navigation and retrieval volume. It is not a complete authored novella or novel.
No private or third-party manuscript is used.

Four deliberately authored anchor passages have separate expected roles:

| Scene | Role | Expected evidence |
| --- | --- | --- |
| 1, The Hidden Key | Early secret | Only Ivo knows the tide key is beneath the western bridge. |
| 32, Knowledge Before Its Time | Deliberate knowledge contradiction | Mara knows the location despite not having been told. |
| 48, The Reservoir Confession | Later disclosure | Ivo finally tells Mara the location. |
| 64, The Seventh Bell | Protected deadline and distant revision | The seventh bell must ring before dawn; seven families are safe. |

The browser journey explicitly accepts the bell deadline as canon with exact
scene-1 evidence. It does not ask the local provider to discover that canon or
claim automatic semantic diagnosis of the knowledge contradiction.

## Public workflow under test

`desktop/e2e/long-book-journey.spec.ts` creates a disposable project in the real
desktop web shell, populates it through public core functions, then uses rendered
controls and public CLI reads. Only the native transport is adapted. The local
provider performs deterministic line edits and receives no live-provider keys.

The journey checks distant retrieval; coordinated generation for scenes 1 and
64; separate proposal review; protected-text refusal for the group; successful
group application after correcting the proposal; immediate applied status/Undo
in the open review; one shared applied Revision; and one-action coordinated undo
with a single new Undo Revision and immediate review/queue updates.
It then checks Book-scoped chat citations for scenes 1, 32 and 48, the accepted
canon receipt, bounded estimated input and opening the correct cited scene.
Public reads compare every scene with its original prose at the end.

The protected-text case deliberately edits one replacement to remove the protected
boundary wording; the bell deadline is separately preserved in both final scenes.
This distinguishes a functioning safety check from a provider that simply happens
to leave protected text unchanged. The other group's scene must also remain
unchanged when application is refused. Restoring the protected phrase permits
the same group to be retried. `coordinated-undo-guard.spec.ts` separately saves
newer author writing in one applied scene, then verifies that group undo refuses
without changing either scene, proposal state or Revision history.

## Bugs found in the connected journey

- Opening Changes before scene loading finished left an empty selected-scene
  state, even though the browser dropdown displayed the first scene. Selection
  now initializes when scenes arrive without resetting existing author choices.
  A delayed native-response test reproduces the issue without the large fixture.
- Switching proposal tabs retained the previous proposal's component state.
  Reviews are now keyed to their tab so identity-specific controls reset.
- Group apply refreshed the queue but not open reviews. Applied records now
  update those tabs, and the review uses the tab's current record rather than a
  second stale copy. Group application refreshes scene summaries and disables
  duplicate group submissions while pending.
- The local line-edit fallback removed “rather” from “rather than,” damaging a
  comparison in the generated surrounding prose. The cleanup rule now preserves
  that phrase; a public drafting regression and the browser prose check cover it.

The rendered AppV2 contract exercises late scene loading and group-apply status;
the browser/real-core journey verifies actual prose, protection, revisions and
undo. Neither replaces signed native application testing.

## Remaining author-facing work

This proves selected sources reach the assistant and that the review mechanics
work on a book-sized workload. It does not prove the model understands the
contradiction, selects all relevant sources under paraphrased questions, preserves
literary voice or proposes a useful structural revision. Synthetic repetition
and explicit rare search terms make this a controlled case, not retrieval recall
on real fiction. The local line edit is not an evaluation of AI creative quality.

Next use a non-templated original or authorized multi-chapter manuscript with
independently judged continuity, pacing and character-knowledge tasks. Assess
editorial decisions rather than request completion. Agree on manuscript/privacy
scope and provider spending before live evaluation. Track the findings as an
author-approved revision plan that feeds existing Changes and Story Memory.

The September 11 iteration adds coordinated undo; groups applied before undo
membership/workspace recording still need individual review. Remaining work
includes retaining reading position and unfinished review edits across navigation,
consistent hunk/merge context and general multi-file crash recovery. No release
certification is inferred from this fixture.
