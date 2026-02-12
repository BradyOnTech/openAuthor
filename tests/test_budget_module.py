from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from openauthor.ai import generate_proposal
from openauthor.budget import (
  BudgetPolicyError,
  enforce_generation_budget,
  get_generation_budget_report,
  reset_generation_budget_policy,
  summarize_generation_usage,
  update_generation_budget_policy,
)
from openauthor.project import initialize_project
from openauthor.scenes import add_scene


class BudgetModuleTests(unittest.TestCase):
  def test_budget_policy_update_and_reset(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Budget Policy")

      updated = update_generation_budget_policy(
        paths,
        max_total_tokens=1200,
        daily_tokens=5000,
        weekly_tokens=12000,
      )
      self.assertEqual(updated["per_run"]["max_total_tokens"], 1200)
      self.assertEqual(updated["rolling"]["daily_tokens"], 5000)
      self.assertEqual(updated["rolling"]["weekly_tokens"], 12000)

      reset = reset_generation_budget_policy(paths)
      self.assertIsNone(reset["per_run"]["max_total_tokens"])
      self.assertIsNone(reset["rolling"]["daily_tokens"])
      self.assertIsNone(reset["rolling"]["weekly_tokens"])

  def test_budget_usage_report_tracks_windows(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Budget Usage")
      add_scene(
        paths,
        title="Scene One",
        summary="",
        pov="",
        status="draft",
        body="Scene body for budget usage tracking and reporting checks.",
      )

      generate_proposal(
        paths,
        scene_id="scene-0001",
        instruction="tighten pacing",
        provider="local",
      )
      report = get_generation_budget_report(paths)
      daily = report["usage"]["daily"]
      weekly = report["usage"]["weekly"]
      self.assertGreaterEqual(daily["runs"], 1)
      self.assertGreaterEqual(weekly["runs"], 1)
      self.assertGreaterEqual(daily["total_tokens"], 1)
      self.assertGreaterEqual(weekly["total_tokens"], 1)

  def test_enforce_generation_budget_raises_on_violation(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Budget Enforcement")
      update_generation_budget_policy(paths, max_output_tokens=64)

      with self.assertRaises(BudgetPolicyError):
        enforce_generation_budget(
          paths,
          projected_input_tokens=20,
          projected_output_tokens=128,
          projected_estimated_cost_usd=0.001,
        )

  def test_rolling_token_budget_blocks_after_usage(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Budget Rolling")
      add_scene(
        paths,
        title="Scene One",
        summary="",
        pov="",
        status="draft",
        body="Scene body for rolling token budget validation checks.",
      )
      generate_proposal(
        paths,
        scene_id="scene-0001",
        instruction="tighten pacing and keep continuity",
        provider="local",
      )
      usage = summarize_generation_usage(paths)
      current_daily_tokens = int(usage["daily"]["total_tokens"])
      update_generation_budget_policy(paths, daily_tokens=current_daily_tokens + 1)

      with self.assertRaises(BudgetPolicyError):
        enforce_generation_budget(
          paths,
          projected_input_tokens=10,
          projected_output_tokens=10,
          projected_estimated_cost_usd=0.0,
        )


if __name__ == "__main__":
  unittest.main()
