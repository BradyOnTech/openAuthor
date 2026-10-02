from __future__ import annotations

import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from openauthor.codex import add_entity, list_entities, update_entity
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.scenes import add_scene, get_scene, update_scene
from openauthor.story_memory import correct_memory_suggestion, extract_memory_suggestions, list_memory_suggestions, queue_memory_suggestion, review_memory_suggestion


class MemoryScanTests(unittest.TestCase):
  def setUp(self):
    directory = tempfile.TemporaryDirectory()
    self.addCleanup(directory.cleanup)
    self.paths = initialize_project(Path(directory.name), name="Reviewed Memory scan")
    self.body = "小林关上门。小林等待回信。阿明回来了。阿明没有说话。"
    self.scene = add_scene(self.paths, title="A reply", body=self.body)
    self.body = get_scene(self.paths, "scene-0001")["body"]
    add_scene(self.paths, title="Unselected", body="UNSELECTED-PROSE")

  def args(self, **changes):
    return {"scene_ids": ["scene-0001"], "provider": "openai", "model": "", **changes}

  def preview(self, **changes):
    from openauthor.memory_scan import preview_memory_scan
    return preview_memory_scan(self.paths, **self.args(**changes))

  def entity(self, source_name, kind="character", **changes):
    start = self.body.index(source_name)
    return {"name": source_name, "entity_type": kind, "description": "Appears in the selected passage.", "aliases": [], "alternative_types": [],
      "evidence": [{"scene_id": "scene-0001", "excerpt": source_name, "start": start, "end": start + len(source_name)}], **changes}

  def run_scan(self, candidates, **changes):
    from openauthor.memory_scan import generate_memory_scan
    preview = self.preview(**changes)
    result = {"text": json.dumps({"entities": candidates}, ensure_ascii=False), "input_tokens": 100, "output_tokens": 100, "latency_ms": 1, "attempts": 1, "tool_calls": []}
    with patch("openauthor.ai._call_provider", return_value=result) as provider:
      report = generate_memory_scan(self.paths, **self.args(**changes), expected_fingerprint=preview["fingerprint"])
    return report, provider

  def test_reviewed_interpretation_queues_uncased_names_without_mutating_prose_or_canon(self):
    before = get_scene(self.paths, "scene-0001")
    report, provider = self.run_scan([self.entity("小林"), self.entity("阿明")])
    self.assertEqual({row["name"] for row in report["suggestions"]}, {"小林", "阿明"})
    self.assertTrue(all(row["status"] == "pending" for row in report["suggestions"]))
    self.assertTrue(all(row["generation_id"] == report["generation_id"] for row in report["suggestions"]))
    self.assertEqual(get_scene(self.paths, "scene-0001"), before)
    self.assertEqual(list_entities(self.paths), [])
    payload = json.loads(provider.call_args.kwargs["user_prompt"])
    self.assertEqual(payload["scenes"][0]["body"], self.body)
    self.assertNotIn("UNSELECTED-PROSE", json.dumps(payload))
    extract_memory_suggestions(self.paths)
    self.assertEqual({row["name"] for row in list_memory_suggestions(self.paths)}, {"小林", "阿明"})

  def test_preview_is_provider_free_exact_bounded_and_excludes_private_and_ask_identity(self):
    public = add_entity(self.paths, kind="character", name="Public", description="PRIVATE-DESCRIPTION", notes="PRIVATE-NOTE")
    hidden = add_entity(self.paths, kind="character", name="HIDDEN-IDENTITY")
    update_entity(self.paths, entity_id=hidden, ai_visibility="exclude")
    asking = add_entity(self.paths, kind="character", name="ASK-IDENTITY")
    update_entity(self.paths, entity_id=asking, ai_visibility="ask")
    with patch("openauthor.ai._call_provider") as provider:
      preview = self.preview()
    provider.assert_not_called()
    self.assertEqual(preview["scenes"][0]["body"], self.body)
    self.assertEqual(preview["accepted_entities"], [{"id": public, "type": "character", "name": "Public", "aliases": []}])
    self.assertNotIn("PRIVATE", json.dumps(preview))
    self.assertNotIn("HIDDEN-IDENTITY", json.dumps(preview))
    self.assertNotIn("ASK-IDENTITY", json.dumps(preview))
    self.assertGreater(preview["input_tokens_estimate"], 0)
    for selection in ([], ["scene-0001", "scene-0001"], ["missing"], "scene-0001"):
      with self.subTest(selection=selection), self.assertRaises(OpenAuthorError):
        self.preview(scene_ids=selection)
    update_scene(self.paths, scene_identifier="scene-0001", body="x" * 36001)
    with self.assertRaisesRegex(OpenAuthorError, "36,000|context"):
      self.preview()

  def test_stale_prose_privacy_queue_or_storyline_refuses_before_provider(self):
    from openauthor.memory_scan import generate_memory_scan
    for mutation in ("prose", "privacy", "queue", "storyline"):
      with self.subTest(mutation=mutation):
        entity = add_entity(self.paths, kind="character", name=f"Known {mutation}")
        preview = self.preview()
        if mutation == "prose":
          update_scene(self.paths, scene_identifier="scene-0001", body=self.body + "\nChanged.")
        elif mutation == "privacy":
          update_entity(self.paths, entity_id=entity, ai_visibility="exclude")
        elif mutation == "queue":
          queue_memory_suggestion(self.paths, title="New review", content="A new suggestion.")
        else:
          scope = patch("openauthor.memory_scan.workspace_edit_scope", return_value=("different", "Other Storyline"))
          scope.start()
          self.addCleanup(scope.stop)
        with patch("openauthor.ai._call_provider") as provider, self.assertRaisesRegex(OpenAuthorError, "changed|review"):
          generate_memory_scan(self.paths, **self.args(), expected_fingerprint=preview["fingerprint"])
        provider.assert_not_called()

  def test_postflight_scene_changes_preserve_entire_queue(self):
    from openauthor.memory_scan import generate_memory_scan
    preview = self.preview()
    before = list_memory_suggestions(self.paths)
    def changed(**kwargs):
      worker = threading.Thread(target=lambda: update_scene(self.paths, scene_identifier="scene-0001", body=self.body + "新的一段。"))
      worker.start()
      worker.join(timeout=3)
      self.assertFalse(worker.is_alive(), "Provider work must not hold the project lock against another writer.")
      return {"text": json.dumps({"entities": [self.entity("小林")]}), "input_tokens": 100, "output_tokens": 100, "latency_ms": 1, "attempts": 1, "tool_calls": []}
    with patch("openauthor.ai._call_provider", side_effect=changed), self.assertRaisesRegex(OpenAuthorError, "changed"):
      generate_memory_scan(self.paths, **self.args(), expected_fingerprint=preview["fingerprint"])
    self.assertEqual(list_memory_suggestions(self.paths), before)
    retained = list((self.paths.workspace_dir / "memory-scans").glob("gen-*.json"))
    self.assertEqual(len(retained), 1)
    self.assertEqual(json.loads(json.loads(retained[0].read_text())["response"])["entities"][0]["name"], "小林")
    generation = json.loads(next(self.paths.generations_dir.glob("gen-*.json")).read_text())
    self.assertEqual(generation["content_logging"], "metadata_only")
    self.assertNotIn("response_text", generation)

  def test_postflight_privacy_and_queue_changes_also_refuse_without_overwriting_review(self):
    from openauthor.memory_scan import generate_memory_scan
    identity = add_entity(self.paths, kind="character", name="A known person")
    for mutation in ("privacy", "queue"):
      with self.subTest(mutation=mutation):
        preview = self.preview()
        def changed(**kwargs):
          if mutation == "privacy":
            update_entity(self.paths, entity_id=identity, ai_visibility="exclude")
          else:
            queue_memory_suggestion(self.paths, title="Author review", content="Retain this review.")
          return {"text": json.dumps({"entities": [self.entity("小林")]}), "input_tokens": 100, "output_tokens": 100, "latency_ms": 1, "attempts": 1, "tool_calls": []}
        with patch("openauthor.ai._call_provider", side_effect=changed), self.assertRaisesRegex(OpenAuthorError, "changed"):
          generate_memory_scan(self.paths, **self.args(), expected_fingerprint=preview["fingerprint"])
        self.assertNotIn("小林", {row["name"] for row in list_memory_suggestions(self.paths)})

  def test_response_shape_limits_and_provider_failure_do_not_write_partial_candidates(self):
    from openauthor.memory_scan import generate_memory_scan
    for reply in ("not json", json.dumps([]), json.dumps({"entities": "bad"}), json.dumps({"entities": [self.entity("小林")] * 41})):
      preview = self.preview()
      result = {"text": reply, "input_tokens": 100, "output_tokens": 100, "latency_ms": 1, "attempts": 1, "tool_calls": []}
      with patch("openauthor.ai._call_provider", return_value=result), self.assertRaises(OpenAuthorError):
        generate_memory_scan(self.paths, **self.args(), expected_fingerprint=preview["fingerprint"])
      self.assertEqual(list_memory_suggestions(self.paths), [])
    preview = self.preview()
    with patch("openauthor.ai._call_provider", side_effect=OpenAuthorError("Provider unavailable")), self.assertRaises(OpenAuthorError):
      generate_memory_scan(self.paths, **self.args(), expected_fingerprint=preview["fingerprint"])
    self.assertEqual(list_memory_suggestions(self.paths), [])
    retained = list((self.paths.workspace_dir / "memory-scans").glob("gen-*.json"))
    self.assertEqual(len(retained), 4)

  def test_invalid_evidence_name_alias_type_and_unselected_sources_are_withheld(self):
    good = self.entity("小林")
    cases = [self.entity("阿明", evidence=[{"scene_id": "scene-0001", "excerpt": "invented", "start": 0, "end": 8}]),
      self.entity("阿明", evidence=[{"scene_id": "scene-0002", "excerpt": "UNSELECTED-PROSE", "start": 0, "end": 16}]),
      self.entity("阿明", name="Invented"), self.entity("阿明", aliases=["Unsupported"]), self.entity("阿明", entity_type="person")]
    report, _ = self.run_scan([good, *cases])
    self.assertEqual([row["name"] for row in report["suggestions"]], ["小林"])
    self.assertEqual(report["withheld"], len(cases))
    self.assertTrue(report["warnings"])

  def test_unique_exact_quote_can_reanchor_but_ambiguous_quote_is_withheld(self):
    shifted = self.entity("阿明", evidence=[{"scene_id": "scene-0001", "excerpt": "阿明回来了", "start": 0, "end": 5}])
    ambiguous = self.entity("小林", evidence=[{"scene_id": "scene-0001", "excerpt": "小林", "start": 1, "end": 3}])
    report, _ = self.run_scan([shifted, ambiguous])
    self.assertEqual([row["name"] for row in report["suggestions"]], ["阿明"])
    self.assertEqual(report["withheld"], 1)
    item = report["suggestions"][0]["evidence"][0]
    self.assertEqual(self.body[item["start"]:item["end"]], item["excerpt"])
    self.assertTrue(any("corrected" in row for row in report["warnings"]))

  def test_uncertain_type_requires_explicit_confirmation_and_corrections_survive_local_scan(self):
    self.body = "North Gate was closed. North Gate opened at dawn."
    update_scene(self.paths, scene_identifier="scene-0001", body=self.body)
    local = extract_memory_suggestions(self.paths)["suggestions"][0]
    report, _ = self.run_scan([self.entity("North Gate", "location", alternative_types=["item"])])
    candidate = report["suggestions"][0]
    self.assertEqual(candidate["id"], local["id"])
    self.assertEqual(candidate["entity_type"], "location")
    with self.assertRaisesRegex(OpenAuthorError, "type|classification"):
      review_memory_suggestion(self.paths, candidate["id"], disposition="accepted", expected_version=candidate["review_version"])
    corrected = correct_memory_suggestion(self.paths, candidate["id"], entity_type="location", expected_version=candidate["review_version"])
    self.assertTrue(corrected["type_confirmed"])
    refreshed = extract_memory_suggestions(self.paths)["suggestions"][0]
    self.assertEqual(refreshed["entity_type"], "location")
    review_memory_suggestion(self.paths, refreshed["id"], disposition="accepted", expected_version=refreshed["review_version"])
    self.assertEqual(list_entities(self.paths)[0]["type"], "location")

  def test_rescan_cannot_resolve_prior_classification_uncertainty_without_author_confirmation(self):
    self.body = "North Gate was closed. North Gate opened at dawn."
    update_scene(self.paths, scene_identifier="scene-0001", body=self.body)
    self.run_scan([self.entity("North Gate", "location", alternative_types=["item"])])
    report, _ = self.run_scan([self.entity("North Gate", "character")])
    candidate = report["suggestions"][0]
    self.assertTrue(candidate["classification_uncertain"])
    self.assertFalse(candidate["type_confirmed"])
    self.assertEqual(set(candidate["type_candidates"]), {"location", "item", "character"})
    with self.assertRaisesRegex(OpenAuthorError, "type|classification"):
      review_memory_suggestion(self.paths, candidate["id"], disposition="accepted", expected_version=candidate["review_version"])

  def test_accepting_another_suggestion_cannot_bulk_confirm_uncertain_identity(self):
    self.body = "North Gate was closed. North Gate opened at dawn."
    update_scene(self.paths, scene_identifier="scene-0001", body=self.body)
    report, _ = self.run_scan([self.entity("North Gate", "location", alternative_types=["item"])])
    uncertain = report["suggestions"][0]
    store_path = self.paths.root / "codex" / "suggestions.json"
    store = json.loads(store_path.read_text())
    other = {**store["suggestions"][0], "id": "separate-reviewed-identity", "classification_uncertain": False, "type_confirmed": True}
    store["suggestions"].append(other)
    store_path.write_text(json.dumps(store))
    other = next(row for row in list_memory_suggestions(self.paths) if row["id"] == other["id"])
    review_memory_suggestion(self.paths, other["id"], disposition="accepted", expected_version=other["review_version"])
    retained = next(row for row in list_memory_suggestions(self.paths) if row["id"] == uncertain["id"])
    self.assertEqual(retained["status"], "pending")
    self.assertFalse(retained["type_confirmed"])

  def test_decisions_corrections_and_changed_source_guards_survive_ai_rescan(self):
    report, _ = self.run_scan([self.entity("小林"), self.entity("阿明")])
    rows = {row["name"]: row for row in report["suggestions"]}
    reviewed = review_memory_suggestion(self.paths, rows["小林"]["id"], disposition="rejected", expected_version=rows["小林"]["review_version"])
    corrected = correct_memory_suggestion(self.paths, rows["阿明"]["id"], description="Author correction", entity_type="character", expected_version=rows["阿明"]["review_version"])
    report, _ = self.run_scan([self.entity("小林"), self.entity("阿明", "location")])
    rows = {row["name"]: row for row in report["suggestions"]}
    self.assertEqual(rows["小林"], reviewed)
    self.assertEqual(rows["阿明"]["description"], "Author correction")
    self.assertEqual(rows["阿明"]["entity_type"], "character")
    update_scene(self.paths, scene_identifier="scene-0001", body=self.body + "后来。")
    extract_memory_suggestions(self.paths)
    self.assertEqual(len(list_memory_suggestions(self.paths)), 2)
    with self.assertRaisesRegex(OpenAuthorError, "changed|fresh"):
      review_memory_suggestion(self.paths, corrected["id"], disposition="accepted", expected_version=rows["阿明"]["review_version"])

  def test_local_baseline_does_not_contact_provider_or_claim_semantic_accuracy(self):
    from openauthor.memory_scan import generate_memory_scan
    preview = self.preview(provider="local")
    with patch("openauthor.ai._call_provider") as provider:
      report = generate_memory_scan(self.paths, **self.args(provider="local"), expected_fingerprint=preview["fingerprint"])
    provider.assert_not_called()
    self.assertEqual(report["generation_id"], "")
    self.assertEqual(report["suggestions"], [])
    self.assertTrue(any("capital" in row or "interpret" in row for row in report["warnings"]))

  def test_completed_analysis_with_failed_recovery_storage_does_not_queue_unrecoverable_candidates(self):
    from openauthor.memory_scan import generate_memory_scan
    preview = self.preview()
    result = {"text": json.dumps({"entities": [self.entity("小林")]}), "input_tokens": 100, "output_tokens": 100, "latency_ms": 1, "attempts": 1, "tool_calls": []}
    with patch("openauthor.ai._call_provider", return_value=result), patch("openauthor.memory_scan.atomic_write_json", side_effect=OSError("Disk full")), self.assertRaisesRegex(OpenAuthorError, "completed.*recovery.*Nothing was queued"):
      generate_memory_scan(self.paths, **self.args(), expected_fingerprint=preview["fingerprint"])
    self.assertEqual(list_memory_suggestions(self.paths), [])
    self.assertEqual(list_entities(self.paths), [])
    self.assertEqual(len(list(self.paths.generations_dir.glob("gen-*.json"))), 1)
