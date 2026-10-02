#!/usr/bin/env python3
"""Synthetic stdio peer for subscription delivery and failure contract tests."""
import json
import os
import sys

if "--version" in sys.argv:
  print("codex-cli 0.144.6")
  sys.exit(0)


def emit(payload):
  print(json.dumps(payload), flush=True)


for line in sys.stdin:
  request = json.loads(line)
  method = request.get("method")
  if "id" not in request:
    continue
  results = {
    "initialize": {},
    "config/read": {"config": {}},
    "account/read": {"account": {"type": "chatgpt"}},
    "thread/start": {"thread": {"id": "thread-contract"}, "model": "resolved-contract-model"},
    "turn/start": {"turn": {"id": "turn-contract"}},
  }
  emit({"id": request["id"], "result": results[method]})
  if method == "turn/start":
    emit({"method": "item/completed", "params": {"item": {"type": "agentMessage", "id": "answer", "text": "Mara counted lights."}}})
    emit({"method": "thread/tokenUsage/updated", "params": {"tokenUsage": {"last": {"inputTokens": 120, "outputTokens": 8}, "total": {"inputTokens": 230, "outputTokens": 15}}}})
    emit({"method": "turn/completed", "params": {"turn": {"id": "turn-contract", "status": os.getenv("OPENAUTHOR_TEST_CODEX_STATUS", "completed"), "error": None}}})
