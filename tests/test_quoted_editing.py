from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from openauthor.ai import generate_proposal_draft, preview_proposal_generation, preview_proposal_revision
from openauthor.project import OpenAuthorError, initialize_project, atomic_write_json
from openauthor.proposals import create_proposal, apply_proposal, apply_proposal_batch, undo_proposal, set_proposal_draft, update_change_hunk, rebase_proposal_change_set, get_proposal, edit_change_hunk
from openauthor.changes import build_change_set, render_change_set
from openauthor.scenes import add_scene, get_scene
from openauthor.quoted_editing import QuotedRevision


def edits(text, identifier="quote-1"):
  return json.dumps({"edits": [{"id": identifier, "text": text}]})


class QuoteBoundaryTests(unittest.TestCase):
  def test_growth_within_result_allowance_survives_hunk_rendering(self):
    source = '“Wait.”' + ' ' * 99993
    result = QuotedRevision(source).apply(edits('Stay.' * 1000))
    self.assertGreater(len(result), 100000)
    self.assertLess(len(result), 120000)
    change_set = build_change_set(proposal_id="proposal-large", scene_id="scene-0001", intent="Expand quoted contents.",
      before_body=source, after_body=result, editable_scope="quoted_text")
    self.assertEqual(render_change_set(change_set), result)

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

  def test_individual_quote_decisions_preserve_narration_through_apply_and_undo(self):
    from openauthor.scenes import update_scene
    from itertools import product
    source = '“Wait.” She waited. He watched. She turned. “Leave.” He left.\n'
    update_scene(self.paths, scene_identifier="scene-0001", body=source)
    replacement = ['She turned. He watched. She turned. He left.', 'He left.']
    candidate = QuotedRevision(source).apply(json.dumps({"edits": [
      {"id": f"quote-{index + 1}", "text": text} for index, text in enumerate(replacement)]}))
    for decisions in product(("accepted", "rejected"), repeat=2):
      with self.subTest(decisions=decisions):
        pid = create_proposal(self.paths, title="Independent quotes", scene_id="scene-0001", instruction="Edit quoted contents.",
          revision_intent={"goal": "Edit quoted contents.", "scene_contract": {"editable_scope": "quoted_text"}})
        draft = set_proposal_draft(self.paths, proposal_id=pid, proposed_body=candidate)
        self.assertEqual([row["before_text"] for row in draft["change_set"]["hunks"]], ["Wait.", "Leave."])
        for hunk, decision in zip(draft["change_set"]["hunks"], decisions):
          update_change_hunk(self.paths, proposal_id=pid, hunk_id=hunk["id"], decision=decision)
        if decisions == ("rejected", "rejected"):
          with self.assertRaisesRegex(OpenAuthorError, "identical"):
            apply_proposal(self.paths, proposal_id=pid)
        else:
          apply_proposal(self.paths, proposal_id=pid)
          expected = QuotedRevision(source).apply(json.dumps({"edits": [
            {"id": f"quote-{index + 1}", "text": replacement[index]} for index, decision in enumerate(decisions) if decision == "accepted"]}))
          self.assertEqual(get_scene(self.paths, "scene-0001")["body"], expected)
          undo_proposal(self.paths, proposal_id=pid)
        self.assertEqual(get_scene(self.paths, "scene-0001")["body"], source)

  def test_old_sentence_hunks_cannot_cross_scope_on_individual_or_batch_apply(self):
    from openauthor.scenes import update_scene
    source = '“Wait.” She waited. He watched. She turned. “Leave.” He left.\n'
    update_scene(self.paths, scene_identifier="scene-0001", body=source)
    candidate = QuotedRevision(source).apply(json.dumps({"edits": [
      {"id": "quote-1", "text": "She turned. He watched. She turned. He left."}, {"id": "quote-2", "text": "He left."}]}))
    legacy = set_proposal_draft(self.paths, proposal_id=self.pid, proposed_body=candidate)
    legacy["change_set"] = build_change_set(proposal_id=self.pid, scene_id="scene-0001", intent="Quotes only", before_body=source, after_body=candidate)
    atomic_write_json(self.paths.proposals_dir / f"{self.pid}.json", legacy)
    update_change_hunk(self.paths, proposal_id=self.pid, hunk_id=legacy["change_set"]["hunks"][0]["id"], decision="rejected")
    with self.assertRaisesRegex(OpenAuthorError, "violate quoted-text scope"):
      apply_proposal(self.paths, proposal_id=self.pid)
    add_scene(self.paths, title="Other", body="Other prose.")
    other = create_proposal(self.paths, title="Other edit", scene_id="scene-0002", instruction="Tighten.")
    set_proposal_draft(self.paths, proposal_id=other, proposed_body="Sharper prose.")
    with self.assertRaisesRegex(OpenAuthorError, "violate quoted-text scope"):
      apply_proposal_batch(self.paths, proposal_ids=[other, self.pid])
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"], source)
    self.assertEqual(get_scene(self.paths, "scene-0002")["body"], "Other prose.\n")
    self.assertEqual(get_proposal(self.paths, self.pid)["status"], "pending")
    self.assertEqual(get_proposal(self.paths, other)["status"], "pending")

  def test_quote_rebase_keeps_passage_positions_decisions_and_new_narration(self):
    from openauthor.scenes import update_scene
    source = '“Wait.” She waited. “Wait.” He watched.\n'
    update_scene(self.paths, scene_identifier="scene-0001", body=source)
    candidate = QuotedRevision(source).apply(json.dumps({"edits": [
      {"id": "quote-1", "text": "Stay."}, {"id": "quote-2", "text": "Stay."}]}))
    draft = set_proposal_draft(self.paths, proposal_id=self.pid, proposed_body=candidate)
    first = draft["change_set"]["hunks"][0]["id"]
    update_change_hunk(self.paths, proposal_id=self.pid, hunk_id=first, decision="rejected")
    current = source.replace("She waited.", "Wait. She waited beside the gate.")
    update_scene(self.paths, scene_identifier="scene-0001", body=current)
    rebased = rebase_proposal_change_set(self.paths, proposal_id=self.pid)
    self.assertEqual(rebased["rebase_report"]["status"], "rebased")
    self.assertEqual([h["decision"] for h in rebased["change_set"]["hunks"]], ["rejected", "accepted"])
    apply_proposal(self.paths, proposal_id=self.pid)
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"], current.replace('“Wait.” He watched.', '“Stay.” He watched.'))

  def test_manual_quote_hunk_cannot_inject_narration(self):
    candidate = self.before.replace("Is it approved?", "Is it ready?")
    draft = set_proposal_draft(self.paths, proposal_id=self.pid, proposed_body=candidate)
    with self.assertRaises(OpenAuthorError):
      edit_change_hunk(self.paths, proposal_id=self.pid, hunk_id=draft["change_set"]["hunks"][0]["id"], after_text='Yes.” New narration. “Wait.')
    self.assertEqual(get_proposal(self.paths, self.pid)["proposed_body"], candidate)
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"], self.before)

  def test_individual_and_batch_apply_retain_terminal_outside_whitespace(self):
    for coordinated in (False, True):
      with self.subTest(coordinated=coordinated):
        scene_path = self.paths.root / get_scene(self.paths, "scene-0001")["path"]
        scene_path.write_text(scene_path.read_text().rstrip() + "  \n\n", encoding="utf-8")
        source = get_scene(self.paths, "scene-0001")["body"]
        candidate = source.replace("Is it approved?", "Is it ready?")
        pid = create_proposal(self.paths, title="Whitespace-safe quote", scene_id="scene-0001", instruction="Edit quoted contents.",
          revision_intent={"goal": "Edit quoted contents.", "scene_contract": {"editable_scope": "quoted_text"}})
        set_proposal_draft(self.paths, proposal_id=pid, proposed_body=candidate)
        if coordinated:
          add_scene(self.paths, title="Other", body="Other prose.")
          other = create_proposal(self.paths, title="Other edit", scene_id="scene-0002", instruction="Tighten.")
          set_proposal_draft(self.paths, proposal_id=other, proposed_body="Sharper prose.")
          apply_proposal_batch(self.paths, proposal_ids=[pid, other])
          self.assertEqual(get_scene(self.paths, "scene-0001")["body"], candidate)
          from openauthor.proposals import undo_proposal_batch
          undo_proposal_batch(self.paths, applied_revision=get_proposal(self.paths, pid)["applied_revision"])
        else:
          apply_proposal(self.paths, proposal_id=pid)
          self.assertEqual(get_scene(self.paths, "scene-0001")["body"], candidate)
          undo_proposal(self.paths, proposal_id=pid)
        self.assertEqual(get_scene(self.paths, "scene-0001")["body"], source)

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
    with self.assertRaisesRegex(OpenAuthorError, "hunk fragments may contain incomplete quotes"):
      preview_proposal_revision(self.paths, proposal_id=self.pid, hunk_id=result["change_set"]["hunks"][0]["id"], provider="openai")
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
