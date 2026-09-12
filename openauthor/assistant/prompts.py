"""One assembled input for both context selection and the channel adapter."""

from __future__ import annotations

import json
from typing import Any

from ..model_input import estimate_chat_input, estimate_voice_input
from ..review_context import REVIEW_CONTEXT_GUIDANCE
from .tools import DEFAULT_TOOL_REGISTRY


def response_token_limit(channel: str, reserve: int) -> int:
  return max(64, min(900, reserve)) if channel == "text" else max(1, min(4096, reserve))


def build_model_input(
  *, channel: str, context: dict[str, Any], history: list[dict[str, Any]],
  utterance: str, scope: str, project_revision: str, agent_mode: bool, response_reserve: int,
) -> dict[str, Any]:
  output_limit = response_token_limit(channel, response_reserve)
  if channel == "text":
    system_prompt = (
      "You are openAuthor's fiction assistant. Stay grounded in provided context, "
      "be explicit about assumptions, and avoid direct manuscript mutation language. "
      + REVIEW_CONTEXT_GUIDANCE + " Cite scene and fact IDs when making specific continuity claims."
    )
    if agent_mode:
      system_prompt += (
        "\n\nUse the available tools to read project state and to queue changes. "
        "Write and merge tools are not executed immediately: they are held for "
        "the author's approval, so say so when you use one."
      )
    return {
      "system_prompt": system_prompt,
      "user_prompt": f"User message:\n{utterance}\n\nContext JSON:\n{json.dumps(context, ensure_ascii=False, indent=2)}\n",
      "history": history, "tools": DEFAULT_TOOL_REGISTRY.provider_specs(channel=channel) if agent_mode else [],
      "max_output_tokens": output_limit,
    }
  instructions = (
    "You are openAuthor's fiction assistant. Ground answers in the supplied "
    "Context Pack. Never claim a proposed change has been applied; proposals require author approval. "
    + REVIEW_CONTEXT_GUIDANCE + "\n\nContext Pack:\n"
    + json.dumps({"scope": scope, "project_revision": project_revision, "focus_request": utterance,
                  "context": context, "history": history}, ensure_ascii=False, separators=(",", ":"))
  )
  return {"instructions": instructions, "tools": DEFAULT_TOOL_REGISTRY.realtime_specs(channel=channel), "max_output_tokens": output_limit}


def estimate_model_input(payload: dict[str, Any]) -> int:
  if "instructions" in payload:
    return estimate_voice_input(instructions=payload["instructions"], tools=payload["tools"])
  return estimate_chat_input(system_prompt=payload["system_prompt"], user_prompt=payload["user_prompt"], history=payload["history"], tools=payload["tools"])
