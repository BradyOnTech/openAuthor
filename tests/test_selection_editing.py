from __future__ import annotations

import tempfile
import unittest
import json
import io
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

from openauthor.project import OpenAuthorError, initialize_project
from openauthor.scenes import add_scene, get_scene, update_scene
from openauthor.proposals import apply_proposal, apply_proposal_batch, undo_proposal, create_proposal, get_proposal
from openauthor.codex import add_entity, update_entity
from openauthor.selection_editing import preview_selection, generate_selection
from openauthor.ai import generate_proposal_draft


class SelectionEditingTests(unittest.TestCase):
  def setUp(self):
    self.temporary = tempfile.TemporaryDirectory()
    self.addCleanup(self.temporary.cleanup)
    self.paths = initialize_project(Path(self.temporary.name), name="Selection safety")
    add_scene(self.paths, title="Gate", body="🌙 Élodie waited. Mara began to count the lights. Mara began to count the lights.\n\nNobody moved.")
    self.scene = get_scene(self.paths, "scene-0001")
    self.body = self.scene["body"]
    self.selected = "Mara began to count the lights."
    self.start = self.body.rindex(self.selected)
    self.args = dict(scene_id="scene-0001", start=self.start, end=self.start + len(self.selected), selected_text=self.selected, action="shorten", provider="local")

  def test_only_selected_occurrence_changes_after_review_and_undo_is_byte_exact(self):
    original = (self.paths.root / self.scene["path"]).read_bytes()
    preview = preview_selection(self.paths, **self.args)
    proposal = generate_selection(self.paths, **self.args, expected_fingerprint=preview["fingerprint"], request_id="selection-one")
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"], self.body)
    self.assertEqual(proposal["selection"]["before"], self.selected)
    self.assertNotEqual(proposal["selection"]["after"], self.selected)
    expected = self.body[:self.start] + proposal["selection"]["after"] + self.body[self.args["end"]:]
    apply_proposal(self.paths, proposal_id=proposal["id"])
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"], expected)
    undo_proposal(self.paths, proposal_id=proposal["id"])
    self.assertEqual((self.paths.root / self.scene["path"]).read_bytes(), original)

  def test_batch_cannot_bypass_selection_safety(self):
    preview = preview_selection(self.paths, **self.args)
    proposal = generate_selection(self.paths, **self.args, expected_fingerprint=preview["fingerprint"])
    add_scene(self.paths, title="Elsewhere", body="Unchanged prose.")
    other = create_proposal(self.paths, title="Elsewhere", instruction="Revise", scene_id="scene-0002", proposed_body="Changed prose.")
    update_scene(self.paths, scene_identifier="scene-0001", body=self.body + "New writing.")
    with self.assertRaisesRegex(OpenAuthorError, "[Ss]election"):
      apply_proposal_batch(self.paths, proposal_ids=[proposal["id"], other], force=True)

  def test_stale_selection_cannot_force_overwrite_newer_prose(self):
    preview = preview_selection(self.paths, **self.args)
    proposal = generate_selection(self.paths, **self.args, expected_fingerprint=preview["fingerprint"])
    update_scene(self.paths, scene_identifier="scene-0001", body=self.body + "A newer line.")
    with self.assertRaisesRegex(OpenAuthorError, "Select.*again"):
      apply_proposal(self.paths, proposal_id=proposal["id"], force=True)
    self.assertIn("A newer line.", get_scene(self.paths, "scene-0001")["body"])

  def test_critique_is_durable_feedback_never_a_scene_rewrite(self):
    args = {**self.args, "action": "critique"}
    preview = preview_selection(self.paths, **args)
    proposal = generate_selection(self.paths, **args, expected_fingerprint=preview["fingerprint"], request_id="critique-once")
    self.assertIn("Local mechanical review", proposal["selection"]["feedback"])
    self.assertEqual(generate_selection(self.paths, **args, expected_fingerprint=preview["fingerprint"], request_id="critique-once")["id"], proposal["id"])
    with self.assertRaisesRegex(OpenAuthorError, "feedback only"):
      apply_proposal(self.paths, proposal_id=proposal["id"])
    with self.assertRaisesRegex(OpenAuthorError, "selection"):
      generate_proposal_draft(self.paths, proposal_id=proposal["id"])
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"], self.body)
    self.assertEqual(len(list(self.paths.generations_dir.glob("*.json"))), 1)

  def test_cli_preview_then_generate_is_reviewed_and_recoverable(self):
    def run(action, *extra):
      result = subprocess.run([sys.executable, "-m", "openauthor", "proposal", action, "--input-json", json.dumps(self.args), "--json", *extra], cwd=self.paths.root, env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])}, capture_output=True, text=True, check=True)
      return json.loads(result.stdout)
    preview = run("selection-preview")
    proposal = run("selection-generate", "--expected-fingerprint", preview["fingerprint"], "--request-id", "cli-selection")
    self.assertEqual(proposal, run("selection-generate", "--expected-fingerprint", preview["fingerprint"], "--request-id", "cli-selection"))
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"], self.body)

  def test_exact_preview_respects_private_notes_and_one_request_permissions(self):
    entity = add_entity(self.paths, kind="character", name="Mara", description="ASK_CHARACTER", ai_visibility="ask", notes="PRIVATE_NOTE", details=[{"key": "Past", "type": "text", "value": "ASK_PAST", "ai_visibility": "ask"}, {"key": "Future", "type": "text", "value": "NEVER_SHARE", "ai_visibility": "exclude"}])
    args = {**self.args, "memory_approvals": [{"entity_id": entity}, {"entity_id": entity, "detail_key": "Past"}]}
    preview = preview_selection(self.paths, **args)
    proposal = generate_selection(self.paths, **args, expected_fingerprint=preview["fingerprint"])
    log = json.loads((self.paths.root / proposal["generation"]["log_path"]).read_text())
    self.assertEqual(log["user_prompt"], preview["user_prompt"])
    self.assertEqual(log["system_prompt"], preview["system_prompt"])
    self.assertEqual(log["kind"], "selection")
    for allowed in ("ASK_CHARACTER", "ASK_PAST"):
      self.assertIn(allowed, log["user_prompt"])
      self.assertNotIn(allowed, preview_selection(self.paths, **self.args)["user_prompt"])
    for forbidden in ("PRIVATE_NOTE", "NEVER_SHARE"):
      self.assertNotIn(forbidden, log["user_prompt"])
    update_entity(self.paths, entity_id=entity, description="UPDATED_CHARACTER")
    with patch("urllib.request.urlopen") as transport:
      with self.assertRaisesRegex(OpenAuthorError, "context changed"):
        generate_selection(self.paths, **args, expected_fingerprint=preview["fingerprint"])
      transport.assert_not_called()

  def test_other_storyline_with_identical_prose_is_stale(self):
    from openauthor.git_ops import initialize_git, create_snapshot, create_branch
    initialize_git(self.paths)
    create_snapshot(self.paths, "Initial prose")
    preview = preview_selection(self.paths, **self.args)
    proposal = generate_selection(self.paths, **self.args, expected_fingerprint=preview["fingerprint"])
    create_branch(self.paths, name="another-direction")
    self.assertTrue(get_proposal(self.paths, proposal["id"])["stale"])
    with self.assertRaisesRegex(OpenAuthorError, "book version changed"):
      apply_proposal(self.paths, proposal_id=proposal["id"], force=True)

  def test_undo_cannot_force_overwrite_newer_writing(self):
    preview = preview_selection(self.paths, **self.args)
    proposal = generate_selection(self.paths, **self.args, expected_fingerprint=preview["fingerprint"])
    apply_proposal(self.paths, proposal_id=proposal["id"])
    update_scene(self.paths, scene_identifier="scene-0001", body="My later scene.")
    with self.assertRaisesRegex(OpenAuthorError, "protect newer writing"):
      undo_proposal(self.paths, proposal_id=proposal["id"], force=True)
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"].strip(), "My later scene.")

  def test_remote_actions_send_reviewed_prompt_and_preserve_surrounding_prose(self):
    for action, output in (("rewrite", "Mara counted the lights."), ("shorten", "Mara counted lights."), ("expand", "Mara counted the lights, careful not to skip a single one."), ("critique", "The phrase ‘began to count’ delays the action; consider a direct verb.")):
      with self.subTest(action=action):
        args = {**self.args, "action": action, "provider": "openai"}
        preview = preview_selection(self.paths, **args)
        response = {"choices": [{"message": {"content": output}}], "usage": {"prompt_tokens": 200, "completion_tokens": 30}}
        with patch.dict(os.environ, {"OPENAI_API_KEY": "synthetic-test-key"}), patch("urllib.request.urlopen", return_value=io.BytesIO(json.dumps(response).encode())) as transport:
          proposal = generate_selection(self.paths, **args, expected_fingerprint=preview["fingerprint"], request_id="remote-" + action)
          sent = json.loads(transport.call_args.args[0].data)
          self.assertEqual(sent["messages"][0]["content"], preview["system_prompt"])
          self.assertEqual(sent["messages"][-1]["content"], preview["user_prompt"])
          self.assertEqual(generate_selection(self.paths, **args, expected_fingerprint=preview["fingerprint"], request_id="remote-" + action)["id"], proposal["id"])
          self.assertEqual(transport.call_count, 1)
        self.assertEqual(get_scene(self.paths, "scene-0001")["body"], self.body)
        if action != "critique":
          self.assertEqual(proposal["proposed_body"], self.body[:self.start] + output + self.body[self.args["end"]:])

  def test_edit_during_provider_request_preserves_author_prose_and_logs_response(self):
    args = {**self.args, "provider": "openai"}
    preview = preview_selection(self.paths, **args)
    def provider_reply(*unused, **kwargs):
      update_scene(self.paths, scene_identifier="scene-0001", body=self.body + "Later writing.")
      return io.BytesIO(json.dumps({"choices": [{"message": {"content": "Mara counted lights."}}], "usage": {"prompt_tokens": 200, "completion_tokens": 10}}).encode())
    with patch.dict(os.environ, {"OPENAI_API_KEY": "synthetic-test-key"}), patch("urllib.request.urlopen", side_effect=provider_reply):
      with self.assertRaisesRegex(OpenAuthorError, "changed while generating"):
        generate_selection(self.paths, **args, expected_fingerprint=preview["fingerprint"])
    self.assertIn("Later writing.", get_scene(self.paths, "scene-0001")["body"])
    self.assertEqual(list(self.paths.proposals_dir.glob("*.json")), [])
    log = json.loads(next(self.paths.generations_dir.glob("*.json")).read_text())
    self.assertEqual(log["response_text"], "Mara counted lights.")

  def test_invalid_and_oversized_ranges_never_start_a_provider_request(self):
    invalid = [
      {**self.args, "start": -1}, {**self.args, "start": self.start + 1},
      {**self.args, "end": self.start}, {**self.args, "selected_text": "Different passage"},
      {**self.args, "instruction": "x" * 2001}, {**self.args, "action": "expand"},
    ]
    with patch("urllib.request.urlopen") as transport:
      for args in invalid:
        with self.subTest(args=args), self.assertRaises(OpenAuthorError):
          preview_selection(self.paths, **args)
      transport.assert_not_called()

  def test_preview_discloses_truncated_surroundings_and_omitted_memory(self):
    body = "A" * 2400 + self.selected + "B" * 2600
    update_scene(self.paths, scene_identifier="scene-0001", body=body)
    large = add_entity(self.paths, kind="lore", name="Long source", description="C" * 15000)
    preview = preview_selection(self.paths, **{**self.args, "start": 2400, "end": 2400 + len(self.selected)})
    self.assertEqual(preview["limits"]["omitted_before_characters"], 400)
    self.assertGreaterEqual(preview["limits"]["omitted_after_characters"], 600)
    self.assertIn(large, preview["limits"]["omitted_memory_ids"])
    self.assertLessEqual(len(preview["system_prompt"]) + len(preview["user_prompt"]), 40000)
