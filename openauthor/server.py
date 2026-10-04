"""Persistent JSON-RPC sidecar spoken over stdin/stdout.

The desktop shell spawns `openauthor serve` once per project and keeps it
alive, instead of paying interpreter startup for every command. Frames are
newline-delimited JSON:

  request:  {"id": <str|int>, "method": <str>, "params": {...}}
  response: {"id": <str|int>, "result": ...}
            {"id": <str|int>, "error": {"message": str, "category": str}}
  event:    {"event": <channel>, "sequence": <int>, "payload": {...}}

Events carry a monotonically increasing sequence number so consumers can
detect ordering. Responses may arrive out of request order (chat turns run on
worker threads so `chat.interrupt` stays responsive); consumers match on id.
"""

from __future__ import annotations

import base64
import json
import sys
import threading
import uuid
from typing import Any, TextIO

from .ai import ChatInterrupted
from .chat import (
  list_chat_messages,
  list_chat_threads,
  regenerate_chat_turn,
  preview_chat_context,
  reconcile_chat_delivery,
  send_chat_message,
  truncate_chat_messages,
)
from .assistant.turns import AssistantTurnStore
from .assistant.runtime import AssistantRuntime
from .assistant.snapshots import project_mobile_snapshot
from .assistant.mobile_outbox import (
  MobileOutboxEnvelope,
  import_mobile_outbox_item,
  list_mobile_inbox_items,
  list_mobile_review_decisions,
)
from .project import OpenAuthorError, ProjectPaths, utc_now

PROTOCOL_VERSION = 1


def _chat_context_params(params: dict[str, Any]) -> dict[str, Any]:
  return {
    "thread_id": str(params.get("thread_id", "")).strip(),
    "message": str(params.get("message", "")),
    "current_scene_id": str(params.get("current_scene_id", "")),
    "scene_ids": [str(item) for item in params.get("scene_ids", [])] if isinstance(params.get("scene_ids"), list) else None,
    "selected_text": str(params.get("selected_text", "")),
    "codex_ids": [str(item) for item in params.get("codex_ids", [])] if isinstance(params.get("codex_ids"), list) else None,
    "approved_codex_ids": params.get("approved_codex_ids"),
    "context_overrides": params.get("context_overrides") if isinstance(params.get("context_overrides"), dict) else None,
    "memory_approvals": params.get("memory_approvals"),
    "story_approvals": params.get("story_approvals"),
  }


class _FrameWriter:
  def __init__(self, stream: TextIO) -> None:
    self._stream = stream
    self._lock = threading.Lock()
    self._sequence = 0

  def respond(self, request_id: Any, *, result: Any = None, error: dict[str, Any] | None = None) -> None:
    frame: dict[str, Any] = {"id": request_id}
    if error is not None:
      frame["error"] = error
    else:
      frame["result"] = result
    self._write(frame)

  def emit(self, channel: str, payload: dict[str, Any]) -> None:
    with self._lock:
      self._sequence += 1
      frame = {"event": channel, "sequence": self._sequence, "payload": payload}
      self._stream.write(json.dumps(frame, separators=(",", ":")) + "\n")
      self._stream.flush()

  def _write(self, frame: dict[str, Any]) -> None:
    with self._lock:
      self._stream.write(json.dumps(frame, separators=(",", ":")) + "\n")
      self._stream.flush()


