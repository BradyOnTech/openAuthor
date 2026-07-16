from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from openauthor.planning import (
  add_act,
  add_beat,
  add_chapter,
  add_scene_note,
  assign_scene,
  get_plan,
  preview_scene_move,
  update_brief,
  update_scene_metadata,
)
from openauthor.project import initialize_project
from openauthor.scenes import add_scene


class PlanningModuleTests(unittest.TestCase):
  def test_project_brief_and_hierarchy_are_portable_and_ordered(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Planned Novel")
      add_scene(paths, title="Arrival")
      add_scene(paths, title="Choice")
      update_brief(
        paths,
        synopsis="A courier opens a forbidden gate.",
        genre="Fantasy",
        themes=["Trust", "Power"],
        style_guide="Close third person, past tense.",
      )
      act = add_act(paths, title="Act I")
      chapter = add_chapter(paths, act_id=act["id"], title="The Gate")
      assign_scene(paths, scene_id="scene-0002", chapter_id=chapter["id"])
      assign_scene(paths, scene_id="scene-0001", chapter_id=chapter["id"], before_scene_id="scene-0002")
      beat = add_beat(paths, scene_id="scene-0001", summary="Mara accepts the key.")
      note = add_scene_note(paths, scene_id="scene-0001", title="Revision thought", content="Let the choice cost Mara something.", source="assistant")

      plan = get_plan(paths)
      self.assertEqual(plan["brief"]["genre"], "Fantasy")
      self.assertEqual(plan["acts"][0]["chapters"][0]["scene_ids"], ["scene-0001", "scene-0002"])
      self.assertEqual(plan["beats"][0]["id"], beat["id"])
      self.assertEqual(plan["notes"][0]["id"], note["id"])
      self.assertTrue(paths.structure_file.exists())

  def test_scene_metadata_and_move_preview_explain_structural_consequences(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Structural Preview")
      add_scene(paths, title="Before")
      add_scene(paths, title="Turning Point")
      add_scene(paths, title="After")
      first = add_act(paths, title="Act I")
      second = add_act(paths, title="Act II")
      opening = add_chapter(paths, act_id=first["id"], title="Opening")
      aftermath = add_chapter(paths, act_id=second["id"], title="Aftermath")
      assign_scene(paths, scene_id="scene-0001", chapter_id=opening["id"])
      assign_scene(paths, scene_id="scene-0002", chapter_id=opening["id"])
      assign_scene(paths, scene_id="scene-0003", chapter_id=aftermath["id"])
      update_scene_metadata(
        paths,
        scene_id="scene-0002",
        timeline_position="Day 2, dusk",
        labels=["turning point", "Mara"],
      )
      update_scene_metadata(
        paths,
        scene_id="scene-0003",
        timeline_position="Day 3, dawn",
      )

      preview = preview_scene_move(
        paths,
        scene_id="scene-0002",
        chapter_id=aftermath["id"],
        before_scene_id="scene-0003",
      )

      self.assertEqual(preview["to"]["chapter_title"], "Aftermath")
      self.assertIn("act boundary", " ".join(preview["warnings"]))
      self.assertIn("story time", " ".join(preview["warnings"]).lower())
      plan = get_plan(paths)
      self.assertEqual(plan["scene_metadata"]["scene-0002"]["labels"], ["turning point", "Mara"])
      self.assertEqual(plan["acts"][0]["chapters"][0]["scene_ids"], ["scene-0001", "scene-0002"])

  def test_schema_one_plan_migrates_without_losing_structure(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Legacy Plan")
      add_scene(paths, title="Legacy Scene")
      paths.structure_file.write_text(
        '{"schema_version":1,"brief":{"synopsis":"","genre":"","themes":[],"style_guide":"","outline":""},"acts":[],"unassigned_scene_ids":["scene-0001"],"beats":[],"notes":[]}\n',
        encoding="utf-8",
      )

      plan = get_plan(paths)

      self.assertEqual(plan["schema_version"], 2)
      self.assertEqual(plan["unassigned_scene_ids"], ["scene-0001"])
      self.assertEqual(plan["scene_metadata"], {})


if __name__ == "__main__":
  unittest.main()
