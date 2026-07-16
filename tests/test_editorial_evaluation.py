from __future__ import annotations

import unittest

from scripts.evaluate_editorial_passes import evaluate


class EditorialEvaluationTests(unittest.TestCase):
  def test_every_built_in_pass_improves_its_task_without_canon_regression(self) -> None:
    report = evaluate()
    self.assertEqual(report["pass_count"], 7, report)
    self.assertGreaterEqual(report["improvement_rate"], 0.95, report)
    self.assertGreaterEqual(report["issue_reduction_rate"], 0.95, report)
    self.assertEqual(report["canon_errors"], 0, report)


if __name__ == "__main__":
  unittest.main()
