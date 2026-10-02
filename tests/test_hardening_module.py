from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from openauthor.ai import generate_proposal
from openauthor.generations import audit_generation_pins, set_pinned_generation_run
from openauthor.git_ops import initialize_git
from openauthor.hardening import (
  audit_workspace_metadata,
  collect_performance_baseline,
  collect_startup_health,
)
from openauthor.project import initialize_project
from openauthor.proposals import create_proposal
from openauthor.retrieval import build_retrieval_index
from openauthor.scenes import add_scene, update_scene


class HardeningModuleTests(unittest.TestCase):
  def test_startup_health_reports_and_repairs_safe_foundation_gaps(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Startup Health")
      paths.proposals_dir.rmdir()
      paths.revision_objects_dir.rmdir()
      paths.revision_records_dir.rmdir()
      paths.revisions_dir.rmdir()

      before = collect_startup_health(paths)
      self.assertFalse(before["ready"])
      failed = {row["id"] for row in before["checks"] if row["status"] == "error"}
      self.assertIn("project_directories", failed)
      self.assertIn("revision_store", failed)

      after = collect_startup_health(paths, repair=True)
      self.assertTrue(after["ready"])
      self.assertTrue(paths.proposals_dir.is_dir())
      repaired = {row["id"] for row in after["checks"] if row["repaired"]}
      self.assertIn("project_directories", repaired)
      self.assertIn("revision_store", repaired)

  def test_collect_performance_baseline_returns_metrics(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Perf Baseline")
      initialize_git(paths)

      add_scene(
        paths,
        title="Perf Scene",
        summary="",
        pov="",
        status="draft",
        body="Mara's eyes were blue. Mara's eyes were green.",
      )
      create_proposal(
        paths,
        title="Perf Proposal",
        instruction="Tighten sentence cadence.",
        scene_id="scene-0001",
      )

      report = collect_performance_baseline(paths, repeat=2)
      self.assertEqual(report["repeat"], 2)
      self.assertEqual(report["counts"]["scenes"], 1)
      self.assertEqual(report["counts"]["proposals"], 1)
      self.assertEqual(report["counts"]["generation_runs"], 0)

      metric_names = {row["name"] for row in report["metrics"]}
      self.assertIn("scene_list", metric_names)
      self.assertIn("proposal_list", metric_names)
      self.assertIn("generation_list", metric_names)
      self.assertIn("retrieval_status", metric_names)
      self.assertIn("project_load", metric_names)
      self.assertIn("scene_open", metric_names)
      self.assertIn("scene_save", metric_names)
      self.assertIn("project_search", metric_names)
      self.assertIn("continuity_analysis", metric_names)
      self.assertIn("story_continuity_analysis", metric_names)
      self.assertEqual(report["counts"]["story_continuity_issues"], 1)
      for row in report["metrics"]:
        self.assertEqual(len(row["samples_ms"]), 2)
        self.assertGreaterEqual(row["max_ms"], row["min_ms"])

  def test_workspace_audit_detects_and_repairs_stale_pins(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Workspace Audit")
      initialize_git(paths)

      add_scene(
        paths,
        title="Audit Scene",
        summary="",
        pov="",
        status="draft",
        body="Scene body for workspace audit checks.",
      )
      proposal = generate_proposal(
        paths,
        scene_id="scene-0001",
        instruction="Tighten pacing while preserving voice.",
        provider="local",
      )
      run_id = proposal["generation"]["id"]
      set_pinned_generation_run(paths, scene_id="scene-0001", run_id=run_id)
      (paths.generations_dir / f"{run_id}.json").unlink()

      build_retrieval_index(paths)
      update_scene(
        paths,
        scene_identifier="scene-0001",
        summary="Summary changed after index build.",
      )

      report_before = audit_workspace_metadata(paths, repair=False)
      issue_codes = {row["code"] for row in report_before["issues"]}
      self.assertIn("generation_pins_stale", issue_codes)
      self.assertIn("retrieval_index_stale", issue_codes)
      self.assertFalse(report_before["ok"])

      report_after = audit_workspace_metadata(paths, repair=True)
      self.assertTrue(report_after["generation_pins"]["repair_applied"])
      self.assertEqual(report_after["generation_pins"]["repaired_count"], 1)
      pins_after = audit_generation_pins(paths, repair=False)
      self.assertEqual(pins_after["stale"], 0)


if __name__ == "__main__":
  unittest.main()
