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
from openauthor.writing_review import _critique, _source_comparison, _verification

FIRST = "Mara opened the permit. The seal broke."
REFINED = "Mara slid the permit back. The seal remained unbroken."
CRITIQUE = {"verdict": "revise", "strengths": [], "uncertainty": "", "findings": [
  {"id": "F1", "priority": "high", "category": "fidelity", "quote": "Mara opened the permit.",
   "reason": "The candidate opens the protected permit.", "suggestion": "Keep the seal unbroken.",
   "source_evidence": [{"path": "scene.body", "quote": "She stopped before the seal."}]}]}
VERIFY = {"verdict": "accept", "uncertainty": "", "regressions": [], "resolutions": [
  {"id": "F1", "resolved": True, "quote": "The seal remained unbroken.", "reason": "The revision stops before opening the permit."}]}


def response(text, request=None):
  if isinstance(text, dict) and request and "source_checks" not in text:
    # Provider fixture receipts exercise stage transport and recovery. They
    # are not a semantic assessment of the prose.
    text = copy.deepcopy(text)
    payload = json.loads(request["user_prompt"])
    text["source_checks"] = [{"id": row["id"], "assessment": "preserved",
      "source_quote": row["source"][:100].strip() if row["source"].strip() else None,
      "candidate_quote": row["candidate"][:100].strip() if row["candidate"].strip() else None,
      "source_meaning": "Mock provider's source interpretation.",
      "candidate_meaning": "Mock provider's candidate interpretation.",
      "reason": "Fixture comparison receipt for transport validation.", "permission_evidence": []}
      for row in payload.get("source_comparison", {}).get("passages", [])]
  return {"text": text if isinstance(text, str) else json.dumps(text), "input_tokens": 100,
          "output_tokens": 40, "latency_ms": 5, "attempts": 1, "tool_calls": []}


