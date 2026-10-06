from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from openauthor.ai import generate_proposal_draft, preview_proposal_generation, preview_proposal_revision
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.proposals import create_proposal, apply_proposal, undo_proposal
from openauthor.scenes import add_scene, get_scene
from openauthor.quoted_editing import QuotedRevision


def edits(text, identifier="quote-1"):
  return json.dumps({"edits": [{"id": identifier, "text": text}]})


class QuoteBoundaryTests(unittest.TestCase):
  def test_sparse_edits_preserve_attribution_spacing_and_mixed_delimiters(self):
    source = '  “Wait,” Mara said.\n\n"The sign says \\"CLOSED\\"."\n'
    editor = QuotedRevision(source)
    self.assertEqual(len(editor.context()["passages"]), 2)
    self.assertEqual(editor.apply(edits("Stay,")), source.replace("Wait,", "Stay,"))
    self.assertEqual(editor.apply('{"edits": []}'), source)

  def test_breakouts_unpaired_and_ambiguous_marks_are_rejected(self):
    for source in ['No quotes.', '“Unclosed.', 'Orphan ”.', '“One “nested” quote.”']:
      with self.subTest(source=source), self.assertRaises(OpenAuthorError):
        QuotedRevision(source)
    for source, replacement in [('“Wait,” she said.', 'Stay,” he said. “Go,'),
                                ('"Wait," she said.', 'Stay," he said. "Go,'),
                                ('“Wait,” she said.', 'Stay,\\'),
                                ('“Wait,” she said.', '“Stay,')]:
      with self.subTest(replacement=replacement), self.assertRaises(OpenAuthorError):
        QuotedRevision(source).apply(edits(replacement))

  def test_ids_and_shape_cannot_drop_or_duplicate_passages(self):
    for reply in [edits('Stay', 'quote-2'), '{"edits": [], "narration": "New"}',
                  '{"edits": [{"id":"quote-1","text":"A"},{"id":"quote-1","text":"B"}]}',
                  '{"edits": [{"id":"quote-1","text":null}]}',
                  '{"edits": [], "edits": []}', 'Full replacement prose.']:
      with self.subTest(reply=reply), self.assertRaises(OpenAuthorError):
        QuotedRevision('“Wait,” she said.').apply(reply)

  def test_invalid_refinement_keeps_first_candidate_on_recovery(self):
    from openauthor.writing_review import DraftReview, review_policy, _source_comparison
    source, candidate = '“Wait,” she said.\n', '“Stay,” she said.\n'
    context = {"scene": {"body": source}, "scene_contract": {"editable_scope": "quoted_text"}, "proposal": {"goal": "Sharpen speech."}}
    passages = _source_comparison({"scene.body": source}, candidate)["passages"]
    critique = {"verdict": "revise", "strengths": [], "uncertainty": "", "source_checks": [{
      "id": row["id"], "source_quote": row["source"], "candidate_quote": row["candidate"],
      "source_meaning": "Fixture source.", "candidate_meaning": "Fixture reading.", "assessment": "preserved",
      "reason": "Fixture receipt.", "permission_evidence": []} for row in passages], "findings": [{
      "id": "F1", "priority": "low", "category": "craft", "quote": "Stay,", "reason": "Fixture preference.",
      "suggestion": "Sharper speech.", "source_evidence": []}]}
    calls = []
    def complete(**request):
      calls.append(request["stage"])
      return {"text": json.dumps(critique) if request["stage"] == "critique" else edits('Go,” he said. “Now,'), "input_tokens": 10, "output_tokens": 10}
    with tempfile.TemporaryDirectory() as folder:
      checkpoint = Path(folder) / "review.json"
      for _ in range(2):
        result, report = DraftReview(checkpoint=checkpoint, fingerprint="same-source").run(
          context=context, candidate=candidate, policy=review_policy(editable_scope="quoted_text"), complete=complete, max_output_tokens=100)
        self.assertEqual(result, candidate)
        self.assertEqual(report["status"], "failed")
        self.assertIn("quotation boundary", report["error"])
    self.assertEqual(calls, ["critique", "refine"])


