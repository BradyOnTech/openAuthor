"""Transport-neutral Assistant preparation, tools, and durable recording."""

from __future__ import annotations

import hashlib
import json
from typing import Any, Mapping

from ..project import OpenAuthorError, ProjectPaths, atomic_write_json, utc_now
from .budget import enforce_input_ceiling
from .prompts import estimate_model_input
from .context import (
  ContextRequest,
  build_context_pack,
  context_policy_from_profile,
  load_context_pack,
  validate_memory_access,
)
from .history import HistoryPolicy, build_history_window
from .locks import AssistantThreadLocks
from .realtime import RealtimeSessionBroker
from .tools import DEFAULT_TOOL_REGISTRY
from .turns import AssistantTurnStore


class AssistantRuntime:
  """Own project meaning while text and Realtime adapters own transport."""

  def __init__(self, paths: ProjectPaths) -> None:
    self._paths = paths

  def prepare(
    self,
    *,
    thread_id: str,
    channel: str,
    utterance: str = "",
    current_scene_id: str = "",
    selected_text: str = "",
    scene_ids: list[str] | None = None,
    codex_ids: list[str] | None = None,
    approved_codex_ids: list[str] | None = None,
    context_overrides: Mapping[str, Any] | None = None,
  ) -> dict[str, Any]:
    # Import here to keep the runtime as the outer adapter around legacy chat
    # storage while the shared Assistant modules remain independent of chat.py.
    from ..chat import (
      _normalize_context_profile,
      get_chat_thread,
      list_chat_messages,
    )

    thread = get_chat_thread(self._paths, thread_id)
    stored = thread.get("context_profile", {})
    merged = dict(stored) if isinstance(stored, dict) else {}
    if context_overrides is not None:
      merged.update(dict(context_overrides))
    profile = _normalize_context_profile(merged)
    history = build_history_window(
      list_chat_messages(self._paths, thread_id=thread_id),
      HistoryPolicy(token_budget=int(profile.get("history_token_budget", 4000))),
    ).messages
    pack = build_context_pack(
      self._paths,
      ContextRequest(
        thread_id=thread_id,
        channel=channel,
        utterance=utterance,
        scope=str(profile.get("scope", "adaptive")),
        current_scene_id=current_scene_id,
        selected_text=selected_text,
        explicit_scene_ids=tuple(scene_ids or []),
        explicit_codex_ids=tuple(codex_ids or []),
        approved_codex_ids=tuple(approved_codex_ids or []),
        history=tuple(history),
      ),
      context_policy_from_profile(profile),
    )
    return {
      "context_pack": pack.to_dict(),
      "instructions": pack.model_input["instructions"],
      "tools": pack.model_input["tools"],
      "profile": profile,
    }

  def start_realtime_session(
    self,
    *,
    offer_sdp: str,
    context_pack_id: str,
    model: str = "",
    voice: str = "",
  ) -> dict[str, Any]:
    pack = load_context_pack(self._paths, context_pack_id)
    if pack.channel not in {"desktop_voice", "mobile_voice"}:
      raise OpenAuthorError("Context Pack is not authorized for a voice channel.")
    validate_memory_access(self._paths, pack)
    from ..style_profile import get_style_profile, voice_context
    if pack.provider_context.get("writing_voice", {}) != voice_context(get_style_profile(self._paths)):
      raise OpenAuthorError("Writing Voice changed. Prepare a new voice context before connecting.")
    if pack.budget.get("input_policy_version") != 2 or not pack.model_input:
      raise OpenAuthorError("Prepare a new voice context before connecting; this saved pack predates complete input accounting.")
    # Tool changes also require fresh preparation, so the measured tools match
    # those the broker will send. Never silently replace a prepared policy.
    if pack.model_input["tools"] != DEFAULT_TOOL_REGISTRY.realtime_specs(channel=pack.channel):
      raise OpenAuthorError("Assistant tools changed. Prepare a new voice context before connecting.")
    enforce_input_ceiling(input_tokens=estimate_model_input(pack.model_input),
                          response_reserve=max(pack.budget["allocations"]["response_reserve"], pack.model_input["max_output_tokens"]),
                          ceiling=pack.budget["ceiling"])
    return RealtimeSessionBroker(self._paths).negotiate(
      offer_sdp=offer_sdp,
      context_pack_id=pack.pack_id,
      instructions=pack.model_input["instructions"],
      max_output_tokens=pack.model_input["max_output_tokens"],
      channel=pack.channel,
      model=model,
      voice=voice,
    )

  def handle_tool_call(
    self,
    *,
    thread_id: str,
    channel: str,
    call_id: str,
    wire_name: str,
    arguments: Mapping[str, Any],
  ) -> dict[str, Any]:
    from ..chat import _execute_tool

    allowed = {
      definition.wire_name: definition
      for definition in DEFAULT_TOOL_REGISTRY.definitions(channel=channel)
    }
    definition = allowed.get(wire_name)
    if definition is None:
      return {
        "status": "rejected",
        "call_id": call_id,
        "name": wire_name,
        "message": "This tool is unavailable in the current voice channel.",
      }
    if definition.effect == "read":
      result = _execute_tool(self._paths, definition.name, dict(arguments))
      return {
        "status": "completed",
        "call_id": call_id,
        "name": wire_name,
        "result": result,
        "function_call_output": json.dumps(result, ensure_ascii=False),
      }
    pending = {
      "schema_version": 1,
      "thread_id": thread_id,
      "channel": channel,
      "call_id": call_id,
      "name": wire_name,
      "internal_name": definition.name,
      "arguments": dict(arguments),
      "status": "pending_approval",
      "created_at": utc_now(),
    }
    pending_key = hashlib.sha256(
      f"{thread_id}\0{call_id}".encode("utf-8")
    ).hexdigest()
    path = self._paths.chats_dir / "pending-tools" / f"{pending_key}.json"
    if not path.exists():
      atomic_write_json(path, pending)
    return {
      "status": "pending_approval",
      "call_id": call_id,
      "name": wire_name,
      "pending_id": pending_key,
      "message": "Queued for author approval; no project change was applied.",
      "function_call_output": json.dumps(
        {
          "status": "pending_approval",
          "message": "Queued for author approval; no project change was applied.",
        }
      ),
    }

  def record_voice_turn(
    self,
    *,
    thread_id: str,
    turn_id: str,
    voice_session_id: str,
    user_transcript: str,
    assistant_transcript: str,
    context_pack_id: str,
    provider_event_id: str,
    model: str,
    channel: str = "desktop_voice",
  ) -> dict[str, Any]:
    from ..chat import _append_chat_message, get_chat_thread, list_chat_messages

    pack = load_context_pack(self._paths, context_pack_id)
    if pack.thread_id != thread_id or pack.channel != channel:
      raise OpenAuthorError("Context Pack does not match the voice turn.")
    with AssistantThreadLocks(self._paths).acquire(thread_id):
      store = AssistantTurnStore(self._paths)
      claim = store.claim(
        turn_id=turn_id,
        thread_id=thread_id,
        channel=channel,
        request={
          "voice_session_id": voice_session_id,
          "user_transcript": user_transcript,
          "assistant_transcript": assistant_transcript,
          "context_pack_id": context_pack_id,
          "provider_event_id": provider_event_id,
        },
      )
      if not claim.created:
        if claim.turn.status != "completed":
          raise OpenAuthorError(f"Voice turn is already {claim.turn.status}.")
        messages = list_chat_messages(self._paths, thread_id=thread_id)
        selected = [row for row in messages if row.get("turn_id") == turn_id]
        return {
          "thread": get_chat_thread(self._paths, thread_id),
          "messages": selected,
          "turn": claim.turn.to_dict(),
        }
      user = _append_chat_message(
        self._paths,
        thread_id=thread_id,
        role="user",
        content=user_transcript,
        context_used={"context_pack_id": context_pack_id},
        turn_id=turn_id,
        channel=channel,
        turn_position=0,
      )
      store.mark_running(
        turn_id,
        provider="openai",
        model=model,
        input_message_id=str(user["id"]),
      )
      assistant = _append_chat_message(
        self._paths,
        thread_id=thread_id,
        role="assistant",
        content=assistant_transcript,
        context_used={
          "context_pack_id": context_pack_id,
          "citations": pack.citations,
          "transcript_status": "final",
        },
        usage={"provider": "openai", "model": model},
        turn_id=turn_id,
        channel=channel,
        turn_position=1,
      )
      completed = store.complete(
        turn_id,
        message_ids=[str(user["id"]), str(assistant["id"])],
        context_pack_id=context_pack_id,
        voice_session_id=voice_session_id,
        provider_event_id=provider_event_id,
      )
      return {
        "thread": get_chat_thread(self._paths, thread_id),
        "messages": [user, assistant],
        "turn": completed.to_dict(),
      }
