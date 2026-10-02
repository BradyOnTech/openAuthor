from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from openauthor.canon import (
  add_canon_fact,
  add_arc_state,
  add_open_question,
  add_setup,
  assess_story_memory_impact,
  disposition_diagnostic,
  list_canon_facts,
  resolve_setup,
  review_canon_fact,
  run_canon_diagnostics,
)
from openauthor.codex import add_entity
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.scenes import add_scene, update_scene


class CanonMemoryTests(unittest.TestCase):
  def test_knowledge_mentions_use_whole_words_exact_offsets_and_ignore_explicit_ignorance(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Knowledge Evidence")
      bodies = ["Mara hid the key.", "Ivo watched a monkey climb a tree.",
        "Ivo did not know where Mara had hidden the key.",
        "Ivo didn't know about the key; later, he used the KEY.",
        "Straße was empty. Ivo picked up the KEY.",
        "Mara did not know about the key. Ivo carried the key."]
      for index, body in enumerate(bodies):
        add_scene(paths, title=str(index), body=body, pov="Mara" if index == 0 else "Ivo")
      ivo = add_entity(paths, kind="character", name="Ivo")
      add_canon_fact(paths, subject_entity_id=ivo, predicate="secret object", value="key",
        evidence=[{"scene_id": "scene-0001", "excerpt": bodies[0]}],
        knowledge=[{"character_entity_id": ivo, "state": "does_not_know", "from_scene_id": "scene-0001"}])
      warnings = [row for row in run_canon_diagnostics(paths)["diagnostics"] if row["code"] == "pov_knowledge_leak"]
      self.assertEqual([row["scene_ids"] for row in warnings], [["scene-0004"], ["scene-0005"], ["scene-0006"]])
      for warning in warnings:
        passage = warning["evidence"][-1]
        body = bodies[int(passage["scene_id"].split("-")[1]) - 1]
        self.assertEqual(body[passage["start"]:passage["end"]], passage["excerpt"])
      self.assertEqual(warnings[0]["evidence"][-1]["excerpt"], "KEY")

  def test_knowledge_warnings_follow_latest_state_and_fact_validity_in_reading_order(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Learning")
      for index in range(5):
        add_scene(paths, title=str(index), body="The passphrase is NIGHTJAR.", pov="Ivo")
      ivo = add_entity(paths, kind="character", name="Ivo")
      add_canon_fact(paths, subject_entity_id=ivo, predicate="passphrase", value="NIGHTJAR",
        evidence=[{"scene_id": "scene-0001", "excerpt": "The passphrase is NIGHTJAR."}],
        valid_from_scene_id="scene-0002", valid_to_scene_id="scene-0004",
        knowledge=[
          {"character_entity_id": ivo, "state": "does_not_know", "from_scene_id": "scene-0001"},
          {"character_entity_id": ivo, "state": "knows", "from_scene_id": "scene-0003"},
          {"character_entity_id": ivo, "state": "does_not_know", "from_scene_id": "scene-0004"},
        ])
      warnings = [row for row in run_canon_diagnostics(paths)["diagnostics"] if row["code"] == "pov_knowledge_leak"]
      self.assertEqual([row["scene_ids"] for row in warnings], [["scene-0002"], ["scene-0004"]])

  def test_repeated_trait_evidence_is_bounded_but_preserves_both_sides_of_a_mismatch(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Readable Evidence")
      for index in range(12):
        add_scene(paths, title=str(index), body=f"Mara's eyes were {'blue' if index < 11 else 'green'}.")
      warning = next(row for row in run_canon_diagnostics(paths)["diagnostics"] if row["code"] == "prose_trait_mismatch")
      self.assertLessEqual(len(warning["evidence"]), 8)
      self.assertEqual(warning["evidence_count"], 12)
      self.assertTrue(any("green" in row["excerpt"] for row in warning["evidence"]))
      self.assertTrue(any("blue" in row["excerpt"] for row in warning["evidence"]))
      self.assertIn("8 of 12", warning["message"])

  def test_author_can_relink_or_retire_a_fact_without_changing_its_identity_or_overwriting_a_newer_review(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Repair Evidence")
      add_scene(paths, title="One", body="The gate is blue.")
      fact = add_canon_fact(paths, subject_entity_id="", predicate="color", value="blue", evidence=[{"scene_id": "scene-0001", "excerpt": "The gate is blue."}])
      update_scene(paths, scene_identifier="scene-0001", body="The gate gleams blue.")
      repaired = review_canon_fact(paths, fact["id"], disposition="accepted", evidence=[{"scene_id": "scene-0001", "excerpt": "The gate gleams blue."}], expected_updated_at=fact["updated_at"])
      self.assertEqual(repaired["id"], fact["id"])
      self.assertEqual(repaired["value"], "blue")
      self.assertFalse(run_canon_diagnostics(paths)["diagnostics"])
      with self.assertRaisesRegex(OpenAuthorError, "changed"):
        review_canon_fact(paths, fact["id"], disposition="rejected", expected_updated_at=fact["updated_at"])
      self.assertEqual(list_canon_facts(paths), [repaired])
      retired = review_canon_fact(paths, fact["id"], disposition="rejected", expected_updated_at=repaired["updated_at"])
      self.assertEqual(retired["status"], "rejected")
      self.assertEqual(retired["evidence"], repaired["evidence"])
      self.assertFalse(list_canon_facts(paths, status="accepted"))

  def test_reading_canon_and_running_diagnostics_do_not_create_book_files(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Read Only Checks")
      self.assertFalse((paths.root / "codex" / "memory.json").exists())
      list_canon_facts(paths)
      run_canon_diagnostics(paths)
      self.assertFalse((paths.root / "codex" / "memory.json").exists())

  def test_changed_historical_evidence_is_flagged_without_rewriting_author_canon(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Historical Evidence")
      add_scene(paths, title="One", body="The gate is blue.")
      fact = add_canon_fact(paths, subject_entity_id="", predicate="color", value="blue", evidence=[{"scene_id": "scene-0001", "excerpt": "The gate is blue."}])
      update_scene(paths, scene_identifier="scene-0001", body="The gate is red.")
      warnings = [row for row in run_canon_diagnostics(paths)["diagnostics"] if row["code"] == "stale_evidence"]
      self.assertEqual(len(warnings), 1)
      self.assertEqual(warnings[0]["fact_ids"], [fact["id"]])
      self.assertEqual(warnings[0]["evidence"], fact["evidence"])
      self.assertEqual(list_canon_facts(paths), [fact])
      update_scene(paths, scene_identifier="scene-0001", body="A new opening. The gate is blue.")
      self.assertFalse([row for row in run_canon_diagnostics(paths)["diagnostics"] if row["code"] == "stale_evidence"])

  def test_new_canon_evidence_must_match_current_prose_and_records_real_offsets(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Verified Evidence")
      prose = "🌙 Élodie carries a key. The key is blue. The key is blue."
      add_scene(paths, title="One", body=prose)
      for excerpt in ["An invented quote.", "The key is blue."]:
        with self.subTest(excerpt=excerpt), self.assertRaises(OpenAuthorError):
          add_canon_fact(paths, subject_entity_id="", predicate="color", value="blue", evidence=[{"scene_id": "scene-0001", "excerpt": excerpt}])
      self.assertEqual(list_canon_facts(paths), [])
      fact = add_canon_fact(paths, subject_entity_id="", predicate="carries", value="key", evidence=[{"scene_id": "scene-0001", "excerpt": "Élodie carries a key."}])
      evidence = fact["evidence"][0]
      self.assertEqual(evidence["start"], 2)
      self.assertEqual(prose[evidence["start"]:evidence["end"]], evidence["excerpt"])
      occurrence = prose.rfind("The key is blue.")
      anchored = add_canon_fact(paths, subject_entity_id="", predicate="color", value="blue", evidence=[{"scene_id": "scene-0001", "excerpt": "The key is blue.", "start": occurrence, "end": occurrence + len("The key is blue.")}])
      self.assertEqual(anchored["evidence"][0]["start"], occurrence)

  def test_multiple_possessions_and_general_descriptions_are_not_exclusive_canon(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Nonexclusive Canon")
      body = "Mara owns a sword. Mara owns a horse. Mara is a captain. Mara is tired."
      add_scene(paths, title="One", body=body)
      mara = add_entity(paths, kind="character", name="Mara")
      for predicate, value in [("owns", "a sword"), ("owns", "a horse"), ("is", "a captain"), ("is", "tired")]:
        add_canon_fact(paths, subject_entity_id=mara, predicate=predicate, value=value, evidence=[{"scene_id": "scene-0001", "excerpt": f"Mara {predicate} {value}."}])
      self.assertEqual(run_canon_diagnostics(paths)["diagnostics"], [])

  def test_trait_checks_compare_eye_and_hair_colors_without_conflating_characters_or_hands(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Distinct Traits")
      add_entity(paths, kind="character", name="Mara Voss", aliases=["Mara"])
      add_entity(paths, kind="character", name="Mara Lynn", aliases=["Mara"])
      add_scene(paths, title="Before", body="Mara Voss's eyes were blue. Mara Voss's hair was black. Mara Voss's left hand had four fingers. Mara Lynn's eyes were green.")
      add_scene(paths, title="After", body="Mara Voss's eyes were green. Mara Voss's hair was brown. Mara Voss's right hand had five fingers. Mara's eyes were brown.")
      warnings = [row for row in run_canon_diagnostics(paths)["diagnostics"] if row["code"] == "prose_trait_mismatch"]
      self.assertEqual(len(warnings), 2)
      self.assertTrue(all("Mara Voss" in row["message"] for row in warnings))
      self.assertTrue(any("eye color" in row["message"] for row in warnings))
      self.assertTrue(any("hair color" in row["message"] for row in warnings))
      self.assertTrue(all(len(row["evidence"]) == 2 for row in warnings))

  def test_nearby_pronoun_evidence_is_explicitly_tentative_and_does_not_cross_paragraphs(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Contextual Trait")
      add_scene(paths, title="Before", body="Ivo nodded. Mara had hidden the key. She had not moved it. Her left hand still had four fingers.")
      add_scene(paths, title="After", body="Mara raised her left hand, all five fingers spread.")
      warning = next(row for row in run_canon_diagnostics(paths)["diagnostics"] if row["code"] == "prose_trait_mismatch")
      self.assertIn("inferred", warning["message"])
      self.assertEqual(warning["evidence"][0]["attribution"], "nearby name; review attribution")
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="No Cross Paragraph Guess")
      add_scene(paths, title="Before", body="Mara left.\n\nHer left hand had four fingers.")
      add_scene(paths, title="After", body="Mara raised her left hand, all five fingers spread.")
      self.assertEqual(run_canon_diagnostics(paths)["diagnostics"], [])

  def test_trait_checks_do_not_treat_dialogue_negation_or_hypotheticals_as_story_truth(self) -> None:
    for second in [
      '"Mara\'s left hand had five fingers," Ivo lied.',
      '“Mara’s left hand had five fingers,” Ivo claimed.',
      "If Mara's left hand had five fingers, she would play the lute.",
      "Mara's left hand had five fingers only in her dreams.",
      "Mara's left hand had not five fingers but four.",
      "Mara imagined her left hand, all five fingers spread.",
    ]:
      with self.subTest(prose=second), tempfile.TemporaryDirectory() as tmp:
        paths = initialize_project(Path(tmp), name="Uncertain Observations")
        add_scene(paths, title="First", body="Mara's left hand had four fingers.")
        add_scene(paths, title="Second", body=second)
        self.assertFalse([row for row in run_canon_diagnostics(paths)["diagnostics"] if row["code"] == "prose_trait_mismatch"])

  def test_prose_trait_mismatch_needs_no_manually_seeded_canon(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Prose Continuity")
      first = "Élodie Marchand's left hand had four fingers. Élodie closed the door."
      second = "Élodie raised her left hand, all five fingers spread."
      add_scene(paths, title="Before", body=first)
      add_scene(paths, title="After", body=second)
      report = run_canon_diagnostics(paths)
      warnings = [row for row in report["diagnostics"] if row["code"] == "prose_trait_mismatch"]
      self.assertEqual(len(warnings), 1)
      warning = warnings[0]
      self.assertEqual(warning["severity"], "warning")
      self.assertIn("Élodie Marchand", warning["message"])
      self.assertIn("left hand finger count", warning["message"])
      self.assertEqual(warning["fact_ids"], [])
      self.assertEqual(warning["scene_ids"], ["scene-0001", "scene-0002"])
      for evidence, prose in zip(warning["evidence"], [first, second]):
        self.assertEqual(prose[evidence["start"]:evidence["end"]], evidence["excerpt"])
      self.assertIn("limited", report["coverage"]["method"])

  def test_conflicts_knowledge_setup_and_dispositions_are_evidence_backed(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Canon")
      add_scene(paths, title="One", pov="Mara", body="Mara sees that the gate is blue. She carries a brass key.")
      for index in range(2, 8):
        body = {2: "The gate is painted red. A quiet interval.", 3: "The gate is blue.", 7: "At last, the key turns."}.get(index, "A quiet interval.")
        add_scene(paths, title=f"Scene {index}", pov="Mara" if index == 3 else "Ivo", body=body)
      gate = add_entity(paths, kind="location", name="The Gate")
      mara = add_entity(paths, kind="character", name="Mara")
      first = add_canon_fact(
        paths,
        subject_entity_id=gate,
        predicate="color",
        value="blue",
        evidence=[{"scene_id": "scene-0001", "excerpt": "the gate is blue"}],
        knowledge=[{"character_entity_id": mara, "state": "does_not_know", "from_scene_id": "scene-0001"}],
      )
      second = add_canon_fact(
        paths,
        subject_entity_id=gate,
        predicate="color",
        value="red",
        evidence=[{"scene_id": "scene-0002", "excerpt": "painted red"}],
      )
      setup = add_setup(paths, description="The brass key should open something.", setup_scene_id="scene-0001", excerpt="brass key")
      add_open_question(paths, question="Who built the gate?", scene_id="scene-0001", intentionally_unresolved=True)
      add_arc_state(paths, character_entity_id=mara, dimension="trust in Ivo", value="guarded", scene_id="scene-0002", excerpt="A quiet interval.")
      add_arc_state(paths, character_entity_id=mara, dimension="trust in Ivo", value="complete", scene_id="scene-0002", excerpt="A quiet interval.")

      report = run_canon_diagnostics(paths)
      codes = {row["code"] for row in report["diagnostics"]}
      self.assertIn("conflicting_facts", codes)
      self.assertIn("pov_knowledge_leak", codes)
      self.assertIn("unresolved_setup", codes)
      self.assertIn("arc_state_conflict", codes)
      conflict = next(row for row in report["diagnostics"] if row["code"] == "conflicting_facts")
      self.assertEqual(set(conflict["fact_ids"]), {first["id"], second["id"]})
      self.assertGreaterEqual(len(conflict["evidence"]), 2)

      impact = assess_story_memory_impact(
        paths,
        scene_id="scene-0001",
        before_body="Mara sees that the gate is blue.",
        after_body="Mara sees that the gate is colorless.",
      )
      self.assertEqual(impact["risk"], "high")
      self.assertIn(first["id"], {row["id"] for row in impact["affected"]})

      disposition_diagnostic(paths, conflict["id"], disposition="intentional", notes="Unreliable mural descriptions.")
      refreshed = run_canon_diagnostics(paths)
      disposed = next(row for row in refreshed["diagnostics"] if row["id"] == conflict["id"])
      self.assertEqual(disposed["disposition"]["disposition"], "intentional")
      paid = resolve_setup(paths, setup["id"], payoff_scene_id="scene-0007", excerpt="the key turns")
      self.assertEqual(paid["status"], "paid_off")


if __name__ == "__main__":
  unittest.main()
