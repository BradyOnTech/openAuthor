from __future__ import annotations

import json
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from openauthor.ai import generate_proposal, generate_proposal_draft, preview_proposal_generation, preview_proposal_revision
from openauthor.codex import add_entity
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.proposals import apply_proposal, get_proposal, undo_proposal
from openauthor.scenes import add_scene, get_scene
from openauthor.selection_editing import preview_selection
from openauthor.writing_craft import validate_scene_contract, writing_craft


class WritingCraftTests(unittest.TestCase):
  def setUp(self):
    self.tmp = tempfile.TemporaryDirectory()
    self.addCleanup(self.tmp.cleanup)
    self.paths = initialize_project(Path(self.tmp.name), name="Fiction craft")
    add_scene(self.paths, title="Permit", pov="Mara", body="Mara began to unfold the map. The permit was unopened.\n\nShe stopped before the seal.")
    self.contract = {"purpose": "Test Mara's trust in the courier.", "turn": "She chooses to wait.", "ending": "Stop before the seal; the contents remain unknown."}

  def test_plan_and_draft_keep_authored_intent_and_record_actual_kit(self):
    before = get_scene(self.paths, "scene-0001")["body"]
    args = dict(scene_id="scene-0001", instruction="[Editorial Pass: Dialogue] Tighten the opening.", scene_contract=self.contract)
    preview = preview_proposal_generation(self.paths, **args)
    planned = generate_proposal(self.paths, **args, expected_context_fingerprint=preview["fingerprint"])
    draft_preview = preview_proposal_revision(self.paths, proposal_id=planned["id"])
    self.assertEqual(draft_preview["context"]["scene_contract"], self.contract)
    self.assertEqual(planned["revision_intent"]["scene_contract"], self.contract)
    self.assertIn("references/dialogue.md", preview["context"]["writing_craft"]["resources"])
    self.assertIn("references/dialogue.md", draft_preview["context"]["writing_craft"]["resources"])
    drafted = generate_proposal_draft(self.paths, proposal_id=planned["id"], expected_context_fingerprint=draft_preview["fingerprint"])
    self.assertEqual(drafted["draft"]["writing_craft"], draft_preview["context"]["writing_craft"])
    log = json.loads((self.paths.root / drafted["draft"]["log_path"]).read_text())
    self.assertEqual(log["prompt_sha256"], hashlib.sha256((draft_preview["system_prompt"] + "\n\n" + draft_preview["user_prompt"]).encode()).hexdigest())
    self.assertEqual(log["context"]["scene_contract"], self.contract)
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"], before)
    apply_proposal(self.paths, proposal_id=planned["id"])
    self.assertNotEqual(get_scene(self.paths, "scene-0001")["body"], before)
    undo_proposal(self.paths, proposal_id=planned["id"])
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"], before)

  def test_craft_resource_change_invalidates_review_before_any_provider_call(self):
    args = dict(scene_id="scene-0001", instruction="Tighten the opening.", provider="openai")
    preview = preview_proposal_generation(self.paths, **args)
    original = writing_craft
    def updated(*a, **kw):
      result = original(*a, **kw)
      result["manifest"]["sha256"] = "updated kit content"
      return result
    with patch("openauthor.writing_craft.writing_craft", side_effect=updated), patch("openauthor.ai._call_provider") as provider:
      with self.assertRaisesRegex(OpenAuthorError, "context changed"):
        generate_proposal(self.paths, **args, expected_context_fingerprint=preview["fingerprint"])
      provider.assert_not_called()
    self.assertEqual(list(self.paths.proposals_dir.glob("*.json")), [])

  def test_task_references_are_selective_and_contract_cannot_be_clipped(self):
    plan = writing_craft("plan", direction="[Editorial Pass: Setup & Payoff] preserve the delayed reveal")
    critique = writing_craft("critique", focus="character-knowledge")
    self.assertIn("references/setup-payoff.md", plan["manifest"]["resources"])
    self.assertNotIn("references/dialogue.md", plan["manifest"]["resources"])
    self.assertIn("references/viewpoint.md", critique["manifest"]["resources"])
    self.assertNotEqual(plan["manifest"]["sha256"], critique["manifest"]["sha256"])
    for invalid in [{"canon": "invented"}, {"purpose": False}, {"turn": "a" * 1201}, {key: "a" * 1100 for key in self.contract}]:
      with self.subTest(invalid=list(invalid)):
        with self.assertRaises(OpenAuthorError):
          validate_scene_contract(invalid)
    with self.assertRaises(OpenAuthorError):
      writing_craft("../../secret")
    self.assertEqual(validate_scene_contract({"word_range": [500, 700]}), {"word_range": [500, 700]})
    for invalid in [[True, 500], [500, 400], [0, 500], [500, 20001], ["500", 700], [500]]:
      with self.subTest(range=invalid), self.assertRaises(OpenAuthorError):
        validate_scene_contract({"word_range": invalid})

  def test_selection_craft_does_not_widen_book_access(self):
    add_entity(self.paths, kind="character", name="Mara", description="ASK_CHARACTER", ai_visibility="ask", notes="PRIVATE_SCRATCH")
    add_entity(self.paths, kind="lore", name="Unopened", description="NEVER_SHARE", ai_visibility="exclude")
    body = get_scene(self.paths, "scene-0001")["body"]
    preview = preview_selection(self.paths, scene_id="scene-0001", start=0, end=len(body), selected_text=body, action="critique", review_focus="character-knowledge")
    self.assertIn("references/viewpoint.md", preview["context"]["writing_craft"]["resources"])
    for hidden in ["ASK_CHARACTER", "PRIVATE_SCRATCH", "NEVER_SHARE"]:
      self.assertNotIn(hidden, preview["user_prompt"])
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"], body)

  def test_changed_authored_intent_requires_a_new_preview(self):
    args = dict(scene_id="scene-0001", instruction="Tighten the opening.", provider="openai", scene_contract=self.contract)
    preview = preview_proposal_generation(self.paths, **args)
    with patch("openauthor.ai._call_provider") as provider:
      with self.assertRaisesRegex(OpenAuthorError, "context changed"):
        generate_proposal(self.paths, **{**args, "scene_contract": {**self.contract, "turn": "She opens it."}}, expected_context_fingerprint=preview["fingerprint"])
      provider.assert_not_called()


if __name__ == "__main__":
  unittest.main()
