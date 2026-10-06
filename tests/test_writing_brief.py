from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from openauthor.ai import generate_proposal, generate_proposal_draft, preview_proposal_generation, preview_proposal_revision
from openauthor.codex import add_entity
from openauthor.planning import get_plan_workspace, update_scene_metadata
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.scenes import add_scene, get_scene, update_scene


class WritingBriefWorkflowTests(unittest.TestCase):
  def setUp(self):
    temporary = tempfile.TemporaryDirectory()
    self.addCleanup(temporary.cleanup)
    self.paths = initialize_project(Path(temporary.name), name="Writing direction")
    add_scene(self.paths, title="Before", pov="Mara", body="Mara left the courier outside. The seal was intact.")
    add_scene(self.paths, title="Gate", pov="Mara", body="Mara began to count the lamps.\n\nShe kept the seal intact.")
    add_scene(self.paths, title="Later", pov="Courier", body="FUTURE_REVELATION_SENTINEL")
    self.brief = {"purpose": "Test Mara's trust.", "knowledge": "Mara has not read the letter.",
                  "reveal_limits": "Do not reveal its contents.", "character_goals": "The courier wants entry; Mara wants time.",
                  "change_permission": "preserve", "voice_direction": "Concrete observations; no narrator explanation of her motives."}
    update_scene_metadata(self.paths, scene_id="scene-0002", writing_brief=self.brief, timeline_position="Day 2 · before dawn")
    self.original = get_scene(self.paths, "scene-0002")["body"]

  def test_saved_direction_overrides_and_exact_delivery_survive_the_whole_workflow(self):
    args = dict(scene_id="scene-0002", instruction="Tighten the opening.", scene_contract={"turn": "She chooses to wait."})
    preview = preview_proposal_generation(self.paths, **args)
    expected = {**self.brief, "turn": "She chooses to wait."}
    self.assertEqual(preview["context"]["scene_contract"], expected)
    planned = generate_proposal(self.paths, **args, expected_context_fingerprint=preview["fingerprint"])
    # Editing the saved brief later cannot silently change an already planned request.
    update_scene_metadata(self.paths, scene_id="scene-0002", writing_brief={"purpose": "Let the courier inside."})
    draft_preview = preview_proposal_revision(self.paths, proposal_id=planned["id"])
    self.assertEqual(draft_preview["context"]["scene_contract"], expected)
    self.assertEqual(draft_preview["context"]["writing_brief"]["story_time"], "Day 2 · before dawn")
    self.assertIn("The seal was intact.", draft_preview["user_prompt"])
    self.assertNotIn("FUTURE_REVELATION_SENTINEL", draft_preview["user_prompt"])
    drafted = generate_proposal_draft(self.paths, proposal_id=planned["id"], expected_context_fingerprint=draft_preview["fingerprint"])
    log = json.loads((self.paths.root / drafted["draft"]["log_path"]).read_text())
    self.assertEqual(log["user_prompt"], draft_preview["user_prompt"])
    self.assertEqual(log["system_prompt"], draft_preview["system_prompt"])
    self.assertEqual(get_scene(self.paths, "scene-0002")["body"], self.original)

  def test_saved_brief_uses_the_same_conflict_guard_as_other_planning_details(self):
    plan = get_plan_workspace(self.paths)
    expected = {"workspace": plan["workspace"], "value": plan["scene_metadata"]["scene-0002"]}
    update_scene_metadata(self.paths, scene_id="scene-0002", writing_brief={"knowledge": "Mara read the letter."}, expected_version=expected)
    with self.assertRaisesRegex(OpenAuthorError, "changed since"):
      update_scene_metadata(self.paths, scene_id="scene-0002", writing_brief=self.brief, expected_version=expected)
    self.assertEqual(get_plan_workspace(self.paths)["scene_metadata"]["scene-0002"]["writing_brief"], {"knowledge": "Mara read the letter."})

  def test_preceding_excerpt_changes_invalidate_delivery_and_permission_does_not_widen_memory(self):
    hidden = add_entity(self.paths, kind="character", name="Courier", description="HIDDEN_CHARACTER_SENTINEL", ai_visibility="exclude")
    plan = generate_proposal(self.paths, scene_id="scene-0002", instruction="Tighten.")
    preview = preview_proposal_revision(self.paths, proposal_id=plan["id"])
    self.assertNotIn(hidden, [entry["id"] for entry in preview["context"]["codex_entities"]])
    self.assertNotIn("HIDDEN_CHARACTER_SENTINEL", preview["user_prompt"])
    update_scene(self.paths, scene_identifier="scene-0001", body="The seal was broken before Mara arrived.")
    with self.assertRaisesRegex(OpenAuthorError, "context changed"):
      generate_proposal_draft(self.paths, proposal_id=plan["id"], expected_context_fingerprint=preview["fingerprint"])


if __name__ == "__main__":
  unittest.main()
