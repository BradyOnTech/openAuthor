from __future__ import annotations

import tempfile
import unittest
import json
from pathlib import Path
from unittest.mock import patch

from openauthor.assistant.context import ContextPolicy, ContextRequest, build_context_pack
from openauthor.assistant.runtime import AssistantRuntime
from openauthor.chat import create_chat_thread, send_chat_message
from openauthor.model_input import estimate_chat_input, estimate_tokens
from openauthor.project import initialize_project
from openauthor.scenes import add_scene


class AssistantPayloadBudgetTests(unittest.TestCase):
  def test_long_explicit_scene_cannot_bypass_budget_through_a_short_manifest(self):
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Long scene budget")
      add_scene(paths, title="The return", body="Mara found the missing street. " * 2500)
      with self.assertRaisesRegex(RuntimeError, "Required Assistant input"):
        build_context_pack(paths, ContextRequest(
          thread_id="long-scene", channel="text", utterance="Review this scene.",
          explicit_scene_ids=("scene-0001",),
        ), ContextPolicy(input_token_ceiling=8000, max_item_characters=100, retrieval_mode="off"))

  def test_response_reserve_accounts_for_the_requested_number_of_tokens(self):
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Output room")
      pack = build_context_pack(paths, ContextRequest(thread_id="reserve", channel="text", utterance="Help."),
                                ContextPolicy(response_token_reserve=1200, retrieval_mode="off"))
      self.assertEqual(pack.budget["allocations"]["response_reserve"], 1200)

  def test_actual_agent_request_matches_the_budgeted_input_including_tools(self):
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Actual agent input")
      thread = create_chat_thread(paths, title="Review", provider="local", mode="agent")
      with patch("openauthor.chat.complete_chat", return_value={"text": "A review."}) as provider:
        sent = send_chat_message(paths, thread_id=thread["id"], message="Review the book.", context_overrides={"retrieval_mode": "off"})
      receipt = sent["assistant_message"]["context_used"]["context_pack"]
      pack = json.loads((paths.chats_dir / "context-packs" / f"{receipt['id']}.json").read_text())
      request = provider.call_args.kwargs
      measured = estimate_chat_input(**{key: request[key] for key in ("system_prompt", "user_prompt", "history", "tools")})
      self.assertEqual(measured, pack["budget"]["allocations"]["input_payload"])
      self.assertEqual(request["input_token_ceiling"], pack["budget"]["ceiling"])

  def test_voice_connection_sends_exactly_the_prepared_instructions(self):
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Prepared voice input")
      thread = create_chat_thread(paths, title="Discuss", provider="local")
      runtime = AssistantRuntime(paths)
      prepared = runtime.prepare(thread_id=thread["id"], channel="desktop_voice", utterance="Review the ending.")
      with patch("openauthor.assistant.runtime.RealtimeSessionBroker.negotiate", return_value={"answer_sdp": "offline"}) as broker:
        runtime.start_realtime_session(offer_sdp="offline", context_pack_id=prepared["context_pack"]["pack_id"])
      self.assertEqual(broker.call_args.kwargs["instructions"], prepared["instructions"])
      self.assertEqual(broker.call_args.kwargs["max_output_tokens"], prepared["context_pack"]["model_input"]["max_output_tokens"])

  def test_large_tool_result_is_blocked_before_a_second_provider_call(self):
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Tool round limit")
      add_scene(paths, title="Long source", body="A route through the missing city. " * 4000)
      thread = create_chat_thread(paths, title="Discuss", provider="local", mode="agent")
      first = {"text": "", "tool_calls": [{"id": "read-one", "name": "scene_get", "args": {"id": "scene-0001"}}],
               "input_tokens": 30, "output_tokens": 10, "latency_ms": 0, "attempts": 1}
      with patch("openauthor.ai._call_provider", side_effect=[first, {**first, "text": "An answer", "tool_calls": []}]) as provider:
        with self.assertRaisesRegex(RuntimeError, "input token ceiling"):
          send_chat_message(paths, thread_id=thread["id"], message="Read the source.", context_overrides={"retrieval_mode": "off", "input_token_ceiling": 4000})
      self.assertEqual(provider.call_count, 1)

  def test_optional_long_neighbor_is_omitted_but_focused_prose_and_selection_are_complete(self):
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Useful focus")
      body = "Mara found the missing street. " * 150
      add_scene(paths, title="Focus", body=body)
      add_scene(paths, title="Neighbor", body="An optional neighboring scene. " * 4000)
      selection = "The selected passage must stay intact. " * 40
      pack = build_context_pack(paths, ContextRequest(thread_id="focus", channel="text", utterance="Review the selection.",
        current_scene_id="scene-0001", selected_text=selection), ContextPolicy(input_token_ceiling=6000, max_item_characters=40, retrieval_mode="off"))
      self.assertEqual(pack.provider_context["current_scene"][0]["body"].strip(), body.strip())
      self.assertEqual(pack.provider_context["selected_text"], selection)
      self.assertEqual(pack.provider_context["nearby_scenes"], [])
      self.assertTrue(next(item for item in pack.items if item.kind == "scene").preview_truncated)
      self.assertTrue(any(row.get("candidate_id") == "nearby-scene:scene-0002" for row in pack.degradations))
      self.assertFalse(any(row.get("reason") == "max_item_characters" for row in pack.degradations))

  def test_history_budget_retains_complete_exchanges_and_never_jumps_over_a_gap(self):
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Coherent history")
      latest = ({"role": "user", "content": "Latest question."}, {"role": "assistant", "content": "Latest answer."})
      base = build_context_pack(paths, ContextRequest(thread_id="base", channel="text", utterance="Continue.", history=latest), ContextPolicy(retrieval_mode="off"))
      history = ({"role": "user", "content": "Old question."}, {"role": "assistant", "content": "Old answer."},
                 {"role": "user", "content": "Middle oversized exchange. " * 2000}, {"role": "assistant", "content": "Middle answer."}, *latest)
      pack = build_context_pack(paths, ContextRequest(thread_id="history", channel="text", utterance="Continue.", history=history),
                                ContextPolicy(input_token_ceiling=base.budget["used"] + 100, retrieval_mode="off"))
      self.assertEqual(pack.history, list(latest))
      self.assertTrue(any(row["reason"] == "recent_history_boundary" for row in pack.degradations))

  def test_non_word_input_cannot_collapse_to_zero_or_one_token(self):
    for text in ["漢字" * 2000, "x" * 12000, "[]{}:!" * 2000]:
      self.assertGreaterEqual(estimate_tokens(text), len(text.encode("utf-8")) // 3)


if __name__ == "__main__":
  unittest.main()
