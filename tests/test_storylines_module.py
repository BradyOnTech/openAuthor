from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

from openauthor.git_ops import create_snapshot
from openauthor.canon import add_open_question
from openauthor.project import initialize_project
from openauthor.scenes import add_scene, get_scene, update_scene
from openauthor.storylines import (
  compare_storyline,
  create_storyline,
  create_storyline_integration_changes,
  duplicate_storyline,
  list_storylines,
  switch_storyline,
  update_storyline_status,
  rename_storyline,
)


@unittest.skipUnless(shutil.which("git"), "Storyline adapter requires git")
class StorylineTests(unittest.TestCase):
  def test_switch_preserves_new_primary_writing_without_manual_git_snapshot(self) -> None:
    with tempfile.TemporaryDirectory() as temporary:
      paths = initialize_project(Path(temporary), name="Primary safety")
      add_scene(paths, title="Opening", body="Original Primary")
      alternate = create_storyline(paths, name="Alternate", hypothesis="Try another ending")
      update_scene(paths, scene_identifier="scene-0001", body="Alternate prose")
      switch_storyline(paths, primary=True)
      update_scene(paths, scene_identifier="scene-0001", body="Revised Primary")
      switch_storyline(paths, alternate["id"])
      self.assertEqual(get_scene(paths, "scene-0001")["body"].strip(), "Alternate prose")
      switch_storyline(paths, primary=True)
      self.assertEqual(get_scene(paths, "scene-0001")["body"].strip(), "Revised Primary")

  def test_experiment_compare_and_selective_integration_become_change_sets(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Storylines")
      add_scene(paths, title="Ending", body="Mara closes the gate and goes home.")
      storyline = create_storyline(
        paths,
        name="Mara stays behind",
        hypothesis="The ending is stronger if Mara chooses the city over home.",
        intended_scope="Final scene",
        success_criteria="Her sacrifice feels chosen rather than imposed.",
        protected_constraints=["The gate remains closed"],
      )
      update_scene(paths, scene_identifier="scene-0001", body="Mara closes the gate and stays to rebuild the city.")
      add_open_question(paths, question="Will Mara become the city's new keeper?", scene_id="scene-0001")
      create_snapshot(paths, "Explore the alternate ending")

      dashboard = list_storylines(paths)
      self.assertTrue(dashboard["storylines"][0]["current"])
      self.assertEqual(dashboard["storylines"][0]["divergence"]["changed_scenes"], 1)
      comparison = compare_storyline(paths, storyline["id"])
      self.assertEqual(comparison["scenes"][0]["title"], "Ending")
      self.assertNotEqual(comparison["word_count_delta"], 0)
      self.assertEqual(len(comparison["semantic_delta"]["open_questions"]["added"]), 1)
      self.assertEqual(comparison["impact_analysis"]["after"]["changed_scene_count"], 1)

      switch_storyline(paths, primary=True)
      integration = create_storyline_integration_changes(
        paths,
        storyline["id"],
        scene_paths=[comparison["scenes"][0]["path"]],
      )
      self.assertEqual(integration["proposal_count"], 1)
      proposal = integration["proposals"][0]
      self.assertEqual(proposal["source"], "storyline_integration")
      self.assertGreaterEqual(len(proposal["change_set"]["hunks"]), 1)
      archived = update_storyline_status(paths, storyline["id"], status="archived")
      self.assertEqual(archived["status"], "archived")
      restored = update_storyline_status(paths, storyline["id"], status="active")
      self.assertEqual(restored["status"], "active")
      renamed = rename_storyline(paths, storyline["id"], name="Mara builds a new order")
      self.assertEqual(renamed["name"], "Mara builds a new order")
      duplicate = duplicate_storyline(paths, storyline["id"], name="Mara founds a council")
      self.assertNotEqual(duplicate["branch"], renamed["branch"])


if __name__ == "__main__":
  unittest.main()
