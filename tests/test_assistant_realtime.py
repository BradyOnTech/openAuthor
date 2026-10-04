from __future__ import annotations

import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from openauthor.assistant.realtime import (
  RealtimeSessionBroker,
  build_realtime_session_config,
)
from openauthor.project import OpenAuthorError, initialize_project


class _Response:
  def __init__(self, body: bytes) -> None:
    self._body = io.BytesIO(body)

  def __enter__(self) -> "_Response":
    return self

  def __exit__(self, *_args: object) -> None:
    return None

  def read(self) -> bytes:
    return self._body.read()


class AssistantRealtimeTests(unittest.TestCase):
  def test_session_config_uses_semantic_vad_and_voice_tool_allowlist(self) -> None:
    config = build_realtime_session_config(
      model="gpt-realtime",
      voice="marin",
      instructions="Bounded context",
      channel="desktop_voice",
    )
    self.assertEqual(config["type"], "realtime")
    self.assertEqual(config["max_output_tokens"], 1200)
    self.assertEqual(config["truncation"], "disabled")
    self.assertEqual(config["audio"]["input"]["turn_detection"]["type"], "semantic_vad")
    names = [tool["name"] for tool in config["tools"]]
    self.assertIn("scene_get", names)
    self.assertIn("proposal_add", names)
    self.assertNotIn("branch_switch", names)
    self.assertNotIn("merge_apply", names)

  def test_broker_requires_server_side_key_and_never_returns_it(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Realtime Broker")
      broker = RealtimeSessionBroker(paths)
      with patch.dict(os.environ, {}, clear=True):
        with self.assertRaisesRegex(OpenAuthorError, "OPENAI_API_KEY"):
          broker.negotiate(
            offer_sdp="v=0\r\n",
            context_pack_id="ctx-one",
            instructions="Bounded context",
          )

      captured: dict[str, object] = {}

      def fake_urlopen(request: object, timeout: int) -> _Response:
        captured["request"] = request
        captured["timeout"] = timeout
        return _Response(b"v=0\r\nanswer")

      with patch.dict(os.environ, {"OPENAI_API_KEY": "permanent-secret"}, clear=True):
        with patch("openauthor.assistant.realtime.urllib.request.urlopen", side_effect=fake_urlopen):
          result = broker.negotiate(
            offer_sdp="v=0\r\noffer",
            context_pack_id="ctx-one",
            instructions="Bounded context",
          )

      self.assertEqual(result["answer_sdp"], "v=0\r\nanswer")
      self.assertNotIn("permanent-secret", json.dumps(result))
      request = captured["request"]
      self.assertEqual(request.get_header("Authorization"), "Bearer permanent-secret")
      self.assertIn(b'"type":"realtime"', request.data)
      self.assertEqual(result["context_pack_id"], "ctx-one")


if __name__ == "__main__":
  unittest.main()
