from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from openauthor.codex import add_entity, list_entities, list_relationships
from openauthor.canon import list_canon_facts
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.scenes import add_scene, update_scene
from openauthor.story_memory import (
  correct_memory_suggestion,
  extract_memory_suggestions,
  list_memory_suggestions,
  queue_memory_suggestion,
  review_memory_suggestion,
)


class StoryMemorySuggestionTests(unittest.TestCase):
  def test_sentence_openers_do_not_become_characters_but_can_still_be_names(self):
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Editorial precision")
      add_scene(paths, title="Gate", body="Beyond the gate, Mara waited. Beyond the river, Mara listened. Meanwhile, the clock stopped. Meanwhile, the bell rang.")
      rows = [row for row in extract_memory_suggestions(paths)["suggestions"] if row["kind"] == "entity_create"]
      self.assertEqual([row["name"] for row in rows], ["Mara"])
      add_scene(paths, title="Names", body="Beyond waited. Beyond listened. Meanwhile spoke. Meanwhile returned.")
      rows = [row for row in extract_memory_suggestions(paths)["suggestions"] if row["kind"] == "entity_create"]
      self.assertEqual({row["name"] for row in rows}, {"Mara", "Beyond", "Meanwhile"})

  def test_single_scene_refresh_keeps_manuscript_wide_character_identity(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Stable Incremental Identity")
      add_scene(paths, title="First", body="Mara Voss waited by the gate. Mara held the key.")
      add_scene(paths, title="Later", body="Mara crossed the river. Mara opened the door.")
      first = extract_memory_suggestions(paths)
      original = next(row for row in first["suggestions"] if row["kind"] == "entity_create")
      update_scene(paths, scene_identifier="scene-0002", body="Mara crossed the river. Mara locked the door.")
      refreshed = extract_memory_suggestions(paths, scene_ids=["scene-0002"])
      people = [row for row in refreshed["suggestions"] if row["kind"] == "entity_create" and row["status"] == "pending"]
      self.assertEqual([row["name"] for row in people], ["Mara Voss"])
      self.assertEqual(people[0]["id"], original["id"])
      self.assertIn("Mara", people[0]["aliases"])
      self.assertEqual(refreshed["scanned_scenes"], 1)
      review_memory_suggestion(paths, people[0]["id"], disposition="accepted")
      self.assertEqual([row["name"] for row in list_entities(paths)], ["Mara Voss"])

  def test_fact_extraction_does_not_assign_a_shared_alias_to_both_people(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Ambiguous Facts")
      first = add_entity(paths, kind="character", name="Mara Voss", aliases=["Mara"])
      add_entity(paths, kind="character", name="Mara Lynn", aliases=["Mara"])
      add_scene(paths, title="One", body="Mara owns a sword. Mara Voss owns a horse.")
      facts = [row for row in extract_memory_suggestions(paths)["suggestions"] if row["kind"] == "canon_fact"]
      self.assertEqual([(row["subject_entity_id"], row["value"]) for row in facts], [(first, "a horse")])

  def test_pov_evidence_stays_valid_after_unrelated_prose_edits_but_not_a_pov_change(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="POV Evidence")
      add_scene(paths, title="First", pov="Elara", body="She chose loyalty.")
      suggestion = extract_memory_suggestions(paths)["suggestions"][0]
      update_scene(paths, scene_identifier="scene-0001", body="She chose betrayal.")
      refreshed = extract_memory_suggestions(paths)["suggestions"][0]
      self.assertEqual(suggestion["evidence"], refreshed["evidence"])
      update_scene(paths, scene_identifier="scene-0001", pov="Mara")
      with self.assertRaisesRegex(OpenAuthorError, "changed.*scan"):
        review_memory_suggestion(paths, suggestion["id"], disposition="accepted")
      self.assertEqual(list_entities(paths), [])

  def test_changed_prose_cannot_promote_stale_extraction_to_canon(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Fresh Evidence")
      add_entity(paths, kind="location", name="North Gate")
      add_scene(paths, title="First", body="North Gate is blue.")
      first = next(row for row in extract_memory_suggestions(paths)["suggestions"] if row["kind"] == "canon_fact")
      update_scene(paths, scene_identifier="scene-0001", body="North Gate is red.")
      with self.assertRaisesRegex(OpenAuthorError, "changed.*scan"):
        review_memory_suggestion(paths, first["id"], disposition="accepted")
      self.assertEqual(list_canon_facts(paths), [])
      refreshed = extract_memory_suggestions(paths, scene_ids=["scene-0001"])
      facts = [row for row in refreshed["suggestions"] if row["kind"] == "canon_fact" and row["status"] == "pending"]
      self.assertEqual([row["value"] for row in facts], ["red"])
      review_memory_suggestion(paths, facts[0]["id"], disposition="accepted")
      self.assertEqual([row["value"] for row in list_canon_facts(paths)], ["red"])

  def test_accepting_one_full_name_does_not_accept_another_full_name_with_shared_alias(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Separate Character Reviews")
      add_scene(paths, title="First", body="Mara Voss came home. Mara slept.")
      extract_memory_suggestions(paths, scene_ids=["scene-0001"])
      add_scene(paths, title="Second", body="Mara Lynn came home. Mara left.")
      suggestions = extract_memory_suggestions(paths, scene_ids=["scene-0002"])["suggestions"]
      first = next(row for row in suggestions if row["name"] == "Mara Voss")
      second = next(row for row in suggestions if row["name"] == "Mara Lynn")
      self.assertNotIn("Mara", first["aliases"])
      self.assertNotIn("Mara", second["aliases"])
      review_memory_suggestion(paths, first["id"], disposition="accepted")
      self.assertEqual(next(row for row in list_memory_suggestions(paths) if row["id"] == second["id"])["status"], "pending")
      review_memory_suggestion(paths, second["id"], disposition="accepted")
      self.assertEqual({row["name"] for row in list_entities(paths)}, {"Mara Voss", "Mara Lynn"})

  def test_accept_does_not_pick_an_arbitrary_character_with_a_shared_alias(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Ambiguous Memory")
      first_id = add_entity(paths, kind="character", name="Mara Voss", aliases=["Mara"])
      add_entity(paths, kind="character", name="Mara Lynn", aliases=["Mara"])
      suggestion = queue_memory_suggestion(paths, title="Mara", content="A keeper of keys.")
      with self.assertRaisesRegex(OpenAuthorError, "ambiguous"):
        review_memory_suggestion(paths, suggestion["id"], disposition="accepted")
      self.assertEqual(len(list_entities(paths)), 2)
      self.assertEqual(list_memory_suggestions(paths)[0]["status"], "pending")
      correct_memory_suggestion(paths, suggestion["id"], name="Mara Voss")
      accepted = review_memory_suggestion(paths, suggestion["id"], disposition="accepted")
      self.assertEqual(accepted["created_entity_id"], first_id)

  def test_decomposed_accents_possessives_and_honorific_periods_do_not_create_duplicate_people(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Equivalent Spellings")
      prose = "E\u0301lodie Marchand waited. Élodie’s left hand hurt. Dr. Élodie Marchand stood up. Élodie's bag fell."
      add_scene(paths, title="Morning", body=prose)
      rows = [row for row in extract_memory_suggestions(paths)["suggestions"] if row["kind"] == "entity_create"]
      self.assertEqual([row["name"] for row in rows], ["Élodie Marchand"])
      row = rows[0]
      self.assertIn("Élodie", row["aliases"])
      self.assertIn("Dr. Élodie Marchand", row["aliases"])
      supported = {"E\u0301lodie Marchand", "Élodie", "Dr. Élodie Marchand"}
      self.assertTrue(all(prose[item["start"]:item["end"]] in supported for item in row["evidence"]))

  def test_honorific_first_and_last_name_variants_merge_only_when_unambiguous(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Honorific Memory")
      add_scene(paths, title="Arrival", body="Captain Soren Vale waited. Soren carried the lamp. Vale watched the gate. Soren Vale lowered the lamp. Mara Voss waited. Mara Voss looked away. Mara Lynn waited. Mara Lynn stepped inside. Mara waited. Mara looked back.")
      rows = [row for row in extract_memory_suggestions(paths)["suggestions"] if row["kind"] == "entity_create"]
      names = {row["name"]: row for row in rows}
      self.assertIn("Soren Vale", names)
      self.assertEqual(set(names["Soren Vale"]["aliases"]), {"Captain Soren Vale", "Soren", "Vale"})
      self.assertNotIn("Soren", names)
      self.assertNotIn("Captain Soren Vale", names)
      self.assertEqual(set(names), {"Soren Vale", "Mara Voss", "Mara Lynn", "Mara"})
      self.assertNotIn("Mara", names["Mara Voss"]["aliases"])
      self.assertNotIn("Mara", names["Mara Lynn"]["aliases"])

  def test_unicode_names_keep_spelling_and_exact_evidence_offsets(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Unicode Memory")
      prose = "Élodie Marchand entered the archive. Élodie opened it. Łukasz D’Ávila waited. Łukasz carried the bag. Anne-Marie O’Neill arrived. Anne-Marie took the key."
      add_scene(paths, title="Arrival", body=prose)
      suggestions = extract_memory_suggestions(paths)["suggestions"]
      names = {row["name"]: row for row in suggestions if row["kind"] == "entity_create"}
      for full, alias in [("Élodie Marchand", "Élodie"), ("Łukasz D’Ávila", "Łukasz"), ("Anne-Marie O’Neill", "Anne-Marie")]:
        self.assertIn(full, names)
        self.assertIn(alias, names[full]["aliases"])
        for evidence in names[full]["evidence"]:
          self.assertIn(prose[evidence["start"]:evidence["end"]], [full, alias])
          self.assertEqual(evidence["anchor_text"], prose[evidence["start"]:evidence["end"]])
      self.assertEqual(list_entities(paths), [])

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

  def test_extraction_consolidates_unambiguous_short_and_full_names(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Identity Memory")
      add_scene(
        paths,
        title="The Gate",
        pov="Mara Vey",
        body=(
          "Mara Vey opened the archive. Mara found her brother waiting. "
          "Ilyan Vey watched from the gate. Ilyan carried the key."
        ),
      )

      suggestions = list_memory_suggestions(paths, status="pending")
      self.assertEqual(suggestions, [])
      suggestions = extract_memory_suggestions(paths)["suggestions"]
      character_names = [row["name"] for row in suggestions if row["kind"] == "entity_create"]
      self.assertIn("Mara Vey", character_names)
      self.assertNotIn("Mara", character_names)
      mara = next(row for row in suggestions if row["name"] == "Mara Vey")
      self.assertEqual(mara["aliases"], ["Mara"])

      review_memory_suggestion(paths, mara["id"], disposition="accepted")
      entity = next(row for row in list_entities(paths) if row["name"] == "Mara Vey")
      self.assertEqual(entity["aliases"], ["Mara"])

  def test_accepting_a_corrected_duplicate_reuses_the_existing_entity(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Duplicate Memory")
      short = queue_memory_suggestion(
        paths,
        title="Mara",
        content="Mara keeps the orchard gate.",
      )
      full = queue_memory_suggestion(
        paths,
        title="Mara Vey",
        content="Mara Vey keeps the orchard gate.",
      )
      correct_memory_suggestion(paths, short["id"], name="Mara Vey")

      accepted = review_memory_suggestion(paths, short["id"], disposition="accepted")
      entities = list_entities(paths)
      full_after = next(row for row in list_memory_suggestions(paths) if row["id"] == full["id"])

      self.assertEqual(len(entities), 1)
      self.assertEqual(entities[0]["name"], "Mara Vey")
      self.assertEqual(full_after["status"], "accepted")
      self.assertEqual(full_after["created_entity_id"], accepted["created_entity_id"])

  def test_accepting_a_duplicate_of_an_existing_entity_is_idempotent(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Existing Identity")
      entity_id = add_entity(paths, kind="character", name="Mara Vey")
      suggestion = queue_memory_suggestion(
        paths,
        title="Mara Vey",
        content="Mara Vey keeps the orchard gate.",
      )

      accepted = review_memory_suggestion(paths, suggestion["id"], disposition="accepted")

      self.assertEqual(accepted["created_entity_id"], entity_id)
      self.assertEqual(len(list_entities(paths)), 1)

  def test_rescan_removes_stale_and_honorific_variants_of_accepted_entities(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Accepted Identities")
      add_scene(
        paths,
        title="The Council",
        pov="Mara Vey",
        body=(
          "Mara Vey entered beside Captain Soren Vale. "
          "Captain Soren Vale closed the chamber door. Mara waited."
        ),
      )
      first = extract_memory_suggestions(paths)
      self.assertTrue(any(row["name"] == "Mara Vey" for row in first["suggestions"]))
      add_entity(paths, kind="character", name="Mara Vey")
      add_entity(paths, kind="character", name="Soren Vale")

      refreshed = extract_memory_suggestions(paths)
      pending_names = [
        row["name"] for row in refreshed["suggestions"]
        if row["status"] == "pending" and row["kind"] == "entity_create"
      ]

      self.assertNotIn("Mara Vey", pending_names)
      self.assertNotIn("Captain Soren Vale", pending_names)
      self.assertNotIn("Soren", pending_names)

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

  def test_explicit_relationship_prose_is_reviewed_before_entering_the_graph(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Relationship Suggestions")
      mara_id = add_entity(paths, kind="character", name="Mara Vey", aliases=["Mara"])
      soren_id = add_entity(paths, kind="character", name="Soren Vale", aliases=["Soren"])
      add_scene(
        paths,
        title="The Breach",
        body=(
          "Mara distrusts Soren after the council vote. "
          "At the orchard gate, Mara protects Soren. "
          "Mara watches Soren leave without speaking."
        ),
      )

      report = extract_memory_suggestions(paths)
      suggestions = [
        row for row in report["suggestions"]
        if row["status"] == "pending" and row["kind"] == "relationship_create"
      ]

      self.assertEqual({row["relation"] for row in suggestions}, {"distrusts", "protects"})
      self.assertEqual(list_relationships(paths), [])
      distrusts = next(row for row in suggestions if row["relation"] == "distrusts")
      self.assertEqual(distrusts["source_entity_id"], mara_id)
      self.assertEqual(distrusts["target_entity_id"], soren_id)
      self.assertEqual(distrusts["valid_from_scene_id"], "scene-0001")
      self.assertEqual(distrusts["evidence"][0]["excerpt"], "Mara distrusts Soren")

      accepted = review_memory_suggestion(paths, distrusts["id"], disposition="accepted")
      relationships = list_relationships(paths)
      self.assertEqual(len(relationships), 1)
      self.assertEqual(relationships[0]["relation"], "distrusts")
      self.assertEqual(relationships[0]["valid_from_scene_id"], "scene-0001")
      self.assertEqual(accepted["created_relationship_id"], relationships[0]["id"])

      rescanned = extract_memory_suggestions(paths)
      pending_relations = [
        row["relation"] for row in rescanned["suggestions"]
        if row["status"] == "pending" and row["kind"] == "relationship_create"
      ]
      self.assertEqual(pending_relations, ["protects"])

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
