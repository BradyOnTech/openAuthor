from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from openauthor import ai
from openauthor.codex import add_entity
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.proposals import create_proposal, get_proposal, prepare_draft_revision, set_proposal_draft
from openauthor.scenes import add_scene, get_scene, update_scene
from openauthor.writing_review import _references, _source_comparison, _source_checks


class DraftFeedbackTests(unittest.TestCase):
  def setUp(self):
    temporary = tempfile.TemporaryDirectory()
    self.addCleanup(temporary.cleanup)
    self.paths = initialize_project(Path(temporary.name), name="Draft feedback")
    add_scene(self.paths, title="Gate", body="Mara kept the gate key.")
    add_entity(self.paths, kind="character", name="Mara", notes="PRIVATE_NOTE_SENTINEL")
    pid = create_proposal(self.paths, title="Wait at the gate", scene_id="scene-0001", instruction="GENERATED_PLAN_SENTINEL: shorten everything.",
      revision_intent={"goal": "Keep the key and the unanswered question.", "constraints": ["No gate opening."], "protected_elements": ["Mara"]})
    self.candidate = "Mara kept the gate key. She asked who would return. No answer came. She felt uncertain."
    self.source = set_proposal_draft(self.paths, proposal_id=pid, proposed_body=self.candidate)
    self.candidate = self.source["proposed_body"]
    self.feedback = "Remove the final explanation of uncertainty; keep the unanswered question."

  def prepare(self, **overrides):
    return prepare_draft_revision(self.paths, **{**dict(proposal_id=self.source["id"], feedback=self.feedback,
      expected_updated_at=self.source["updated_at"], request_id="feedback-case-001"), **overrides})

  def test_fork_is_idempotent_and_does_not_change_source_or_manuscript(self):
    before = (self.paths.proposals_dir / (self.source["id"] + ".json")).read_bytes()
    child = self.prepare()
    self.assertNotEqual(child["id"], self.source["id"])
    self.assertEqual(self.prepare()["id"], child["id"])
    self.assertEqual(len(list(self.paths.proposals_dir.glob("*.json"))), 2)
    self.assertEqual(child["revision_intent"], self.source["revision_intent"])
    self.assertEqual(child["draft_revision"]["source"]["body"], self.candidate)
    self.assertEqual(child["proposed_body"], "")
    self.assertEqual((self.paths.proposals_dir / (self.source["id"] + ".json")).read_bytes(), before)
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"].strip(), "Mara kept the gate key.")
    with self.assertRaisesRegex(OpenAuthorError, "another draft or direction"):
      self.prepare(feedback="A different direction.")

  def test_reviewed_candidate_and_feedback_reach_writer_and_source_audit(self):
    child = self.prepare()
    options = dict(proposal_id=child["id"], provider="openai-codex", model="test-writer", review_mode="off")
    preview = ai.preview_proposal_revision(self.paths, **options)
    self.assertEqual(preview["context"]["current_candidate"], self.candidate)
    self.assertEqual(preview["context"]["author_feedback"], self.feedback)
    self.assertEqual(preview["context"]["proposal"]["goal"], self.source["revision_intent"]["goal"])
    self.assertNotIn("PRIVATE_NOTE_SENTINEL", preview["user_prompt"])
    revised = "Mara kept the gate key. She asked who would return. No answer came."
    references = _references(preview["context"])
    self.assertNotIn("GENERATED_PLAN_SENTINEL", json.dumps(references))
    comparison = _source_comparison(references, revised)
    self.assertEqual(comparison["source_reference"], "current_candidate")
    self.assertIn("She felt uncertain.", comparison["passages"][0]["source"])
    row = comparison["passages"][0]
    checks, coverage = _source_checks([{"id": row["id"], "source_quote": row["source"],
      "source_meaning": "The key remains, the question is unanswered, and uncertainty is named.",
      "candidate_quote": row["candidate"], "candidate_meaning": "The key and unanswered question remain; the redundant explanation is removed.",
      "assessment": "permitted_change", "reason": "The author explicitly requests that removal.",
      "permission_evidence": [{"path": "author_feedback", "quote": self.feedback}]}], comparison, references)
    self.assertEqual(checks[0]["assessment"], "permitted_change")
    self.assertFalse(coverage["truncated"])
    result = {"text": revised, "input_tokens": 100, "output_tokens": 20, "latency_ms": 1, "attempts": 1}
    with patch.object(ai, "_call_provider", return_value=result) as writer:
      generated = ai.generate_proposal_draft(self.paths, **options, expected_context_fingerprint=preview["fingerprint"])
    self.assertEqual(writer.call_args.kwargs["user_prompt"], preview["user_prompt"])
    self.assertEqual(generated["proposed_body"].rstrip("\n"), revised)
    self.assertEqual(get_proposal(self.paths, self.source["id"])["proposed_body"], self.candidate)
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"].strip(), "Mara kept the gate key.")

  def test_source_or_scene_change_requires_a_new_review_before_inference(self):
    with self.assertRaisesRegex(OpenAuthorError, "draft changed"):
      self.prepare(expected_updated_at="older")
    child = self.prepare()
    options = dict(proposal_id=child["id"], provider="openai-codex", model="test-writer")
    preview = ai.preview_proposal_revision(self.paths, **options)
    update_scene(self.paths, scene_identifier="scene-0001", body="Mara pocketed the gate key.")
    with patch.object(ai, "_call_provider") as writer:
      with self.assertRaises(OpenAuthorError):
        ai.generate_proposal_draft(self.paths, **options, expected_context_fingerprint=preview["fingerprint"])
      writer.assert_not_called()
    with self.assertRaisesRegex(OpenAuthorError, "unapplied"):
      self.prepare(request_id="feedback-case-002")

  def test_selected_focus_is_frozen_and_changes_reviewed_guidance(self):
    general = self.prepare()
    child = self.prepare(request_id="dialogue-focus-001", focus="dialogue")
    self.assertEqual(child["draft_revision"]["focus"], "dialogue")
    options = dict(provider="openai-codex", model="test-writer")
    focused = ai.preview_proposal_revision(self.paths, proposal_id=child["id"], **options)
    prior = ai.preview_proposal_revision(self.paths, proposal_id=general["id"], **options)
    self.assertEqual(focused["context"]["revision_focus"], "dialogue")
    self.assertIn("references/dialogue.md", focused["context"]["writing_craft"]["resources"])
    self.assertNotIn("references/dialogue.md", prior["context"]["writing_craft"]["resources"])
    self.assertNotEqual(focused["fingerprint"], prior["fingerprint"])
    self.assertEqual(focused["context"]["current_candidate"], prior["context"]["current_candidate"])
    self.assertEqual(focused["context"]["codex_entities"], prior["context"]["codex_entities"])
    with self.assertRaisesRegex(OpenAuthorError, "another draft or direction"):
      self.prepare(request_id="dialogue-focus-001", focus="pacing")
    with self.assertRaisesRegex(OpenAuthorError, "supported draft revision focus"):
      self.prepare(request_id="dialogue-focus-002", focus="unrecognized")

  def test_quoted_feedback_edits_the_previous_draft_quote_and_keeps_narration(self):
    original = 'Mara kept the key. “No.” She waited.'
    candidate = 'Mara kept the key. “Not yet.” She waited.'
    update_scene(self.paths, scene_identifier="scene-0001", body=original)
    pid = create_proposal(self.paths, title="Quote revision", scene_id="scene-0001", instruction="Keep narration.",
      revision_intent={"goal": "Keep narration.", "constraints": [], "protected_elements": [],
        "scene_contract": {"editable_scope": "quoted_text"}})
    source = set_proposal_draft(self.paths, proposal_id=pid, proposed_body=candidate)
    child = prepare_draft_revision(self.paths, proposal_id=pid, feedback="Make the delivery emphatic; keep its meaning.",
      expected_updated_at=source["updated_at"], request_id="quoted-feedback-001")
    options = dict(proposal_id=child["id"], provider="openai-codex", model="test-writer")
    preview = ai.preview_proposal_revision(self.paths, **options)
    self.assertEqual(preview["context"]["quoted_editing"]["passages"][0]["text"], "Not yet.")
    response = {"text": '{"edits":[{"id":"quote-1","text":"Not yet!"}]}',
      "input_tokens": 100, "output_tokens": 20, "latency_ms": 1, "attempts": 1}
    with patch.object(ai, "_call_provider", return_value=response):
      generated = ai.generate_proposal_draft(self.paths, **options, expected_context_fingerprint=preview["fingerprint"])
    self.assertEqual(generated["proposed_body"].strip(), 'Mara kept the key. “Not yet!” She waited.')
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"].strip(), original)


if __name__ == "__main__":
  unittest.main()
