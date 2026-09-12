from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from contextlib import contextmanager
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from typing import Any, Iterator, Mapping

from ..project import OpenAuthorError, ProjectPaths, atomic_write_json, utc_now

try:
  import fcntl
except ImportError:  # pragma: no cover - exercised only on non-POSIX hosts
  fcntl = None  # type: ignore[assignment]

TURN_SCHEMA_VERSION = 1
TURN_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
TURN_CHANNELS = {"text", "desktop_voice", "mobile_voice"}
_FALLBACK_LOCKS: dict[str, threading.Lock] = {}
_FALLBACK_LOCKS_GUARD = threading.Lock()


class TurnIdempotencyConflict(OpenAuthorError):
  category = "idempotency_conflict"


@dataclass(frozen=True)
class AssistantTurn:
  schema_version: int
  turn_id: str
  thread_id: str
  channel: str
  request_digest: str
  status: str
  created_at: str
  started_at: str | None
  completed_at: str | None
  input_message_id: str | None
  message_ids: list[str]
  generation_ids: list[str]
  pending_tool_call_ids: list[str]
  context_pack_id: str | None
  provider: str | None
  model: str | None
  error: dict[str, Any] | None
  superseded_by: str | None
  voice_session_id: str | None
  provider_event_id: str | None
  revision: int

  @classmethod
  def from_dict(cls, payload: Mapping[str, Any]) -> AssistantTurn:
    return cls(
      schema_version=int(payload.get("schema_version", 0)),
      turn_id=str(payload.get("turn_id", "")),
      thread_id=str(payload.get("thread_id", "")),
      channel=str(payload.get("channel", "")),
      request_digest=str(payload.get("request_digest", "")),
      status=str(payload.get("status", "")),
      created_at=str(payload.get("created_at", "")),
      started_at=(
        str(payload["started_at"]) if payload.get("started_at") is not None else None
      ),
      completed_at=(
        str(payload["completed_at"])
        if payload.get("completed_at") is not None
        else None
      ),
      input_message_id=(
        str(payload["input_message_id"])
        if payload.get("input_message_id") is not None
        else None
      ),
      message_ids=[str(item) for item in payload.get("message_ids", [])],
      generation_ids=[str(item) for item in payload.get("generation_ids", [])],
      pending_tool_call_ids=[
        str(item) for item in payload.get("pending_tool_call_ids", [])
      ],
      context_pack_id=(
        str(payload["context_pack_id"])
        if payload.get("context_pack_id") is not None
        else None
      ),
      provider=(
        str(payload["provider"]) if payload.get("provider") is not None else None
      ),
      model=str(payload["model"]) if payload.get("model") is not None else None,
      error=dict(payload["error"]) if isinstance(payload.get("error"), dict) else None,
      superseded_by=(
        str(payload["superseded_by"])
        if payload.get("superseded_by") is not None
        else None
      ),
      voice_session_id=(
        str(payload["voice_session_id"])
        if payload.get("voice_session_id") is not None
        else None
      ),
      provider_event_id=(
        str(payload["provider_event_id"])
        if payload.get("provider_event_id") is not None
        else None
      ),
      revision=int(payload.get("revision", 0)),
    )

  def to_dict(self) -> dict[str, Any]:
    return asdict(self)


@dataclass(frozen=True)
class TurnClaim:
  turn: AssistantTurn
  created: bool


def _request_digest(request: Mapping[str, Any]) -> str:
  serialized = json.dumps(request, sort_keys=True, separators=(",", ":"))
  return "sha256:" + hashlib.sha256(serialized.encode("utf-8")).hexdigest()


@contextmanager
def _exclusive_file_lock(lock_path: Path) -> Iterator[None]:
  lock_path.parent.mkdir(parents=True, exist_ok=True)
  if fcntl is not None:
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
      fcntl.flock(descriptor, fcntl.LOCK_EX)
      yield
    finally:
      fcntl.flock(descriptor, fcntl.LOCK_UN)
      os.close(descriptor)
    return

  lock_key = str(lock_path.resolve())
  with _FALLBACK_LOCKS_GUARD:
    process_lock = _FALLBACK_LOCKS.setdefault(lock_key, threading.Lock())
  with process_lock:  # pragma: no cover - POSIX CI uses fcntl
    yield


