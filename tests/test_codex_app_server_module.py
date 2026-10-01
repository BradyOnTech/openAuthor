from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from openauthor.codex_app_server import CodexAppServer, CodexAppServerError, CodexAppServerUnsafeConfiguration


class CodexAppServerModuleTests(unittest.TestCase):
  def test_unverified_runtime_is_refused_before_starting_an_app_server(self):
    import subprocess
    with tempfile.TemporaryDirectory() as tmp:
      server = CodexAppServer(binary=Path("/bin/true"), codex_home=Path(tmp))
      with patch("subprocess.run", return_value=subprocess.CompletedProcess([], 0, "codex-cli 0.100.0\n", "")), patch("subprocess.Popen") as process:
        with self.assertRaisesRegex(CodexAppServerError, "verified runtime"):
          server.start()
        process.assert_not_called()

  def test_global_instruction_files_fail_before_launch_without_changing_them(self):
    for filename in ("AGENTS.md", "AGENTS.override.md"):
      with self.subTest(filename=filename), tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp)
        (home / filename).write_text("Private synthetic instruction.", encoding="utf-8")
        server = CodexAppServer(binary=Path("/bin/true"), codex_home=home)
        with patch("subprocess.Popen") as process:
          with self.assertRaisesRegex(CodexAppServerUnsafeConfiguration, "No manuscript was sent"):
            server.start()
          process.assert_not_called()
        self.assertEqual((home / filename).read_text(), "Private synthetic instruction.")

  def test_noncompleted_turns_never_return_partial_writing_as_success(self):
    for status in ("interrupted", "failed", "inProgress", None):
      with self.subTest(status=status), tempfile.TemporaryDirectory() as tmp:
        server = CodexAppServer(binary=Path("/bin/true"), codex_home=Path(tmp))
        self.addCleanup(server.close)
        def request(method, params, **callbacks):
          if method == "thread/start":
            return {"thread": {"id": "thread-1"}}
          return {"turn": {"id": "turn-1"}}
        def wait_for(predicate, **callbacks):
          callbacks["on_message"]({"method": "item/agentMessage/delta", "params": {"itemId": "message-1", "delta": "Incomplete writing"}})
          message = {"method": "turn/completed", "params": {"turn": {"id": "turn-1", "status": status, "error": None}}}
          callbacks["on_message"](message)
          return message
        server.request = request
        server.wait_for = wait_for
        with self.assertRaisesRegex(CodexAppServerError, "not complete"):
          server.complete(project_root=Path(tmp), model="codex-recommended", system_prompt="Write.", history=[], user_prompt="Revise.", max_output_tokens=300, on_delta=None, tools=None)

  def test_login_opens_app_server_url_and_waits_for_matching_completion(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      server = CodexAppServer(binary=Path("/bin/true"), codex_home=Path(tmp))
      self.addCleanup(server.close)
      requests: list[tuple[str, object]] = []

      def request(method: str, params: object, **_: object) -> dict[str, object]:
        requests.append((method, params))
        if method == "account/login/start":
          return {
            "type": "chatgpt",
            "loginId": "login-1",
            "authUrl": "https://auth.openai.test/start",
          }
        if method == "account/read":
          return {
            "account": {
              "type": "chatgpt",
              "email": "writer@example.com",
              "planType": "plus",
            },
            "requiresOpenaiAuth": True,
          }
        raise AssertionError(method)

      def wait_for(predicate: object, **_: object) -> dict[str, object]:
        message = {
          "method": "account/login/completed",
          "params": {"loginId": "login-1", "success": True, "error": None},
        }
        self.assertTrue(predicate(message))  # type: ignore[operator]
        return message

      server.request = request  # type: ignore[method-assign]
      server.wait_for = wait_for  # type: ignore[method-assign]
      with patch("openauthor.codex_app_server.webbrowser.open", return_value=True) as opened:
        status = server.login_chatgpt()

    self.assertTrue(status["authenticated"])
    self.assertEqual(status["plan_type"], "plus")
    opened.assert_called_once_with("https://auth.openai.test/start")
    self.assertEqual(requests[0][0], "account/login/start")

  def test_login_waits_for_account_update_when_read_is_initially_empty(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      server = CodexAppServer(binary=Path("/bin/true"), codex_home=Path(tmp))
      self.addCleanup(server.close)
      read_count = 0
      wait_count = 0

      def request(method: str, params: object, **_: object) -> dict[str, object]:
        nonlocal read_count
        if method == "account/login/start":
          return {
            "type": "chatgpt",
            "loginId": "login-1",
            "authUrl": "https://auth.openai.test/start",
          }
        if method == "account/read":
          read_count += 1
          if read_count == 1:
            return {"account": None, "requiresOpenaiAuth": True}
          return {
            "account": {
              "type": "chatgpt",
              "email": "writer@example.com",
              "planType": "plus",
            },
            "requiresOpenaiAuth": True,
          }
        raise AssertionError(method)

      def wait_for(predicate: object, **callbacks: object) -> dict[str, object]:
        nonlocal wait_count
        wait_count += 1
        if wait_count == 1:
          message: dict[str, object] = {
            "method": "account/login/completed",
            "params": {"loginId": "login-1", "success": True, "error": None},
          }
        else:
          message = {
            "method": "account/updated",
            "params": {"authMode": "chatgpt", "planType": "plus"},
          }
        on_message = callbacks.get("on_message")
        if on_message is not None:
          on_message(message)  # type: ignore[operator]
        self.assertTrue(predicate(message))  # type: ignore[operator]
        return message

      server.request = request  # type: ignore[method-assign]
      server.wait_for = wait_for  # type: ignore[method-assign]
      with patch("openauthor.codex_app_server.webbrowser.open", return_value=True):
        status = server.login_chatgpt()

    self.assertTrue(status["authenticated"])
    self.assertEqual(read_count, 2)
    self.assertEqual(wait_count, 2)

  def test_completion_streams_text_usage_and_defers_host_tool_call(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      server = CodexAppServer(binary=Path("/bin/true"), codex_home=Path(tmp))
      self.addCleanup(server.close)
      thread_params: dict[str, object] = {}
      tool_response: dict[str, object] = {}

      def request(
        method: str,
        params: dict[str, object],
        **callbacks: object,
      ) -> dict[str, object]:
        nonlocal thread_params, tool_response
        if method == "thread/start":
          thread_params = params
          return {
            "thread": {"id": "thread-1"},
            "model": "gpt-5.6-sol",
          }
        if method == "turn/start":
          handle_request = callbacks["on_server_request"]
          tool_response = handle_request({  # type: ignore[operator]
            "method": "item/tool/call",
            "id": 80,
            "params": {
              "threadId": "thread-1",
              "turnId": "turn-1",
              "callId": "call-1",
              "namespace": None,
              "tool": "scene_list",
              "arguments": {},
            },
          })
          handle_message = callbacks["on_message"]
          handle_message({  # type: ignore[operator]
            "method": "item/completed",
            "params": {
              "item": {"type": "agentMessage", "id": "message-1", "text": ""},
            },
          })
          handle_message({  # type: ignore[operator]
            "method": "thread/tokenUsage/updated",
            "params": {
              "tokenUsage": {
                "last": {"inputTokens": 120, "outputTokens": 8},
                "total": {"inputTokens": 230, "outputTokens": 15},
              },
            },
          })
          return {"turn": {"id": "turn-1"}}
        raise AssertionError(method)

      def wait_for(predicate: object, **callbacks: object) -> dict[str, object]:
        message = {
          "method": "turn/completed",
          "params": {
            "turn": {"id": "turn-1", "status": "completed", "error": None},
          },
        }
        handle_message = callbacks["on_message"]
        handle_message(message)  # type: ignore[operator]
        self.assertTrue(predicate(message))  # type: ignore[operator]
        return message

      server.request = request  # type: ignore[method-assign]
      server.wait_for = wait_for  # type: ignore[method-assign]
      result = server.complete(
        project_root=Path(tmp),
        model="gpt-5.6-sol",
        system_prompt="Help the author.",
        history=[],
        user_prompt="List scenes.",
        max_output_tokens=300,
        on_delta=None,
        tools=[{
          "name": "scene_list",
          "description": "List scenes.",
          "parameters": {"type": "object", "properties": {}, "required": []},
        }],
      )

    self.assertEqual(thread_params["model"], "gpt-5.6-sol")
    self.assertEqual(thread_params["sandbox"], "read-only")
    self.assertEqual(thread_params["environments"], [])
    config = thread_params["config"]
    self.assertIsInstance(config, dict)
    self.assertEqual(config["web_search"], "disabled")  # type: ignore[index]
    self.assertFalse(config["features"]["shell_tool"])  # type: ignore[index]
    self.assertFalse(config["features"]["multi_agent"])  # type: ignore[index]
    self.assertEqual(result["tool_calls"], [{"id": "call-1", "name": "scene_list", "args": {}}])
    self.assertEqual(result["input_tokens"], 230)
    self.assertEqual(result["output_tokens"], 15)
    self.assertEqual(result["model"], "gpt-5.6-sol")
    self.assertTrue(tool_response["success"])

  def test_recommended_model_is_selected_by_codex_runtime(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      server = CodexAppServer(binary=Path("/bin/true"), codex_home=Path(tmp))
      self.addCleanup(server.close)
      thread_params: dict[str, object] = {}

      def request(
        method: str,
        params: dict[str, object],
        **_: object,
      ) -> dict[str, object]:
        nonlocal thread_params
        if method == "thread/start":
          thread_params = params
          return {"thread": {"id": "thread-1"}}
        if method == "turn/start":
          return {"turn": {"id": "turn-1"}}
        raise AssertionError(method)

      def wait_for(predicate: object, **callbacks: object) -> dict[str, object]:
        message: dict[str, object] = {
          "method": "turn/completed",
          "params": {
            "turn": {"id": "turn-1", "status": "completed", "error": None},
          },
        }
        handle_message = callbacks["on_message"]
        handle_message(message)  # type: ignore[operator]
        self.assertTrue(predicate(message))  # type: ignore[operator]
        return message

      server.request = request  # type: ignore[method-assign]
      server.wait_for = wait_for  # type: ignore[method-assign]
      server.complete(
        project_root=Path(tmp),
        model="codex-recommended",
        system_prompt="Help the author.",
        history=[],
        user_prompt="Improve this paragraph.",
        max_output_tokens=300,
        on_delta=None,
        tools=None,
      )

    self.assertNotIn("model", thread_params)


if __name__ == "__main__":
  unittest.main()
