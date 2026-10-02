"""Opt-in wire contract for the pinned bundled Codex runtime; never calls a provider."""
from __future__ import annotations

import json
import os
import re
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from openauthor.codex_app_server import CodexAppServer


@unittest.skipUnless(os.getenv("OPENAUTHOR_CODEX_CONTRACT_BIN"), "requires an explicit local Codex binary")
class CodexRuntimeContractTests(unittest.TestCase):
  def test_only_reviewed_content_reaches_local_responses_endpoint(self):
    requests = []

    class ResponsesEndpoint(BaseHTTPRequestHandler):
      def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        requests.append(payload)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        item = {"type": "message", "id": "msg-contract", "role": "assistant", "status": "completed", "content": [{"type": "output_text", "text": "Reviewed result.", "annotations": []}]}
        response = {"id": "resp-contract", "object": "response", "status": "completed", "output": [item], "usage": {"input_tokens": 100, "output_tokens": 3, "total_tokens": 103}}
        events = [
          {"type": "response.created", "response": {**response, "status": "in_progress", "output": []}},
          {"type": "response.output_item.added", "output_index": 0, "item": {**item, "status": "in_progress", "content": []}},
          {"type": "response.output_text.delta", "item_id": item["id"], "output_index": 0, "content_index": 0, "delta": "Reviewed result."},
          {"type": "response.output_item.done", "output_index": 0, "item": item},
          {"type": "response.completed", "response": response},
        ]
        for event in events:
          self.wfile.write(("data: " + json.dumps(event) + "\n\n").encode())

      def log_message(self, *args):
        pass

    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      book, auth = root / "book", root / "auth"
      book.mkdir()
      auth.mkdir()
      (book / "AGENTS.md").write_text("UNREVIEWED_BOOK_INSTRUCTIONS", encoding="utf-8")
      skill = auth / "skills" / "secret-author-skill"
      skill.mkdir(parents=True)
      (skill / "SKILL.md").write_text("---\nname: secret-author-skill\ndescription: UNREVIEWED_SKILL_CATALOG\n---\nUNREVIEWED_SKILL_BODY", encoding="utf-8")
      (book / "private-manuscript.md").write_text("UNREVIEWED_PRIVATE_MANUSCRIPT", encoding="utf-8")
      endpoint = ThreadingHTTPServer(("127.0.0.1", 0), ResponsesEndpoint)
      worker = threading.Thread(target=endpoint.serve_forever, daemon=True)
      worker.start()
      try:
        (auth / "config.toml").write_text(
          'model_provider = "contract"\n'
          'developer_instructions = "UNREVIEWED_CONFIG_INSTRUCTIONS"\n'
          '[model_providers.contract]\nname = "Local wire contract"\n'
          f'base_url = "http://127.0.0.1:{endpoint.server_port}/v1"\n'
          'wire_api = "responses"\nrequires_openai_auth = false\n'
          '[mcp_servers.unreviewed_connector]\n'
          f'url = "http://127.0.0.1:{endpoint.server_port}/unreviewed-mcp"\n', encoding="utf-8")
        with CodexAppServer(binary=Path(os.environ["OPENAUTHOR_CODEX_CONTRACT_BIN"]), codex_home=auth, request_timeout=20) as server:
          config = server.request("config/read", {"includeLayers": False})["config"]
          self.assertFalse(config["features"]["code_mode"])
          self.assertFalse(config["features"]["multi_agent_v2"]["enabled"])
          self.assertEqual(config["features"]["multi_agent_v2"]["max_concurrent_threads_per_session"], 1)
          result = server.complete(project_root=book, model="gpt-5.6-sol", system_prompt="REVIEWED_SYSTEM", history=[], user_prompt="REVIEWED_SELECTION", max_output_tokens=300, on_delta=None, tools=None)
        self.assertEqual(result["text"], "Reviewed result.")
        self.assertEqual(len(requests), 1)
        wire = json.dumps(requests[0])
        self.assertIn("REVIEWED_SYSTEM", wire)
        self.assertIn("REVIEWED_SELECTION", wire)
        self.assertEqual(sorted(set(re.findall(r"UNREVIEWED_[A-Z_]+", wire))), [], "Unreviewed synthetic instructions were sent")
        self.assertFalse(str(book) in wire, "Manuscript directory was disclosed")
        self.assertFalse(requests[0].get("tools", []), "Unapproved runtime tools were exposed")
        added_tools = [tool.get("name", tool.get("type")) for item in requests[0]["input"] if item.get("type") == "additional_tools" for tool in item.get("tools", [])]
        # Model-catalog-selected orchestration scaffolding cannot be removed by
        # feature flags. It has no environments, skills, connectors or agent slots.
        self.assertLessEqual(set(added_tools), {"exec", "wait", "collaboration"})
        for forbidden_tool in ("exec_command", "read_file", "apply_patch", "skills__", "mcp__", "view_image", "web_search"):
          self.assertFalse(f'"name": "{forbidden_tool}' in wire or f"### `{forbidden_tool}" in wire, f"Unapproved runtime capability: {forbidden_tool}")
        self.assertFalse("skills_instructions" in wire, "Runtime skill catalog was sent")
      finally:
        endpoint.shutdown()
        endpoint.server_close()
        worker.join(timeout=2)


if __name__ == "__main__":
  unittest.main()
