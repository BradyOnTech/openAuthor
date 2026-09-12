from __future__ import annotations

import base64
import io
import json
import tempfile
import unittest
from pathlib import Path
from typing import Any

from openauthor.assistant.mobile_outbox import mobile_outbox_payload_digest
from openauthor.assistant.turns import AssistantTurnStore
from openauthor.chat import create_chat_thread, list_chat_messages
from openauthor.project import initialize_project
from openauthor.revisions import create_revision
from openauthor.server import ChatSidecarServer
from openauthor.scenes import add_scene, get_scene


def _run_requests(paths: Any, requests: list[dict[str, Any]]) -> list[dict[str, Any]]:
  stdin = io.StringIO("\n".join(json.dumps(request) for request in requests) + "\n")
  stdout = io.StringIO()
  ChatSidecarServer(paths, stdin=stdin, stdout=stdout).serve_forever()
  frames: list[dict[str, Any]] = []
  for line in stdout.getvalue().splitlines():
    if line.strip():
      frames.append(json.loads(line))
  return frames


def _response_for(frames: list[dict[str, Any]], request_id: Any) -> dict[str, Any]:
  return next(
    frame
    for frame in frames
    if "event" not in frame and frame.get("id") == request_id
  )


class ServerModuleTests(unittest.TestCase):
  def test_mobile_snapshot_prepare_returns_plaintext_for_desktop_encryption(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(
        Path(tmp),
        name="Mobile Snapshot Sidecar",
        project_id="project-mobile-sidecar",
      )
      add_scene(paths, title="Opening", body="Mara finds the winter key.")
      revision = create_revision(paths, "Mobile snapshot baseline")

      frames = _run_requests(
        paths,
        [{
          "id": "mobile-snapshot",
          "method": "mobile.snapshot.prepare",
          "params": {"project_id": "project-mobile-sidecar"},
        }],
      )

      result = _response_for(frames, "mobile-snapshot")["result"]
      plaintext = base64.b64decode(result["plaintext_base64"])
      envelope = json.loads(plaintext)
      self.assertEqual(result["manifest"]["project_id"], "project-mobile-sidecar")
      self.assertEqual(result["manifest"]["revision"], revision)
      self.assertEqual(envelope["manifest"], result["manifest"])
      self.assertEqual(envelope["snapshot"]["scenes"][0]["body"], "Mara finds the winter key.\n")
      self.assertNotIn(str(Path(tmp)), plaintext.decode("utf-8"))
      self.assertNotIn("project_key", result)

  def test_mobile_outbox_import_is_idempotent_through_the_sidecar(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(
        Path(tmp),
        name="Mobile Outbox Sidecar",
        project_id="project-mobile-outbox-sidecar",
      )
      revision = create_revision(paths, "Mobile outbox baseline")
      payload = {
        "kind": "capture_note",
        "title": "Gate image",
        "content": "Let the gate cast a shadow before it appears.",
      }
      envelope = {
        "project_id": "project-mobile-outbox-sidecar",
        "device_id": "device-ios-1",
        "operation_id": "operation-note-1",
        "base_revision": revision,
        "payload_digest": mobile_outbox_payload_digest(payload),
      }

      frames = _run_requests(
        paths,
        [
          {
            "id": "mobile-import-1",
            "method": "mobile.outbox.import",
            "params": {"envelope": envelope, "payload": payload},
          },
          {
            "id": "mobile-import-replay",
            "method": "mobile.outbox.import",
            "params": {"envelope": envelope, "payload": payload},
          },
          {"id": "mobile-inbox", "method": "mobile.inbox.list", "params": {}},
        ],
      )

      first = _response_for(frames, "mobile-import-1")["result"]
      replay = _response_for(frames, "mobile-import-replay")["result"]
      self.assertEqual(replay, first)
      self.assertEqual(first["artifact_kind"], "mobile_inbox_item")
      inbox = _response_for(frames, "mobile-inbox")["result"]
      self.assertEqual(len(inbox), 1)
      self.assertEqual(inbox[0]["operation_id"], "operation-note-1")
      self.assertEqual(inbox[0]["payload"], payload)

  def test_mobile_outbox_import_rejects_non_string_envelope_identity(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(
        Path(tmp),
        name="Mobile Envelope Validation",
        project_id="project-mobile-envelope",
      )
      revision = create_revision(paths, "Envelope baseline")
      payload = {"kind": "capture_note", "content": "Do not coerce identity."}
      frames = _run_requests(
        paths,
        [{
          "id": "mobile-invalid-envelope",
          "method": "mobile.outbox.import",
          "params": {
            "envelope": {
              "project_id": "project-mobile-envelope",
              "device_id": None,
              "operation_id": "operation-one",
              "base_revision": revision,
              "payload_digest": mobile_outbox_payload_digest(payload),
            },
            "payload": payload,
          },
        }],
      )

      response = _response_for(frames, "mobile-invalid-envelope")
      self.assertEqual(response["error"]["category"], "core_error")
      self.assertIn("string", response["error"]["message"])

  def test_mobile_review_list_exposes_pending_intent_without_applying_it(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(
        Path(tmp),
        name="Mobile Review Sidecar",
        project_id="project-mobile-review-sidecar",
      )
      add_scene(paths, title="Opening", body="The gate stayed closed.")
      revision = create_revision(paths, "Mobile review baseline")
      proposal_payload = {
        "kind": "dictated_passage",
        "title": "Open the gate",
        "scene_id": "scene-0001",
        "content": "The gate opened before Mara arrived.",
      }
      proposal_envelope = {
        "project_id": "project-mobile-review-sidecar",
        "device_id": "device-ios-1",
        "operation_id": "operation-proposal-1",
        "base_revision": revision,
        "payload_digest": mobile_outbox_payload_digest(proposal_payload),
      }
      proposal_frames = _run_requests(
        paths,
        [{
          "id": "mobile-proposal",
          "method": "mobile.outbox.import",
          "params": {"envelope": proposal_envelope, "payload": proposal_payload},
        }],
      )
      proposal_id = _response_for(proposal_frames, "mobile-proposal")["result"]["artifact_id"]
      decision_payload = {
        "kind": "review_decision",
        "target_kind": "proposal",
        "target_id": proposal_id,
        "decision": "accepted",
      }
      decision_envelope = {
        "project_id": "project-mobile-review-sidecar",
        "device_id": "device-ios-1",
        "operation_id": "operation-review-1",
        "base_revision": revision,
        "payload_digest": mobile_outbox_payload_digest(decision_payload),
      }

      frames = _run_requests(
        paths,
        [
          {
            "id": "mobile-decision",
            "method": "mobile.outbox.import",
            "params": {"envelope": decision_envelope, "payload": decision_payload},
          },
          {"id": "mobile-reviews", "method": "mobile.review.list", "params": {}},
        ],
      )

      reviews = _response_for(frames, "mobile-reviews")["result"]
      self.assertEqual(len(reviews), 1)
      self.assertEqual(reviews[0]["status"], "pending_desktop_review")
      self.assertEqual(reviews[0]["payload"]["target_id"], proposal_id)
      self.assertEqual(get_scene(paths, "scene-0001")["body"].strip(), "The gate stayed closed.")

  def test_voice_context_tool_and_turn_methods_share_runtime_contracts(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Voice Sidecar")
      add_scene(paths, title="Opening", body="Mara finds the key.")
      thread = create_chat_thread(paths, title="Voice", provider="local", mode="agent")
      prepared_frames = _run_requests(
        paths,
        [
          {
            "id": "voice-prepare",
            "method": "voice.context.prepare",
            "params": {
              "thread_id": thread["id"],
              "channel": "desktop_voice",
              "utterance": "What next?",
              "current_scene_id": "scene-0001",
            },
          },
          {
            "id": "voice-read-tool",
            "method": "voice.tool.handle",
            "params": {
              "thread_id": thread["id"],
              "channel": "desktop_voice",
              "call_id": "call-read",
              "name": "scene_get",
              "arguments": {"id": "scene-0001"},
            },
          },
          {
            "id": "voice-pending-tool",
            "method": "voice.tool.handle",
            "params": {
              "thread_id": thread["id"],
              "channel": "desktop_voice",
              "call_id": "call-propose",
              "name": "proposal_add",
              "arguments": {
                "title": "Try station",
                "instruction": "Move the next beat to the station.",
                "scene_id": "scene-0001",
              },
            },
          },
        ],
      )
      prepared = _response_for(prepared_frames, "voice-prepare")["result"]
      pack_id = prepared["context_pack"]["pack_id"]
      self.assertEqual(_response_for(prepared_frames, "voice-read-tool")["result"]["status"], "completed")
      self.assertEqual(
        _response_for(prepared_frames, "voice-pending-tool")["result"]["status"],
        "pending_approval",
      )

      recorded_frames = _run_requests(
        paths,
        [
          {
            "id": "voice-record",
            "method": "voice.turn.record",
            "params": {
              "thread_id": thread["id"],
              "turn_id": "turn-sidecar-voice",
              "voice_session_id": "session-one",
              "user_transcript": "What next?",
              "assistant_transcript": "Try the station.",
              "context_pack_id": pack_id,
              "provider_event_id": "evt-done",
              "model": "gpt-realtime",
              "channel": "desktop_voice",
            },
          }
        ],
      )
      recorded = _response_for(recorded_frames, "voice-record")["result"]
      self.assertEqual(recorded["turn"]["status"], "completed")
      self.assertEqual(recorded["turn"]["context_pack_id"], pack_id)

  def test_ping_and_unknown_method(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Sidecar Ping")
      frames = _run_requests(
        paths,
        [
          {"id": "req-1", "method": "ping", "params": {}},
          {"id": "req-2", "method": "nope", "params": {}},
        ],
      )
      ping = _response_for(frames, "req-1")
      self.assertTrue(ping["result"]["ok"])
      self.assertEqual(ping["result"]["protocol_version"], 1)
      unknown = _response_for(frames, "req-2")
      self.assertEqual(unknown["error"]["category"], "unknown_method")

  def test_chat_send_streams_ordered_deltas_then_result(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Sidecar Stream")
      thread = create_chat_thread(paths, title="Stream Thread", provider="local", mode="chat")
      frames = _run_requests(
        paths,
        [
          {
            "id": "req-1",
            "method": "chat.send",
            "params": {
              "thread_id": thread["id"],
              "message": "How should the next chapter open?",
            },
          }
        ],
      )
      deltas = [frame for frame in frames if frame.get("event") == "chat.delta"]
      self.assertGreaterEqual(len(deltas), 2)
      sequences = [frame["sequence"] for frame in deltas]
      self.assertEqual(sequences, sorted(sequences))
      self.assertEqual(len(set(sequences)), len(sequences))
      for frame in deltas:
        self.assertEqual(frame["payload"]["thread_id"], thread["id"])
        self.assertEqual(frame["payload"]["request_id"], "req-1")

      response = _response_for(frames, "req-1")
      assistant = response["result"]["assistant_message"]
      self.assertEqual(assistant["role"], "assistant")
      streamed_text = "".join(frame["payload"]["text"] for frame in deltas)
      self.assertEqual(streamed_text.strip(), assistant["content"])

  def test_chat_send_dual_emits_semantic_turn_events_with_per_turn_sequence(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Semantic Stream")
      thread = create_chat_thread(paths, title="Stream Thread", provider="local", mode="chat")
      frames = _run_requests(
        paths,
        [
          {
            "id": "req-semantic",
            "method": "chat.send",
            "params": {
              "turn_id": "turn-semantic",
              "thread_id": thread["id"],
              "message": "How should the next chapter open?",
            },
          }
        ],
      )

      events = [frame for frame in frames if frame.get("event") == "assistant.event"]
      self.assertGreaterEqual(len(events), 3)
      payloads = [frame["payload"] for frame in events]
      self.assertEqual(
        [payload["turn_sequence"] for payload in payloads],
        list(range(1, len(payloads) + 1)),
      )
      self.assertTrue(all(payload["turn_id"] == "turn-semantic" for payload in payloads))
      self.assertEqual(payloads[-2]["type"], "output.final")
      self.assertEqual(payloads[-1]["type"], "turn.status")
      self.assertEqual(payloads[-1]["data"]["status"], "completed")
      self.assertEqual(
        _response_for(frames, "req-semantic")["result"]["turn"]["turn_id"],
        "turn-semantic",
      )

  def test_thread_and_message_list_methods(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Sidecar Reads")
      thread = create_chat_thread(paths, title="Read Thread", provider="local", mode="chat")
      _run_requests(
        paths,
        [
          {
            "id": "req-1",
            "method": "chat.send",
            "params": {"thread_id": thread["id"], "message": "Hello there."},
          }
        ],
      )
      # Reads dispatch inline (not on a worker thread), so run them in a
      # second server pass after the send has fully settled.
      frames = _run_requests(
        paths,
        [
          {"id": "req-2", "method": "chat.threads", "params": {}},
          {
            "id": "req-3",
            "method": "chat.messages",
            "params": {"thread_id": thread["id"], "limit": 10},
          },
          {
            "id": "req-4",
            "method": "chat.messages",
            "params": {"thread_id": "chat-missing"},
          },
        ],
      )
      threads = _response_for(frames, "req-2")["result"]
      self.assertEqual([row["id"] for row in threads], [thread["id"]])

      messages = _response_for(frames, "req-3")["result"]
      self.assertEqual([row["role"] for row in messages], ["user", "assistant"])

      missing = _response_for(frames, "req-4")
      self.assertIn("error", missing)
      self.assertEqual(missing["error"]["category"], "core_error")

      messages = _response_for(frames, "req-3")["result"]
      truncate_frames = _run_requests(
        paths,
        [
          {
            "id": "req-5",
            "method": "chat.truncate",
            "params": {
              "thread_id": thread["id"],
              "from_message_id": messages[0]["id"],
            },
          },
          {
            "id": "req-6",
            "method": "chat.messages",
            "params": {"thread_id": thread["id"]},
          },
        ],
      )
      truncated = _response_for(truncate_frames, "req-5")["result"]
      self.assertEqual(truncated["removed_count"], 2)
      self.assertEqual(_response_for(truncate_frames, "req-6")["result"], [])

  def test_interrupt_before_send_aborts_turn(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Sidecar Interrupt")
      thread = create_chat_thread(paths, title="Interrupt Thread", provider="local", mode="chat")
      frames = _run_requests(
        paths,
        [
          {"id": "req-0", "method": "chat.interrupt", "params": {"request_id": "req-1"}},
          {
            "id": "req-1",
            "method": "chat.send",
            "params": {
              "turn_id": "turn-interrupted",
              "thread_id": thread["id"],
              "message": "Draft the opening.",
            },
          },
        ],
      )
      interrupt = _response_for(frames, "req-0")
      self.assertTrue(interrupt["result"]["interrupt_requested"])
      send = _response_for(frames, "req-1")
      self.assertEqual(send["error"]["category"], "interrupted")

      messages = list_chat_messages(paths, thread_id=thread["id"])
      self.assertEqual([row["role"] for row in messages], ["user"])
      self.assertEqual(
        AssistantTurnStore(paths).get("turn-interrupted").status,
        "interrupted",
      )


if __name__ == "__main__":
  unittest.main()
