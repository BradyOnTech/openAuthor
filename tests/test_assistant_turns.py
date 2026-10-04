from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from openauthor.assistant.turns import AssistantTurnStore, TurnIdempotencyConflict
from openauthor.chat import create_chat_thread, list_chat_messages, send_chat_message
from openauthor.project import OpenAuthorError, initialize_project


class AssistantTurnStoreTests(unittest.TestCase):
  def test_claim_is_idempotent_for_same_turn_and_rejects_changed_request(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Durable Turns")
      store = AssistantTurnStore(paths)

      first = store.claim(
        turn_id="turn-client-1",
        thread_id="chat-1",
        channel="text",
        request={"message": "What should happen next?", "scope": "project"},
      )
      retry = store.claim(
        turn_id="turn-client-1",
        thread_id="chat-1",
        channel="text",
        request={"scope": "project", "message": "What should happen next?"},
      )

      self.assertTrue(first.created)
      self.assertFalse(retry.created)
      self.assertEqual(retry.turn.turn_id, first.turn.turn_id)
      self.assertEqual(retry.turn.request_digest, first.turn.request_digest)
      self.assertEqual(retry.turn.status, "accepted")
      self.assertEqual(len(list((paths.chats_dir / "turns").glob("*.json"))), 1)

      with self.assertRaises(TurnIdempotencyConflict):
        store.claim(
          turn_id="turn-client-1",
          thread_id="chat-1",
          channel="text",
          request={"message": "A different request", "scope": "project"},
        )

  def test_turn_lifecycle_is_atomic_and_terminal(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Turn Lifecycle")
      store = AssistantTurnStore(paths)
      store.claim(
        turn_id="turn-client-2",
        thread_id="chat-2",
        channel="desktop_voice",
        request={"message": "Read this scene"},
      )

      running = store.mark_running(
        "turn-client-2",
        provider="openai",
        model="realtime-model",
        input_message_id="msg-user",
      )
      completed = store.complete(
        "turn-client-2",
        message_ids=["msg-user", "msg-assistant"],
        generation_ids=["gen-1"],
        pending_tool_call_ids=["tool-1"],
        context_pack_id="ctx-1",
      )

      self.assertEqual(running.status, "running")
      self.assertIsNotNone(running.started_at)
      self.assertEqual(completed.status, "completed")
      self.assertIsNotNone(completed.completed_at)
      self.assertEqual(completed.message_ids, ["msg-user", "msg-assistant"])
      self.assertEqual(completed.revision, 3)
      with self.assertRaisesRegex(RuntimeError, "cannot transition"):
        store.mark_running("turn-client-2", provider="openai", model="other")

  def test_same_completed_chat_turn_is_returned_without_invoking_provider_twice(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Idempotent Chat Turn")
      thread = create_chat_thread(paths, title="Turn", provider="local", mode="chat")
      completion = {
        "text": "A single answer.",
        "tool_calls": [],
        "input_tokens": 4,
        "output_tokens": 3,
        "latency_ms": 2,
        "provider_attempts": 1,
        "estimated_cost_usd": 0.0,
        "generation_id": "gen-once",
        "log_path": "",
      }

      with patch("openauthor.chat.complete_chat", return_value=completion) as provider:
        first = send_chat_message(
          paths,
          thread_id=thread["id"],
          message="Answer once.",
          turn_id="turn-idempotent",
        )
        retry = send_chat_message(
          paths,
          thread_id=thread["id"],
          message="Answer once.",
          turn_id="turn-idempotent",
        )

      self.assertEqual(provider.call_count, 1)
      self.assertEqual(first["assistant_message"]["id"], retry["assistant_message"]["id"])
      self.assertEqual(first["turn"]["status"], "completed")
      self.assertEqual(retry["turn"]["status"], "completed")
      self.assertEqual(
        [row["role"] for row in list_chat_messages(paths, thread_id=thread["id"])],
        ["user", "assistant"],
      )

  def test_provider_failure_records_failed_turn_without_duplicate_user_message(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Failed Chat Turn")
      thread = create_chat_thread(paths, title="Turn", provider="local", mode="chat")

      with patch(
        "openauthor.chat.complete_chat",
        side_effect=OpenAuthorError("Provider unavailable."),
      ):
        with self.assertRaisesRegex(OpenAuthorError, "Provider unavailable"):
          send_chat_message(
            paths,
            thread_id=thread["id"],
            message="Fail once.",
            turn_id="turn-failed",
          )

      failed = AssistantTurnStore(paths).get("turn-failed")
      self.assertEqual(failed.status, "failed")
      self.assertEqual(failed.error["category"], "core_error")
      self.assertEqual(
        [row["role"] for row in list_chat_messages(paths, thread_id=thread["id"])],
        [],
      )


if __name__ == "__main__":
  unittest.main()
