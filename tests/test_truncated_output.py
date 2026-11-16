from __future__ import annotations

import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch

from openauthor import ai
from openauthor.budget import summarize_generation_usage
from openauthor.chat import create_chat_thread, list_chat_messages, send_chat_message
from openauthor.git_ops import create_branch, create_snapshot, current_branch, initialize_git, switch_branch
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.proposals import create_proposal, get_proposal, list_proposals, set_proposal_draft
from openauthor.scenes import add_scene, get_scene, update_scene
from openauthor.selection_editing import generate_selection, preview_selection

CUT_OFF = "cut off at its output length limit, so nothing was changed"
KEYS = {"OPENAI_API_KEY": "synthetic-test-key", "ANTHROPIC_API_KEY": "synthetic-test-key", "OPENROUTER_API_KEY": "synthetic-test-key"}


def _openai_reply(text: str, finish_reason: str, *, tool_calls: list[dict[str, Any]] | None = None) -> io.BytesIO:
  message: dict[str, Any] = {"content": text}
  if tool_calls:
    message["tool_calls"] = tool_calls
  return io.BytesIO(json.dumps({
    "choices": [{"message": message, "finish_reason": finish_reason}],
    "usage": {"prompt_tokens": 120, "completion_tokens": 64},
  }).encode())


def _anthropic_reply(text: str, stop_reason: str) -> io.BytesIO:
  return io.BytesIO(json.dumps({
    "content": [{"type": "text", "text": text}] if text else [],
    "stop_reason": stop_reason,
    "usage": {"input_tokens": 120, "output_tokens": 64},
  }).encode())


class _EventStream:
  def __init__(self, frames: list[Any]) -> None:
    self._frames = frames

  def __enter__(self) -> "_EventStream":
    return self

  def __exit__(self, *_: object) -> bool:
    return False

  def __iter__(self):
    for frame in self._frames:
      data = frame if isinstance(frame, str) else json.dumps(frame)
      yield f"data: {data}\n".encode()


def _openai_stream(text: str, finish_reason: str) -> _EventStream:
  return _EventStream([
    {"choices": [{"delta": {"content": text}, "finish_reason": None}]},
    {"choices": [{"delta": {}, "finish_reason": finish_reason}]},
    {"choices": [], "usage": {"prompt_tokens": 120, "completion_tokens": 64}},
    "[DONE]",
  ])


def _anthropic_stream(text: str, stop_reason: str) -> _EventStream:
  return _EventStream([
    {"type": "message_start", "message": {"usage": {"input_tokens": 120}}},
    {"type": "content_block_delta", "delta": {"type": "text_delta", "text": text}},
    {"type": "message_delta", "delta": {"stop_reason": stop_reason}, "usage": {"output_tokens": 64}},
    {"type": "message_stop"},
  ])


def _provider_call(provider: str, transport: Any, *, on_delta: Any = None) -> dict[str, Any]:
  with patch.dict(os.environ, KEYS), patch("urllib.request.urlopen", return_value=transport):
    return ai._call_provider(
      project_root=Path("."), provider=provider, model="synthetic-model", system_prompt="System.",
      user_prompt="Write.", context={}, instruction="Write.", temperature=0.2, max_output_tokens=64, on_delta=on_delta,
    )