class AssistantTurnStore:
  """Atomic durable journal for Assistant turn identity and lifecycle."""

  def __init__(self, paths: ProjectPaths) -> None:
    self._turns_dir = paths.chats_dir / "turns"
    self._locks_dir = paths.chats_dir / "locks" / "turns"

  def _validate_turn_id(self, turn_id: str) -> str:
    normalized = turn_id.strip()
    if not TURN_ID_PATTERN.fullmatch(normalized):
      raise OpenAuthorError("Invalid Assistant turn id.")
    return normalized

  def _turn_path(self, turn_id: str) -> Path:
    return self._turns_dir / f"{self._validate_turn_id(turn_id)}.json"

  def _lock_path(self, turn_id: str) -> Path:
    return self._locks_dir / f"{self._validate_turn_id(turn_id)}.lock"

  def get(self, turn_id: str) -> AssistantTurn:
    turn_path = self._turn_path(turn_id)
    if not turn_path.exists():
      raise OpenAuthorError(f"Assistant turn '{turn_id}' not found.")
    try:
      payload = json.loads(turn_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
      raise OpenAuthorError(f"Invalid Assistant turn record '{turn_id}'.") from error
    if not isinstance(payload, dict):
      raise OpenAuthorError(f"Invalid Assistant turn record '{turn_id}'.")
    turn = AssistantTurn.from_dict(payload)
    if turn.schema_version != TURN_SCHEMA_VERSION or turn.turn_id != turn_id:
      raise OpenAuthorError(f"Invalid Assistant turn record '{turn_id}'.")
    return turn

  def claim(
    self,
    *,
    turn_id: str,
    thread_id: str,
    channel: str,
    request: Mapping[str, Any],
  ) -> TurnClaim:
    normalized_turn_id = self._validate_turn_id(turn_id)
    normalized_thread_id = thread_id.strip()
    normalized_channel = channel.strip().lower()
    if normalized_thread_id == "":
      raise OpenAuthorError("thread_id is required.")
    if normalized_channel not in TURN_CHANNELS:
      raise OpenAuthorError(f"Unsupported Assistant channel '{channel}'.")
    digest = _request_digest(request)

    with _exclusive_file_lock(self._lock_path(normalized_turn_id)):
      turn_path = self._turn_path(normalized_turn_id)
      if turn_path.exists():
        existing = self.get(normalized_turn_id)
        if (
          existing.thread_id != normalized_thread_id
          or existing.channel != normalized_channel
          or existing.request_digest != digest
        ):
          raise TurnIdempotencyConflict(
            f"Assistant turn '{normalized_turn_id}' was already claimed for a different request."
          )
        return TurnClaim(turn=existing, created=False)

      turn = AssistantTurn(
        schema_version=TURN_SCHEMA_VERSION,
        turn_id=normalized_turn_id,
        thread_id=normalized_thread_id,
        channel=normalized_channel,
        request_digest=digest,
        status="accepted",
        created_at=utc_now(),
        started_at=None,
        completed_at=None,
        input_message_id=None,
        message_ids=[],
        generation_ids=[],
        pending_tool_call_ids=[],
        context_pack_id=None,
        provider=None,
        model=None,
        error=None,
        superseded_by=None,
        voice_session_id=None,
        provider_event_id=None,
        revision=1,
      )
      atomic_write_json(turn_path, turn.to_dict())
      return TurnClaim(turn=turn, created=True)

  def _transition(
    self,
    turn_id: str,
    *,
    expected_statuses: set[str],
    status: str,
    updates: Mapping[str, Any] | None = None,
  ) -> AssistantTurn:
    normalized_turn_id = self._validate_turn_id(turn_id)
    with _exclusive_file_lock(self._lock_path(normalized_turn_id)):
      current = self.get(normalized_turn_id)
      if current.status not in expected_statuses:
        allowed = ", ".join(sorted(expected_statuses))
        raise OpenAuthorError(
          f"Assistant turn '{normalized_turn_id}' cannot transition from "
          f"'{current.status}' to '{status}' (expected: {allowed})."
        )
      next_turn = replace(
        current,
        status=status,
        revision=current.revision + 1,
        **dict(updates or {}),
      )
      atomic_write_json(self._turn_path(normalized_turn_id), next_turn.to_dict())
      return next_turn

  def mark_running(
    self,
    turn_id: str,
    *,
    provider: str,
    model: str,
    input_message_id: str | None = None,
  ) -> AssistantTurn:
    return self._transition(
      turn_id,
      expected_statuses={"accepted"},
      status="running",
      updates={
        "started_at": utc_now(),
        "provider": provider.strip() or None,
        "model": model.strip() or None,
        "input_message_id": input_message_id,
      },
    )

  def complete(
    self,
    turn_id: str,
    *,
    message_ids: list[str],
    generation_ids: list[str] | None = None,
    pending_tool_call_ids: list[str] | None = None,
    context_pack_id: str | None = None,
    voice_session_id: str | None = None,
    provider_event_id: str | None = None,
  ) -> AssistantTurn:
    return self._transition(
      turn_id,
      expected_statuses={"running"},
      status="completed",
      updates={
        "completed_at": utc_now(),
        "message_ids": list(message_ids),
        "generation_ids": list(generation_ids or []),
        "pending_tool_call_ids": list(pending_tool_call_ids or []),
        "context_pack_id": context_pack_id,
        "voice_session_id": voice_session_id,
        "provider_event_id": provider_event_id,
      },
    )

  def fail(
    self,
    turn_id: str,
    *,
    message: str,
    category: str = "core_error",
  ) -> AssistantTurn:
    return self._transition(
      turn_id,
      expected_statuses={"accepted", "running"},
      status="failed",
      updates={
        "completed_at": utc_now(),
        "error": {
          "message": message,
          "category": category.strip() or "core_error",
        },
      },
    )

  def interrupt(self, turn_id: str, *, message: str) -> AssistantTurn:
    return self._transition(
      turn_id,
      expected_statuses={"accepted", "running"},
      status="interrupted",
      updates={
        "completed_at": utc_now(),
        "error": {
          "message": message,
          "category": "interrupted",
        },
      },
    )

  def supersede(self, turn_id: str, *, superseded_by: str) -> AssistantTurn:
    return self._transition(
      turn_id,
      expected_statuses={"completed"},
      status="superseded",
      updates={"superseded_by": superseded_by},
    )