class ChatSidecarServer:
  def __init__(
    self,
    paths: ProjectPaths,
    *,
    stdin: TextIO | None = None,
    stdout: TextIO | None = None,
  ) -> None:
    self._paths = paths
    self._stdin = stdin if stdin is not None else sys.stdin
    self._writer = _FrameWriter(stdout if stdout is not None else sys.stdout)
    self._cancel_flags: dict[str, threading.Event] = {}
    self._cancel_lock = threading.Lock()
    self._workers: list[threading.Thread] = []

  def serve_forever(self) -> None:
    for raw_line in self._stdin:
      line = raw_line.strip()
      if line == "":
        continue
      try:
        request = json.loads(line)
      except (ValueError, RecursionError):
        self._writer.respond(
          None,
          error={"message": "Invalid JSON request frame.", "category": "invalid_request"},
        )
        continue
      if not isinstance(request, dict):
        self._writer.respond(
          None,
          error={"message": "Request frame must be an object.", "category": "invalid_request"},
        )
        continue
      self._dispatch(request)
    for worker in self._workers:
      worker.join()

  def _dispatch(self, request: dict[str, Any]) -> None:
    request_id = request.get("id")
    method = str(request.get("method", "")).strip()
    params = request.get("params", {})
    if not isinstance(params, dict):
      params = {}

    if method == "ping":
      self._writer.respond(
        request_id,
        result={"ok": True, "protocol_version": PROTOCOL_VERSION},
      )
      return
    if method == "chat.threads":
      self._respond_call(request_id, lambda: list_chat_threads(self._paths))
      return
    if method == "chat.messages":
      raw_limit = params.get("limit")
      if raw_limit is not None and (type(raw_limit) is not int or raw_limit < 1):
        self._writer.respond(
          request_id,
          error={"message": "limit must be a positive integer.", "category": "invalid_request"},
        )
        return
      limit = raw_limit
      self._respond_call(
        request_id,
        lambda: list_chat_messages(
          self._paths,
          thread_id=str(params.get("thread_id", "")).strip(),
          limit=limit,
        ),
      )
      return
    if method == "chat.truncate":
      self._respond_call(
        request_id,
        lambda: truncate_chat_messages(
          self._paths,
          thread_id=str(params.get("thread_id", "")).strip(),
          from_message_id=str(params.get("from_message_id", "")).strip(),
        ),
      )
      return
    if method == "assistant.turn.get":
      self._respond_call(
        request_id,
        lambda: AssistantTurnStore(self._paths).get(
          str(params.get("turn_id", "")).strip()
        ).to_dict(),
      )
      return
    if method == "mobile.snapshot.prepare":
      def prepare_mobile_snapshot() -> dict[str, Any]:
        artifact = project_mobile_snapshot(
          self._paths,
          selected_project_id=str(params.get("project_id", "")).strip(),
        )
        return {
          "schema_version": 1,
          "media_type": "application/vnd.openauthor.mobile-snapshot+json",
          "manifest": artifact.manifest,
          "plaintext_base64": base64.b64encode(artifact.plaintext_bytes).decode("ascii"),
        }

      self._respond_call(request_id, prepare_mobile_snapshot)
      return
    if method == "mobile.outbox.import":
      def import_mobile_outbox() -> dict[str, Any]:
        raw_envelope = params.get("envelope", {})
        raw_payload = params.get("payload", {})
        if not isinstance(raw_envelope, dict) or not isinstance(raw_payload, dict):
          raise OpenAuthorError(
            "Mobile outbox import requires object envelope and payload values."
          )
        identity_fields = (
          "project_id",
          "device_id",
          "operation_id",
          "base_revision",
          "payload_digest",
        )
        if any(not isinstance(raw_envelope.get(field), str) for field in identity_fields):
          raise OpenAuthorError(
            "Mobile outbox envelope identity fields must be strings."
          )
        envelope = MobileOutboxEnvelope(
          project_id=raw_envelope["project_id"],
          device_id=raw_envelope["device_id"],
          operation_id=raw_envelope["operation_id"],
          base_revision=raw_envelope["base_revision"],
          payload_digest=raw_envelope["payload_digest"],
        )
        return import_mobile_outbox_item(
          self._paths,
          envelope=envelope,
          payload=raw_payload,
        ).to_dict()

      self._respond_call(request_id, import_mobile_outbox)
      return
    if method == "mobile.inbox.list":
      self._respond_call(
        request_id,
        lambda: list_mobile_inbox_items(self._paths),
      )
      return
    if method == "mobile.review.list":
      self._respond_call(
        request_id,
        lambda: list_mobile_review_decisions(self._paths),
      )
      return
    if method == "voice.context.prepare":
      self._respond_call(
        request_id,
        lambda: AssistantRuntime(self._paths).prepare(
          thread_id=str(params.get("thread_id", "")).strip(),
          channel=str(params.get("channel", "desktop_voice")).strip(),
          utterance=str(params.get("utterance", "")),
          current_scene_id=str(params.get("current_scene_id", "")),
          selected_text=str(params.get("selected_text", "")),
          scene_ids=[str(item) for item in params.get("scene_ids", [])]
          if isinstance(params.get("scene_ids"), list)
          else None,
          codex_ids=[str(item) for item in params.get("codex_ids", [])]
          if isinstance(params.get("codex_ids"), list)
          else None,
          approved_codex_ids=[str(item) for item in params.get("approved_codex_ids", [])]
          if isinstance(params.get("approved_codex_ids"), list)
          else None,
          context_overrides=(
            params.get("context_overrides")
            if isinstance(params.get("context_overrides"), dict)
            else None
          ),
        ),
      )
      return
    if method == "voice.session.start":
      self._respond_call(
        request_id,
        lambda: AssistantRuntime(self._paths).start_realtime_session(
          offer_sdp=str(params.get("offer_sdp", "")),
          context_pack_id=str(params.get("context_pack_id", "")),
          model=str(params.get("model", "")),
          voice=str(params.get("voice", "")),
        ),
      )
      return
    if method == "voice.session.end":
      self._writer.respond(
        request_id,
        result={
          "ended": True,
          "voice_session_id": str(params.get("voice_session_id", "")),
        },
      )
      return
    if method == "voice.tool.handle":
      arguments = params.get("arguments", {})
      self._respond_call(
        request_id,
        lambda: AssistantRuntime(self._paths).handle_tool_call(
          thread_id=str(params.get("thread_id", "")).strip(),
          channel=str(params.get("channel", "desktop_voice")).strip(),
          call_id=str(params.get("call_id", "")).strip(),
          wire_name=str(params.get("name", "")).strip(),
          arguments=arguments if isinstance(arguments, dict) else {},
        ),
      )
      return
    if method == "voice.turn.record":
      self._respond_call(
        request_id,
        lambda: AssistantRuntime(self._paths).record_voice_turn(
          thread_id=str(params.get("thread_id", "")).strip(),
          turn_id=str(params.get("turn_id", "")).strip(),
          voice_session_id=str(params.get("voice_session_id", "")).strip(),
          user_transcript=str(params.get("user_transcript", "")),
          assistant_transcript=str(params.get("assistant_transcript", "")),
          context_pack_id=str(params.get("context_pack_id", "")).strip(),
          provider_event_id=str(params.get("provider_event_id", "")).strip(),
          model=str(params.get("model", "gpt-realtime")).strip(),
          channel=str(params.get("channel", "desktop_voice")).strip(),
        ),
      )
      return
    if method == "chat.interrupt":
      target = str(params.get("request_id", "")).strip()
      if target == "":
        self._writer.respond(
          request_id,
          error={"message": "request_id is required.", "category": "invalid_request"},
        )
        return
      self._cancel_flag(target).set()
      self._writer.respond(request_id, result={"interrupt_requested": True})
      return
    if method == "chat.send":
      worker = threading.Thread(
        target=self._handle_chat_send,
        args=(request_id, params),
        daemon=True,
      )
      self._workers.append(worker)
      worker.start()
      return
    if method == "chat.regenerate":
      worker = threading.Thread(
        target=self._handle_chat_send,
        args=(request_id, params),
        daemon=True,
      )
      self._workers.append(worker)
      worker.start()
      return
    if method == "chat.context":
      self._respond_call(request_id, lambda: preview_chat_context(
        self._paths, **_chat_context_params(params),
        history_before_message_id=str(params.get("history_before_message_id", "")),
      ))
      return
    if method == "chat.delivery.reconcile":
      # Reconciliation waits for the delivery lock. Keep stdin responsive to
      # Stop requests while a different worker settles the original turn.
      worker = threading.Thread(target=self._respond_call, args=(request_id, lambda: reconcile_chat_delivery(
        self._paths, thread_id=str(params.get("thread_id", "")).strip(),
        request_id=str(params.get("request_id", "")).strip(), turn_id=str(params.get("turn_id", "")).strip(),
      )), daemon=True)
      self._workers.append(worker)
      worker.start()
      return

    self._writer.respond(
      request_id,
      error={"message": f"Unknown method '{method}'.", "category": "unknown_method"},
    )

  def _respond_call(self, request_id: Any, operation: Any) -> None:
    try:
      self._writer.respond(request_id, result=operation())
    except OpenAuthorError as error:
      self._writer.respond(
        request_id,
        error={
          "message": str(error),
          "category": str(getattr(error, "category", "core_error")),
        },
      )

  def _cancel_flag(self, request_key: str) -> threading.Event:
    with self._cancel_lock:
      flag = self._cancel_flags.get(request_key)
      if flag is None:
        flag = threading.Event()
        self._cancel_flags[request_key] = flag
      return flag

  def _handle_chat_send(self, request_id: Any, params: dict[str, Any]) -> None:
    request_key = str(request_id)
    cancel = self._cancel_flag(request_key)
    thread_id = str(params.get("thread_id", "")).strip()
    turn_id = str(params.get("turn_id", "")).strip() or f"turn-{uuid.uuid4().hex}"
    turn_sequence = 0

    def emit_assistant_event(event_type: str, data: dict[str, Any]) -> None:
      nonlocal turn_sequence
      turn_sequence += 1
      self._writer.emit(
        "assistant.event",
        {
          "protocol_version": 1,
          "event_id": f"{turn_id}:{turn_sequence}",
          "turn_id": turn_id,
          "thread_id": thread_id,
          "turn_sequence": turn_sequence,
          "occurred_at": utc_now(),
          "type": event_type,
          "data": data,
        },
      )

    def on_delta(text: str) -> None:
      if cancel.is_set():
        raise ChatInterrupted("Chat turn interrupted by user.")
      emit_assistant_event(
        "output.delta",
        {
          "output_id": f"{turn_id}:assistant",
          "role": "assistant",
          "modality": "text",
          "delta": text,
        },
      )
      self._writer.emit(
        "chat.delta",
        {"request_id": request_id, "thread_id": thread_id, "text": text},
      )

    try:
      common = {**_chat_context_params(params),
        "approved_codex_ids": params.get("approved_codex_ids"), "on_delta": on_delta}
      replacement_from = str(params.get("replace_from_message_id", "")).strip()
      if replacement_from:
        result = regenerate_chat_turn(
          self._paths,
          from_message_id=replacement_from,
          replacement_turn_id=turn_id,
          expected_context_fingerprint=str(params.get("expected_context_fingerprint", "")),
          is_cancelled=cancel.is_set,
          **common,
        )
      else:
        result = send_chat_message(
          self._paths,
          **common,
          turn_id=turn_id, channel=str(params.get("channel", "text")),
          expected_context_fingerprint=str(params.get("expected_context_fingerprint", "")),
          request_id=str(params.get("delivery_id") or request_id),
          is_cancelled=cancel.is_set,
        )
      assistant_message = result.get("assistant_message", {})
      emit_assistant_event(
        "output.final",
        {
          "message_id": assistant_message.get("id", ""),
          "role": "assistant",
          "modality": "text",
          "transcript_status": "final",
        },
      )
      emit_assistant_event(
        "turn.status",
        {"status": result.get("turn", {}).get("status", "completed")},
      )
      self._writer.respond(request_id, result=result)
    except ChatInterrupted as error:
      emit_assistant_event("turn.status", {"status": "interrupted"})
      self._writer.respond(
        request_id,
        error={"message": str(error), "category": "interrupted"},
      )
    except (OpenAuthorError, OSError, ValueError) as error:
      try:
        status = AssistantTurnStore(self._paths).get(turn_id).status
      except OpenAuthorError:
        status = "failed"
      emit_assistant_event("turn.status", {"status": status})
      self._writer.respond(
        request_id,
        error={
          "message": str(error),
          "category": str(getattr(error, "category", "core_error")),
        },
      )
    finally:
      with self._cancel_lock:
        self._cancel_flags.pop(request_key, None)


def run_server(paths: ProjectPaths) -> None:
  ChatSidecarServer(paths).serve_forever()
