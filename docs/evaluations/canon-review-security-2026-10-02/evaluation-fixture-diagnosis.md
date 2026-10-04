# Canon evaluation fixture diagnosis

The approved root core suite ran 583 tests and had one error in `test_curated_corpus_has_measured_precision_and_recall`. The isolated command `PYTHONPATH=. python3 -m unittest tests.test_canon_evaluation` reproduced the same error in `evaluation-fixture-red.txt`.

Ranked hypotheses, sent to root before changing the fixture:

1. The `impossible-timeline-range` fixture depends on creating newly accepted Canon with an inverted scene-0002 to scene-0001 validity range. The new accepted-status invariant correctly prevents that public mutation. The fixture and exact stack trace confirm this.
2. The validation might confuse story time with reading order. The documented and existing Canon contract uses Plan reading order for validity; this hypothesis does not match that contract.
3. Plan order might have unexpectedly changed. The failing fixture creates scenes in ordinary scene-0001, scene-0002 order, with no move. No evidence supports this.

A separate disposable-book probe created a valid accepted range scene-0001 to scene-0002, then genuinely moved scene-0002 before scene-0001 through Plan. Before the move diagnostics were empty; after the move they reported exactly one impossible_validity. The Canon file and both prose bodies were unchanged. `validity-after-reorder-probe.json` retains that outcome.

The fixture now creates the valid accepted fact before applying its declared reading order. The evaluation helper uses the ordinary Plan API for that post-creation move and validates that the fixture lists each saved scene exactly once. The corpus still expects the same impossible_validity diagnosis, and the test explicitly asserts both its expected and actual count. No production validation was removed, and the case was neither skipped nor omitted from precision/recall.