def staged_responses(outputs):
  remaining = iter(outputs)
  def provider(**kwargs):
    item = next(remaining)
    if isinstance(item, Exception):
      raise item
    return response(item, kwargs)
  return provider


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
    with patch("openauthor.ai._call_provider", side_effect=staged_responses(outputs)) as provider:
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
      payload = json.loads(call.kwargs["user_prompt"])
      self.assertEqual(payload["references"]["scene.body"], self.before)
      self.assertEqual(payload["source_comparison"]["source_reference"], "scene.body")
      self.assertIn("She stopped before the seal.", payload["source_comparison"]["passages"][0]["source"])
      expected_candidate = REFINED if "revised_candidate" in payload else FIRST
      self.assertEqual(expected_candidate, payload["source_comparison"]["passages"][0]["candidate"])
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
                   lambda row: row["findings"][0]["source_evidence"][0].update(path="source_comparison.changes"),
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
        with patch("openauthor.ai._call_provider", side_effect=staged_responses([FIRST, model_keep, refined, verify])) as provider:
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

  def test_model_can_cite_only_the_actual_host_observations_supplied_to_its_stage(self):
    for path, quote, first, accepted in [("mechanical_observations.candidate_words", "7", FIRST, True),
                                         ("mechanical_observations.candidate_words", "8", FIRST, False),
                                         ("mechanical_observations.unshared_count", "7", FIRST, False),
                                         ("mechanical_observations.candidate_words", "7", (FIRST + " ") * 11, False)]:
      with self.subTest(path=path, quote=quote):
        pid = create_proposal(self.paths, title="Cited host count", scene_id="scene-0001", instruction="Keep sealed.",
          revision_intent={"goal": "Keep sealed.", "scene_contract": {"word_range": [9, 10]}})
        args = {**self.args, "proposal_id": pid}
        preview = preview_proposal_revision(self.paths, **args)
        critique = copy.deepcopy(CRITIQUE)
        critique["findings"][0].update(category="intent", source_evidence=[
          {"path": "scene_contract.word_range", "quote": "[9, 10]"}, {"path": path, "quote": quote}])
        verify = copy.deepcopy(VERIFY)
        verify["resolutions"].append({"id": "host-word-range", "resolved": True, "quote": REFINED, "reason": "Nine words meet the target."})
        outputs = [first, critique, REFINED, verify]
        with patch("openauthor.ai._call_provider", side_effect=staged_responses(outputs)) as provider:
          result = generate_proposal_draft(self.paths, **args, expected_context_fingerprint=preview["fingerprint"])
        report = result["draft"]["writing_review"]
        self.assertEqual(report["status"], "refined" if accepted else "failed")
        self.assertEqual(provider.call_count, 4 if accepted else 2)
        if accepted:
          evidence = next(row for row in report["critique"]["findings"] if row["id"] == "F1")["source_evidence"]
          self.assertIn({"path": path, "quote": "7"}, evidence)

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
        with patch("openauthor.ai._call_provider", side_effect=staged_responses(outputs)):
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
        return response(CRITIQUE, kwargs)
      return response(FIRST)
    with patch("openauthor.ai._call_provider", side_effect=provider):
      with self.assertRaisesRegex(OpenAuthorError, "scene changed"):
        generate_proposal_draft(self.paths, **self.args, expected_context_fingerprint=preview["fingerprint"])
    self.assertEqual(count, 2)
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"], "Author's newer writing.\n")
    self.assertNotIn("draft", get_proposal(self.paths, self.pid))

  def test_completed_stages_survive_final_delivery_loss_without_repeating_provider_calls(self):
    preview = preview_proposal_revision(self.paths, **self.args)
    with patch("openauthor.ai._call_provider", side_effect=staged_responses([FIRST, CRITIQUE, REFINED, VERIFY])) as provider, patch("openauthor.ai.set_proposal_draft", side_effect=RuntimeError("delivery lost")):
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
    with patch("openauthor.ai._call_provider", side_effect=staged_responses([FIRST, CRITIQUE, RuntimeError("process lost")])):
      with self.assertRaisesRegex(RuntimeError, "process lost"):
        generate_proposal_draft(self.paths, **self.args, expected_context_fingerprint=preview["fingerprint"], request_id="partial-review")
    with patch("openauthor.ai._call_provider", side_effect=staged_responses([REFINED, VERIFY])) as provider:
      result = generate_proposal_draft(self.paths, **self.args, expected_context_fingerprint=preview["fingerprint"], request_id="partial-review")
    self.assertEqual(provider.call_count, 2)
    self.assertEqual(result["draft"]["writing_review"]["status"], "refined")
    self.assertEqual(result["draft"]["input_tokens"], 400)

  def test_missing_source_receipts_stop_review_before_refinement(self):
    review = {"verdict": "keep", "strengths": [], "findings": [], "uncertainty": "", "source_checks": []}
    result, provider = self.generate([FIRST, review])
    self.assertEqual(provider.call_count, 2)
    self.assertEqual(result["draft"]["writing_review"]["status"], "failed")
    self.assertIn("every supplied source change", result["draft"]["writing_review"]["error"])
    self.assertEqual(result["proposed_body"], FIRST + "\n")

  def test_deleted_source_receipt_can_trigger_repair_without_candidate_quote_or_craft_finding(self):
    original = FIRST + "\n\nThe unopened letter stayed on the desk."
    update_scene(self.paths, scene_identifier="scene-0001", body=original)
    self.args["proposal_id"] = create_proposal(self.paths, title="Keep all physical details", scene_id="scene-0001",
      instruction="Preserve all physical details.")
    check = {"id": "change-1", "assessment": "violation", "source_quote": "The unopened letter stayed on the desk.",
      "candidate_quote": None, "source_meaning": "The unopened letter remains on the desk.",
      "candidate_meaning": "This passage is absent.", "reason": "The candidate deletes the stated physical detail.", "permission_evidence": []}
    review = {"verdict": "keep", "strengths": [], "findings": [], "uncertainty": "", "source_checks": [check]}
    verification = {"verdict": "accept", "resolutions": [], "regressions": [], "uncertainty": "", "source_checks": []}
    result, provider = self.generate([FIRST, review, original, verification])
    report = result["draft"]["writing_review"]
    self.assertEqual(provider.call_count, 4)
    self.assertEqual(report["critique"]["verdict"], "revise")
    self.assertEqual(report["status"], "refined")
    self.assertEqual(json.loads(provider.call_args_list[2].kwargs["user_prompt"])["source_checks"], [check])
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"], original + "\n")

  def test_source_audit_rejects_repeated_ids_wrong_side_quotes_and_non_author_permission(self):
    refs = {"scene.body": "First fact.\nSecond fact.\nThird fact.", "author_goal": "Preserve all facts.", "lore": "A world fact."}
    candidate = "Changed first.\nSecond fact.\nChanged third."
    comparison = _source_comparison(refs, candidate)
    checks = [{"id": row["id"], "assessment": "preserved", "source_quote": row["source"],
      "candidate_quote": row["candidate"], "source_meaning": "Source interpretation.", "candidate_meaning": "Candidate interpretation.",
      "reason": "Fixture receipt.", "permission_evidence": []} for row in comparison["passages"]]
    for change in [lambda rows: rows[1].update(id=rows[0]["id"]),
                   lambda rows: rows[0].update(source_quote="Changed first."),
                   lambda rows: rows[0].update(assessment="permitted_change", permission_evidence=[]),
                   lambda rows: rows[0].update(assessment="permitted_change", permission_evidence=[{"path": "lore", "quote": "A world fact."}])]:
      with self.subTest(change=change):
        mutated = copy.deepcopy(checks)
        change(mutated)
        review = {"verdict": "keep", "strengths": [], "findings": [], "uncertainty": "", "source_checks": mutated}
        with self.assertRaises(OpenAuthorError):
          _critique(json.dumps(review), candidate, refs, comparison)

  def test_incomplete_source_comparison_cannot_clear_a_draft(self):
    refs = {"scene.body": "Very long source. " * 1000, "author_goal": "Tighten the scene."}
    comparison = _source_comparison(refs, FIRST)
    self.assertTrue(comparison["truncated"])
    self.assertEqual(comparison["passages"], [])
    review = {"verdict": "keep", "strengths": [], "findings": [], "uncertainty": "", "source_checks": []}
    result = _critique(json.dumps(review), FIRST, refs, comparison)
    self.assertEqual(result["verdict"], "uncertain")
    self.assertEqual(result["source_coverage"]["total_passages"], 1)
    self.assertIn("incomplete", result["uncertainty"])

  def test_verification_checks_original_changes_beyond_prioritized_findings(self):
    refs = {"scene.body": self.before}
    comparison = _source_comparison(refs, REFINED)
    row = comparison["passages"][0]
    verification = copy.deepcopy(VERIFY)
    verification["source_checks"] = [{"id": row["id"], "assessment": "violation", "source_quote": row["source"],
      "candidate_quote": row["candidate"], "source_meaning": "Original physical actions.", "candidate_meaning": "Changed physical actions.",
      "reason": "An additional source change remains outside the resolved finding.", "permission_evidence": []}]
    result = _verification(json.dumps(verification), REFINED, refs, CRITIQUE["findings"], comparison)
    self.assertTrue(result["resolutions"][0]["resolved"])
    self.assertEqual(result["verdict"], "reject")


if __name__ == "__main__":
  unittest.main()
