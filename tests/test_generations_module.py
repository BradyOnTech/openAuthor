from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from openauthor.ai import generate_proposal
from openauthor.generations import (
  clear_pinned_generation_run,
  get_generation_run,
  get_generation_runtime_config,
  list_generation_runs,
  list_pinned_generation_runs,
  rerun_generation,
  set_pinned_generation_run,
)
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.retrieval import build_retrieval_index
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
      self.assertIn("retrieval_mode", rows[0])
      self.assertIn("retrieval_used", rows[0])
      self.assertIn("retrieval_result_count", rows[0])
      self.assertFalse(rows[0]["preferred_for_scene"])

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
      self.assertFalse(details["preferred_for_scene"])

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
      self.assertIn("budget", runtime)

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
      build_retrieval_index(paths)

      first = generate_proposal(
        paths,
        scene_id="scene-0001",
        instruction="tighten pacing",
        provider="local",
        retrieval_mode="required",
      )
      rerun = rerun_generation(paths, run_id=first["generation"]["id"])

      self.assertNotEqual(first["id"], rerun["id"])
      self.assertEqual(rerun["scene_id"], "scene-0001")
      self.assertEqual(rerun["source"], "ai_generate")
      self.assertEqual(rerun["generation"]["provider"], "local")
      self.assertNotEqual(first["generation"]["id"], rerun["generation"]["id"])
      self.assertEqual(rerun["generation"]["retrieval"]["mode"], "required")

  def test_pin_generation_run_for_scene(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Generations Pins")

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

      proposal_one = generate_proposal(
        paths,
        scene_id="scene-0001",
        instruction="tighten pacing",
        provider="local",
      )
      proposal_two = generate_proposal(
        paths,
        scene_id="scene-0002",
        instruction="tighten pacing",
        provider="local",
      )

      run_one = proposal_one["generation"]["id"]
      run_two = proposal_two["generation"]["id"]
      pinned = set_pinned_generation_run(
        paths,
        scene_id="scene-0001",
        run_id=run_one,
      )
      self.assertEqual(pinned["scene_id"], "scene-0001")
      self.assertEqual(pinned["run_id"], run_one)

      with self.assertRaises(OpenAuthorError):
        set_pinned_generation_run(
          paths,
          scene_id="scene-0001",
          run_id=run_two,
        )

      pins = list_pinned_generation_runs(paths)
      self.assertEqual(pins, [{"scene_id": "scene-0001", "run_id": run_one}])
      filtered_pins = list_pinned_generation_runs(paths, scene_id="scene-0001")
      self.assertEqual(filtered_pins, [{"scene_id": "scene-0001", "run_id": run_one}])

      run_rows = list_generation_runs(paths, scene_id="scene-0001")
      self.assertEqual(len(run_rows), 1)
      self.assertTrue(run_rows[0]["preferred_for_scene"])

      run_details = get_generation_run(paths, run_one)
      self.assertTrue(run_details["preferred_for_scene"])

      cleared = clear_pinned_generation_run(paths, scene_id="scene-0001")
      self.assertTrue(cleared["cleared"])
      self.assertEqual(cleared["run_id"], run_one)
      self.assertEqual(list_pinned_generation_runs(paths), [])


if __name__ == "__main__":
  unittest.main()
