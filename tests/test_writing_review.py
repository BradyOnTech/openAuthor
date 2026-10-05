from __future__ import annotations

import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from openauthor.ai import generate_proposal_draft, preview_proposal_revision
from openauthor.codex import add_entity
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.proposals import create_proposal, get_proposal, apply_proposal, undo_proposal, select_draft_candidate
from openauthor.scenes import add_scene, get_scene, update_scene

FIRST = "Mara opened the permit. The seal broke."
REFINED = "Mara slid the permit back. The seal remained unbroken."
CRITIQUE = {"verdict": "revise", "strengths": [], "uncertainty": "", "findings": [
  {"id": "F1", "priority": "high", "category": "fidelity", "quote": "Mara opened the permit.",
   "reason": "The candidate opens the protected permit.", "suggestion": "Keep the seal unbroken.",
   "source_evidence": [{"path": "scene.body", "quote": "She stopped before the seal."}]}]}
VERIFY = {"verdict": "accept", "uncertainty": "", "regressions": [], "resolutions": [
  {"id": "F1", "resolved": True, "quote": "The seal remained unbroken.", "reason": "The revision stops before opening the permit."}]}


def response(text):
  return {"text": text if isinstance(text, str) else json.dumps(text), "input_tokens": 100,
          "output_tokens": 40, "latency_ms": 5, "attempts": 1, "tool_calls": []}


