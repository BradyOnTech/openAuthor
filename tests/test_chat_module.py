from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from openauthor.chat import (
  create_chat_thread,
  execute_pending_tool_call,
  list_chat_messages,
  list_chat_threads,
  rename_chat_thread,
  send_chat_message,
  update_chat_thread,
)
from openauthor.project import initialize_project
from openauthor.scenes import add_scene


class ChatModuleTests(unittest.TestCase):
  def test_chat_thread_lifecycle(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Chat Thread Lifecycle")
      created = create_chat_thread(
        paths,
        title="Worldbuilding",
        provider="local",
        mode="chat",
      )
      self.assertEqual(created["title"], "Worldbuilding")
      self.assertEqual(created["provider"], "local")
      self.assertEqual(created["mode"], "chat")
      self.assertEqual(created["model"], "heuristic-v1")

      renamed = rename_chat_thread(paths, thread_id=created["id"], title="Draft Room")
      self.assertEqual(renamed["title"], "Draft Room")

      updated = update_chat_thread(
        paths,
        thread_id=created["id"],
        mode="agent",
        context_profile={
          "include_codex": "explicit",
          "retrieval_mode": "auto",
        },
      )
      self.assertEqual(updated["mode"], "agent")
      self.assertEqual(updated["context_profile"]["include_codex"], "explicit")
      self.assertEqual(updated["context_profile"]["retrieval_mode"], "auto")

      threads = list_chat_threads(paths)
      self.assertEqual(len(threads), 1)
      self.assertEqual(threads[0]["id"], created["id"])

  def test_chat_send_agent_executes_read_tools_and_queues_writes(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Chat Send")
      add_scene(
        paths,
        title="Scene One",
        summary="Opening",
        pov="narrator",
        status="draft",
        body="A simple opening scene body.",
      )
      thread = create_chat_thread(
        paths,
        title="Agent Thread",
        provider="local",
        mode="agent",
      )

      read_result = send_chat_message(
        paths,
        thread_id=thread["id"],
        message="Please list scenes for me.",
        current_scene_id="scene-0001",
      )
      self.assertEqual(read_result["assistant_message"]["role"], "assistant")
      self.assertEqual(len(read_result["pending_tool_calls"]), 0)
      self.assertGreaterEqual(len(read_result["tool_messages"]), 1)

      write_result = send_chat_message(
        paths,
        thread_id=thread["id"],
        message="Please create proposal for this scene.",
        current_scene_id="scene-0001",
      )
      self.assertGreaterEqual(len(write_result["pending_tool_calls"]), 1)
      pending = write_result["pending_tool_calls"][0]
      self.assertEqual(pending["tool"], "proposal.add")
      self.assertEqual(pending["classification"], "write")

      executed = execute_pending_tool_call(
        paths,
        thread_id=thread["id"],
        assistant_message_id=write_result["assistant_message"]["id"],
        tool_index=0,
      )
      self.assertEqual(executed["tool"], "proposal.add")

      messages = list_chat_messages(paths, thread_id=thread["id"])
      self.assertTrue(any(row["role"] == "tool" for row in messages))


if __name__ == "__main__":
  unittest.main()
