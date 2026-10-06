from __future__ import annotations

import json
import io
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from openauthor import ai
from openauthor.canon import add_canon_fact
from openauthor.codex import add_entity
from openauthor.planning import update_brief
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.proposals import create_proposal, get_proposal, list_proposals, set_proposal_draft
from openauthor.scenes import add_scene


class RevisionContextTests(unittest.TestCase):
  def setUp(self):
    temporary = tempfile.TemporaryDirectory()
    self.addCleanup(temporary.cleanup)
    self.paths = initialize_project(Path(temporary.name), name="Reviewed revision")
    self.body = "Mara began to count the lanterns. Her left hand had four fingers."
    add_scene(self.paths, title="The Gate", body=self.body)
    update_brief(self.paths, style_guide="STYLE_SENTINEL: terse past tense.")
    self.mara = add_entity(self.paths, kind="character", name="Mara", notes="PRIVATE_NOTE_SENTINEL")
    self.fact = add_canon_fact(self.paths, subject_entity_id=self.mara, predicate="left hand fingers", value="four", evidence=[{"scene_id": "scene-0001", "excerpt": "Her left hand had four fingers."}])
    self.proposal_id = create_proposal(self.paths, title="Tighten", instruction="Tighten without inventing facts.", scene_id="scene-0001", revision_intent={"goal": "Tighten", "constraints": ["CONSTRAINT_SENTINEL: no new objects"], "protected_elements": ["Mara"]})
    self.proposal = set_proposal_draft(self.paths, proposal_id=self.proposal_id, proposed_body="Mara counted the lanterns. Her left hand had four fingers.")
    self.hunk_id = self.proposal["change_set"]["hunks"][0]["id"]

  def test_initial_edit_plan_sends_exact_reviewed_guidance_and_canon(self):
    args = dict(scene_id="scene-0001", instruction="Tighten the scene.", constraints=["CONSTRAINT_SENTINEL"], story_approvals=[self.fact["id"]])
    preview = ai.preview_proposal_generation(self.paths, **args)
    for marker in ("STYLE_SENTINEL", "CONSTRAINT_SENTINEL", self.fact["id"]):
      self.assertIn(marker, preview["user_prompt"])
    self.assertNotIn("PRIVATE_NOTE_SENTINEL", preview["user_prompt"])
    generated = ai.generate_proposal(self.paths, **args, expected_context_fingerprint=preview["fingerprint"])
    log = json.loads((self.paths.root / generated["generation"]["log_path"]).read_text())
    self.assertEqual(log["user_prompt"], preview["user_prompt"])
    self.assertEqual(log["system_prompt"], preview["system_prompt"])

  def test_initial_plan_refuses_unreviewed_or_changed_context_before_and_during_send(self):
    args = dict(scene_id="scene-0001", instruction="Tighten.", provider="openai")
    with patch("urllib.request.urlopen") as transport:
      with self.assertRaisesRegex(OpenAuthorError, "Review context"):
        ai.generate_proposal(self.paths, **args)
      transport.assert_not_called()
    preview = ai.preview_proposal_generation(self.paths, **args)
    update_brief(self.paths, style_guide="New direction.")
    with patch("urllib.request.urlopen") as transport:
      with self.assertRaisesRegex(OpenAuthorError, "context changed"):
        ai.generate_proposal(self.paths, **args, expected_context_fingerprint=preview["fingerprint"])
      transport.assert_not_called()
    preview = ai.preview_proposal_generation(self.paths, **args)
    before = list_proposals(self.paths)
    def provider_response(*_args, **_kwargs):
      update_brief(self.paths, style_guide="Changed during the plan request.")
      return io.BytesIO(json.dumps({"choices": [{"message": {"content": "Intent: Tighten.\nConstraints: Preserve facts.\nEdit Plan: Remove hedging.\nContinuity Notes: No new objects."}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 100, "completion_tokens": 30}}).encode())
    with patch.dict("os.environ", {"OPENAI_API_KEY": "synthetic-test-key"}), patch("urllib.request.urlopen", side_effect=provider_response):
      with self.assertRaisesRegex(OpenAuthorError, "context changed"):
        ai.generate_proposal(self.paths, **args, expected_context_fingerprint=preview["fingerprint"])
    self.assertEqual(list_proposals(self.paths), before)

  def test_cli_initial_plan_retries_the_reviewed_request(self):
    def run(*args):
      result = subprocess.run([sys.executable, "-m", "openauthor", "proposal", *args, "--json"], cwd=self.paths.root,
        env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])}, capture_output=True, text=True, check=True)
      return json.loads(result.stdout)
    inputs = dict(scene_id="scene-0001", instruction="Tighten.", story_approvals=[self.fact["id"]])
    preview = run("generation-preview", "--input-json", json.dumps(inputs))
    args = ("generate", "--scene", "scene-0001", "--instruction", "Tighten.", "--story-approvals", json.dumps([self.fact["id"]]), "--expected-context-fingerprint", preview["fingerprint"], "--request-id", "reviewed-plan")
    first = run(*args)
    self.assertEqual(run(*args), first)
    log = json.loads((self.paths.root / first["generation"]["log_path"]).read_text())
    self.assertEqual(log["user_prompt"], preview["user_prompt"])

  def test_hunk_sends_exact_reviewed_guidance_constraints_and_approved_canon(self):
    args = dict(proposal_id=self.proposal_id, hunk_id=self.hunk_id, provider="local", feedback="Keep the voice.", story_approvals=[self.fact["id"]])
    preview = ai.preview_proposal_revision(self.paths, **args)
    for marker in ("STYLE_SENTINEL", "CONSTRAINT_SENTINEL", self.fact["id"]):
      self.assertIn(marker, preview["user_prompt"])
    self.assertNotIn("PRIVATE_NOTE_SENTINEL", preview["user_prompt"])
    revised = ai.regenerate_change_hunk(self.paths, **args, expected_context_fingerprint=preview["fingerprint"])
    hunk = next(row for row in revised["change_set"]["hunks"] if row["id"] == self.hunk_id)
    log = json.loads((self.paths.root / hunk["regeneration"]["log_path"]).read_text())
    self.assertEqual(log["user_prompt"], preview["user_prompt"])
    self.assertEqual(log["system_prompt"], preview["system_prompt"])

  def test_external_hunk_requests_require_review_and_refuse_guidance_changed_during_generation(self):
    args = dict(proposal_id=self.proposal_id, hunk_id=self.hunk_id, provider="openai")
    with patch("urllib.request.urlopen") as transport:
      with self.assertRaisesRegex(OpenAuthorError, "[Rr]eview"):
        ai.regenerate_change_hunk(self.paths, **args)
      transport.assert_not_called()
    preview = ai.preview_proposal_revision(self.paths, **args)
    update_brief(self.paths, style_guide="New style guidance.")
    with patch("urllib.request.urlopen") as transport:
      with self.assertRaisesRegex(OpenAuthorError, "context changed"):
        ai.regenerate_change_hunk(self.paths, **args, expected_context_fingerprint=preview["fingerprint"])
      transport.assert_not_called()
    preview = ai.preview_proposal_revision(self.paths, **args)
    before = get_proposal(self.paths, self.proposal_id)
    def provider_response(*_args, **_kwargs):
      update_brief(self.paths, style_guide="Guidance changed while the request was running.")
      return io.BytesIO(json.dumps({"choices": [{"message": {"content": "Mara counted the lights."}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 100, "completion_tokens": 8}}).encode())
    with patch.dict("os.environ", {"OPENAI_API_KEY": "synthetic-test-key"}), patch("urllib.request.urlopen", side_effect=provider_response):
      with self.assertRaisesRegex(OpenAuthorError, "context changed"):
        ai.regenerate_change_hunk(self.paths, **args, expected_context_fingerprint=preview["fingerprint"])
    self.assertEqual(get_proposal(self.paths, self.proposal_id), before)

  def test_cli_preview_permissions_match_the_recoverable_hunk_request(self):
    def run(*args):
      result = subprocess.run([sys.executable, "-m", "openauthor", "proposal", *args, "--json"], cwd=self.paths.root,
        env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])}, capture_output=True, text=True, check=True)
      return json.loads(result.stdout)
    inputs = dict(proposal_id=self.proposal_id, hunk_id=self.hunk_id, story_approvals=[self.fact["id"]], temperature=0.5, max_output_tokens=800)
    preview = run("revision-preview", "--input-json", json.dumps(inputs))
    args = ("hunk-regenerate", "--id", self.proposal_id, "--hunk", self.hunk_id, "--story-approvals", json.dumps([self.fact["id"]]), "--expected-context-fingerprint", preview["fingerprint"], "--request-id", "reviewed-hunk", "--temperature", "0.5", "--max-output-tokens", "800")
    first = run(*args)
    self.assertEqual(run(*args), first)
    hunk = next(row for row in first["change_set"]["hunks"] if row["id"] == self.hunk_id)
    log = json.loads((self.paths.root / hunk["regeneration"]["log_path"]).read_text())
    self.assertEqual(log["user_prompt"], preview["user_prompt"])

  def test_scene_draft_sends_the_reviewed_plan_constraints_and_approved_canon(self):
    args = dict(proposal_id=self.proposal_id, provider="local", story_approvals=[self.fact["id"]])
    preview = ai.preview_proposal_revision(self.paths, **args)
    self.assertEqual(preview["max_output_tokens"], 2000)
    self.assertEqual(preview["context"]["scene"]["body"].rstrip("\n"), self.body)
    for marker in ("STYLE_SENTINEL", "CONSTRAINT_SENTINEL", self.fact["id"], "Tighten without inventing facts."):
      self.assertIn(marker, preview["user_prompt"])
    self.assertNotIn("PRIVATE_NOTE_SENTINEL", preview["user_prompt"])
    revised = ai.generate_proposal_draft(self.paths, **args, expected_context_fingerprint=preview["fingerprint"])
    log = json.loads((self.paths.root / revised["draft"]["log_path"]).read_text())
    self.assertEqual(log["user_prompt"], preview["user_prompt"])
    self.assertEqual(log["system_prompt"], preview["system_prompt"])

  def test_scene_direction_keeps_whole_permitted_subjects_before_unrelated_memory(self):
    for index in range(5):
      add_entity(self.paths, kind="lore", name=f"Unrelated district {index}", description="x" * 2600)
    description = "Estuary habitat evidence. " + "y" * 1600
    subject = add_entity(self.paths, kind="lore", name="The Estuary, tidal coast", description=description)
    add_entity(self.paths, kind="lore", name="Estuary depths", description="EXCLUDED_DEPTHS_SENTINEL", ai_visibility="exclude")
    pid = create_proposal(self.paths, title="Arrival", scene_id="scene-0001", instruction="Mara reaches Estuary and considers its depths.")
    preview = ai.preview_proposal_revision(self.paths, proposal_id=pid)
    records = preview["context"]["codex_entities"]
    selected = next(row for row in records if row["id"] == subject)
    self.assertEqual(selected["description"], description)
    self.assertIn(self.mara, {row["id"] for row in records})
    self.assertNotIn("EXCLUDED_DEPTHS_SENTINEL", preview["user_prompt"])
    self.assertNotIn("PRIVATE_NOTE_SENTINEL", preview["user_prompt"])
    self.assertTrue(preview["limits"]["omitted_memory_ids"])
    self.assertLessEqual(sum(len(json.dumps(row, ensure_ascii=False)) for row in records), 12000)
    plan = ai.preview_proposal_generation(self.paths, scene_id="scene-0001", instruction="Mara reaches Estuary.", codex_limit=2)
    self.assertEqual({row["id"] for row in plan["context"]["codex_entities"]}, {self.mara, subject})

  def test_scene_draft_requires_review_and_preserves_work_when_guidance_changes(self):
    args = dict(proposal_id=self.proposal_id, provider="openai")
    with patch("urllib.request.urlopen") as transport:
      with self.assertRaisesRegex(OpenAuthorError, "[Rr]eview"):
        ai.generate_proposal_draft(self.paths, **args)
      transport.assert_not_called()
    preview = ai.preview_proposal_revision(self.paths, **args)
    update_brief(self.paths, style_guide="Revised guidance.")
    with patch("urllib.request.urlopen") as transport:
      with self.assertRaisesRegex(OpenAuthorError, "context changed"):
        ai.generate_proposal_draft(self.paths, **args, expected_context_fingerprint=preview["fingerprint"])
      transport.assert_not_called()
    preview = ai.preview_proposal_revision(self.paths, **args)
    before = get_proposal(self.paths, self.proposal_id)
    def provider_response(*_args, **_kwargs):
      update_brief(self.paths, style_guide="Changed during the request.")
      return io.BytesIO(json.dumps({"choices": [{"message": {"content": "Mara counted the lights. Her left hand had four fingers."}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 100, "completion_tokens": 16}}).encode())
    with patch.dict("os.environ", {"OPENAI_API_KEY": "synthetic-test-key"}), patch("urllib.request.urlopen", side_effect=provider_response):
      with self.assertRaisesRegex(OpenAuthorError, "context changed"):
        ai.generate_proposal_draft(self.paths, **args, expected_context_fingerprint=preview["fingerprint"])
    self.assertEqual(get_proposal(self.paths, self.proposal_id), before)

  def test_cli_scene_draft_retries_the_exact_reviewed_request(self):
    def run(*args):
      result = subprocess.run([sys.executable, "-m", "openauthor", "proposal", *args, "--json"], cwd=self.paths.root,
        env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])}, capture_output=True, text=True, check=True)
      return json.loads(result.stdout)
    inputs = dict(proposal_id=self.proposal_id, story_approvals=[self.fact["id"]])
    preview = run("revision-preview", "--input-json", json.dumps(inputs))
    args = ("draft", "--id", self.proposal_id, "--story-approvals", json.dumps([self.fact["id"]]), "--expected-context-fingerprint", preview["fingerprint"], "--request-id", "reviewed-draft")
    first = run(*args)
    self.assertEqual(run(*args), first)
    log = json.loads((self.paths.root / first["draft"]["log_path"]).read_text())
    self.assertEqual(log["user_prompt"], preview["user_prompt"])
