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

import json
import sys
import threading
from typing import Any, TextIO

from .ai import ChatInterrupted
from .chat import (
  list_chat_messages,
  list_chat_threads,
  send_chat_message,
  truncate_chat_messages,
)
from .project import OpenAuthorError, ProjectPaths

PROTOCOL_VERSION = 1


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
    self._send_lock = threading.Lock()
    self._workers: list[threading.Thread] = []

  def serve_forever(self) -> None:
    for raw_line in self._stdin:
      line = raw_line.strip()
      if line == "":
        continue
      try:
        request = json.loads(line)
      except json.JSONDecodeError:
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
      limit = int(raw_limit) if isinstance(raw_limit, (int, float)) and raw_limit else None
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

    def on_delta(text: str) -> None:
      if cancel.is_set():
        raise ChatInterrupted("Chat turn interrupted by user.")
      self._writer.emit(
        "chat.delta",
        {"request_id": request_id, "thread_id": thread_id, "text": text},
      )

    scene_ids = params.get("scene_ids")
    codex_ids = params.get("codex_ids")
    context_overrides = params.get("context_overrides")
    try:
      with self._send_lock:
        result = send_chat_message(
          self._paths,
          thread_id=thread_id,
          message=str(params.get("message", "")),
          current_scene_id=str(params.get("current_scene_id", "")),
          scene_ids=[str(item) for item in scene_ids] if isinstance(scene_ids, list) else None,
          selected_text=str(params.get("selected_text", "")),
          codex_ids=[str(item) for item in codex_ids] if isinstance(codex_ids, list) else None,
          context_overrides=context_overrides if isinstance(context_overrides, dict) else None,
          on_delta=on_delta,
        )
      self._writer.respond(request_id, result=result)
    except ChatInterrupted as error:
      self._writer.respond(
        request_id,
        error={"message": str(error), "category": "interrupted"},
      )
    except OpenAuthorError as error:
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
