from __future__ import annotations

import unittest

from openauthor.assistant.budget import (
  BudgetCandidate,
  BudgetPolicy,
  allocate_input_budget,
)


class AssistantBudgetTests(unittest.TestCase):
  def test_global_budget_prioritizes_required_and_high_value_model_input(self) -> None:
    allocation = allocate_input_budget(
      [
        BudgetCandidate(
          candidate_id="policy",
          category="instructions",
          serialized="ssss",
          priority=100,
          required=True,
        ),
        BudgetCandidate(
          candidate_id="current-scene",
          category="evidence",
          serialized="hhh",
          priority=80,
        ),
        BudgetCandidate(
          candidate_id="old-history",
          category="history",
          serialized="llll",
          priority=10,
        ),
      ],
      BudgetPolicy(input_token_ceiling=7),
      estimate_tokens=len,
    )

    self.assertEqual(
      [candidate.candidate_id for candidate in allocation.selected],
      ["policy", "current-scene"],
    )
    self.assertEqual(allocation.used_tokens, 7)
    self.assertEqual(allocation.remaining_tokens, 0)
    self.assertEqual(
      allocation.dropped,
      [
        {
          "candidate_id": "old-history",
          "category": "history",
          "estimated_tokens": 4,
          "reason": "input_token_ceiling",
        }
      ],
    )


if __name__ == "__main__":
  unittest.main()
