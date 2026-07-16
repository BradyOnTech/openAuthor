from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from openauthor.codex import list_entities
from openauthor.codex import add_entity
from openauthor.canon import list_canon_facts
from openauthor.project import initialize_project
from openauthor.scenes import add_scene, update_scene
from openauthor.story_memory import (
  correct_memory_suggestion,
  extract_memory_suggestions,
  list_memory_suggestions,
  queue_memory_suggestion,
  review_memory_suggestion,
)


class StoryMemorySuggestionTests(unittest.TestCase):
  def test_assistant_insight_is_reviewable_before_becoming_memory(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Promoted Insight")
      suggestion = queue_memory_suggestion(
        paths,
        title="The bell is a promise",
        content="Treat each bell strike as a reminder of Mara's unkept oath.",
        source="assistant",
      )
      self.assertEqual(suggestion["status"], "pending")
      self.assertEqual(list_entities(paths), [])
      accepted = review_memory_suggestion(paths, suggestion["id"], disposition="accepted")
      self.assertTrue(accepted["created_entity_id"].startswith("entity-"))
      self.assertEqual(list_entities(paths)[0]["name"], "The bell is a promise")

  def test_author_can_correct_a_suggestion_before_it_becomes_canon(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Corrected Insight")
      suggestion = queue_memory_suggestion(
        paths,
        title="The silver bell",
        content="A draft interpretation.",
        source="assistant",
      )

      corrected = correct_memory_suggestion(
        paths,
        suggestion["id"],
        name="The brass bell",
        description="It marks the archive's missing minutes.",
      )
      self.assertTrue(corrected["author_corrected"])
      self.assertEqual(corrected["status"], "pending")
      self.assertEqual(list_entities(paths), [])

      accepted = review_memory_suggestion(paths, suggestion["id"], disposition="accepted")
      entity = list_entities(paths)[0]
      self.assertEqual(entity["name"], "The brass bell")
      self.assertIn("missing minutes", entity["description"])
      self.assertEqual(accepted["status"], "accepted")

  def test_extraction_is_review_first_and_preserves_evidence(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Evidence Memory")
      add_scene(
        paths,
        title="The Gate",
        pov="Mara Vale",
        body=(
          "Mara Vale carried the brass key through Bellweather. "
          "At dusk, Mara Vale hid the key beneath the archive steps."
        ),
      )

      report = extract_memory_suggestions(paths)
      self.assertGreaterEqual(report["added"], 1)
      self.assertEqual(list_entities(paths), [])
      suggestions = list_memory_suggestions(paths, status="pending")
      mara = next(row for row in suggestions if row["name"] == "Mara Vale")
      self.assertEqual(mara["evidence"][0]["scene_id"], "scene-0001")
      self.assertIn("Mara Vale", mara["evidence"][0]["excerpt"])

      accepted = review_memory_suggestion(paths, mara["id"], disposition="accepted")
      self.assertTrue(accepted["created_entity_id"].startswith("entity-"))
      self.assertEqual(list_entities(paths)[0]["name"], "Mara Vale")
      self.assertEqual(list_memory_suggestions(paths, status="pending"), [
        row for row in suggestions if row["id"] != mara["id"]
      ])

  def test_declarative_prose_becomes_a_fact_suggestion_not_silent_canon(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Fact Suggestions")
      gate_id = add_entity(paths, kind="location", name="North Gate")
      add_scene(paths, title="Watch", body="North Gate is sealed with blue glass.")
      extract_memory_suggestions(paths, scene_ids=["scene-0001"])
      facts = [row for row in list_memory_suggestions(paths, status="pending") if row["kind"] == "canon_fact"]
      self.assertEqual(len(facts), 1)
      self.assertEqual(facts[0]["subject_entity_id"], gate_id)
      self.assertEqual(list_canon_facts(paths), [])
      accepted = review_memory_suggestion(paths, facts[0]["id"], disposition="accepted")
      self.assertTrue(accepted["created_fact_id"].startswith("fact-"))
      self.assertEqual(list_canon_facts(paths)[0]["value"], "sealed with blue glass")

  def test_derived_refresh_preserves_author_metadata_and_stable_timestamp(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Stable Memory")
      add_scene(
        paths,
        title="The Gate",
        pov="Mara Vale",
        body="Mara Vale crossed the gate. Mara Vale carried the key.",
      )
      first = extract_memory_suggestions(paths)
      mara = next(row for row in first["suggestions"] if row["name"] == "Mara Vale")
      corrected = correct_memory_suggestion(
        paths,
        mara["id"],
        description="The keeper of the northern gate.",
      )

      update_scene(
        paths,
        scene_identifier="scene-0001",
        body="She crossed the gate alone.",
      )
      refreshed = extract_memory_suggestions(paths, scene_ids=["scene-0001"])
      mara_after = next(row for row in refreshed["suggestions"] if row["id"] == mara["id"])

      self.assertEqual(mara_after["updated_at"], corrected["updated_at"])
      self.assertTrue(mara_after["author_corrected"])
      self.assertEqual(mara_after["description"], "The keeper of the northern gate.")


if __name__ == "__main__":
  unittest.main()
