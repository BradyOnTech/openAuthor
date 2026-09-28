from __future__ import annotations

import unittest
import tempfile
from pathlib import Path
from openauthor.project import atomic_write_json

from scripts.evaluate_editorial_passes import evaluate


class EditorialEvaluationTests(unittest.TestCase):
  def test_every_built_in_pass_improves_its_task_without_canon_regression(self) -> None:
    report = evaluate()
    self.assertEqual(report["pass_count"], 7, report)
    self.assertGreaterEqual(report["improvement_rate"], 0.95, report)
    self.assertGreaterEqual(report["issue_reduction_rate"], 0.95, report)
    self.assertEqual(report["canon_errors"], 0, report)
    self.assertEqual(report["evidence_kind"], "synthetic_local_adapter_regression")

  def test_empty_corpus_is_ungraded(self) -> None:
    with tempfile.TemporaryDirectory() as temporary:
      path = Path(temporary) / "empty.json"
      atomic_write_json(path, {"schema_version": 1, "cases": []})
      report = evaluate(path)
      self.assertIsNone(report["improvement_rate"])
      self.assertIsNone(report["issue_reduction_rate"])
      self.assertIsNone(report["canon_error_rate"])


if __name__ == "__main__":
  unittest.main()