class StopReasonTests(unittest.TestCase):
  def test_length_stop_is_detected_in_every_blocking_and_streaming_path(self) -> None:
    cases = {
      "openai blocking": lambda: _provider_call("openai", _openai_reply("Half a sen", "length")),
      "openrouter blocking": lambda: _provider_call("openrouter", _openai_reply("Half a sen", "length")),
      "anthropic blocking": lambda: _provider_call("anthropic", _anthropic_reply("Half a sen", "max_tokens")),
      "openai stream": lambda: _provider_call("openai", _openai_stream("Half a sen", "length"), on_delta=lambda _: None),
      "openrouter stream": lambda: _provider_call("openrouter", _openai_stream("Half a sen", "length"), on_delta=lambda _: None),
      "anthropic stream": lambda: _provider_call("anthropic", _anthropic_stream("Half a sen", "max_tokens"), on_delta=lambda _: None),
    }
    for name, call in cases.items():
      with self.subTest(name):
        result = call()
        self.assertTrue(result["truncated"])
        self.assertEqual(result["text"], "Half a sen")
        self.assertEqual((result["input_tokens"], result["output_tokens"]), (120, 64))

  def test_normal_completion_is_not_marked(self) -> None:
    cases = {
      "openai blocking": lambda: _provider_call("openai", _openai_reply("A whole sentence.", "stop")),
      "anthropic blocking": lambda: _provider_call("anthropic", _anthropic_reply("A whole sentence.", "end_turn")),
      "openai stream": lambda: _provider_call("openai", _openai_stream("A whole sentence.", "stop"), on_delta=lambda _: None),
      "anthropic stream": lambda: _provider_call("anthropic", _anthropic_stream("A whole sentence.", "end_turn"), on_delta=lambda _: None),
      "no reason reported": lambda: _provider_call("openai", io.BytesIO(json.dumps({"choices": [{"message": {"content": "A whole sentence."}}], "usage": {}}).encode())),
    }
    for name, call in cases.items():
      with self.subTest(name):
        self.assertFalse(call()["truncated"])

  def test_local_provider_never_reports_truncation(self) -> None:
    result = ai._call_provider(
      project_root=Path("."), provider="local", model="local", system_prompt="", user_prompt="Hello",
      context={"chat_mode": True}, instruction="Hello", temperature=0.2, max_output_tokens=64,
    )
    self.assertFalse(result["truncated"])


class _ProjectCase(unittest.TestCase):
  def setUp(self) -> None:
    temporary = tempfile.TemporaryDirectory()
    self.addCleanup(temporary.cleanup)
    self.paths = initialize_project(Path(temporary.name), name="Cut-off responses")
    self.body = "Mara began to count the lanterns. Her left hand had four fingers."
    add_scene(self.paths, title="The Gate", body=self.body)
    environment = patch.dict(os.environ, KEYS)
    environment.start()
    self.addCleanup(environment.stop)

  def _failed_runs(self) -> list[dict[str, Any]]:
    logs = [json.loads(path.read_text(encoding="utf-8")) for path in sorted(self.paths.generations_dir.glob("gen-*.json"))]
    return [log for log in logs if log.get("status") == "failed"]

  def _assert_logged_as_truncated_spend(self) -> None:
    failed = self._failed_runs()
    self.assertEqual(len(failed), 1)
    self.assertEqual(failed[0]["error"]["category"], "truncated_output")
    self.assertTrue(failed[0]["usage_reported"])
    self.assertEqual((failed[0]["usage"]["input_tokens"], failed[0]["usage"]["output_tokens"]), (120, 64))
    # The cut-off attempt still cost tokens, so it counts against the budget.
    self.assertEqual(summarize_generation_usage(self.paths)["lifetime"]["total_tokens"], 184)


