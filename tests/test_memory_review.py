import unittest
import tempfile
from pathlib import Path

from scripts.evaluate_memory_review import evaluate
from openauthor.codex import add_entity, list_entities
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.scenes import add_scene, update_scene
from openauthor.story_memory import correct_memory_suggestion, extract_memory_suggestions, list_memory_suggestions, review_memory_suggestion


class MemoryReviewTests(unittest.TestCase):
  def test_type_correction_survives_rescan_and_is_accepted_as_a_location(self):
    with tempfile.TemporaryDirectory() as directory:
      paths = initialize_project(Path(directory), name="Correct a place")
      add_scene(paths, title="Gate", body="North Gate was closed. North Gate opened at dawn.")
      suggestion = extract_memory_suggestions(paths)["suggestions"][0]
      corrected = correct_memory_suggestion(paths, suggestion["id"], entity_type="location", expected_version=suggestion["review_version"])
      self.assertEqual(corrected["entity_type"], "location")
      with self.assertRaisesRegex(OpenAuthorError, "changed"):
        review_memory_suggestion(paths, suggestion["id"], disposition="accepted", expected_version=suggestion["review_version"])
      refreshed = extract_memory_suggestions(paths)["suggestions"][0]
      self.assertEqual(refreshed["entity_type"], "location")
      review_memory_suggestion(paths, refreshed["id"], disposition="accepted", expected_version=refreshed["review_version"])
      self.assertEqual(list_entities(paths)[0]["type"], "location")

  def test_changed_source_or_another_correction_refuses_a_stale_review(self):
    with tempfile.TemporaryDirectory() as directory:
      paths = initialize_project(Path(directory), name="Source review")
      add_scene(paths, title="Wait", body="Mara waited. Mara stayed.")
      suggestion = extract_memory_suggestions(paths)["suggestions"][0]
      update_scene(paths, scene_identifier="scene-0001", body="Mara left. Mara returned.")
      with self.assertRaisesRegex(OpenAuthorError, "changed"):
        correct_memory_suggestion(paths, suggestion["id"], name="New name", expected_version=suggestion["review_version"])
      self.assertEqual(list_entities(paths), [])

  def test_corrected_place_refuses_a_new_matching_character_without_mutating_either_record(self):
    with tempfile.TemporaryDirectory() as directory:
      paths = initialize_project(Path(directory), name="Separate identities")
      add_scene(paths, title="Gate", body="North Gate was closed. North Gate opened at dawn.")
      suggestion = extract_memory_suggestions(paths)["suggestions"][0]
      corrected = correct_memory_suggestion(paths, suggestion["id"], entity_type="location", expected_version=suggestion["review_version"])
      add_entity(paths, kind="character", name="North Gate", description="A different identity.")
      before_entities = list_entities(paths)
      before_suggestions = list_memory_suggestions(paths)
      with self.assertRaisesRegex(OpenAuthorError, "Resolve the identity"):
        review_memory_suggestion(paths, corrected["id"], disposition="accepted", expected_version=corrected["review_version"])
      self.assertEqual(list_entities(paths), before_entities)
      self.assertEqual(list_memory_suggestions(paths), before_suggestions)
      self.assertEqual(before_suggestions[0]["status"], "pending")
      self.assertEqual(before_suggestions[0]["entity_type"], "location")

  def test_accepting_one_identity_does_not_bulk_accept_a_different_type(self):
    with tempfile.TemporaryDirectory() as directory:
      paths = initialize_project(Path(directory), name="Separate suggested identities")
      add_scene(paths, title="Gate", body="Mara arrived. Mara waited. North Gate was closed. North Gate opened.")
      suggestions = {row["name"]: row for row in extract_memory_suggestions(paths)["suggestions"]}
      place = correct_memory_suggestion(paths, suggestions["North Gate"]["id"], entity_type="location", expected_version=suggestions["North Gate"]["review_version"])
      renamed = correct_memory_suggestion(paths, suggestions["Mara"]["id"], name="North Gate", expected_version=suggestions["Mara"]["review_version"])
      review_memory_suggestion(paths, place["id"], disposition="accepted", expected_version=place["review_version"])
      retained = next(row for row in list_memory_suggestions(paths) if row["id"] == renamed["id"])
      self.assertEqual(retained["status"], "pending")
      self.assertEqual(retained["entity_type"], "character")

  def test_grammatical_openers_and_modifiers_do_not_become_people_or_erase_genuine_names(self):
    result = evaluate(Path(__file__).with_name("fixtures") / "memory_review_cases.json")
    cases = {row["id"]: row for row in result["cases"]}
    for identifier, case in cases.items():
      self.assertEqual(case["invalid_evidence"], [], identifier)
      if identifier not in {"ambiguous-capitalized-places", "uncased-script-names"}:
        self.assertEqual(case["extra"], [], identifier)
        self.assertEqual(case["missed"], [], identifier)
        self.assertEqual(case["type_errors"], [], identifier)
    # Keep these limitations visible rather than assigning full quality credit.
    self.assertEqual(cases["ambiguous-capitalized-places"]["type_errors"], ["Last Ferry", "North Gate"])
    self.assertEqual(cases["uncased-script-names"]["missed"], ["小林", "阿明"])
