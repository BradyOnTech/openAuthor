from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from openauthor.ai import ChatInterrupted
from openauthor.assistant.turns import AssistantTurnStore
from openauthor.chat import create_chat_thread, list_chat_messages, preview_chat_context, regenerate_chat_turn, send_chat_message
from openauthor.project import OpenAuthorError, atomic_write_json, atomic_write_text, initialize_project


class ChatDeliveryTurnTests(unittest.TestCase):
  def setUp(self) -> None:
    self.temporary = tempfile.TemporaryDirectory()
    self.addCleanup(self.temporary.cleanup)
    self.paths = initialize_project(Path(self.temporary.name), name="Durable delivery attempts")
    self.thread = create_chat_thread(self.paths, title="Recovery", provider="local", mode="chat")
    self.completion = {"text": "A recovered synthetic answer.", "tool_calls": [], "generation_id": "gen-delivery"}

  def request(self, suffix: str = "one") -> dict:
    return {
      "thread_id": self.thread["id"], "message": "Discuss this synthetic opening.",
      "request_id": f"delivery-{suffix}", "turn_id": f"turn-{suffix}",
    }

  def test_failed_and_interrupted_attempts_retry_under_the_same_delivery_and_turn_identity(self) -> None:
    for status, error in [("failed", OpenAuthorError("Temporary provider failure")), ("interrupted", ChatInterrupted("Stopped turn"))]:
      with self.subTest(status=status):
        request = self.request(status)
        with patch("openauthor.chat.complete_chat", side_effect=[error, self.completion]) as provider:
          with self.assertRaises(type(error)):
            send_chat_message(self.paths, **request)
          self.assertEqual(AssistantTurnStore(self.paths).get(request["turn_id"]).status, status)
          recovered = send_chat_message(self.paths, **request)
          replay = send_chat_message(self.paths, **request)
        self.assertEqual(provider.call_count, 2)
        self.assertEqual(recovered, replay)
        self.assertEqual(recovered["turn"]["status"], "completed")
        self.assertNotEqual(recovered["turn"]["turn_id"], request["turn_id"])
        messages = [row for row in list_chat_messages(self.paths, thread_id=self.thread["id"])
                    if row["turn_id"] == recovered["turn"]["turn_id"]]
        self.assertEqual([row["role"] for row in messages], ["user", "assistant"])

  def test_failed_receipt_storage_does_not_leave_a_completed_turn_without_messages(self) -> None:
    request = self.request("storage")

    def fail_receipt(path, payload):
      if path.parent.parent.name == "deliveries":
        raise OSError("Receipt storage is unavailable")
      return atomic_write_json(path, payload)

    with patch("openauthor.chat.complete_chat", return_value=self.completion) as provider:
      with patch("openauthor.chat.atomic_write_json", side_effect=fail_receipt):
        with self.assertRaisesRegex(OSError, "Receipt storage"):
          send_chat_message(self.paths, **request)
      self.assertEqual(AssistantTurnStore(self.paths).get(request["turn_id"]).status, "failed")
      self.assertEqual(list_chat_messages(self.paths, thread_id=self.thread["id"]), [])
      recovered = send_chat_message(self.paths, **request)
      self.assertEqual(send_chat_message(self.paths, **request), recovered)
    # No response artifact survived the storage failure, so this retry may
    # require a second provider attempt; only its completed turn is published.
    self.assertEqual(provider.call_count, 2)
    self.assertEqual(len(list_chat_messages(self.paths, thread_id=self.thread["id"])), 2)

  def test_a_process_exit_before_receipt_storage_retries_an_abandoned_attempt(self) -> None:
    request = self.request("process-exit")
    with patch("openauthor.chat.complete_chat", side_effect=[KeyboardInterrupt("Process stopped"), self.completion]) as provider:
      with self.assertRaises(KeyboardInterrupt):
        send_chat_message(self.paths, **request)
      self.assertEqual(AssistantTurnStore(self.paths).get(request["turn_id"]).status, "running")
      recovered = send_chat_message(self.paths, **request)
      self.assertEqual(send_chat_message(self.paths, **request), recovered)
    self.assertEqual(provider.call_count, 2)
    self.assertEqual(AssistantTurnStore(self.paths).get(request["turn_id"]).status, "failed")
    self.assertEqual(len(list_chat_messages(self.paths, thread_id=self.thread["id"])), 2)

  def test_an_existing_failed_turn_id_cannot_be_reused_for_a_different_request(self) -> None:
    request = self.request("reused-turn")
    with patch("openauthor.chat.complete_chat", side_effect=OpenAuthorError("Temporary provider failure")):
      with self.assertRaises(OpenAuthorError):
        send_chat_message(self.paths, **request)
    with patch("openauthor.chat.complete_chat", return_value=self.completion) as provider:
      with self.assertRaisesRegex(OpenAuthorError, "different request"):
        send_chat_message(self.paths, **{**request, "request_id": "another-delivery", "message": "A different request"})
    self.assertEqual(provider.call_count, 0)
    self.assertEqual(list_chat_messages(self.paths, thread_id=self.thread["id"]), [])

  def test_terminal_completion_requires_a_durable_result_and_all_turn_messages(self) -> None:
    complete = AssistantTurnStore.complete

    def verify_receipt_then_complete(store, turn_id, **kwargs):
      receipts = list(self.paths.chats_dir.glob("deliveries/*/*.json"))
      self.assertEqual(len(receipts), 1)
      receipt = json.loads(receipts[0].read_text(encoding="utf-8"))
      self.assertEqual(receipt["result"]["assistant_message"]["content"], self.completion["text"])
      self.assertEqual([row["id"] for row in receipt["messages"]], kwargs["message_ids"])
      self.assertEqual(store.get(turn_id).status, "running")
      return complete(store, turn_id, **kwargs)

    with patch("openauthor.chat.complete_chat", return_value=self.completion):
      with patch.object(AssistantTurnStore, "complete", new=verify_receipt_then_complete):
        result = send_chat_message(self.paths, **self.request("durability"))
    self.assertEqual(result["turn"]["status"], "completed")
    self.assertNotIn("_turn_completion", result)

  def test_saved_receipt_recovers_failed_turn_finalization_without_another_generation(self) -> None:
    request = self.request("finalization")
    with patch("openauthor.chat.complete_chat", return_value=self.completion) as provider:
      with patch.object(AssistantTurnStore, "complete", side_effect=OSError("Turn finalization interrupted")):
        with self.assertRaisesRegex(OSError, "finalization"):
          send_chat_message(self.paths, **request)
      self.assertEqual(AssistantTurnStore(self.paths).get(request["turn_id"]).status, "running")
      recovered = send_chat_message(self.paths, **request)
      self.assertEqual(send_chat_message(self.paths, **request), recovered)
    self.assertEqual(provider.call_count, 1)
    self.assertEqual(recovered["turn"]["turn_id"], request["turn_id"])
    self.assertEqual(recovered["turn"]["status"], "completed")
    self.assertEqual(len(list_chat_messages(self.paths, thread_id=self.thread["id"])), 2)

  def test_saved_receipt_recovers_transcript_publication_without_another_generation(self) -> None:
    request = self.request("publication")

    def fail_transcript(path, content):
      if path.suffix == ".jsonl":
        raise OSError("Transcript publication interrupted")
      return atomic_write_text(path, content)

    with patch("openauthor.chat.complete_chat", return_value=self.completion) as provider:
      with patch("openauthor.chat.atomic_write_text", side_effect=fail_transcript):
        with self.assertRaisesRegex(OSError, "publication"):
          send_chat_message(self.paths, **request)
      self.assertEqual(AssistantTurnStore(self.paths).get(request["turn_id"]).status, "completed")
      self.assertEqual(list_chat_messages(self.paths, thread_id=self.thread["id"]), [])
      recovered = send_chat_message(self.paths, **request)
      self.assertEqual(send_chat_message(self.paths, **request), recovered)
    self.assertEqual(provider.call_count, 1)
    self.assertEqual(len(list_chat_messages(self.paths, thread_id=self.thread["id"])), 2)

  def test_failed_regeneration_retry_replaces_the_original_turn_without_duplicate_history(self) -> None:
    with patch("openauthor.chat.complete_chat", return_value=self.completion):
      original = send_chat_message(self.paths, thread_id=self.thread["id"], message="Original opening", turn_id="turn-original")
    request = {
      "thread_id": self.thread["id"], "from_message_id": original["user_message"]["id"],
      "replacement_turn_id": "turn-replacement", "message": "A revised opening",
    }
    with patch("openauthor.chat.complete_chat", side_effect=[OpenAuthorError("Temporary provider failure"), self.completion]) as provider:
      with self.assertRaisesRegex(OpenAuthorError, "Temporary provider"):
        regenerate_chat_turn(self.paths, **request)
      self.assertEqual([row["content"] for row in list_chat_messages(self.paths, thread_id=self.thread["id"])],
                       ["Original opening", self.completion["text"]])
      recovered = regenerate_chat_turn(self.paths, **request)
      self.assertEqual(regenerate_chat_turn(self.paths, **request), recovered)
    self.assertEqual(provider.call_count, 2)
    self.assertEqual([row["content"] for row in list_chat_messages(self.paths, thread_id=self.thread["id"])],
                     ["A revised opening", self.completion["text"]])
    original_turn = AssistantTurnStore(self.paths).get("turn-original")
    self.assertEqual(original_turn.status, "superseded")
    self.assertEqual(original_turn.superseded_by, recovered["turn"]["turn_id"])

  def test_regenerated_receipt_recovers_exact_replacement_after_failed_publication(self) -> None:
    with patch("openauthor.chat.complete_chat", return_value=self.completion):
      prefix = send_chat_message(self.paths, thread_id=self.thread["id"], message="Keep this earlier turn", turn_id="turn-prefix")
      original = send_chat_message(self.paths, thread_id=self.thread["id"], message="Replace this original", turn_id="turn-original")
      send_chat_message(self.paths, thread_id=self.thread["id"], message="Discard this later turn", turn_id="turn-later")
    original_messages = list_chat_messages(self.paths, thread_id=self.thread["id"])
    preview = preview_chat_context(self.paths, thread_id=self.thread["id"], message="The revised request",
                                   history_before_message_id=original["user_message"]["id"], memory_approvals=[], story_approvals=[])
    request = {
      "thread_id": self.thread["id"], "from_message_id": original["user_message"]["id"],
      "replacement_turn_id": "turn-replacement", "message": "The revised request",
      "memory_approvals": [], "story_approvals": [], "expected_context_fingerprint": preview["fingerprint"],
      "is_cancelled": lambda: False,
    }

    def complete_with_original_still_present(*args, **kwargs):
      self.assertEqual(list_chat_messages(self.paths, thread_id=self.thread["id"]), original_messages)
      self.assertEqual(kwargs["history"], preview["history"])
      return self.completion

    def fail_transcript(path, content):
      if path.suffix == ".jsonl":
        raise OSError("Regenerated transcript publication interrupted")
      return atomic_write_text(path, content)

    with patch("openauthor.chat.complete_chat", side_effect=complete_with_original_still_present) as provider:
      with patch("openauthor.chat.atomic_write_text", side_effect=fail_transcript):
        with self.assertRaisesRegex(OSError, "publication"):
          regenerate_chat_turn(self.paths, **request)
      self.assertEqual(list_chat_messages(self.paths, thread_id=self.thread["id"]), original_messages)
      self.assertEqual(AssistantTurnStore(self.paths).get("turn-original").status, "completed")
      recovered = regenerate_chat_turn(self.paths, **request)
      self.assertEqual(regenerate_chat_turn(self.paths, **request), recovered)
    self.assertEqual(provider.call_count, 1)
    self.assertEqual(list_chat_messages(self.paths, thread_id=self.thread["id"]),
                     [prefix["user_message"], prefix["assistant_message"], recovered["user_message"], recovered["assistant_message"]])
    original_turn = AssistantTurnStore(self.paths).get("turn-original")
    self.assertEqual(original_turn.status, "superseded")
    self.assertEqual(original_turn.superseded_by, recovered["turn"]["turn_id"])

  def test_regenerated_transcript_survives_interrupted_receipt_marking(self) -> None:
    with patch("openauthor.chat.complete_chat", return_value=self.completion):
      original = send_chat_message(self.paths, thread_id=self.thread["id"], message="Original request", turn_id="turn-original")
    request = {
      "thread_id": self.thread["id"], "from_message_id": original["user_message"]["id"],
      "replacement_turn_id": "turn-replacement", "message": "Revised request",
    }

    def fail_published_receipt(path, payload):
      if isinstance(payload, dict) and payload.get("replace_from_message_id") and payload.get("published"):
        raise OSError("Replacement receipt marking interrupted")
      return atomic_write_json(path, payload)

    with patch("openauthor.chat.complete_chat", return_value=self.completion) as provider:
      with patch("openauthor.chat.atomic_write_json", side_effect=fail_published_receipt):
        with self.assertRaisesRegex(OSError, "marking"):
          regenerate_chat_turn(self.paths, **request)
      published = list_chat_messages(self.paths, thread_id=self.thread["id"])
      self.assertEqual([row["content"] for row in published], ["Revised request", self.completion["text"]])
      recovered = regenerate_chat_turn(self.paths, **request)
      self.assertEqual(regenerate_chat_turn(self.paths, **request), recovered)
    self.assertEqual(provider.call_count, 1)
    self.assertEqual(list_chat_messages(self.paths, thread_id=self.thread["id"]), published)
    self.assertEqual(AssistantTurnStore(self.paths).get("turn-original").superseded_by, recovered["turn"]["turn_id"])

  def test_direct_text_desktop_voice_and_mobile_voice_turns_remain_idempotent(self) -> None:
    with patch("openauthor.chat.complete_chat", return_value=self.completion) as provider:
      for channel in ("text", "desktop_voice", "mobile_voice"):
        with self.subTest(channel=channel):
          request = self.request(channel)
          request.pop("request_id")
          first = send_chat_message(self.paths, **request, channel=channel)
          self.assertEqual(send_chat_message(self.paths, **request, channel=channel), first)
          self.assertEqual(first["turn"]["turn_id"], request["turn_id"])
          self.assertEqual(first["turn"]["channel"], channel)
    self.assertEqual(provider.call_count, 3)
    self.assertEqual(len(list_chat_messages(self.paths, thread_id=self.thread["id"])), 6)
