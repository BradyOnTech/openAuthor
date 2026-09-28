from __future__ import annotations

import unittest
import tempfile
from pathlib import Path
from openauthor.project import atomic_write_json

from scripts.evaluate_canon_diagnostics import evaluate


class CanonEvaluationTests(unittest.TestCase):
  def test_curated_corpus_has_measured_precision_and_recall(self) -> None:
    report = evaluate()
    self.assertGreaterEqual(report["precision"], 0.95, report)
    self.assertGreaterEqual(report["recall"], 0.95, report)
    self.assertEqual(report["evidence_kind"], "synthetic_seeded_canon_regression")

  def test_empty_corpus_is_ungraded_not_perfect(self) -> None:
    with tempfile.TemporaryDirectory() as temporary:
      path = Path(temporary) / "empty.json"
      atomic_write_json(path, {"cases": []})
      report = evaluate(path)
      self.assertIsNone(report["precision"])
      self.assertIsNone(report["recall"])


if __name__ == "__main__":
  unittest.main()
