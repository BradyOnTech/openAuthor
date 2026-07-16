from __future__ import annotations

import unittest

from scripts.evaluate_canon_diagnostics import evaluate


class CanonEvaluationTests(unittest.TestCase):
  def test_curated_corpus_has_measured_precision_and_recall(self) -> None:
    report = evaluate()
    self.assertGreaterEqual(report["precision"], 0.95, report)
    self.assertGreaterEqual(report["recall"], 0.95, report)


if __name__ == "__main__":
  unittest.main()