class WritingReviewTests(unittest.TestCase):
  def setUp(self):
    self.tmp = tempfile.TemporaryDirectory()
    self.addCleanup(self.tmp.cleanup)
    self.paths = initialize_project(Path(self.tmp.name), name="Draft review")
    add_scene(self.paths, title="Permit", pov="Mara", body="Mara began to unfold the map.\n\nShe stopped before the seal.")
    self.before = get_scene(self.paths, "scene-0001")["body"]
    self.pid = create_proposal(self.paths, title="Keep the permit closed", scene_id="scene-0001",
      instruction="MODEL_GENERATED_EXPLANATION", revision_intent={"goal": "Keep the permit unopened.",
      "protected_elements": ["The permit stays sealed."], "constraints": [],
      "scene_contract": {"ending": "Stop before the seal; the contents remain unknown."}})
    self.args = dict(proposal_id=self.pid, provider="openai", review_mode="refine")

  def generate(self, outputs, **kwargs):
    preview = preview_proposal_revision(self.paths, **self.args)
    with patch("openauthor.ai._call_provider", side_effect=[response(row) for row in outputs]) as provider:
      result = generate_proposal_draft(self.paths, **self.args, expected_context_fingerprint=preview["fingerprint"], **kwargs)
    return result, provider

  def test_fresh_critic_refines_supported_issue_and_author_can_apply_and_undo(self):
    add_entity(self.paths, kind="lore", name="Hidden", description="EXCLUDED_SECRET", ai_visibility="exclude")
    result, provider = self.generate([FIRST, CRITIQUE, REFINED, VERIFY], request_id="reviewed-draft")
    report = result["draft"]["writing_review"]
    self.assertEqual(result["proposed_body"], REFINED + "\n")
    self.assertEqual(report["status"], "refined")
    self.assertEqual(report["first_candidate"], FIRST)
    self.assertEqual(result["draft"]["input_tokens"], 400)
    self.assertEqual(result["draft"]["output_tokens"], 160)
    self.assertEqual(provider.call_count, 4)
    for call in provider.call_args_list[1:]:
      self.assertNotIn("MODEL_GENERATED_EXPLANATION", call.kwargs["user_prompt"])
      self.assertNotIn("EXCLUDED_SECRET", call.kwargs["user_prompt"])
      self.assertEqual(call.kwargs["history"], [])
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"], self.before)
    apply_proposal(self.paths, proposal_id=self.pid)
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"], REFINED + "\n")
    undo_proposal(self.paths, proposal_id=self.pid)
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"], self.before)

  def test_critic_can_keep_the_draft_without_spending_on_revision(self):
    review = {"verdict": "keep", "strengths": [{"quote": "The seal remained unbroken.", "reason": "The ending preserves uncertainty."}], "findings": [], "uncertainty": ""}
    result, provider = self.generate([REFINED, review])
    self.assertEqual(provider.call_count, 2)
    self.assertEqual(result["draft"]["writing_review"]["status"], "kept")
    self.assertEqual(result["proposed_body"], REFINED + "\n")

  def test_author_can_choose_retained_candidate_and_provenance_follows_actual_prose(self):
    result, _ = self.generate([FIRST, CRITIQUE, REFINED, VERIFY])
    initial_generation = result["draft"]["initial_generation_id"]
    refined_generation = result["draft"]["generation_id"]
    self.assertNotEqual(initial_generation, refined_generation)
    first = select_draft_candidate(self.paths, proposal_id=self.pid, candidate="first", expected_updated_at=result["updated_at"])
    self.assertEqual(first["proposed_body"], FIRST + "\n")
    self.assertEqual(first["draft"]["generation_id"], initial_generation)
    self.assertEqual(first["draft"]["writing_review"]["author_selected"], "first")
    self.assertEqual(first["change_set"]["provenance"]["generation_id"], initial_generation)
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"], self.before)
    with self.assertRaisesRegex(OpenAuthorError, "Change Set changed"):
      select_draft_candidate(self.paths, proposal_id=self.pid, candidate="refined", expected_updated_at=result["updated_at"])
    refined = select_draft_candidate(self.paths, proposal_id=self.pid, candidate="refined", expected_updated_at=first["updated_at"])
    self.assertEqual(refined["proposed_body"], REFINED + "\n")
    self.assertEqual(refined["draft"]["generation_id"], refined_generation)

  def test_fabricated_quotes_and_missing_fidelity_evidence_cannot_trigger_revision(self):
    for mutate in [lambda row: row["findings"][0].update(quote="Invented quote"),
                   lambda row: row["findings"][0].update(source_evidence=[]),
                   lambda row: row["findings"][0]["source_evidence"][0].update(path="private.notes"),
                   lambda row: row.update(uncertainty="Intent is unknown"),
                   lambda row: row.update(verdict=[]),
                   lambda row: row["findings"][0].update(category={}),
                   lambda row: row["findings"][0]["source_evidence"][0].update(path=[])]:
      with self.subTest(mutate=mutate):
        review = copy.deepcopy(CRITIQUE)
        mutate(review)
        result, provider = self.generate([FIRST, review])
        self.assertEqual(provider.call_count, 2)
        self.assertIn(result["draft"]["writing_review"]["status"], {"failed", "uncertain"})
        self.assertEqual(result["proposed_body"], FIRST + "\n")

  def test_payload_qualified_reference_paths_remain_bound_to_real_sources(self):
    for identifier in ["references.scene.body", get_scene(self.paths, "scene-0001")["path"]]:
      with self.subTest(identifier=identifier):
        critique = copy.deepcopy(CRITIQUE)
        critique["findings"][0]["source_evidence"][0]["path"] = identifier
        result, _ = self.generate([FIRST, critique, REFINED, VERIFY])
        report = result["draft"]["writing_review"]
        self.assertEqual(report["status"], "refined")
        self.assertEqual(report["critique"]["findings"][0]["source_evidence"][0]["path"], "scene.body")

  def test_craft_findings_allow_candidate_citations_without_turning_them_into_story_evidence(self):
    for category, path in [("craft", "candidate"), ("craft", "unknown-craft-reference"), ("fidelity", "candidate")]:
      with self.subTest(category=category, path=path):
        critique = copy.deepcopy(CRITIQUE)
        critique["findings"][0].update(category=category, source_evidence=[{"path": path, "quote": "Mara opened the permit."}])
        result, provider = self.generate([FIRST, critique] if category == "fidelity" else [FIRST, critique, REFINED, VERIFY])
        report = result["draft"]["writing_review"]
        self.assertEqual(report["status"], "failed" if category == "fidelity" else "refined")
        self.assertEqual(provider.call_count, 2 if category == "fidelity" else 4)
        if path == "unknown-craft-reference":
          self.assertEqual(report["critique"]["findings"][0]["source_evidence"], [])
          self.assertTrue(report["critique"]["validation_warnings"])

  def test_wrapped_source_quotes_are_anchored_and_invalid_strengths_do_not_discard_verified_findings(self):
    critique = copy.deepcopy(CRITIQUE)
    critique["strengths"] = [{"quote": "A strength the model invented.", "reason": "Unsupported"}]
    critique["findings"][0]["source_evidence"][0]["quote"] = "Mara began to unfold the map. She stopped before the seal."
    result, _ = self.generate([FIRST, critique, REFINED, VERIFY])
    report = result["draft"]["writing_review"]
    self.assertEqual(report["status"], "refined")
    self.assertEqual(report["critique"]["strengths"], [])
    self.assertTrue(report["critique"]["validation_warnings"])
    self.assertEqual(report["critique"]["findings"][0]["source_evidence"][0]["quote"], self.before.strip())

  def test_rejected_incomplete_or_uncertain_verification_retains_first_candidate(self):
    for mutate in [lambda row: row.update(verdict="reject"),
                   lambda row: row.update(uncertainty="Possible voice drift"),
                   lambda row: row.update(resolutions=[]),
                   lambda row: row["resolutions"][0].update(resolved=False),
                   lambda row: row.update(regressions=[{"quote": "Mara slid the permit back.", "reason": "Unnecessary action", "source_evidence": []}])]:
      with self.subTest(mutate=mutate):
        verification = copy.deepcopy(VERIFY)
        mutate(verification)
        result, provider = self.generate([FIRST, CRITIQUE, REFINED, verification])
        report = result["draft"]["writing_review"]
        self.assertEqual(result["proposed_body"], FIRST + "\n")
        self.assertEqual(report["refined_candidate"], REFINED)
        self.assertNotEqual(report["status"], "refined")
        self.assertEqual(provider.call_count, 4)

  def test_review_mode_is_authorized_by_exact_preview(self):
    preview = preview_proposal_revision(self.paths, **{**self.args, "review_mode": "off"})
    with patch("openauthor.ai._call_provider") as provider:
      with self.assertRaisesRegex(OpenAuthorError, "context changed"):
        generate_proposal_draft(self.paths, **self.args, expected_context_fingerprint=preview["fingerprint"])
      provider.assert_not_called()

  def test_quoted_regressions_still_reject_a_revision_when_optional_reference_cannot_be_verified(self):
    for verdict in ["accept", "reject"]:
      with self.subTest(verdict=verdict):
        verification = copy.deepcopy(VERIFY)
        verification.update(verdict=verdict, regressions=[{"quote": "Mara slid the permit back.", "reason": "The new movement creates a concern to inspect.", "source_evidence": [{"path": "unshared-reference", "quote": "UNSUPPORTED CITATION"}]}])
        result, _ = self.generate([FIRST, CRITIQUE, REFINED, verification])
        report = result["draft"]["writing_review"]
        self.assertEqual(report["status"], "rejected")
        self.assertEqual(report["verification"]["regressions"][0]["source_evidence"], [])
        self.assertTrue(report["verification"]["validation_warnings"])
        self.assertEqual(result["proposed_body"], FIRST + "\n")

  def test_automatic_output_allowance_covers_the_whole_scene_and_matches_delivery(self):
    update_scene(self.paths, scene_identifier="scene-0001", body="Mara began to unfold the map. " * 600)
    pid = create_proposal(self.paths, title="Long scene", scene_id="scene-0001", instruction="Tighten this scene.")
    preview = preview_proposal_revision(self.paths, proposal_id=pid)
    self.assertGreater(preview["max_output_tokens"], 2000)
    result = generate_proposal_draft(self.paths, proposal_id=pid, expected_context_fingerprint=preview["fingerprint"])
    self.assertEqual(result["draft"]["max_output_tokens"], preview["max_output_tokens"])

  def test_host_count_repairs_a_missed_length_requirement_and_cannot_be_overruled_by_model(self):
    for refined, expected_status in [(REFINED, "refined"), (FIRST, "rejected")]:
      with self.subTest(refined=refined):
        pid = create_proposal(self.paths, title="A counted target", scene_id="scene-0001", instruction="Keep the permit sealed.",
          revision_intent={"goal": "Keep the permit sealed.", "scene_contract": {"word_range": [9, 10]}})
        args = {**self.args, "proposal_id": pid}
        preview = preview_proposal_revision(self.paths, **args)
        model_keep = {"verdict": "keep", "strengths": [], "findings": [], "uncertainty": ""}
        verify = {"verdict": "accept", "regressions": [], "uncertainty": "", "resolutions": [{"id": "host-word-range", "resolved": True, "quote": refined, "reason": "The model claims the word range is met."}]}
        with patch("openauthor.ai._call_provider", side_effect=[response(row) for row in [FIRST, model_keep, refined, verify]]) as provider:
          result = generate_proposal_draft(self.paths, **args, expected_context_fingerprint=preview["fingerprint"])
        self.assertEqual(json.loads(provider.call_args_list[2].kwargs["user_prompt"])["mechanical_observations"]["candidate_words"], 7)
        report = result["draft"]["writing_review"]
        self.assertEqual(report["status"], expected_status)
        self.assertEqual(report["mechanical_checks"]["first_words"], 7)
        self.assertEqual(report["mechanical_checks"]["refined_in_range"], expected_status == "refined")
        self.assertEqual(report["critique"]["findings"][0]["origin"], "host")

  def test_local_review_counts_words_without_claiming_creative_review(self):
    pid = create_proposal(self.paths, title="Local word count", scene_id="scene-0001", instruction="Tighten.", revision_intent={"goal": "Tighten.", "scene_contract": {"word_range": [9, 10]}})
    result = generate_proposal_draft(self.paths, proposal_id=pid, review_mode="refine")
    report = result["draft"]["writing_review"]
    self.assertEqual(report["status"], "unavailable")
    self.assertEqual(report["mechanical_checks"]["first_words"], len(result["proposed_body"].split()))
    self.assertEqual(report["mechanical_checks"]["word_range"], [9, 10])
    self.assertEqual(report["stages"], [])

  def test_failed_critic_does_not_hide_counted_requirements_or_drop_a_colliding_finding(self):
    for malformed in [True, False]:
      with self.subTest(malformed=malformed):
        pid = create_proposal(self.paths, title="Count and fidelity", scene_id="scene-0001", instruction="Keep sealed.",
          revision_intent={"goal": "Keep sealed.", "scene_contract": {"word_range": [9, 10]}})
        args = {**self.args, "proposal_id": pid}
        preview = preview_proposal_revision(self.paths, **args)
        critique = copy.deepcopy(CRITIQUE)
        critique["findings"][0]["id"] = "host-word-range"
        verify = copy.deepcopy(VERIFY)
        verify["resolutions"][0]["id"] = "host-word-range"
        verify["resolutions"].append({"id": "host-word-range-count", "resolved": True, "quote": REFINED, "reason": "Nine words meet the target."})
        outputs = [FIRST, "invalid JSON"] if malformed else [FIRST, critique, REFINED, verify]
        with patch("openauthor.ai._call_provider", side_effect=[response(row) for row in outputs]):
          result = generate_proposal_draft(self.paths, **args, expected_context_fingerprint=preview["fingerprint"])
        report = result["draft"]["writing_review"]
        self.assertFalse(report["mechanical_checks"]["first_in_range"])
        self.assertEqual(report["status"], "failed" if malformed else "refined")
        if not malformed:
          self.assertEqual(len(report["critique"]["findings"]), 2)
          self.assertEqual(report["critique"]["findings"][0]["category"], "fidelity")

  def test_scene_mutation_during_review_stops_later_calls_and_preserves_newer_writing(self):
    preview = preview_proposal_revision(self.paths, **self.args)
    count = 0
    def provider(**kwargs):
      nonlocal count
      count += 1
      if count == 2:
        update_scene(self.paths, scene_identifier="scene-0001", body="Author's newer writing.")
        return response(CRITIQUE)
      return response(FIRST)
    with patch("openauthor.ai._call_provider", side_effect=provider):
      with self.assertRaisesRegex(OpenAuthorError, "scene changed"):
        generate_proposal_draft(self.paths, **self.args, expected_context_fingerprint=preview["fingerprint"])
    self.assertEqual(count, 2)
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"], "Author's newer writing.\n")
    self.assertNotIn("draft", get_proposal(self.paths, self.pid))

  def test_completed_stages_survive_final_delivery_loss_without_repeating_provider_calls(self):
    preview = preview_proposal_revision(self.paths, **self.args)
    with patch("openauthor.ai._call_provider", side_effect=[response(row) for row in [FIRST, CRITIQUE, REFINED, VERIFY]]) as provider, patch("openauthor.ai.set_proposal_draft", side_effect=RuntimeError("delivery lost")):
      with self.assertRaisesRegex(RuntimeError, "delivery lost"):
        generate_proposal_draft(self.paths, **self.args, expected_context_fingerprint=preview["fingerprint"], request_id="recover-stages")
      self.assertEqual(provider.call_count, 4)
    with patch("openauthor.ai._call_provider") as provider:
      result = generate_proposal_draft(self.paths, **self.args, expected_context_fingerprint=preview["fingerprint"], request_id="recover-stages")
      provider.assert_not_called()
    self.assertEqual(result["proposed_body"], REFINED + "\n")
    self.assertEqual(result["draft"]["writing_review"]["status"], "refined")

  def test_review_failure_preserves_draft_and_reports_uncertainty(self):
    preview = preview_proposal_revision(self.paths, **self.args)
    with patch("openauthor.ai._call_provider", return_value=response(FIRST)), patch("openauthor.ai.complete_chat", side_effect=OpenAuthorError("Review budget exhausted")):
      result = generate_proposal_draft(self.paths, **self.args, expected_context_fingerprint=preview["fingerprint"])
    report = result["draft"]["writing_review"]
    self.assertEqual(report["status"], "failed")
    self.assertIn("budget exhausted", report["error"])
    self.assertEqual(result["proposed_body"], FIRST + "\n")

  def test_interrupted_refinement_resumes_after_completed_draft_and_critique(self):
    preview = preview_proposal_revision(self.paths, **self.args)
    with patch("openauthor.ai._call_provider", side_effect=[response(FIRST), response(CRITIQUE), RuntimeError("process lost")]):
      with self.assertRaisesRegex(RuntimeError, "process lost"):
        generate_proposal_draft(self.paths, **self.args, expected_context_fingerprint=preview["fingerprint"], request_id="partial-review")
    with patch("openauthor.ai._call_provider", side_effect=[response(REFINED), response(VERIFY)]) as provider:
      result = generate_proposal_draft(self.paths, **self.args, expected_context_fingerprint=preview["fingerprint"], request_id="partial-review")
    self.assertEqual(provider.call_count, 2)
    self.assertEqual(result["draft"]["writing_review"]["status"], "refined")
    self.assertEqual(result["draft"]["input_tokens"], 400)


if __name__ == "__main__":
  unittest.main()