class QuotedWorkflowTests(unittest.TestCase):
  def setUp(self):
    self.tmp = tempfile.TemporaryDirectory()
    self.addCleanup(self.tmp.cleanup)
    self.paths = initialize_project(Path(self.tmp.name), name="Quoted scope")
    add_scene(self.paths, title="Gate", body='“Is it approved?” Ines asked.\n\n“The routing can begin,” Theo said.')
    self.before = get_scene(self.paths, "scene-0001")["body"]
    self.pid = create_proposal(self.paths, title="Dialogue", scene_id="scene-0001", instruction="Sharpen the question.",
      revision_intent={"goal": "Sharpen the question; preserve uncertainty.", "scene_contract": {"editable_scope": "quoted_text"}})
    self.args = dict(proposal_id=self.pid, provider="openai", review_mode="refine")

  def test_author_scope_survives_preview_draft_refinement_apply_and_undo(self):
    preview = preview_proposal_revision(self.paths, **self.args)
    self.assertEqual(preview["context"]["quoted_editing"]["passages"][0]["text"], "Is it approved?")
    self.assertIn('Return only JSON', preview["writing_review"]["systems"]["refine"])
    first = self.before.replace("Is it approved?", "It is approved?")
    refined = self.before.replace("Is it approved?", "Has it been approved?")
    calls = []
    def provider(**request):
      calls.append(request)
      payload = json.loads(request["user_prompt"].split("Reviewed revision context:\n")[-1])
      if len(calls) == 1:
        text = edits("It is approved?")
      elif len(calls) == 3:
        self.assertEqual(payload["quoted_editing"]["passages"][0]["text"], "It is approved?")
        text = edits("Has it been approved?")
      else:
        rows = [{"id": row["id"], "source_quote": row["source"], "candidate_quote": row["candidate"],
          "source_meaning": "Fixture source reading.", "candidate_meaning": "Fixture candidate reading.",
          "assessment": "preserved", "reason": "Fixture receipt, not a quality judgment.", "permission_evidence": []}
          for row in payload["source_comparison"]["passages"]]
        if len(calls) == 2:
          text = json.dumps({"source_checks": rows, "verdict": "revise", "strengths": [], "uncertainty": "", "findings": [{
            "id": "F1", "priority": "low", "category": "craft", "quote": "It is approved?", "reason": "Awkward question.",
            "suggestion": "Use a natural question.", "source_evidence": []}]})
        else:
          text = json.dumps({"source_checks": rows, "verdict": "accept", "regressions": [], "uncertainty": "", "resolutions": [{
            "id": "F1", "resolved": True, "quote": "Has it been approved?", "reason": "Natural question."}]})
      return {"text": text, "input_tokens": 100, "output_tokens": 40, "latency_ms": 5, "attempts": 1, "tool_calls": []}
    with patch("openauthor.ai._call_provider", side_effect=provider):
      result = generate_proposal_draft(self.paths, **self.args, expected_context_fingerprint=preview["fingerprint"], request_id="bounded-edit")
    self.assertEqual(len(calls), 4)
    self.assertEqual(result["draft"]["writing_review"]["first_candidate"], first)
    self.assertEqual(result["proposed_body"], refined)
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"], self.before)
    apply_proposal(self.paths, proposal_id=self.pid)
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"], refined)
    undo_proposal(self.paths, proposal_id=self.pid)
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"], self.before)

  def test_invalid_first_reply_is_logged_and_recovery_does_not_charge_again(self):
    args = {**self.args, "review_mode": "off"}
    preview = preview_proposal_revision(self.paths, **args)
    with patch("openauthor.ai._call_provider", return_value={"text": '“New,” Ines said. New narration.', "input_tokens": 10,
        "output_tokens": 20, "latency_ms": 5, "attempts": 1}) as provider:
      for _ in range(2):
        with self.assertRaisesRegex(OpenAuthorError, "valid edit JSON"):
          generate_proposal_draft(self.paths, **args, expected_context_fingerprint=preview["fingerprint"], request_id="invalid-quote-reply")
      self.assertEqual(provider.call_count, 1)
    logs = [json.loads(path.read_text()) for path in self.paths.generations_dir.glob("*.json")]
    self.assertEqual(len(logs), 1)
    self.assertEqual(logs[0]["status"], "failed")
    self.assertEqual(logs[0]["usage"]["output_tokens"], 20)
    self.assertIn("New narration", logs[0]["raw_response_text"])
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"], self.before)

  def test_preflight_rejects_unsupported_source_before_provider_access(self):
    from openauthor.scenes import update_scene
    update_scene(self.paths, scene_identifier="scene-0001", body="No paired quotes.")
    with patch("openauthor.ai._call_provider") as provider, self.assertRaisesRegex(OpenAuthorError, "no paired double quotes"):
      preview_proposal_generation(self.paths, scene_id="scene-0001", instruction="Sharpen dialogue.", provider="openai", scene_contract={"editable_scope": "quoted_text"})
    provider.assert_not_called()


if __name__ == "__main__":
  unittest.main()
