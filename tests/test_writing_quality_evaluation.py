import json
import unittest
from unittest.mock import patch

from openauthor.project import OpenAuthorError
from scripts.evaluate_writing_voice import CORPUS, candidate_checks, evaluate, review_packet


class WritingQualityEvaluationTests(unittest.TestCase):
  def test_original_corpus_exercises_three_modes_and_semantic_edge_cases(self):
    corpus = json.loads(CORPUS.read_text())
    self.assertEqual({row["mode"] for row in corpus["cases"]}, {"action", "dialogue", "introspection"})
    for case in corpus["cases"]:
      self.assertTrue(180 <= len(case["source"].split()) <= 400)
      self.assertGreaterEqual(len(case["facts"]), 4)
      self.assertTrue(all(phrase in case["source"] for phrase in case["protected_phrases"]))

  def test_case_selector_bounds_a_targeted_review_without_changing_default(self):
    result = evaluate(case_ids=["action-interrupted-choice"])
    self.assertEqual(result["case_ids"], ["action-interrupted-choice"])
    self.assertEqual(result["candidate_count"], 3)
    self.assertEqual(len(result["cases"]), 1)
    with self.assertRaisesRegex(ValueError, "Unknown evaluation case"):
      evaluate(case_ids=["missing-case"])

  def test_offline_public_workflow_keeps_baselines_and_never_claims_quality(self):
    with patch("openauthor.ai._call_provider", side_effect=AssertionError("Offline evaluation attempted inference")):
      result = evaluate()
    self.assertEqual(result["candidate_count"], 9)
    self.assertEqual(result["generation_calls"], 0)
    self.assertEqual(result["changed_candidates"], 0)
    packet = review_packet(result)
    self.assertIn("Not assessed", packet)
    for row in result["cases"]:
      for candidate in row["candidates"]:
        self.assertEqual(candidate["author_review"], {"ratings": {}, "notes": ""})
        self.assertNotIn(candidate["direction"], packet)
        self.assertEqual(candidate["checks"]["semantic_fidelity"], "requires human review")

  def test_api_providers_are_rejected_before_auth_or_generation(self):
    with patch("scripts.evaluate_writing_voice.get_auth_status") as auth, patch("scripts.evaluate_writing_voice.preview_voice") as preview:
      for provider in ["openai", "anthropic", "openrouter", "automatic"]:
        with self.assertRaises(ValueError):
          evaluate(provider=provider)
      auth.assert_not_called()
      preview.assert_not_called()

  def test_signed_out_subscription_fails_without_fallback(self):
    with patch("scripts.evaluate_writing_voice.get_auth_status", return_value={"openai-codex": {"authenticated": False}}), patch("scripts.evaluate_writing_voice.preview_voice") as preview:
      with self.assertRaisesRegex(OpenAuthorError, "No generation ran"):
        evaluate(provider="openai-codex")
      preview.assert_not_called()

  def test_marker_presence_is_not_confused_with_factual_correctness(self):
    case = json.loads(CORPUS.read_text())["cases"][1]
    contradiction = case["source"] + " Mara knew the spare key was in the bellows."
    checks = candidate_checks(case, contradiction)
    self.assertEqual(checks["missing_lexical_markers"], [])
    self.assertEqual(checks["missing_protected_phrases"], [])
    self.assertEqual(checks["semantic_fidelity"], "requires human review")

  def test_subscription_route_uses_existing_provider_and_craft_prompt(self):
    def response(**kwargs):
      self.assertEqual(kwargs["provider"], "openai-codex")
      self.assertIn("unfinished actions unfinished", kwargs["system_prompt"])
      self.assertIn("everyone sound alike", kwargs["system_prompt"])
      payload = json.loads(kwargs["user_prompt"])
      return {"text": json.dumps({"text": payload["source"], "observations": []}), "input_tokens": 100, "output_tokens": 100, "latency_ms": 1, "attempts": 1, "tool_calls": []}
    with patch("scripts.evaluate_writing_voice.get_auth_status", return_value={"openai-codex": {"authenticated": True}}), patch("openauthor.ai._call_provider", side_effect=response) as provider:
      result = evaluate(provider="openai-codex")
    self.assertEqual(provider.call_count, 9)
    self.assertEqual(result["provider"], "openai-codex")

  def test_best_effort_targeted_review_keeps_prose_when_review_metadata_is_bad(self):
    def response(**kwargs):
      payload = json.loads(kwargs["user_prompt"])
      return {"text": json.dumps({"text": payload["source"].replace("The ferry", "The old ferry"), "observations": [
        {"criterion": "voice_fit", "observation": "Bad evidence", "excerpt": "Not in the revision."}]}), "input_tokens": 100, "output_tokens": 100, "latency_ms": 1, "attempts": 1, "tool_calls": []}
    with patch("scripts.evaluate_writing_voice.get_auth_status", return_value={"openai-codex": {"authenticated": True}}), patch("openauthor.ai._call_provider", side_effect=response):
      result = evaluate(provider="openai-codex", model="gpt-5.6-terra", case_ids=["action-interrupted-choice"], strict_review=False)
    self.assertEqual(result["status"], "completed")
    self.assertEqual(result["candidate_count"], 3)
    self.assertTrue(all(row["warnings"] for row in result["cases"][0]["candidates"]))

  def test_rejected_assessment_retains_failure_and_other_scene_results(self):
    calls = []
    def response(**kwargs):
      calls.append(kwargs["provider"])
      payload = json.loads(kwargs["user_prompt"])
      observations = [{"criterion": "voice_fit", "observation": "Unsupported quotation", "excerpt": "Absent from the candidate."}] if len(calls) == 1 else []
      return {"text": json.dumps({"text": payload["source"], "observations": observations}), "input_tokens": 100, "output_tokens": 100, "latency_ms": 1, "attempts": 1, "tool_calls": []}
    with patch("scripts.evaluate_writing_voice.get_auth_status", return_value={"openai-codex": {"authenticated": True}}), patch("openauthor.ai._call_provider", side_effect=response):
      result = evaluate(provider="openai-codex", model="gpt-5.6-terra")
    self.assertEqual(result["status"], "partial")
    self.assertEqual(result["candidate_count"], 6)
    self.assertEqual(result["generation_calls"], 7)
    self.assertEqual(calls, ["openai-codex"] * 7)
    self.assertEqual(result["failed_cases"][0]["id"], json.loads(CORPUS.read_text())["cases"][0]["id"])
    self.assertIn("quoted text absent", result["failed_cases"][0]["error"])
    self.assertEqual(len(result["generations"]), 7)
    self.assertIn("Rejected comparison", review_packet(result))