class ManuscriptOutputTests(_ProjectCase):
  def test_truncated_scene_draft_is_rejected_and_not_stored(self) -> None:
    proposal_id = create_proposal(self.paths, title="Tighten", instruction="Tighten.", scene_id="scene-0001")
    before = get_proposal(self.paths, proposal_id)
    for provider, reply in (("openai", _openai_reply("Mara counted the lan", "length")), ("anthropic", _anthropic_reply("Mara counted the lan", "max_tokens"))):
      with self.subTest(provider):
        preview = ai.preview_proposal_revision(self.paths, proposal_id=proposal_id, provider=provider)
        with patch("urllib.request.urlopen", return_value=reply):
          with self.assertRaisesRegex(OpenAuthorError, CUT_OFF) as caught:
            ai.generate_proposal_draft(self.paths, proposal_id=proposal_id, provider=provider, expected_context_fingerprint=preview["fingerprint"])
        self.assertIn("truncated_output", str(caught.exception))
        self.assertEqual(get_proposal(self.paths, proposal_id), before)
        self.assertEqual(get_scene(self.paths, "scene-0001")["body"].rstrip("\n"), self.body)
    self.assertEqual([row["error"]["category"] for row in self._failed_runs()], ["truncated_output", "truncated_output"])

  def test_complete_scene_draft_is_still_stored(self) -> None:
    proposal_id = create_proposal(self.paths, title="Tighten", instruction="Tighten.", scene_id="scene-0001")
    preview = ai.preview_proposal_revision(self.paths, proposal_id=proposal_id, provider="openai")
    with patch("urllib.request.urlopen", return_value=_openai_reply("Mara counted the lanterns. Her left hand had four fingers.", "stop")):
      drafted = ai.generate_proposal_draft(self.paths, proposal_id=proposal_id, provider="openai", expected_context_fingerprint=preview["fingerprint"])
    self.assertEqual(drafted["proposed_body"].strip(), "Mara counted the lanterns. Her left hand had four fingers.")
    self.assertEqual(self._failed_runs(), [])

  def test_truncated_edit_plan_creates_no_change_set(self) -> None:
    args = dict(scene_id="scene-0001", instruction="Tighten.", provider="openai")
    preview = ai.preview_proposal_generation(self.paths, **args)
    with patch("urllib.request.urlopen", return_value=_openai_reply("Intent: Tighten.\nConstraints: Pres", "length")):
      with self.assertRaisesRegex(OpenAuthorError, CUT_OFF):
        ai.generate_proposal(self.paths, **args, expected_context_fingerprint=preview["fingerprint"])
    self.assertEqual(list_proposals(self.paths), [])
    self._assert_logged_as_truncated_spend()

  def test_truncated_passage_regeneration_keeps_the_reviewed_hunk(self) -> None:
    proposal_id = create_proposal(self.paths, title="Tighten", instruction="Tighten.", scene_id="scene-0001")
    proposal = set_proposal_draft(self.paths, proposal_id=proposal_id, proposed_body="Mara counted the lanterns. Her left hand had four fingers.")
    args = dict(proposal_id=proposal_id, hunk_id=proposal["change_set"]["hunks"][0]["id"], provider="openai")
    preview = ai.preview_proposal_revision(self.paths, **args)
    before = get_proposal(self.paths, proposal_id)
    with patch("urllib.request.urlopen", return_value=_openai_reply("Mara counted the", "length")):
      with self.assertRaisesRegex(OpenAuthorError, CUT_OFF):
        ai.regenerate_change_hunk(self.paths, **args, expected_context_fingerprint=preview["fingerprint"])
    after = get_proposal(self.paths, proposal_id)
    self.assertEqual(after["change_set"], before["change_set"])
    self.assertEqual(after["proposed_body"], before["proposed_body"])

  def test_truncated_selection_edit_creates_no_proposal(self) -> None:
    selected = "Mara began to count the lanterns."
    args = dict(scene_id="scene-0001", start=0, end=len(selected), selected_text=selected, action="rewrite", provider="openai", instruction="Tighten.")
    preview = preview_selection(self.paths, **args)
    with patch("urllib.request.urlopen", return_value=_openai_reply("Mara counted the", "length")):
      with self.assertRaisesRegex(OpenAuthorError, CUT_OFF):
        generate_selection(self.paths, **args, expected_fingerprint=preview["fingerprint"], request_id="cut-off-selection")
    self.assertEqual(list_proposals(self.paths), [])
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"].rstrip("\n"), self.body)
    self._assert_logged_as_truncated_spend()

  def test_response_cut_off_before_any_text_is_reported_as_truncated(self) -> None:
    args = dict(scene_id="scene-0001", instruction="Tighten.", provider="anthropic")
    preview = ai.preview_proposal_generation(self.paths, **args)
    with patch("urllib.request.urlopen", return_value=_anthropic_reply("", "max_tokens")):
      with self.assertRaisesRegex(OpenAuthorError, CUT_OFF):
        ai.generate_proposal(self.paths, **args, expected_context_fingerprint=preview["fingerprint"])
    self._assert_logged_as_truncated_spend()

  def test_structured_completions_reject_truncation_by_default(self) -> None:
    with patch("urllib.request.urlopen", return_value=_openai_reply('{"entities": [{"name": "Mar', "length")):
      with self.assertRaisesRegex(OpenAuthorError, CUT_OFF) as caught:
        ai.complete_chat(self.paths, provider="openai", model="", system_prompt="Return JSON.", user_prompt="{}", chat_mode=False)
    self.assertEqual(caught.exception.category, "truncated_output")
    self.assertFalse(caught.exception.retriable)
    self._assert_logged_as_truncated_spend()


