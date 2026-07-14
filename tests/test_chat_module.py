from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from openauthor.budget import update_generation_budget_policy
from openauthor.chat import (
  _build_provider_history,
  create_chat_thread,
  execute_pending_tool_call,
  list_chat_messages,
  list_chat_threads,
  rename_chat_thread,
  send_chat_message,
  update_chat_thread,
)
from openauthor.generations import list_generation_runs
from openauthor.project import OpenAuthorError, initialize_project
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

  def test_chat_send_includes_explicit_scene_mentions_in_context(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Chat Scene Mentions")
      add_scene(
        paths,
        title="Scene One",
        summary="Opening",
        pov="narrator",
        status="draft",
        body="Body one",
      )
      add_scene(
        paths,
        title="Scene Two",
        summary="Follow up",
        pov="narrator",
        status="draft",
        body="Body two",
      )
      thread = create_chat_thread(paths, title="Context Thread", provider="local", mode="agent")

      result = send_chat_message(
        paths,
        thread_id=thread["id"],
        message="Use both scenes for this suggestion.",
        current_scene_id="scene-0001",
        scene_ids=["scene-0002"],
      )

      context_used = result["user_message"]["context_used"]
      self.assertEqual(context_used["scene_ids"], ["scene-0001", "scene-0002"])

  def test_build_provider_history_maps_roles_and_windows_by_tokens(self) -> None:
    rows = [
      {"role": "user", "content": "First question."},
      {"role": "assistant", "content": "First answer."},
      {"role": "tool", "content": '{"tool":"scene.list","result":[]}'},
    ]
    history = _build_provider_history(rows, token_budget=4000)
    self.assertEqual(
      [entry["role"] for entry in history],
      ["user", "assistant", "user"],
    )
    self.assertEqual(history[0]["content"], "First question.")
    self.assertTrue(history[2]["content"].startswith("Tool result:"))

    self.assertEqual(_build_provider_history(rows, token_budget=0), [])

    old_row = {"role": "user", "content": "old words " * 100}
    new_row = {"role": "user", "content": "keep this recent question"}
    windowed = _build_provider_history([old_row, new_row], token_budget=20)
    self.assertEqual(len(windowed), 1)
    self.assertEqual(windowed[0]["content"], "keep this recent question")

    # A window that starts mid-conversation must not lead with an assistant
    # turn, and consecutive same-role entries collapse into one.
    dangling = _build_provider_history(
      [
        {"role": "assistant", "content": "Orphaned answer."},
        {"role": "user", "content": "Follow-up one."},
        {"role": "user", "content": "Follow-up two."},
      ],
      token_budget=4000,
    )
    self.assertEqual(len(dangling), 1)
    self.assertEqual(dangling[0]["role"], "user")
    self.assertIn("Follow-up one.", dangling[0]["content"])
    self.assertIn("Follow-up two.", dangling[0]["content"])

  def test_chat_send_passes_thread_history_to_provider(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Chat History")
      thread = create_chat_thread(paths, title="History Thread", provider="local", mode="chat")

      completion = {
        "text": "Reply one.",
        "input_tokens": 10,
        "output_tokens": 5,
        "latency_ms": 4,
        "provider_attempts": 1,
        "estimated_cost_usd": None,
        "generation_id": "gen-000000000000",
        "log_path": "",
      }
      with patch("openauthor.chat.complete_chat", return_value=completion) as fake:
        send_chat_message(paths, thread_id=thread["id"], message="First question.")
        first_history = fake.call_args.kwargs["history"]
        self.assertEqual(first_history, [])

        send_chat_message(paths, thread_id=thread["id"], message="Second question.")
        second_history = fake.call_args.kwargs["history"]
        self.assertEqual(
          [entry["role"] for entry in second_history],
          ["user", "assistant"],
        )
        self.assertEqual(second_history[0]["content"], "First question.")
        self.assertEqual(second_history[1]["content"], "Reply one.")
        self.assertEqual(fake.call_args.kwargs["thread_id"], thread["id"])

  def test_chat_send_writes_generation_log_with_thread_provenance(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Chat Provenance")
      thread = create_chat_thread(paths, title="Logged Thread", provider="local", mode="chat")

      result = send_chat_message(
        paths,
        thread_id=thread["id"],
        message="What should happen in the next scene?",
      )
      generation_id = result["assistant_message"]["usage"]["generation_id"]
      self.assertTrue(generation_id.startswith("gen-"))

      runs = list_generation_runs(paths)
      row = next(item for item in runs if item["run_id"] == generation_id)
      self.assertEqual(row["kind"], "chat")
      self.assertEqual(row["thread_id"], thread["id"])
      self.assertEqual(row["status"], "succeeded")
      self.assertIsNotNone(row["input_tokens"])
      self.assertIsNotNone(row["output_tokens"])

  def test_chat_send_blocked_by_budget_policy_fails_closed(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Chat Budget")
      thread = create_chat_thread(paths, title="Budget Thread", provider="local", mode="chat")
      update_generation_budget_policy(paths, max_output_tokens=64)

      with self.assertRaises(OpenAuthorError) as context:
        send_chat_message(paths, thread_id=thread["id"], message="Hello there.")
      self.assertIn("budget", str(context.exception).lower())

      runs = list_generation_runs(paths, status="failed")
      self.assertTrue(
        any(
          row["kind"] == "chat"
          and row["thread_id"] == thread["id"]
          and row["error_category"] == "budget_policy_violation"
          for row in runs
        )
      )
      messages = list_chat_messages(paths, thread_id=thread["id"])
      self.assertEqual([row["role"] for row in messages], ["user"])


if __name__ == "__main__":
  unittest.main()
