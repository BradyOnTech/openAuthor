from __future__ import annotations

import hashlib
import io
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from openauthor.ai import ChatInterrupted
from openauthor.assistant.turns import AssistantTurnStore
from openauthor.chat import (
  _chat_delivery_folder, create_chat_thread, list_chat_messages, preview_chat_context,
  reconcile_chat_delivery, regenerate_chat_turn, send_chat_message,
)
from openauthor.generations import list_generation_runs
from openauthor.project import OpenAuthorError, atomic_write_json, atomic_write_text, initialize_project
from openauthor.scenes import add_scene, list_scenes, update_scene
from openauthor.server import ChatSidecarServer


class ChatDeliveryRecoveryTests(unittest.TestCase):
  def setUp(self) -> None:
    self.temporary = tempfile.TemporaryDirectory()
    self.addCleanup(self.temporary.cleanup)
    self.paths = initialize_project(Path(self.temporary.name), name="Fresh-context recovery")
    self.thread = create_chat_thread(self.paths, title="Editorial question", provider="local", mode="chat")
    self.args = {"thread_id": self.thread["id"], "request_id": "delivery-original", "turn_id": "turn-original"}

  def reconcile(self) -> dict:
    return reconcile_chat_delivery(self.paths, **self.args)

  def test_recovers_completed_receipt_after_publication_failure_without_provider(self) -> None:
    def fail_transcript(path: Path, content: str) -> None:
      if path.suffix == ".jsonl":
        raise OSError("Synthetic transcript write failure")
      atomic_write_text(path, content)
    with patch("openauthor.chat.atomic_write_text", side_effect=fail_transcript):
      with self.assertRaises(OSError):
        send_chat_message(self.paths, **self.args, message="Review the opening.")
    before = list_generation_runs(self.paths)
    with patch("openauthor.chat.complete_chat", side_effect=AssertionError("Reconciliation contacted AI")):
      self.assertEqual(self.reconcile()["status"], "completed")
      self.assertEqual(self.reconcile()["status"], "completed")
    self.assertEqual(list_generation_runs(self.paths), before)
    self.assertEqual(len(list_chat_messages(self.paths, thread_id=self.thread["id"])), 2)

  def test_stale_preflight_closes_old_identity_and_allows_a_fresh_reviewed_send(self) -> None:
    add_scene(self.paths, title="Gate", body="Mara waits by the gate.")
    scene_id = list_scenes(self.paths)[0]["id"]
    payload = {"thread_id": self.thread["id"], "message": "Review the gate.", "scene_ids": [scene_id]}
    stale = preview_chat_context(self.paths, **payload)["fingerprint"]
    update_scene(self.paths, scene_identifier=scene_id, body="Mara opens the gate.")
    with self.assertRaisesRegex(OpenAuthorError, "Context changed"):
      send_chat_message(self.paths, **payload, request_id="delivery-original", turn_id="turn-original", expected_context_fingerprint=stale)
    self.assertEqual(self.reconcile()["status"], "not_delivered")
    with self.assertRaisesRegex(OpenAuthorError, "request is closed"):
      send_chat_message(self.paths, **payload, request_id="delivery-original", turn_id="turn-original")
    self.assertEqual(list_generation_runs(self.paths), [])
    fresh = preview_chat_context(self.paths, **payload)["fingerprint"]
    send_chat_message(self.paths, **payload, request_id="delivery-fresh", turn_id="turn-fresh", expected_context_fingerprint=fresh)
    self.assertEqual(len(list_generation_runs(self.paths)), 1)

  def test_cancelled_attempt_is_explicitly_indeterminate_and_cannot_be_retried(self) -> None:
    def stop(_text: str) -> None:
      raise ChatInterrupted("Synthetic stop")
    with self.assertRaises(ChatInterrupted):
      send_chat_message(self.paths, **self.args, message="Keep this question.", on_delta=stop)
    result = self.reconcile()
    self.assertEqual(result["status"], "indeterminate")
    self.assertTrue(result["can_review"])
    self.assertIn("incurred charges", result["message"])
    with patch("openauthor.chat.complete_chat", side_effect=AssertionError("Closed delivery contacted AI")):
      with self.assertRaisesRegex(OpenAuthorError, "request is closed"):
        send_chat_message(self.paths, **self.args, message="Keep this question.")
    self.assertEqual(list_chat_messages(self.paths, thread_id=self.thread["id"]), [])

  def test_closes_unstarted_and_crashed_running_deliveries_durably(self) -> None:
    self.assertEqual(self.reconcile()["status"], "not_delivered")
    self.assertEqual(self.reconcile()["status"], "not_delivered")
    with self.assertRaisesRegex(OpenAuthorError, "request is closed"):
      send_chat_message(self.paths, **self.args, message="Delayed request.")
    store = AssistantTurnStore(self.paths)
    store.claim(turn_id="turn-crashed", thread_id=self.thread["id"], channel="text", request={"message": "crashed"})
    store.mark_running("turn-crashed", provider="local", model="heuristic-v1", input_message_id="lost-user")
    result = reconcile_chat_delivery(self.paths, thread_id=self.thread["id"], request_id="delivery-crashed", turn_id="turn-crashed")
    self.assertEqual(result["status"], "indeterminate")
    self.assertEqual(store.get("turn-crashed").status, "interrupted")

  def test_completed_turn_without_receipt_blocks_a_second_provider_attempt(self) -> None:
    send_chat_message(self.paths, **self.args, message="Already completed.")
    for stored in _chat_delivery_folder(self.paths, self.thread["id"]).glob("*.json"):
      stored.unlink()
    result = self.reconcile()
    self.assertEqual(result["status"], "blocked")
    self.assertFalse(result["can_review"])
    with self.assertRaisesRegex(OpenAuthorError, "request is closed"):
      send_chat_message(self.paths, **self.args, message="Already completed.")
    self.assertEqual(len(list_generation_runs(self.paths)), 1)

  def test_reconciliation_waits_for_active_delivery_then_recovers_its_one_reply(self) -> None:
    entered, release, reconciled = threading.Event(), threading.Event(), threading.Event()
    errors: list[BaseException] = []
    results: list[dict] = []
    def provider(*_args: object, **_kwargs: object) -> dict:
      entered.set()
      release.wait(2)
      return {"text": "One reply", "tool_calls": [], "input_tokens": 1, "output_tokens": 1, "latency_ms": 1, "provider_attempts": 1, "estimated_cost_usd": None, "generation_id": "", "log_path": ""}
    def send() -> None:
      try:
        send_chat_message(self.paths, **self.args, message="Original request.")
      except BaseException as error:
        errors.append(error)
    def check() -> None:
      try:
        results.append(self.reconcile())
      except BaseException as error:
        errors.append(error)
      finally:
        reconciled.set()
    with patch("openauthor.chat.complete_chat", side_effect=provider) as calls:
      writer = threading.Thread(target=send)
      writer.start()
      self.assertTrue(entered.wait(1))
      reader = threading.Thread(target=check)
      reader.start()
      self.assertFalse(reconciled.wait(.04))
      release.set()
      writer.join(2)
      reader.join(2)
      self.assertEqual(calls.call_count, 1)
    self.assertEqual(errors, [])
    self.assertEqual(results[0]["status"], "completed")
    self.assertEqual(len(list_chat_messages(self.paths, thread_id=self.thread["id"])), 2)

  def test_sidecar_recovers_replacement_using_its_existing_turn_delivery_identity(self) -> None:
    original = send_chat_message(self.paths, **self.args, message="Original question.")
    regenerate_chat_turn(self.paths, thread_id=self.thread["id"], from_message_id=original["user_message"]["id"], replacement_turn_id="turn-replacement", message="Replacement question.")
    stdin = io.StringIO(json.dumps({"id": "reconcile", "method": "chat.delivery.reconcile", "params": {"thread_id": self.thread["id"], "request_id": "turn-replacement", "turn_id": "turn-replacement"}}) + "\n")
    stdout = io.StringIO()
    ChatSidecarServer(self.paths, stdin=stdin, stdout=stdout).serve_forever()
    self.assertEqual(json.loads(stdout.getvalue())["result"]["status"], "completed")
    self.assertEqual(len(list_generation_runs(self.paths)), 2)

  def test_mismatched_or_corrupt_attempts_fail_closed(self) -> None:
    folder = _chat_delivery_folder(self.paths, self.thread["id"])
    key = hashlib.sha256(f"{self.thread['id']}:delivery-original".encode()).hexdigest()
    path = folder / "attempts" / f"{key}.json"
    atomic_write_json(path, {"logical_turn_id": "another-turn", "turn_id": "another-turn"})
    with self.assertRaisesRegex(OpenAuthorError, "different Assistant turn"):
      self.reconcile()
    path.write_text("invalid", encoding="utf-8")
    with self.assertRaisesRegex(OpenAuthorError, "could not be reconciled"):
      self.reconcile()
    self.assertEqual(list_generation_runs(self.paths), [])