class MergeOutputTests(unittest.TestCase):
  def test_truncated_reconciliation_creates_no_resolution(self) -> None:
    temporary = tempfile.TemporaryDirectory()
    self.addCleanup(temporary.cleanup)
    paths = initialize_project(Path(temporary.name), name="Cut-off merge")
    initialize_git(paths)
    add_scene(paths, title="Choice", body="Mara waited at the gate.")
    create_snapshot(paths, "Seed")
    base = current_branch(paths)
    create_branch(paths, name="alternate")
    update_scene(paths, scene_identifier="scene-0001", body="Mara chose betrayal.")
    create_snapshot(paths, "Alternate")
    switch_branch(paths, name=base)
    update_scene(paths, scene_identifier="scene-0001", body="Mara chose loyalty.")
    create_snapshot(paths, "Primary")
    args = {"base": base, "head": "alternate", "scene_path": get_scene(paths, "scene-0001")["path"], "provider": "openai"}
    preview = ai.preview_merge_resolution(paths, **args)
    with patch.dict(os.environ, KEYS), patch("urllib.request.urlopen", return_value=_openai_reply("Mara chose", "length")):
      with self.assertRaisesRegex(OpenAuthorError, CUT_OFF):
        ai.generate_merge_resolution(paths, **args, expected_context_fingerprint=preview["fingerprint"])
    self.assertEqual(list_proposals(paths), [])
    self.assertEqual(get_scene(paths, "scene-0001")["body"].strip(), "Mara chose loyalty.")


class ChatReplyTests(_ProjectCase):
  def _send(self, provider: str, transport: Any) -> dict[str, Any]:
    thread = create_chat_thread(self.paths, title="Cut-off chat", provider=provider, mode="chat")
    self.thread_id = thread["id"]
    with patch("urllib.request.urlopen", return_value=transport):
      return send_chat_message(self.paths, thread_id=thread["id"], message="Describe the gate.", on_delta=lambda _: None)

  def test_cut_off_reply_keeps_its_text_and_is_marked_on_the_message(self) -> None:
    for provider, transport in (("openai", _openai_stream("The gate stood half", "length")), ("anthropic", _anthropic_stream("The gate stood half", "max_tokens"))):
      with self.subTest(provider):
        result = self._send(provider, transport)
        message = result["assistant_message"]
        self.assertEqual(message["content"], "The gate stood half")
        self.assertIs(message["usage"]["truncated"], True)
        stored = [row for row in list_chat_messages(self.paths, thread_id=self.thread_id) if row["role"] == "assistant"]
        self.assertIs(stored[0]["usage"]["truncated"], True)
        log = json.loads((self.paths.generations_dir / f"{message['usage']['generation_id']}.json").read_text(encoding="utf-8"))
        self.assertEqual(log["status"], "succeeded")
        self.assertIs(log["truncated"], True)

  def test_complete_reply_carries_no_marker(self) -> None:
    result = self._send("openai", _openai_stream("The gate stood open.", "stop"))
    self.assertNotIn("truncated", result["assistant_message"]["usage"])
    log = json.loads((self.paths.generations_dir / f"{result['assistant_message']['usage']['generation_id']}.json").read_text(encoding="utf-8"))
    self.assertNotIn("truncated", log)

  def test_reply_cut_off_before_any_text_fails_the_turn(self) -> None:
    with self.assertRaisesRegex(OpenAuthorError, CUT_OFF):
      self._send("anthropic", _EventStream([
        {"type": "message_start", "message": {"usage": {"input_tokens": 120}}},
        {"type": "message_delta", "delta": {"stop_reason": "max_tokens"}, "usage": {"output_tokens": 64}},
        {"type": "message_stop"},
      ]))
    self.assertEqual([row for row in list_chat_messages(self.paths, thread_id=self.thread_id) if row["role"] == "assistant"], [])

  def test_cut_off_tool_call_is_never_returned_for_execution(self) -> None:
    tool = {"name": "scene_get", "description": "Read a scene.", "parameters": {"type": "object", "properties": {"scene_id": {"type": "string"}}}}
    call = {"id": "call-1", "type": "function", "function": {"name": "scene_get", "arguments": "{\"scene_id\": \"scene-00"}}
    with patch("urllib.request.urlopen", return_value=_openai_reply("Let me look.", "length", tool_calls=[call])):
      with self.assertRaisesRegex(OpenAuthorError, CUT_OFF):
        ai.complete_chat(self.paths, provider="openai", model="", system_prompt="Assist.", user_prompt="Read it.", tools=[tool], allow_truncated=True)


if __name__ == "__main__":
  unittest.main()
