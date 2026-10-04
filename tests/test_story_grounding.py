from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from openauthor.canon import add_canon_fact
from openauthor.codex import add_entity, add_relationship, update_entity
from openauthor.project import initialize_project, OpenAuthorError
from openauthor.scenes import add_scene, update_scene
from openauthor.selection_editing import preview_selection, generate_selection
from openauthor.chat import create_chat_thread, preview_chat_context, send_chat_message, list_chat_messages


class StoryGroundingTests(unittest.TestCase):
  def setUp(self):
    temporary = tempfile.TemporaryDirectory()
    self.addCleanup(temporary.cleanup)
    self.paths = initialize_project(Path(temporary.name), name="Story grounding")
    self.text = "Mara began to count the lights. Her left hand had four fingers. Ivo was her brother."
    add_scene(self.paths, title="Before", body=self.text)
    add_scene(self.paths, title="After", body="Mara's left hand had five fingers. Ivo no longer trusted her.")
    self.mara = add_entity(self.paths, kind="character", name="Mara", notes="PRIVATE_MARA_NOTE")
    self.ivo = add_entity(self.paths, kind="character", name="Ivo")
    self.args = dict(scene_id="scene-0001", start=0, end=30, selected_text=self.text[:30], action="shorten")

  def fact(self, **changes):
    args = dict(subject_entity_id=self.mara, predicate="left hand fingers", value="four", evidence=[{"scene_id": "scene-0001", "excerpt": "Her left hand had four fingers."}], valid_to_scene_id="scene-0001")
    return add_canon_fact(self.paths, **{**args, **changes})

  def test_selected_records_report_whether_they_fit_in_the_actual_prompt(self):
    from openauthor.story_grounding import prepare_story_grounding
    record = self.fact()
    small = prepare_story_grounding(self.paths, ["scene-0001"], story_approvals=[record["id"]], character_budget=1)
    self.assertEqual(small["context"]["facts"], [])
    self.assertTrue(small["choices"][0]["approved"])
    self.assertFalse(small["choices"][0]["included"])
    self.assertIn("budget", small["choices"][0]["reason"])
    full = prepare_story_grounding(self.paths, ["scene-0001"], story_approvals=[record["id"]])
    self.assertTrue(full["choices"][0]["included"])
    self.assertEqual(full["choices"][0]["reason"], "")

  def test_reading_order_changes_invalidate_review_and_tied_knowledge_is_not_silently_resolved(self):
    from openauthor.planning import assign_scene
    add_scene(self.paths, title="Final", body="Mara waited.")
    record = self.fact(valid_to_scene_id="", knowledge=[
      {"character_entity_id": self.ivo, "state": "does_not_know", "from_scene_id": "scene-0001"},
      {"character_entity_id": self.ivo, "state": "knows", "from_scene_id": "scene-0002"},
      {"character_entity_id": self.ivo, "state": "believes", "from_scene_id": "scene-0002"},
    ])
    args = {**self.args, "scene_id": "scene-0003", "end": 4, "selected_text": "Mara", "story_approvals": [record["id"]]}
    first = preview_selection(self.paths, **args)
    self.assertEqual({row["state"] for row in first["context"]["story_memory"]["facts"][0]["knowledge"]}, {"knows", "believes"})
    assign_scene(self.paths, scene_id="scene-0002", chapter_id=None, before_scene_id="scene-0001")
    after = preview_selection(self.paths, **args)
    self.assertEqual([row["state"] for row in after["context"]["story_memory"]["facts"][0]["knowledge"]], ["does_not_know"])
    self.assertNotEqual(first["fingerprint"], after["fingerprint"])
    with self.assertRaisesRegex(OpenAuthorError, "context changed"):
      generate_selection(self.paths, **args, expected_fingerprint=first["fingerprint"])

  def test_malformed_and_missing_story_permissions_fail_closed(self):
    self.fact()
    for grant in ["all", [True], [{"id": "fact"}], ["fact-missing"]]:
      with self.subTest(grant=grant), self.assertRaises(OpenAuthorError):
        preview_selection(self.paths, **self.args, story_approvals=grant)

  def test_selection_sends_only_explicitly_approved_current_story_records(self):
    fact = self.fact()
    relation = add_relationship(self.paths, source_entity_id=self.mara, target_entity_id=self.ivo, relation="sister of", notes="PRIVATE_RELATION_NOTE", valid_to_scene_id="scene-0001")
    initial = preview_selection(self.paths, **self.args)
    self.assertEqual(initial["context"]["story_memory"]["facts"], [])
    choices = {row["id"]: row for row in initial["story_choices"]}
    self.assertTrue(choices[fact["id"]]["eligible"])
    self.assertTrue(choices[relation["id"]]["eligible"])
    args = {**self.args, "story_approvals": [fact["id"], relation["id"]]}
    preview = preview_selection(self.paths, **args)
    grounding = preview["context"]["story_memory"]
    self.assertEqual([row["id"] for row in grounding["facts"]], [fact["id"]])
    self.assertEqual(grounding["facts"][0]["applies_to_scene_ids"], ["scene-0001"])
    self.assertEqual(grounding["relationships"][0]["relation"], "sister of")
    proposal = generate_selection(self.paths, **args, expected_fingerprint=preview["fingerprint"])
    log = json.loads((self.paths.root / proposal["generation"]["log_path"]).read_text())
    self.assertEqual(log["user_prompt_sha256"], hashlib.sha256(preview["user_prompt"].encode()).hexdigest())
    self.assertNotIn("PRIVATE_", preview["user_prompt"])
    self.assertEqual(preview_selection(self.paths, **self.args)["context"]["story_memory"]["facts"], [])

  def test_future_expired_and_invalid_ranges_are_not_current_truth(self):
    current = self.fact()
    future = self.fact(value="five", evidence=[{"scene_id": "scene-0002", "excerpt": "Mara's left hand had five fingers."}], valid_from_scene_id="scene-0002", valid_to_scene_id="")
    missing = add_relationship(self.paths, source_entity_id=self.mara, target_entity_id=self.ivo, relation="former ally", valid_from_scene_id="scene-9999")
    inverted = add_relationship(self.paths, source_entity_id=self.mara, target_entity_id=self.ivo, relation="ally", valid_from_scene_id="scene-0002", valid_to_scene_id="scene-0001")
    choices = {row["id"]: row for row in preview_selection(self.paths, **self.args)["story_choices"]}
    for record in (future, missing, inverted):
      self.assertFalse(choices[record["id"]]["eligible"])
      with self.assertRaisesRegex(OpenAuthorError, "Review context again"):
        preview_selection(self.paths, **self.args, story_approvals=[record["id"]])
    later = preview_selection(self.paths, **{**self.args, "scene_id": "scene-0002", "end": 4, "selected_text": "Mara"}, story_approvals=[future["id"]])
    self.assertEqual(later["context"]["story_memory"]["facts"][0]["value"], "five")
    self.assertFalse(next(row for row in later["story_choices"] if row["id"] == current["id"])["eligible"])

  def test_changed_evidence_in_another_scene_blocks_a_reviewed_request(self):
    record = self.fact(evidence=[{"scene_id": "scene-0002", "excerpt": "Mara's left hand had five fingers."}])
    suggested = self.fact(status="suggested")
    retired = self.fact(status="rejected")
    args = {**self.args, "story_approvals": [record["id"]], "provider": "openai"}
    preview = preview_selection(self.paths, **args)
    update_scene(self.paths, scene_identifier="scene-0002", body="The evidence was corrected.")
    with patch("urllib.request.urlopen") as transport:
      with self.assertRaisesRegex(OpenAuthorError, "evidence.*[Rr]eview|[Rr]eview.*evidence"):
        generate_selection(self.paths, **args, expected_fingerprint=preview["fingerprint"])
      transport.assert_not_called()
    choices = {row["id"]: row for row in preview_selection(self.paths, **self.args)["story_choices"]}
    for row in (record, suggested, retired):
      self.assertFalse(choices[row["id"]]["eligible"])

  def test_knowledge_is_scene_specific_and_restricted_people_stay_private(self):
    hidden = add_entity(self.paths, kind="character", name="PRIVATE_PERSON", ai_visibility="exclude")
    record = self.fact(valid_to_scene_id="", knowledge=[
      {"character_entity_id": self.ivo, "state": "does_not_know", "from_scene_id": "scene-0001"},
      {"character_entity_id": self.ivo, "state": "knows", "from_scene_id": "scene-0002"},
      {"character_entity_id": hidden, "state": "knows"},
    ])
    first = preview_selection(self.paths, **self.args, story_approvals=[record["id"]])
    knowledge = first["context"]["story_memory"]["facts"][0]["knowledge"]
    self.assertEqual([row["state"] for row in knowledge], ["does_not_know"])
    self.assertEqual(knowledge[0]["character_name"], "Ivo")
    self.assertNotIn(hidden, first["user_prompt"])
    self.assertNotIn("PRIVATE_PERSON", first["user_prompt"])
    second = preview_selection(self.paths, **{**self.args, "scene_id": "scene-0002", "end": 4, "selected_text": "Mara"}, story_approvals=[record["id"]])
    self.assertEqual([row["state"] for row in second["context"]["story_memory"]["facts"][0]["knowledge"]], ["knows"])
    update_entity(self.paths, entity_id=self.mara, ai_visibility="exclude")
    with self.assertRaisesRegex(OpenAuthorError, "linked Memory"):
      preview_selection(self.paths, **self.args, story_approvals=[record["id"]])

  def test_chat_grants_expire_without_erasing_the_local_transcript(self):
    record = self.fact()
    thread = create_chat_thread(self.paths, title="Current knowledge", provider="local", mode="chat")
    args = dict(thread_id=thread["id"], current_scene_id="scene-0001", message="Help revise this scene.", story_approvals=[record["id"]])
    preview = preview_chat_context(self.paths, **args)
    self.assertEqual(preview["context"]["story_memory"]["facts"][0]["id"], record["id"])
    send_chat_message(self.paths, **args, expected_context_fingerprint=preview["fingerprint"])
    self.assertTrue(list_chat_messages(self.paths, thread_id=thread["id"])[0]["context_used"]["privacy"]["one_time_approval"])
    later = preview_chat_context(self.paths, thread_id=thread["id"], current_scene_id="scene-0001", message="Continue.")
    self.assertEqual(later["context"]["story_memory"]["facts"], [])
    self.assertEqual(later["history"], [])
    self.assertTrue(later["context_used"]["privacy"]["history_reset"])
    self.assertEqual(len(list_chat_messages(self.paths, thread_id=thread["id"])), 2)
