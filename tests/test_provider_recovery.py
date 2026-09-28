from __future__ import annotations

import json
import http.client
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from itertools import product
from pathlib import Path
from unittest.mock import patch

from openauthor.chat import create_chat_thread, list_chat_messages, send_chat_message
from openauthor.ai import ProviderExecutionError, _json_post, _openai_style_stream
from openauthor.project import OpenAuthorError, initialize_project


class ProviderRecoveryTests(unittest.TestCase):
  def test_raw_socket_failures_are_classified_and_partial_streams_are_not_retried(self) -> None:
    for failure in (TimeoutError("timed out"), http.client.IncompleteRead(b"partial")):
      with self.subTest(failure=type(failure).__name__), patch.dict(os.environ, {"OPENAUTHOR_PROVIDER_MAX_RETRIES": "0"}):
        with patch("urllib.request.urlopen", side_effect=failure):
          with self.assertRaises(ProviderExecutionError):
            _json_post(provider="openai", url="http://127.0.0.1/unused", headers={}, payload={})
        class PartialResponse:
          def __enter__(self):
            return self
          def __exit__(self, *args):
            pass
          def __iter__(self):
            yield b'data: {"choices":[{"delta":{"content":"Synthetic partial"}}]}\n'
            raise failure
        with patch("urllib.request.urlopen", return_value=PartialResponse()) as transport:
          with self.assertRaises(ProviderExecutionError) as raised:
            _openai_style_stream(provider="openai", url="http://127.0.0.1/unused", headers={}, payload={}, on_delta=lambda text: None)
          self.assertFalse(raised.exception.retriable)
          self.assertEqual(transport.call_count, 1)

  def test_dropped_stream_is_not_a_success_and_manual_retry_publishes_once(self) -> None:
    for provider, failure_mode in product(("openai", "anthropic"), ("disconnect", "error", "invalid_json")):
      with self.subTest(provider=provider, failure_mode=failure_mode), tempfile.TemporaryDirectory() as temporary:
        attempts: list[dict] = []
        class Provider(BaseHTTPRequestHandler):
          def log_message(self, *args):
            pass

          def do_POST(self):
            attempts.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            if provider == "openai":
              frames = [{"choices": [{"delta": {"content": "Synthetic answer"}}]}]
              if len(attempts) > 1:
                frames.append({"choices": [{"delta": {}, "finish_reason": "stop"}]})
            else:
              frames = [{"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Synthetic answer"}}]
              if len(attempts) > 1:
                frames.append({"type": "message_stop"})
            for frame in frames:
              self.wfile.write(("data: " + json.dumps(frame) + "\n\n").encode())
            if len(attempts) == 1 and failure_mode == "error":
              self.wfile.write(b'data: {"error": {"type": "overloaded_error", "message": "Synthetic failure"}}\n\n')
            if len(attempts) == 1 and failure_mode == "invalid_json":
              self.wfile.write(b'data: {invalid}\n\n')
            if provider == "openai" and len(attempts) > 1:
              self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
            self.close_connection = True

        server = ThreadingHTTPServer(("127.0.0.1", 0), Provider)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
          env = {f"OPENAUTHOR_{provider.upper()}_BASE_URL": f"http://127.0.0.1:{server.server_port}/v1", f"{provider.upper()}_API_KEY": "synthetic-test-key"}
          paths = initialize_project(Path(temporary), name="Stream recovery")
          thread = create_chat_thread(paths, title="Recovery", provider=provider, mode="chat")
          with patch.dict(os.environ, env):
            with self.assertRaises(OpenAuthorError) as failure:
              send_chat_message(paths, thread_id=thread["id"], message="Synthetic prompt", request_id="same-turn", on_delta=lambda text: None)
            expected_category = {"disconnect": "incomplete_stream", "error": "provider_stream_error", "invalid_json": "invalid_provider_response"}[failure_mode]
            self.assertEqual(failure.exception.category, expected_category)
            self.assertEqual(len(attempts), 1)
            self.assertEqual(list_chat_messages(paths, thread_id=thread["id"]), [])
            result = send_chat_message(paths, thread_id=thread["id"], message="Synthetic prompt", request_id="same-turn", on_delta=lambda text: None)
            replay = send_chat_message(paths, thread_id=thread["id"], message="Synthetic prompt", request_id="same-turn", on_delta=lambda text: None)
          self.assertEqual(result, replay)
          self.assertEqual(len(attempts), 2)
          self.assertEqual(len(list_chat_messages(paths, thread_id=thread["id"])), 2)
        finally:
          server.shutdown()
          server.server_close()
          worker.join()
