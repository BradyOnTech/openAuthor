from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from openauthor.ai import generate_proposal
from openauthor.chat import create_chat_thread, send_chat_message
from openauthor.codex import add_entity, update_entity
from openauthor.project import initialize_project
from openauthor.scenes import add_scene
from openauthor.retrieval import build_retrieval_index, query_retrieval_index


class AIPrivacyTests(unittest.TestCase):
  def setUp(self) -> None:
    self.temporary = tempfile.TemporaryDirectory()
    self.addCleanup(self.temporary.cleanup)
    self.paths = initialize_project(Path(self.temporary.name), name="Privacy contract")
    add_scene(self.paths, title="Opening", body="An ordinary synthetic scene in the archive.")

  def test_chat_sends_only_permitted_memory_fields(self) -> None:
    for mode in ("include", "ask", "exclude"):
      add_entity(
        self.paths, kind="character", name=f"Sentinel{mode}",
        description=f"DESCRIPTION_{mode}", notes=f"PRIVATE_NOTE_{mode}",
        ai_visibility=mode,
        details=[
          {"key": "Public trait", "type": "text", "value": f"PUBLIC_{mode}", "ai_visibility": "include"},
          {"key": "Secret trait", "type": "text", "value": f"SECRET_{mode}", "ai_visibility": "exclude"},
          {"key": "Ask trait", "type": "text", "value": f"ASK_{mode}", "ai_visibility": "ask"},
        ],
      )
    thread = create_chat_thread(self.paths, title="Privacy", provider="local", mode="chat")
    with patch("openauthor.chat.complete_chat", return_value={"text": "A safe reply.", "tool_calls": []}) as completion:
      send_chat_message(self.paths, thread_id=thread["id"], message="Discuss Sentinelinclude, Sentinelask and Sentinelexclude.")
    payload = json.dumps(completion.call_args.kwargs)
    self.assertIn("DESCRIPTION_include", payload)
    self.assertIn("PUBLIC_include", payload)
    for forbidden in ("DESCRIPTION_ask", "DESCRIPTION_exclude", "PRIVATE_NOTE_", "SECRET_", "ASK_"):
      self.assertNotIn(forbidden, payload)

  def test_proposal_prompt_uses_the_same_visibility_policy(self) -> None:
    add_entity(self.paths, kind="lore", name="Public", description="VISIBLE_DESCRIPTION", notes="PRIVATE_NOTE")
    add_entity(self.paths, kind="lore", name="Restricted", description="EXCLUDED_DESCRIPTION", ai_visibility="exclude")
    add_entity(self.paths, kind="lore", name="Permission", description="ASK_DESCRIPTION", ai_visibility="ask")
    proposal = generate_proposal(self.paths, scene_id="scene-0001", instruction="Tighten the scene.", provider="local")
    log = json.loads((self.paths.root / proposal["generation"]["log_path"]).read_text())
    payload = log["user_prompt"]
    self.assertIn("VISIBLE_DESCRIPTION", payload)
    for forbidden in ("PRIVATE_NOTE", "EXCLUDED_DESCRIPTION", "ASK_DESCRIPTION"):
      self.assertNotIn(forbidden, payload)

  def test_ask_permission_covers_only_selected_fields_and_one_turn(self) -> None:
    entity_id = add_entity(
      self.paths, kind="character", name="Mara", description="ASK_CHARACTER", ai_visibility="ask", notes="PRIVATE_NOTE",
      details=[
        {"key": "Past", "type": "text", "value": "ASK_PAST", "ai_visibility": "ask"},
        {"key": "Future", "type": "text", "value": "ASK_FUTURE", "ai_visibility": "ask"},
        {"key": "Secret", "type": "text", "value": "NEVER_SHARE", "ai_visibility": "exclude"},
      ],
    )
    thread = create_chat_thread(self.paths, title="One-time permission", provider="local", mode="agent")
    approvals = [{"entity_id": entity_id}, {"entity_id": entity_id, "detail_key": "Past"}]
    with patch("openauthor.chat.complete_chat", side_effect=[
      {"text": "", "tool_calls": [{"id": "read", "name": "codex_get", "args": {"id": entity_id}}]},
      {"text": "A reply about ASK_PAST.", "tool_calls": []},
    ]) as completion:
      send_chat_message(self.paths, thread_id=thread["id"], message="Discuss Mara.", memory_approvals=approvals)
    payload = json.dumps(completion.call_args.kwargs)
    for allowed in ("ASK_CHARACTER", "ASK_PAST"):
      self.assertIn(allowed, payload)
    for forbidden in ("ASK_FUTURE", "PRIVATE_NOTE", "NEVER_SHARE"):
      self.assertNotIn(forbidden, payload)
    with patch("openauthor.chat.complete_chat", return_value={"text": "A fresh reply.", "tool_calls": []}) as completion:
      send_chat_message(self.paths, thread_id=thread["id"], message="Continue without Memory permission.")
    self.assertNotIn("ASK_PAST", json.dumps(completion.call_args.kwargs))
    self.assertEqual(completion.call_args.kwargs["history"], [])
    from openauthor.codex import get_entity
    self.assertEqual(get_entity(self.paths, entity_id)["ai_visibility"], "ask")

  def test_preview_matches_outbound_context_and_rejects_changed_memory(self) -> None:
    from openauthor.chat import preview_chat_context
    from openauthor.project import OpenAuthorError
    entity_id = add_entity(self.paths, kind="character", name="Mara", description="ORIGINAL_FACT")
    thread = create_chat_thread(self.paths, title="Review context", provider="local", mode="chat")
    params = {"thread_id": thread["id"], "message": "Discuss Mara.", "current_scene_id": "scene-0001"}
    preview = preview_chat_context(self.paths, **params)
    with patch("openauthor.chat.complete_chat", return_value={"text": "A safe reply.", "tool_calls": []}) as completion:
      send_chat_message(self.paths, **params, expected_context_fingerprint=preview["fingerprint"])
    for key in ("user_prompt", "system_prompt", "history"):
      self.assertEqual(completion.call_args.kwargs[key], preview[key])
    preview = preview_chat_context(self.paths, **params)
    update_entity(self.paths, entity_id=entity_id, description="CHANGED_FACT")
    with patch("openauthor.chat.complete_chat") as completion:
      with self.assertRaisesRegex(OpenAuthorError, "changed.*[Rr]eview"):
        send_chat_message(self.paths, **params, expected_context_fingerprint=preview["fingerprint"])
    completion.assert_not_called()

  def test_legacy_codex_approval_is_one_turn_and_is_rechecked_before_send(self) -> None:
    entity_id = add_entity(self.paths, kind="character", name="Mara", description="ASK_LEGACY_SENTINEL", ai_visibility="ask",
      details=[{"key": "Past", "type": "text", "value": "ASK_PAST_SENTINEL", "ai_visibility": "ask"}])
    thread = create_chat_thread(self.paths, title="Legacy permission", provider="local")
    with patch("openauthor.chat.complete_chat", return_value={"text": "ASK_LEGACY_SENTINEL", "tool_calls": []}) as provider:
      send_chat_message(self.paths, thread_id=thread["id"], message="Discuss Mara.", codex_ids=[entity_id], approved_codex_ids=[entity_id])
    self.assertIn("ASK_PAST_SENTINEL", provider.call_args.kwargs["user_prompt"])
    with patch("openauthor.chat.complete_chat", return_value={"text": "A fresh reply.", "tool_calls": []}) as provider:
      send_chat_message(self.paths, thread_id=thread["id"], message="Continue.")
    self.assertEqual(provider.call_args.kwargs["history"], [])
    self.assertNotIn("ASK_LEGACY_SENTINEL", provider.call_args.kwargs["user_prompt"])

  def test_chat_does_not_send_unapproved_or_out_of_range_canon_through_legacy_review(self) -> None:
    from openauthor.canon import add_canon_fact
    from openauthor.chat import preview_chat_context
    entity_id = add_entity(self.paths, kind="character", name="Mara")
    add_scene(self.paths, title="Later", body="Mara knew the unapproved secret.")
    fact = add_canon_fact(self.paths, subject_entity_id=entity_id, predicate="secret", value="UNAPPROVED_CANON_SENTINEL",
      valid_from_scene_id="scene-0002", evidence=[{"scene_id": "scene-0002", "excerpt": "Mara knew the unapproved secret."}])
    thread = create_chat_thread(self.paths, title="Canon permission", provider="local")
    preview = preview_chat_context(self.paths, thread_id=thread["id"], message="Discuss Mara.", current_scene_id="scene-0001")
    self.assertFalse(next(row for row in preview["story_choices"] if row["id"] == fact["id"])["eligible"])
    self.assertEqual(preview["context"]["accepted_canon"], [])
    self.assertNotIn("UNAPPROVED_CANON_SENTINEL", preview["user_prompt"])

  def test_chapter_grounding_rechecks_selected_scenes_while_another_scene_is_open(self) -> None:
    from openauthor.canon import add_canon_fact
    from openauthor.chat import preview_chat_context
    entity_id = add_entity(self.paths, kind="character", name="Mara")
    add_scene(self.paths, title="Later", body="Mara found the old route.")
    fact = add_canon_fact(self.paths, subject_entity_id=entity_id, predicate="route", value="APPROVED_CHAPTER_ROUTE",
      valid_from_scene_id="scene-0002", evidence=[{"scene_id": "scene-0002", "excerpt": "Mara found the old route."}])
    thread = create_chat_thread(self.paths, title="Chapter grounding", provider="local")
    args = dict(thread_id=thread["id"], message="Review this chapter.", current_scene_id="scene-0001", scene_ids=["scene-0002"],
      context_overrides={"scope": "chapter", "retrieval_mode": "off"}, story_approvals=[fact["id"]])
    preview = preview_chat_context(self.paths, **args)
    self.assertEqual(preview["context_used"]["story_scene_ids"], ["scene-0002"])
    self.assertTrue(next(row for row in preview["story_choices"] if row["id"] == fact["id"])["included"])
    with patch("openauthor.chat.complete_chat", return_value={"text": "A chapter review.", "tool_calls": []}) as provider:
      send_chat_message(self.paths, **args, expected_context_fingerprint=preview["fingerprint"])
    self.assertIn("APPROVED_CHAPTER_ROUTE", provider.call_args.kwargs["user_prompt"])

  def test_excluded_fields_and_model_or_profile_grants_cannot_be_approved(self) -> None:
    from openauthor.chat import preview_chat_context
    from openauthor.project import OpenAuthorError
    hidden = add_entity(self.paths, kind="character", name="Mara", description="NEVER_SHARE", ai_visibility="exclude")
    ask = add_entity(self.paths, kind="lore", name="Atlas", description="ASK_FACT", ai_visibility="ask")
    thread = create_chat_thread(self.paths, title="No bypass", provider="local", mode="agent")
    with self.assertRaises(OpenAuthorError):
      preview_chat_context(self.paths, thread_id=thread["id"], message="Mara", memory_approvals=[{"entity_id": hidden}])
    preview = preview_chat_context(self.paths, thread_id=thread["id"], message="Atlas", context_overrides={"memory_approvals": [{"entity_id": ask}]})
    self.assertNotIn("ASK_FACT", preview["user_prompt"])
    with patch("openauthor.chat.complete_chat", side_effect=[
      {"text": "", "tool_calls": [{"id": "read", "name": "codex_get", "args": {"id": ask, "memory_approvals": [{"entity_id": ask}]}}]},
      {"text": "I need permission.", "tool_calls": []},
    ]) as completion:
      send_chat_message(self.paths, thread_id=thread["id"], message="Read the lore.")
    self.assertNotIn("ASK_FACT", json.dumps(completion.call_args.kwargs))

  def test_memory_revoked_during_agent_turn_stops_before_another_provider_call(self) -> None:
    from openauthor.chat import list_chat_messages
    from openauthor.project import OpenAuthorError
    entity_id = add_entity(self.paths, kind="lore", name="Atlas", description="REVOKED_FACT")
    thread = create_chat_thread(self.paths, title="Mid-turn revocation", provider="local", mode="agent")
    def first_round(*args, **kwargs):
      update_entity(self.paths, entity_id=entity_id, ai_visibility="exclude")
      return {"text": "", "tool_calls": [{"id": "read", "name": "codex_list", "args": {}}]}
    with patch("openauthor.chat.complete_chat", side_effect=first_round) as completion:
      with self.assertRaisesRegex(OpenAuthorError, "changed during this turn"):
        send_chat_message(self.paths, thread_id=thread["id"], message="Discuss Atlas.")
    self.assertEqual(completion.call_count, 1)
    self.assertEqual(list_chat_messages(self.paths, thread_id=thread["id"]), [])

  def test_retrieval_revocation_applies_even_to_an_existing_index(self) -> None:
    entity_id = add_entity(self.paths, kind="lore", name="Atlas", description="Cobalt observatory secret")
    build_retrieval_index(self.paths)
    self.assertTrue(query_retrieval_index(self.paths, query="Cobalt")["results"])
    update_entity(self.paths, entity_id=entity_id, ai_visibility="exclude")
    result = query_retrieval_index(self.paths, query="Cobalt", require_fresh=False)
    self.assertEqual(result["results"], [])
    build_retrieval_index(self.paths)
    self.assertNotIn("Cobalt", self.paths.retrieval_index_file.read_text())

  def test_agent_read_tools_cannot_bypass_memory_permissions(self) -> None:
    public = add_entity(self.paths, kind="lore", name="Public", description="PUBLIC_DESCRIPTION", notes="PRIVATE_NOTE")
    excluded = add_entity(self.paths, kind="lore", name="Hidden", description="EXCLUDED_DESCRIPTION", ai_visibility="exclude")
    thread = create_chat_thread(self.paths, title="Tools", provider="local", mode="agent")
    calls = [
      {"id": "read-all", "name": "codex_list", "args": {}},
      {"id": "read-public", "name": "codex_get", "args": {"id": public}},
      {"id": "read-hidden", "name": "codex_get", "args": {"id": excluded, "approved_entity_ids": [excluded]}},
    ]
    with patch("openauthor.chat.complete_chat", side_effect=[
      {"text": "", "tool_calls": calls}, {"text": "Finished reading.", "tool_calls": []},
    ]) as completion:
      send_chat_message(self.paths, thread_id=thread["id"], message="Inspect the memory.")
    payload = json.dumps(completion.call_args.kwargs)
    self.assertIn("PUBLIC_DESCRIPTION", payload)
    self.assertNotIn("PRIVATE_NOTE", payload)
    self.assertNotIn("EXCLUDED_DESCRIPTION", payload)

  def test_restricting_memory_starts_fresh_provider_history_without_deleting_chat(self) -> None:
    from openauthor.chat import list_chat_messages
    entity_id = add_entity(self.paths, kind="lore", name="Atlas", description="Formerly shared cobalt secret")
    thread = create_chat_thread(self.paths, title="Revocation", provider="local", mode="chat")
    with patch("openauthor.chat.complete_chat", return_value={"text": "The formerly shared cobalt secret.", "tool_calls": []}):
      send_chat_message(self.paths, thread_id=thread["id"], message="Explain Atlas.")
    update_entity(self.paths, entity_id=entity_id, ai_visibility="exclude")
    with patch("openauthor.chat.complete_chat", return_value={"text": "A fresh reply.", "tool_calls": []}) as completion:
      result = send_chat_message(self.paths, thread_id=thread["id"], message="What should happen next?")
    self.assertEqual(completion.call_args.kwargs["history"], [])
    self.assertNotIn("cobalt", json.dumps(completion.call_args.kwargs))
    self.assertTrue(result["user_message"]["context_used"]["privacy"]["history_reset"])
    self.assertEqual(len(list_chat_messages(self.paths, thread_id=thread["id"])), 4)


if __name__ == "__main__":
  unittest.main()
