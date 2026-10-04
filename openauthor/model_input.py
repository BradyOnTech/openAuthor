"""Model-visible text serialization and dependency-free token estimates.

These estimates are not provider tokenizer counts or billing guarantees. Keeping
the complete request at this seam prevents omitted tools/arguments and clipped
source previews from masquerading as the input that is actually sent.
"""

from __future__ import annotations

import json
import math
import re
from typing import Any

TOKEN_ESTIMATOR_VERSION = "utf8-word-estimate-v2"


def estimate_tokens(value: str) -> int:
  if not value:
    return 0
  return max(math.ceil(len(re.findall(r"\b\w+\b", value)) * 1.35),
             math.ceil(len(value.encode("utf-8")) / 3))


def chat_messages(*, system_prompt: str, history: list[dict[str, Any]], user_prompt: str) -> list[dict[str, Any]]:
  messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
  for entry in history:
    role = entry["role"]
    if role == "tool":
      messages.append({"role": "tool", "tool_call_id": entry["tool_call_id"], "content": entry["content"]})
    elif role == "assistant" and entry.get("tool_calls"):
      messages.append({"role": "assistant", "content": entry.get("content") or None, "tool_calls": [
        {"id": call["id"], "type": "function", "function": {"name": call["name"], "arguments": json.dumps(call["args"])}}
        for call in entry["tool_calls"]
      ]})
    else:
      messages.append({"role": role, "content": entry["content"]})
  if user_prompt.strip():
    messages.append({"role": "user", "content": user_prompt})
  return messages


def chat_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
  return [{"type": "function", "function": {key: tool[key] for key in ("name", "description", "parameters")}} for tool in tools]


def estimate_chat_input(*, system_prompt: str, user_prompt: str, history: list[dict[str, Any]], tools: list[dict[str, Any]] | None = None) -> int:
  payload = {"messages": chat_messages(system_prompt=system_prompt, user_prompt=user_prompt, history=history)}
  if tools:
    payload["tools"] = chat_tools(tools)
  return estimate_tokens(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))


def estimate_voice_input(*, instructions: str, tools: list[dict[str, Any]]) -> int:
  return estimate_tokens(json.dumps({"instructions": instructions, "tools": tools}, ensure_ascii=False, separators=(",", ":")))
