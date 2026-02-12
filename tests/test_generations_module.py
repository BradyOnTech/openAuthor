from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from openauthor.ai import generate_proposal
from openauthor.generations import (
  get_generation_run,
  get_generation_runtime_config,
  list_generation_runs,
  rerun_generation,
)
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.scenes import add_scene


class GenerationsModuleTests(unittest.TestCase):
  def test_list_and_get_generation_runs(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Generations Demo")

      add_scene(
        paths,
        title="One",
        summary="",
        pov="",
        status="draft",
        body="Scene one body with enough words for generation context checks.",
      )
      add_scene(
        paths,
        title="Two",
        summary="",
        pov="",
        status="draft",
        body="Scene two body with enough words for generation context checks.",
      )

      proposal = generate_proposal(
        paths,
        scene_id="scene-0001",
        instruction="tighten pacing",
        provider="local",
      )
      run_id = proposal["generation"]["id"]

      rows = list_generation_runs(paths)
      self.assertEqual(len(rows), 1)
      self.assertEqual(rows[0]["run_id"], run_id)
      self.assertEqual(rows[0]["status"], "succeeded")
      self.assertEqual(rows[0]["proposal_id"], proposal["id"])
      self.assertIn("normalization_changed", rows[0])
      self.assertIn("missing_sections_filled", rows[0])
      self.assertIn("quality_score", rows[0])
      self.assertIn("quality_tier", rows[0])
      self.assertIn("quality_flags", rows[0])

      filtered = list_generation_runs(paths, status="succeeded", scene_id="scene-0001")
      self.assertEqual(len(filtered), 1)
      self.assertEqual(filtered[0]["run_id"], run_id)
      quality_filtered = list_generation_runs(
        paths,
        quality_tier=rows[0]["quality_tier"],
      )
      self.assertEqual(len(quality_filtered), 1)
      self.assertEqual(quality_filtered[0]["run_id"], run_id)

      details = get_generation_run(paths, run_id)
      self.assertEqual(details["run_id"], run_id)
      self.assertEqual(details["status"], "succeeded")
      self.assertEqual(details["proposal_id"], proposal["id"])
      self.assertIn("normalized_instruction", details)
      self.assertIn("normalization", details)
      self.assertIn("quality", details)

  def test_generation_run_errors(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Generations Errors")

      with self.assertRaises(OpenAuthorError):
        get_generation_run(paths, "gen-missing")
      with self.assertRaises(OpenAuthorError):
        rerun_generation(paths, run_id="gen-missing")

      with self.assertRaises(OpenAuthorError):
        list_generation_runs(paths, status="invalid")
      with self.assertRaises(OpenAuthorError):
        list_generation_runs(paths, quality_tier="invalid")

      runtime = get_generation_runtime_config(paths)
      self.assertIn("retry", runtime)
      self.assertIn("providers", runtime)
      self.assertIn("openai", runtime["providers"])

  def test_rerun_generation_from_existing_run(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Generations Rerun")

      add_scene(
        paths,
        title="One",
        summary="",
        pov="",
        status="draft",
        body="Scene one body with enough words for generation context checks.",
      )

      first = generate_proposal(
        paths,
        scene_id="scene-0001",
        instruction="tighten pacing",
        provider="local",
      )
      rerun = rerun_generation(paths, run_id=first["generation"]["id"])

      self.assertNotEqual(first["id"], rerun["id"])
      self.assertEqual(rerun["scene_id"], "scene-0001")
      self.assertEqual(rerun["source"], "ai_generate")
      self.assertEqual(rerun["generation"]["provider"], "local")
      self.assertNotEqual(first["generation"]["id"], rerun["generation"]["id"])


if __name__ == "__main__":
  unittest.main()
