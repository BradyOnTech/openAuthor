import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from openauthor.planning import add_act, add_beat, add_chapter, assign_scene, get_plan_workspace, get_manuscript_reading, update_brief, update_scene_metadata
from openauthor.project import initialize_project, OpenAuthorError
from openauthor.scenes import add_scene
from openauthor.style_profile import PRESETS
from openauthor.writing_voice import preview_voice, review_voice_preview, voice_workspace


class SessionContinuityTests(unittest.TestCase):
  def setUp(self):
    directory = tempfile.TemporaryDirectory()
    self.addCleanup(directory.cleanup)
    self.paths = initialize_project(Path(directory.name), name="Continuity")
    add_scene(self.paths, title="Gate", body="Mara waited at the gate.")

  def test_scope_is_transient_and_matches_reading_and_voice(self):
    plan = get_plan_workspace(self.paths)
    self.assertEqual(plan["workspace"], get_manuscript_reading(self.paths)["workspace"])
    self.assertEqual(plan["workspace"], voice_workspace(self.paths)["scope"])
    self.assertNotIn("workspace", json.loads(self.paths.structure_file.read_text()))

  def test_restored_brief_checks_its_original_value_not_an_unrelated_structure_edit(self):
    plan = get_plan_workspace(self.paths)
    version = {"workspace": plan["workspace"], "value": plan["brief"]}
    add_act(self.paths, title="Act one")
    update_brief(self.paths, synopsis="First writer", themes=["Trust"], expected_version=version)
    before = self.paths.structure_file.read_bytes()
    with self.assertRaisesRegex(OpenAuthorError, "changed since"):
      update_brief(self.paths, synopsis="Stale recovery", expected_version=version)
    self.assertEqual(before, self.paths.structure_file.read_bytes())

  def test_storyline_switch_blocks_all_guarded_plan_writes_before_mutation(self):
    plan = get_plan_workspace(self.paths)
    before = self.paths.structure_file.read_bytes()
    actions = [
      lambda: update_brief(self.paths, synopsis="Wrong branch", expected_version={"workspace": "other", "value": plan["brief"]}),
      lambda: add_act(self.paths, title="Wrong branch", expected_workspace="other"),
      lambda: add_chapter(self.paths, act_id="missing", title="Wrong branch", expected_workspace="other"),
      lambda: add_beat(self.paths, scene_id="scene-0001", summary="Wrong branch", expected_workspace="other"),
      lambda: assign_scene(self.paths, scene_id="scene-0001", chapter_id=None, expected_workspace="other"),
    ]
    for action in actions:
      with self.assertRaisesRegex(OpenAuthorError, "Storyline"):
        action()
      self.assertEqual(before, self.paths.structure_file.read_bytes())

  def test_metadata_recovery_cannot_overwrite_newer_labels(self):
    plan = get_plan_workspace(self.paths)
    baseline = {"timeline_position": "", "labels": []}
    version = {"workspace": plan["workspace"], "value": baseline}
    update_scene_metadata(self.paths, scene_id="scene-0001", labels=["First"], expected_version=version)
    before = self.paths.structure_file.read_bytes()
    with self.assertRaisesRegex(OpenAuthorError, "changed since"):
      update_scene_metadata(self.paths, scene_id="scene-0001", labels=["Stale"], expected_version=version)
    self.assertEqual(before, self.paths.structure_file.read_bytes())

  def test_cli_clears_themes_and_labels_and_forwards_preconditions(self):
    def command(args):
      return subprocess.run([sys.executable, "-m", "openauthor", *args, "--json"], cwd=self.paths.root, env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])}, capture_output=True, text=True)
    plan = get_plan_workspace(self.paths)
    version = {"workspace": plan["workspace"], "value": plan["brief"]}
    update_brief(self.paths, themes=["Trust"])
    failure = command(["plan", "brief", "--synopsis", "Stale", "--expected-version", json.dumps(version)])
    self.assertNotEqual(failure.returncode, 0)
    for args in (["plan", "brief", "--clear-themes"], ["plan", "scene-meta", "--scene", "scene-0001", "--clear-labels"]):
      result = command(args)
      self.assertEqual(result.returncode, 0, result.stderr)
    self.assertEqual(get_plan_workspace(self.paths)["brief"]["themes"], [])

  def test_assessment_baseline_conflicts_are_per_direction_and_do_not_change_prose(self):
    record = preview_voice(self.paths, request={"scene_id": "scene-0001", "source_text": "Mara waited at the gate.", "directions": PRESETS[:2]})
    baseline = {"ratings": {}, "notes": ""}
    first = {"ratings": {"voice_fit": "works"}, "notes": "First reader"}
    review_voice_preview(self.paths, preview_id=record["id"], direction_id="direction-1", review=first, expected_review=baseline)
    review_voice_preview(self.paths, preview_id=record["id"], direction_id="direction-2", review=first, expected_review=baseline)
    with self.assertRaisesRegex(OpenAuthorError, "saved elsewhere"):
      review_voice_preview(self.paths, preview_id=record["id"], direction_id="direction-1", review={**first, "notes": "Stale"}, expected_review=baseline)
    self.assertEqual(voice_workspace(self.paths)["previews"][0]["directions"][0]["author_review"], first)
