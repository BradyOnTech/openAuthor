from __future__ import annotations

import io
import json
import tempfile
import unittest
from pathlib import Path
from typing import Any

from openauthor.chat import create_chat_thread, list_chat_messages
from openauthor.project import initialize_project
from openauthor.server import ChatSidecarServer


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
            "params": {"thread_id": thread["id"], "message": "Draft the opening."},
          },
        ],
      )
      interrupt = _response_for(frames, "req-0")
      self.assertTrue(interrupt["result"]["interrupt_requested"])
      send = _response_for(frames, "req-1")
      self.assertEqual(send["error"]["category"], "interrupted")

      messages = list_chat_messages(paths, thread_id=thread["id"])
      self.assertEqual([row["role"] for row in messages], ["user"])


if __name__ == "__main__":
  unittest.main()
