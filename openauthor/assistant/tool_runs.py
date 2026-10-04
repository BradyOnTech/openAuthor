"""Durable idempotency records for approved Assistant tool actions."""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from typing import Any, Mapping

from ..project import OpenAuthorError, ProjectPaths, atomic_write_json, utc_now
from .turns import TurnIdempotencyConflict


@dataclass(frozen=True)
class ToolRun:
  schema_version: int
  run_key: str
  tool_call_id: str
  thread_id: str
  assistant_message_id: str
  tool_name: str
  request_digest: str
  status: str
  created_at: str
  started_at: str | None
  completed_at: str | None
  tool_message_id: str | None
  error: dict[str, str] | None
  revision: int

  @classmethod
  def from_dict(cls, payload: Mapping[str, Any]) -> "ToolRun":
    return cls(
      schema_version=int(payload.get("schema_version", 0)),
      run_key=str(payload.get("run_key", "")),
      tool_call_id=str(payload.get("tool_call_id", "")),
      thread_id=str(payload.get("thread_id", "")),
      assistant_message_id=str(payload.get("assistant_message_id", "")),
      tool_name=str(payload.get("tool_name", "")),
      request_digest=str(payload.get("request_digest", "")),
      status=str(payload.get("status", "")),
      created_at=str(payload.get("created_at", "")),
      started_at=str(payload["started_at"]) if payload.get("started_at") else None,
      completed_at=(str(payload["completed_at"]) if payload.get("completed_at") else None),
      tool_message_id=(
        str(payload["tool_message_id"]) if payload.get("tool_message_id") else None
      ),
      error=dict(payload["error"]) if isinstance(payload.get("error"), dict) else None,
      revision=int(payload.get("revision", 0)),
    )

  def to_dict(self) -> dict[str, Any]:
    return asdict(self)


class ToolRunStore:
  """Small journal used while the caller holds the corresponding thread lock."""

  def __init__(self, paths: ProjectPaths) -> None:
    self._runs_dir = paths.chats_dir / "tool-runs"

  @staticmethod
  def key(*, thread_id: str, assistant_message_id: str, tool_call_id: str) -> str:
    identity = "\0".join((thread_id, assistant_message_id, tool_call_id))
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()

  def _path(self, run_key: str) -> Path:
    return self._runs_dir / f"{run_key}.json"

  def get(self, run_key: str) -> ToolRun:
    path = self._path(run_key)
    if not path.exists():
      raise OpenAuthorError("Approved tool action not found.")
    try:
      payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
      raise OpenAuthorError("Invalid approved tool action record.") from error
    if not isinstance(payload, dict):
      raise OpenAuthorError("Invalid approved tool action record.")
    run = ToolRun.from_dict(payload)
    if run.schema_version != 1 or run.run_key != run_key:
      raise OpenAuthorError("Invalid approved tool action record.")
    return run

  def claim(
    self,
    *,
    thread_id: str,
    assistant_message_id: str,
    tool_call_id: str,
    tool_name: str,
    args: Mapping[str, Any],
  ) -> tuple[ToolRun, bool]:
    if tool_call_id.strip() == "":
      raise OpenAuthorError("Approved tool action requires a tool_call_id.")
    run_key = self.key(
      thread_id=thread_id,
      assistant_message_id=assistant_message_id,
      tool_call_id=tool_call_id,
    )
    request_payload = {"tool": tool_name, "args": dict(args)}
    serialized = json.dumps(request_payload, sort_keys=True, separators=(",", ":"))
    request_digest = "sha256:" + hashlib.sha256(serialized.encode("utf-8")).hexdigest()
    path = self._path(run_key)
    if path.exists():
      existing = self.get(run_key)
      if existing.request_digest != request_digest:
        raise TurnIdempotencyConflict("Tool call was already approved with different arguments.")
      return existing, False
    run = ToolRun(
      schema_version=1,
      run_key=run_key,
      tool_call_id=tool_call_id,
      thread_id=thread_id,
      assistant_message_id=assistant_message_id,
      tool_name=tool_name,
      request_digest=request_digest,
      status="accepted",
      created_at=utc_now(),
      started_at=None,
      completed_at=None,
      tool_message_id=None,
      error=None,
      revision=1,
    )
    atomic_write_json(path, run.to_dict())
    return run, True

  def _transition(self, run: ToolRun, status: str, **updates: Any) -> ToolRun:
    current = self.get(run.run_key)
    next_run = replace(
      current,
      status=status,
      revision=current.revision + 1,
      **updates,
    )
    atomic_write_json(self._path(run.run_key), next_run.to_dict())
    return next_run

  def mark_running(self, run: ToolRun) -> ToolRun:
    if run.status != "accepted":
      raise OpenAuthorError(f"Approved tool action is already {run.status}.")
    return self._transition(run, "running", started_at=utc_now())

  def complete(self, run: ToolRun, *, tool_message_id: str) -> ToolRun:
    return self._transition(
      run,
      "completed",
      completed_at=utc_now(),
      tool_message_id=tool_message_id,
    )

  def fail(self, run: ToolRun, error: BaseException) -> ToolRun:
    return self._transition(
      run,
      "failed",
      completed_at=utc_now(),
      error={
        "message": str(error),
        "category": str(getattr(error, "category", "core_error")),
      },
    )
