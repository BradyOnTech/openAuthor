import tempfile
import unittest
from pathlib import Path

from openauthor.codex import add_entity, list_entities, list_relationships
from openauthor.canon import list_canon_facts
from openauthor.project import initialize_project
from openauthor.scenes import add_scene, get_scene, update_scene
from openauthor.story_memory import extract_memory_suggestions, review_memory_suggestion


class MemoryAssertionTests(unittest.TestCase):
  def extract(self, body):
    directory = tempfile.TemporaryDirectory(prefix="openauthor-memory-assertions-")
    self.addCleanup(directory.cleanup)
    paths = initialize_project(Path(directory.name), name="Memory assertion review")
    add_entity(paths, kind="character", name="Elin")
    add_entity(paths, kind="character", name="Tomas")
    add_scene(paths, title="Evidence", body=body)
    before = get_scene(paths, "scene-0001")["body"]
    entities = list_entities(paths)
    rows = extract_memory_suggestions(paths)["suggestions"]
    self.assertEqual(get_scene(paths, "scene-0001")["body"], before)
    self.assertEqual(list_entities(paths), entities)
    self.assertEqual(list_relationships(paths), [])
    self.assertEqual(list_canon_facts(paths), [])
    for row in rows:
      for evidence in row["evidence"]:
        self.assertEqual(body[evidence["start"]:evidence["end"]], evidence.get("anchor_text", evidence["excerpt"]))
    return paths, [row for row in rows if row["kind"] in {"canon_fact", "relationship_create"}]

  def test_conditional_speculative_and_reported_statements_do_not_become_explicit_facts_or_connections(self):
    cases = [
      "If Elin owns the red key, the door will open.",
      "Elin owns the red key if the rumour is true.",
      "Perhaps Elin knows the safe number.",
      "Tomas imagined that Elin was a spy.",
      "If Elin trusts Tomas, he will answer.",
      "Tomas dreamed that Elin protects Tomas.",
      "The witness said Elin trusts Tomas.",
      "It was not true that Elin is a spy.",
      "Elin trusts Tomas?",
      "Elin owns the key, according to the witness.",
      "Elin is a “traitor” in the witness's words.",
      'Elin "never" trusts Tomas.',
      "Elin is a spy, Tomas claimed.",
      "Elin is a spy, Leah says.",
      "Elin trusts Tomas, Leah believes.",
      "Elin owns the red key, the witness reports.",
    ]
    for body in cases:
      with self.subTest(body=body):
        _, rows = self.extract(body)
        self.assertEqual(rows, [])

  def test_quoted_claims_are_not_facts_but_narration_after_them_is_still_reviewable(self):
    for opening, closing in [("“", "”"), ('"', '"'), ("‘", "’"), ("'", "'")]:
      body = f"{opening}Elin owns Tomas's key and Elin trusts Tomas,{closing} said the witness. Elin owns the blue ribbon."
      with self.subTest(quotes=(opening, closing)):
        _, rows = self.extract(body)
        self.assertEqual([(row["kind"], row.get("value")) for row in rows], [("canon_fact", "the blue ribbon")])

  def test_direct_declarations_negative_values_and_explicit_distrust_remain_reviewable(self):
    body = "Elin owns the red key. Elin is not a spy. Elin does not trust Tomas. At the gate, Elin protects Tomas. Elin owns Tomas' coat."
    _, rows = self.extract(body)
    self.assertEqual({row["relation"] for row in rows if row["kind"] == "relationship_create"}, {"distrusts", "protects"})
    self.assertEqual({(row["predicate"], row["value"]) for row in rows if row["kind"] == "canon_fact"}, {("owns", "the red key"), ("is", "not a spy"), ("owns", "Tomas' coat")})

  def test_escaped_nested_quotes_do_not_end_the_reported_speech(self):
    for escape in ["\\", "\\\\\\"]:
      body = '"The witness said ' + escape + '"Elin trusts Tomas' + escape + '" yesterday," Leah said. Elin owns the blue ribbon.'
      with self.subTest(escape=escape):
        _, rows = self.extract(body)
        self.assertEqual([(row["kind"], row.get("value")) for row in rows], [("canon_fact", "the blue ribbon")])

  def test_semicolon_keeps_a_direct_clause_separate_from_an_unrelated_guess(self):
    body = "Perhaps the rain will stop; Elin owns the red key; Elin trusts Tomas."
    _, rows = self.extract(body)
    self.assertEqual({row["relation"] for row in rows if row["kind"] == "relationship_create"}, {"trusts"})
    self.assertEqual([(row["predicate"], row["value"]) for row in rows if row["kind"] == "canon_fact"], [("owns", "the red key")])

  def test_a_stated_belief_does_not_turn_its_object_into_a_fact_about_someone_else(self):
    _, rows = self.extract("Elin believes Tomas is a spy.")
    self.assertEqual([(row["subject_name"], row["predicate"], row["value"]) for row in rows], [("Elin", "believes", "Tomas is a spy")])

  def test_an_author_defined_name_matching_a_speculative_word_is_not_erased(self):
    paths, _ = self.extract("Elin waited.")
    add_entity(paths, kind="character", name="Maybe")
    update_scene(paths, scene_identifier="scene-0001", body="Maybe owns the red key. Maybe trusts Elin.")
    rows = extract_memory_suggestions(paths)["suggestions"]
    self.assertEqual([(row["predicate"], row["value"]) for row in rows if row["kind"] == "canon_fact"], [("owns", "the red key")])
    self.assertEqual([row["relation"] for row in rows if row["kind"] == "relationship_create"], ["trusts"])

  def test_author_defined_uncertainty_words_remain_identities_in_targets_and_possessive_values(self):
    paths, _ = self.extract("Elin waited.")
    add_entity(paths, kind="character", name="Maybe", aliases=["Perhaps"])
    add_entity(paths, kind="character", name="Hope")
    update_scene(paths, scene_identifier="scene-0001", body="Elin trusts Maybe. Elin owns Maybe’s coat. Elin knows Hope’s number. Elin protects Perhaps.")
    rows = extract_memory_suggestions(paths)["suggestions"]
    self.assertEqual({(row["relation"], row["target_name"]) for row in rows if row["kind"] == "relationship_create"}, {("trusts", "Maybe"), ("protects", "Maybe")})
    self.assertEqual({(row["predicate"], row["value"]) for row in rows if row["kind"] == "canon_fact"}, {("owns", "Maybe’s coat"), ("knows", "Hope’s number")})
    update_scene(paths, scene_identifier="scene-0001", body="Perhaps Elin trusts Maybe. Elin owns Maybe’s coat if the story is true.")
    rows = extract_memory_suggestions(paths)["suggestions"]
    self.assertEqual([row for row in rows if row["kind"] in {"canon_fact", "relationship_create"}], [])

  def test_an_indirect_complement_is_not_treated_as_a_direct_declaration(self):
    _, rows = self.extract("Tomas pretended that Elin owns the red key. Elin owns the blue ribbon.")
    self.assertEqual([(row["predicate"], row["value"]) for row in rows], [("owns", "the blue ribbon")])

  def test_rescan_retires_an_unreviewed_claim_but_preserves_an_author_accepted_fact(self):
    paths, rows = self.extract("Elin owns the red key. Elin knows the number.")
    accepted = next(row for row in rows if row["predicate"] == "owns")
    review_memory_suggestion(paths, accepted["id"], disposition="accepted", expected_version=accepted["review_version"])
    before = list_canon_facts(paths)
    update_scene(paths, scene_identifier="scene-0001", body="Tomas imagined that Elin owns the red key and Elin knows the number.")
    rescanned = extract_memory_suggestions(paths)["suggestions"]
    self.assertEqual(list_canon_facts(paths), before)
    self.assertEqual([(row["predicate"], row["status"]) for row in rescanned if row["kind"] == "canon_fact"], [("owns", "accepted")])


if __name__ == "__main__":
  unittest.main()
