from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from openauthor.codex_app_server import CodexAppServer


class CodexAppServerModuleTests(unittest.TestCase):
  def test_login_opens_app_server_url_and_waits_for_matching_completion(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      server = CodexAppServer(binary=Path("/bin/true"), codex_home=Path(tmp))
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

  def test_completion_streams_text_usage_and_defers_host_tool_call(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      server = CodexAppServer(binary=Path("/bin/true"), codex_home=Path(tmp))
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
    self.assertEqual(result["tool_calls"], [{"id": "call-1", "name": "scene_list", "args": {}}])
    self.assertEqual(result["input_tokens"], 120)
    self.assertTrue(tool_response["success"])


if __name__ == "__main__":
  unittest.main()
