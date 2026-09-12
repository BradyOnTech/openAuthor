from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from openauthor.ai import build_generation_context
from openauthor.assistant.context import ContextPolicy, ContextRequest, build_context_pack
from openauthor.assistant.runtime import AssistantRuntime
from openauthor.chat import _execute_tool, create_chat_thread, send_chat_message
from openauthor.codex import add_entity, get_entity, update_entity
from openauthor.project import atomic_write_json, initialize_project
from openauthor.retrieval import build_retrieval_index, query_retrieval_index
from openauthor.scenes import add_scene


class AIContextPrivacyTests(unittest.TestCase):
  def test_old_voice_packs_require_preparation_under_the_current_memory_policy(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Old voice context")
      thread = create_chat_thread(paths, title="Voice", provider="local", mode="chat")
      runtime = AssistantRuntime(paths)
      prepared = runtime.prepare(thread_id=thread["id"], channel="desktop_voice")
      pack = prepared["context_pack"]
      with patch("openauthor.assistant.runtime.RealtimeSessionBroker.negotiate", return_value={"answer_sdp": "fixture"}) as provider:
        runtime.start_realtime_session(offer_sdp="fixture", context_pack_id=pack["pack_id"])
        provider.assert_called_once()
      del pack["memory_access"]
      atomic_write_json(paths.chats_dir / "context-packs" / f"{pack['pack_id']}.json", pack)
      with patch("openauthor.assistant.runtime.RealtimeSessionBroker.negotiate") as provider:
        with self.assertRaisesRegex(RuntimeError, "Prepare a new voice context"):
          runtime.start_realtime_session(offer_sdp="fixture", context_pack_id=pack["pack_id"])
        provider.assert_not_called()

  def test_old_search_indexes_cannot_claim_current_memory_until_rebuilt(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Old Memory search")
      add_entity(paths, kind="character", name="Mara", description="Allowed memory")
      build_retrieval_index(paths)
      old = json.loads(paths.retrieval_index_file.read_text())
      del old["memory_policy_version"]
      for source in old["sources"]:
        source.pop("content_digest", None)
      atomic_write_json(paths.retrieval_index_file, old)
      result = query_retrieval_index(paths, query="Mara")
      self.assertEqual(result["result_count"], 0)
      self.assertTrue(result["index"]["stale"])
      with self.assertRaisesRegex(RuntimeError, "index is stale"):
        query_retrieval_index(paths, query="Mara", require_fresh=True)
      build_retrieval_index(paths)
      self.assertEqual(query_retrieval_index(paths, query="Mara", require_fresh=True)["result_count"], 1)

  def test_memory_update_approval_is_not_permission_to_read_ask_details(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Mutation is not read consent")
      entity_id = add_entity(paths, kind="character", name="Mara", details=[
        {"key": "ending", "type": "text", "value": "ASK-DETAIL", "ai_visibility": "ask"},
      ])
      result = _execute_tool(paths, "codex.update", {"id": entity_id, "description": "A careful cartographer."})
      self.assertFalse("ASK-DETAIL" in json.dumps(result), "Mutation output disclosed an unapproved detail")

  def test_prepared_voice_context_cannot_bypass_a_later_memory_exclusion(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Voice permission revocation")
      entity_id = add_entity(paths, kind="character", name="Mara", description="PRIVATE-AFTER-PREPARE")
      thread = create_chat_thread(paths, title="Voice", provider="local", mode="chat")
      runtime = AssistantRuntime(paths)
      prepared = runtime.prepare(thread_id=thread["id"], channel="desktop_voice", utterance="Discuss Mara.")
      update_entity(paths, entity_id=entity_id, ai_visibility="exclude")
      with patch("openauthor.assistant.runtime.RealtimeSessionBroker.negotiate") as provider:
        with self.assertRaisesRegex(RuntimeError, "Prepare a new voice context"):
          runtime.start_realtime_session(offer_sdp="fixture-sdp", context_pack_id=prepared["context_pack"]["pack_id"])
        provider.assert_not_called()

  def test_search_revocation_blocks_old_excerpts_even_when_stale_results_are_allowed(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Stale search privacy")
      entity_id = add_entity(paths, kind="character", name="Mara", description="HIDDEN-SEARCH-FIXTURE")
      build_retrieval_index(paths)
      self.assertEqual(query_retrieval_index(paths, query="Mara")["result_count"], 1)
      update_entity(paths, entity_id=entity_id, ai_visibility="exclude")
      result = query_retrieval_index(paths, query="Mara", require_fresh=False)
      self.assertFalse("HIDDEN-SEARCH-FIXTURE" in json.dumps(result), "Stale search bypassed exclusion")

  def test_an_ask_entry_requires_separate_one_request_approval_and_never_releases_excluded_details(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Ask permission")
      entity_id = add_entity(paths, kind="character", name="Mara", ai_visibility="ask", notes="PRIVATE-NOTE-FIXTURE", details=[
        {"key": "known", "type": "text", "value": "PUBLIC-DETAIL"},
        {"key": "permission", "type": "text", "value": "ASK-DETAIL", "ai_visibility": "ask"},
        {"key": "secret", "type": "text", "value": "EXCLUDED-DETAIL", "ai_visibility": "exclude"},
      ])
      request = dict(thread_id="permission", channel="text", utterance="Discuss Mara.", explicit_codex_ids=(entity_id,))
      policy = ContextPolicy(retrieval_mode="off")
      with self.assertRaisesRegex(RuntimeError, "requires author permission"):
        build_context_pack(paths, ContextRequest(**request), policy)
      with self.assertRaisesRegex(RuntimeError, "requires author permission"):
        AssistantRuntime(paths).handle_tool_call(thread_id="permission", channel="desktop_voice", call_id="read", wire_name="codex_get", arguments={"id": entity_id, "approved_codex_ids": [entity_id]})
      allowed = build_context_pack(paths, ContextRequest(**request, approved_codex_ids=(entity_id,)), policy)
      raw = json.dumps(allowed.to_dict())
      self.assertIn("PUBLIC-DETAIL", raw)
      self.assertIn("ASK-DETAIL", raw)
      self.assertNotIn("EXCLUDED-DETAIL", raw)
      self.assertNotIn("PRIVATE-NOTE-FIXTURE", raw)
      with self.assertRaisesRegex(RuntimeError, "requires author permission"):
        build_context_pack(paths, ContextRequest(**request), policy)
      update_entity(paths, entity_id=entity_id, ai_visibility="exclude")
      with self.assertRaisesRegex(RuntimeError, "excluded from AI context"):
        build_context_pack(paths, ContextRequest(**request, approved_codex_ids=(entity_id,)), policy)

  def test_chat_voice_tools_and_revision_generation_use_projected_memory(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Shared memory policy")
      excluded = add_entity(paths, kind="character", name="Ivo", description="EXCLUDED-ENTRY", ai_visibility="exclude")
      add_entity(paths, kind="character", name="Mara", description="PUBLIC-FACT", notes="PRIVATE-NOTE-FIXTURE", details=[
        {"key": "private", "type": "text", "value": "EXCLUDED-DETAIL", "ai_visibility": "exclude"},
        {"key": "ask", "type": "text", "value": "ASK-DETAIL", "ai_visibility": "ask"},
      ])
      add_scene(paths, title="The last door", body="Mara and Ivo waited.")
      thread = create_chat_thread(paths, title="Discuss", provider="local", mode="chat")
      with patch("openauthor.chat.complete_chat", return_value={"text": "A grounded answer."}) as provider:
        send_chat_message(paths, thread_id=thread["id"], message="Discuss Mara and Ivo.")
      runtime = AssistantRuntime(paths)
      payloads = [
        provider.call_args.kwargs["user_prompt"],
        runtime.prepare(thread_id=thread["id"], channel="desktop_voice", utterance="Discuss Mara and Ivo.")["instructions"],
        runtime.handle_tool_call(thread_id=thread["id"], channel="desktop_voice", call_id="read", wire_name="codex_list", arguments={}),
        build_generation_context(paths, scene_id="scene-0001", context_scene_radius=0, codex_limit=20),
      ]
      for index, payload in enumerate(payloads):
        with self.subTest(path=index):
          raw = json.dumps(payload)
          self.assertIn("PUBLIC-FACT", raw)
          for marker in ("EXCLUDED-ENTRY", "PRIVATE-NOTE-FIXTURE", "EXCLUDED-DETAIL", "ASK-DETAIL"):
            self.assertFalse(marker in raw, f"Private marker reached path {index}")
      with self.assertRaisesRegex(RuntimeError, "excluded from AI context"):
        runtime.handle_tool_call(thread_id=thread["id"], channel="desktop_voice", call_id="excluded", wire_name="codex_get", arguments={"id": excluded, "approved_codex_ids": [excluded]})

  def test_excluded_memory_never_enters_automatic_context(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Memory privacy")
      add_entity(paths, kind="character", name="Mara", description="HIDDEN-MEMORY-FIXTURE", ai_visibility="exclude")
      pack = build_context_pack(paths, ContextRequest(
        thread_id="privacy", channel="text", utterance="Discuss Mara.",
      ), ContextPolicy(retrieval_mode="off"))
      self.assertFalse("HIDDEN-MEMORY-FIXTURE" in json.dumps(pack.to_dict()), "Excluded entry reached the context pack")

  def test_private_notes_are_not_provider_context_even_for_an_included_entry(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Private author notes")
      entity = add_entity(paths, kind="character", name="Mara", description="A cartographer.", notes="PRIVATE-NOTE-FIXTURE")
      pack = build_context_pack(paths, ContextRequest(
        thread_id="privacy", channel="desktop_voice", utterance="Discuss Mara.",
      ), ContextPolicy(retrieval_mode="off"))
      self.assertFalse("PRIVATE-NOTE-FIXTURE" in json.dumps(pack.to_dict()), "Private notes reached the context pack")
      self.assertEqual(get_entity(paths, entity)["notes"], "PRIVATE-NOTE-FIXTURE")


if __name__ == "__main__":
  unittest.main()
