from __future__ import annotations

import json
import hashlib
import uuid
from pathlib import Path
from typing import Any

from .model_input import estimate_tokens as _estimate_tokens
from .ai import ChatInterrupted, DEFAULT_MODELS, SUPPORTED_PROVIDERS, complete_chat
from .assistant.history import HistoryPolicy, build_history_window
from .assistant.context import (
  ContextPack,
  ContextRequest,
  build_context_pack,
  context_policy_from_profile,
)
from .assistant.tools import DEFAULT_TOOL_REGISTRY
from .assistant.locks import serialize_assistant_thread_mutation
from .assistant.tool_runs import ToolRunStore
from .assistant.turns import AssistantTurn, AssistantTurnStore
from .checks import run_continuity_checks
from .codex import add_entity, list_entities, update_entity
from .ai_visibility import current_privacy_history, memory_context_fingerprint, memory_for_ai
from .project_lock import project_write_lock
from .story_grounding import prepare_story_grounding, STORY_GROUNDING_INSTRUCTIONS
from contextvars import ContextVar

_pending_messages: ContextVar[list[dict[str, Any]] | None] = ContextVar("pending_chat_messages", default=None)
from .memory_context import get_assistant_memory, list_assistant_memory, memory_for_assistant
from .git_ops import (
  create_branch,
  create_snapshot,
  current_branch,
  diff_branches,
  get_branch_workspace_status,
  merge_branches,
  preflight_merge,
  run_git,
  switch_branch,
)
from .project import OpenAuthorError, ProjectPaths, atomic_write_json, atomic_write_text, utc_now
from .proposals import create_proposal
from .retrieval import query_retrieval_index
from .scenes import get_scene, list_scenes

CHAT_MODES = {"chat", "agent"}
INCLUDE_CODEX_MODES = {"off", "explicit", "auto", "auto_and_explicit"}
RETRIEVAL_MODES = {"off", "auto", "required"}
MAX_TOOL_ROUNDS = 4


CHAT_TOOL_WIRE_NAMES = {
  definition.wire_name: definition.name
  for definition in DEFAULT_TOOL_REGISTRY.definitions(channel="text")
}


def _chat_tool_specs() -> list[dict[str, Any]]:
  return DEFAULT_TOOL_REGISTRY.provider_specs(channel="text")


def _clip_tool_result(value: str, limit: int = 4000) -> str:
  if len(value) <= limit:
    return value
  return value[: limit - 3] + "..."


def _thread_messages_path(paths: ProjectPaths, thread_id: str) -> Path:
  return paths.chat_threads_dir / f"{thread_id}.jsonl"


def _default_context_profile() -> dict[str, Any]:
  return {
    "scope": "adaptive",
    "include_current_scene": True,
    "include_selection": True,
    "include_recent_scenes_radius": 1,
    "include_codex": "auto_and_explicit",
    "retrieval_mode": "auto",
    "retrieval_limit": 5,
    "retrieval_min_score": 0.0,
    "retrieval_require_fresh": False,
    "history_token_budget": 4000,
    "input_token_ceiling": 16000,
    "response_token_reserve": 1200,
    "agent_auto_read_only": True,
    "agent_confirm_writes": True,
  }


def _load_threads(paths: ProjectPaths) -> list[dict[str, Any]]:
  try:
    payload = json.loads(paths.chat_threads_index_file.read_text(encoding="utf-8"))
  except json.JSONDecodeError as error:
    raise OpenAuthorError(
      f"Invalid chat threads index JSON: {paths.chat_threads_index_file}"
    ) from error
  if not isinstance(payload, list):
    raise OpenAuthorError(
      f"Invalid chat threads index shape: {paths.chat_threads_index_file}"
    )
  rows = [row for row in payload if isinstance(row, dict)]
  rows.sort(key=lambda row: str(row.get("updated_at", "")), reverse=True)
  return rows


def _write_threads(paths: ProjectPaths, rows: list[dict[str, Any]]) -> None:
  normalized = sorted(
    rows,
    key=lambda row: (str(row.get("updated_at", "")), str(row.get("id", ""))),
    reverse=True,
  )
  atomic_write_json(paths.chat_threads_index_file, normalized)


def _capture_vcs_anchor(paths: ProjectPaths) -> tuple[str, str]:
  try:
    branch = current_branch(paths)
    commit = run_git(paths, ["rev-parse", "HEAD"], check=False).stdout.strip()
    return branch, commit
  except OpenAuthorError:
    return "", ""


def _normalize_mode(mode: str) -> str:
  normalized = mode.strip().lower()
  if normalized not in CHAT_MODES:
    allowed = ", ".join(sorted(CHAT_MODES))
    raise OpenAuthorError(f"Invalid chat mode '{mode}'. Allowed: {allowed}.")
  return normalized


def _normalize_provider(provider: str) -> str:
  normalized = provider.strip().lower()
  if normalized not in SUPPORTED_PROVIDERS:
    allowed = ", ".join(sorted(SUPPORTED_PROVIDERS))
    raise OpenAuthorError(f"Invalid provider '{provider}'. Allowed: {allowed}.")
  return normalized


def _normalize_context_profile(
  profile: dict[str, Any] | None,
) -> dict[str, Any]:
  merged = _default_context_profile()
  if isinstance(profile, dict):
    merged.update(profile)
  include_codex = str(merged.get("include_codex", "off")).strip().lower()
  if include_codex not in INCLUDE_CODEX_MODES:
    allowed = ", ".join(sorted(INCLUDE_CODEX_MODES))
    raise OpenAuthorError(
      f"Invalid include_codex mode '{include_codex}'. Allowed: {allowed}."
    )
  merged["include_codex"] = include_codex

  retrieval_mode = str(merged.get("retrieval_mode", "off")).strip().lower()
  if retrieval_mode not in RETRIEVAL_MODES:
    allowed = ", ".join(sorted(RETRIEVAL_MODES))
    raise OpenAuthorError(
      f"Invalid retrieval mode '{retrieval_mode}'. Allowed: {allowed}."
    )
  merged["retrieval_mode"] = retrieval_mode

  scope = str(merged.get("scope", "adaptive")).strip().lower()
  allowed_scopes = {"adaptive", "project", "scene", "chapter", "character", "storyline"}
  if scope not in allowed_scopes:
    allowed = ", ".join(sorted(allowed_scopes))
    raise OpenAuthorError(f"Invalid Assistant scope '{scope}'. Allowed: {allowed}.")
  merged["scope"] = scope

  merged["include_current_scene"] = bool(merged.get("include_current_scene", True))
  merged["include_selection"] = bool(merged.get("include_selection", True))
  merged["retrieval_require_fresh"] = bool(merged.get("retrieval_require_fresh", False))
  merged["agent_auto_read_only"] = bool(merged.get("agent_auto_read_only", True))
  merged["agent_confirm_writes"] = bool(merged.get("agent_confirm_writes", True))

  try:
    merged["include_recent_scenes_radius"] = max(
      0,
      int(merged.get("include_recent_scenes_radius", 1)),
    )
  except (TypeError, ValueError):
    raise OpenAuthorError("include_recent_scenes_radius must be an integer >= 0.")
  try:
    merged["retrieval_limit"] = max(1, int(merged.get("retrieval_limit", 5)))
  except (TypeError, ValueError):
    raise OpenAuthorError("retrieval_limit must be an integer >= 1.")
  try:
    merged["retrieval_min_score"] = max(
      0.0, float(merged.get("retrieval_min_score", 0.0))
    )
  except (TypeError, ValueError):
    raise OpenAuthorError("retrieval_min_score must be a number >= 0.")
  try:
    merged["history_token_budget"] = max(
      0,
      int(merged.get("history_token_budget", 4000)),
    )
  except (TypeError, ValueError):
    raise OpenAuthorError("history_token_budget must be an integer >= 0.")
  try:
    merged["input_token_ceiling"] = max(
      1,
      int(merged.get("input_token_ceiling", 16000)),
    )
  except (TypeError, ValueError):
    raise OpenAuthorError("input_token_ceiling must be an integer >= 1.")
  try:
    merged["response_token_reserve"] = max(
      0,
      int(merged.get("response_token_reserve", 1200)),
    )
  except (TypeError, ValueError):
    raise OpenAuthorError("response_token_reserve must be an integer >= 0.")
  return merged


def list_chat_threads(paths: ProjectPaths) -> list[dict[str, Any]]:
  return _load_threads(paths)


def create_chat_thread(
  paths: ProjectPaths,
  *,
  title: str,
  provider: str = "local",
  model: str = "",
  mode: str = "chat",
  context_profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
  normalized_provider = _normalize_provider(provider)
  normalized_mode = _normalize_mode(mode)
  normalized_profile = _normalize_context_profile(context_profile)
  thread_title = title.strip() or "New thread"
  branch, commit = _capture_vcs_anchor(paths)
  now = utc_now()
  thread_id = f"chat-{uuid.uuid4().hex[:12]}"
  row = {
    "id": thread_id,
    "title": thread_title,
    "provider": normalized_provider,
    "model": model.strip() or DEFAULT_MODELS[normalized_provider],
    "mode": normalized_mode,
    "created_at": now,
    "updated_at": now,
    "context_profile": normalized_profile,
    "vcs_branch": branch,
    "vcs_base_commit": commit,
  }
  rows = _load_threads(paths)
  rows.append(row)
  _write_threads(paths, rows)
  _thread_messages_path(paths, thread_id).write_text("", encoding="utf-8")
  return row


def get_chat_thread(paths: ProjectPaths, thread_id: str) -> dict[str, Any]:
  normalized = thread_id.strip()
  if normalized == "":
    raise OpenAuthorError("thread_id cannot be empty.")
  for row in _load_threads(paths):
    if row.get("id") == normalized:
      return row
  raise OpenAuthorError(f"Unknown chat thread id '{normalized}'.")


def rename_chat_thread(paths: ProjectPaths, *, thread_id: str, title: str) -> dict[str, Any]:
  normalized_id = thread_id.strip()
  new_title = title.strip()
  if normalized_id == "":
    raise OpenAuthorError("thread_id cannot be empty.")
  if new_title == "":
    raise OpenAuthorError("title cannot be empty.")

  rows = _load_threads(paths)
  for row in rows:
    if row.get("id") != normalized_id:
      continue
    row["title"] = new_title
    row["updated_at"] = utc_now()
    _write_threads(paths, rows)
    return row
  raise OpenAuthorError(f"Unknown chat thread id '{normalized_id}'.")


def update_chat_thread(
  paths: ProjectPaths,
  *,
  thread_id: str,
  provider: str | None = None,
  model: str | None = None,
  mode: str | None = None,
  context_profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
  normalized_id = thread_id.strip()
  if normalized_id == "":
    raise OpenAuthorError("thread_id cannot be empty.")
  rows = _load_threads(paths)
  for row in rows:
    if row.get("id") != normalized_id:
      continue
    if provider is not None:
      row["provider"] = _normalize_provider(provider)
      if not isinstance(model, str) or model.strip() == "":
        row["model"] = DEFAULT_MODELS[row["provider"]]
    if model is not None:
      clean_model = model.strip()
      if clean_model == "":
        row["model"] = DEFAULT_MODELS[str(row.get("provider", "local"))]
      else:
        row["model"] = clean_model
    if mode is not None:
      row["mode"] = _normalize_mode(mode)
    if context_profile is not None:
      current = row.get("context_profile", {})
      current_dict = current if isinstance(current, dict) else {}
      merged = dict(current_dict)
      merged.update(context_profile)
      row["context_profile"] = _normalize_context_profile(merged)
    row["updated_at"] = utc_now()
    _write_threads(paths, rows)
    return row
  raise OpenAuthorError(f"Unknown chat thread id '{normalized_id}'.")


def list_chat_messages(
  paths: ProjectPaths,
  *,
  thread_id: str,
  limit: int | None = None,
) -> list[dict[str, Any]]:
  normalized_id = thread_id.strip()
  if normalized_id == "":
    raise OpenAuthorError("thread_id cannot be empty.")
  if limit is not None and limit < 1:
    raise OpenAuthorError("limit must be >= 1.")
  get_chat_thread(paths, normalized_id)
  message_path = _thread_messages_path(paths, normalized_id)
  if not message_path.exists():
    return []

  rows: list[dict[str, Any]] = []
  for raw_line in message_path.read_text(encoding="utf-8").splitlines():
    stripped = raw_line.strip()
    if not stripped:
      continue
    try:
      payload = json.loads(stripped)
    except json.JSONDecodeError as error:
      raise OpenAuthorError(
        f"Invalid chat message JSONL entry in {message_path}."
      ) from error
    if isinstance(payload, dict):
      rows.append(payload)
  if limit is not None:
    return rows[-limit:]
  return rows


@serialize_assistant_thread_mutation
def truncate_chat_messages(
  paths: ProjectPaths,
  *,
  thread_id: str,
  from_message_id: str,
) -> dict[str, Any]:
  """Remove a message and everything after it from a thread.

  Used by regenerate: rewind the thread to just before a turn and send the
  turn again. Generation logs for the removed turns are kept — spend history
  is immutable even when the conversation is rewound.
  """
  normalized_id = from_message_id.strip()
  if normalized_id == "":
    raise OpenAuthorError("from_message_id cannot be empty.")
  messages = list_chat_messages(paths, thread_id=thread_id)
  index = next(
    (position for position, row in enumerate(messages) if row.get("id") == normalized_id),
    None,
  )
  if index is None:
    raise OpenAuthorError(
      f"Message '{normalized_id}' not found in thread '{thread_id}'."
    )
  kept = messages[:index]
  removed = messages[index:]
  message_path = _thread_messages_path(paths, thread_id)
  atomic_write_text(
    message_path,
    "".join(json.dumps(row, separators=(",", ":")) + "\n" for row in kept),
  )
  _touch_thread(paths, thread_id)
  return {
    "thread_id": thread_id,
    "from_message_id": normalized_id,
    "removed_count": len(removed),
    "remaining_count": len(kept),
    "removed_ids": [str(row.get("id", "")) for row in removed],
  }


def _append_chat_message(
  paths: ProjectPaths,
  *,
  thread_id: str,
  role: str,
  content: str,
  context_used: dict[str, Any] | None = None,
  tool_calls: list[dict[str, Any]] | None = None,
  usage: dict[str, Any] | None = None,
  turn_id: str = "",
  channel: str = "text",
  turn_position: int | None = None,
) -> dict[str, Any]:
  if role not in {"user", "assistant", "tool"}:
    raise OpenAuthorError(f"Invalid chat role '{role}'.")
  message_id = f"msg-{uuid.uuid4().hex[:12]}"
  row: dict[str, Any] = {
    "id": message_id,
    "role": role,
    "created_at": utc_now(),
    "content": content,
    "context_used": context_used or {},
    "tool_calls": tool_calls or [],
    "usage": usage or {},
  }
  if turn_id:
    row["turn_id"] = turn_id
    row["thread_id"] = thread_id
    row["channel"] = channel
    row["turn_position"] = turn_position
  pending = _pending_messages.get()
  if pending is not None:
    pending.append(row)
    return row
  message_path = _thread_messages_path(paths, thread_id)
  message_path.parent.mkdir(parents=True, exist_ok=True)
  with message_path.open("a", encoding="utf-8") as handle:
    handle.write(json.dumps(row, separators=(",", ":")) + "\n")
  return row


def _build_provider_history(
  rows: list[dict[str, Any]],
  *,
  token_budget: int,
) -> list[dict[str, str]]:
  """Compatibility adapter for callers that still expect provider messages."""

  return build_history_window(
    rows,
    HistoryPolicy(token_budget=token_budget),
  ).messages


def _tool_classification(tool_name: str) -> str:
  return DEFAULT_TOOL_REGISTRY.legacy_classification(tool_name)


def _execute_tool(paths: ProjectPaths, tool_name: str, args: dict[str, Any], *, approved_codex_ids: tuple[str, ...] = (), memory_approvals: list[dict[str, str]] | None = None) -> Any:
  if tool_name == "scene.list":
    return list_scenes(paths)
  if tool_name == "scene.get":
    return get_scene(paths, str(args.get("id", "")).strip())
  if tool_name == "codex.list":
    return memory_for_ai(paths, memory_approvals) if memory_approvals is not None else list_assistant_memory(paths, approved_ids=approved_codex_ids)
  if tool_name == "codex.get":
    if memory_approvals is None:
      return get_assistant_memory(paths, str(args.get("id", "")).strip(), approved_ids=approved_codex_ids)
    entity = next((row for row in memory_for_ai(paths, memory_approvals) if row["id"] == str(args.get("id", "")).strip()), None)
    if entity is None: raise OpenAuthorError("Story Memory entry is unavailable to the Assistant.")
    return entity
  if tool_name == "retrieval.query":
    return query_retrieval_index(
      paths,
      query=str(args.get("text", "")).strip(),
      limit=max(1, int(args.get("limit", 5))),
      min_score=max(0.0, float(args.get("min_score", 0.0))),
      require_fresh=bool(args.get("require_fresh", False)),
    )
  if tool_name == "check.continuity":
    return run_continuity_checks(paths)
  if tool_name == "branch.status":
    return get_branch_workspace_status(paths)
  if tool_name == "proposal.add":
    proposal_id = create_proposal(
      paths,
      title=str(args.get("title", "")).strip(),
      instruction=str(args.get("instruction", "")).strip(),
      scene_id=str(args.get("scene_id", "")).strip(),
      source="chat_agent",
    )
    from .proposals import get_proposal

    return get_proposal(paths, proposal_id)
  if tool_name == "proposal.generate":
    from .ai import generate_proposal

    return generate_proposal(
      paths,
      scene_id=str(args.get("scene_id", "")).strip(),
      instruction=str(args.get("instruction", "")).strip(),
      title=str(args.get("title", "")).strip(),
      provider=str(args.get("provider", "local")).strip() or "local",
      model=(str(args.get("model", "")).strip() or None),
      temperature=float(args.get("temperature", 0.2)),
      max_output_tokens=max(64, int(args.get("max_output_tokens", 700))),
      context_scene_radius=max(0, int(args.get("context_scene_radius", 1))),
      codex_limit=max(1, int(args.get("codex_limit", 20))),
      retrieval_mode=str(args.get("retrieval_mode", "off")).strip() or "off",
      retrieval_limit=max(1, int(args.get("retrieval_limit", 5))),
      retrieval_min_score=max(0.0, float(args.get("retrieval_min_score", 0.0))),
      retrieval_require_fresh=bool(args.get("retrieval_require_fresh", False)),
    )
  if tool_name == "codex.add":
    entity_id = add_entity(
      paths,
      kind=str(args.get("type", "")).strip(),
      name=str(args.get("name", "")).strip(),
      description=str(args.get("description", "")),
    )
    return get_assistant_memory(paths, entity_id)
  if tool_name == "codex.update":
    get_assistant_memory(paths, str(args.get("id", "")).strip(), approved_ids=approved_codex_ids)
    return memory_for_assistant(update_entity(
      paths,
      entity_id=str(args.get("id", "")).strip(),
      kind=(str(args.get("type", "")).strip() or None),
      name=(str(args.get("name", "")).strip() or None),
      description=(str(args.get("description", "")) if "description" in args else None),
    ), approved=str(args.get("id", "")).strip() in approved_codex_ids)
  if tool_name == "snapshot.create":
    return {"message": create_snapshot(paths, str(args.get("message", "")).strip())}
  if tool_name == "branch.create":
    return create_branch(
      paths,
      name=str(args.get("name", "")).strip(),
      from_ref=(str(args.get("from_ref", "")).strip() or None),
      switch=not bool(args.get("no_switch", False)),
    )
  if tool_name == "branch.switch":
    return switch_branch(paths, name=str(args.get("name", "")).strip())
  if tool_name == "merge.preflight":
    return preflight_merge(
      paths,
      base=str(args.get("base", "")).strip(),
      head=str(args.get("head", "")).strip(),
    )
  if tool_name == "merge.apply":
    return merge_branches(
      paths,
      base=str(args.get("base", "")).strip(),
      head=str(args.get("head", "")).strip(),
    )
  raise OpenAuthorError(f"Unsupported chat tool '{tool_name}'.")


def _completed_turn_result(
  paths: ProjectPaths,
  *,
  turn: AssistantTurn,
) -> dict[str, Any]:
  rows = list_chat_messages(paths, thread_id=turn.thread_id)
  by_id = {str(row.get("id", "")): row for row in rows}
  turn_rows = [by_id[item] for item in turn.message_ids if item in by_id]
  user_message = next(
    (row for row in turn_rows if row.get("role") == "user"),
    None,
  )
  assistant_rows = [row for row in turn_rows if row.get("role") == "assistant"]
  if user_message is None or not assistant_rows:
    raise OpenAuthorError(
      f"Completed Assistant turn '{turn.turn_id}' is missing durable messages."
    )
  assistant_message = assistant_rows[-1]
  pending_tool_calls = [
    call
    for row in assistant_rows
    for call in row.get("tool_calls", [])
    if isinstance(call, dict) and not bool(call.get("executed", False))
  ]
  return {
    "thread": get_chat_thread(paths, turn.thread_id),
    "user_message": user_message,
    "assistant_message": assistant_message,
    "tool_messages": [row for row in turn_rows if row.get("role") == "tool"],
    "pending_tool_calls": pending_tool_calls,
    "turn": turn.to_dict(),
  }


def _chat_lock_resource(thread_id: str) -> str:
  return "chat-" + hashlib.sha256(thread_id.encode()).hexdigest()



def _chat_delivery_folder(paths: ProjectPaths, thread_id: str) -> Path:
  return paths.chats_dir / "deliveries" / hashlib.sha256(thread_id.encode()).hexdigest()



def _recover_chat_deliveries(paths: ProjectPaths, thread_id: str) -> None:
  folder = _chat_delivery_folder(paths, thread_id)
  for stored in sorted([*folder.glob("*.json"), *(folder / "tools").glob("*.json")]):
    receipt = json.loads(stored.read_text(encoding="utf-8"))
    if receipt.get("status") != "executing":
      _complete_chat_receipt(paths, stored, receipt)
      _publish_chat_receipt(paths, thread_id, stored, receipt)



def _complete_chat_receipt(paths: ProjectPaths, receipt_path: Path, receipt: dict[str, Any]) -> None:
  completion = receipt.get("turn_completion")
  if not completion or receipt["result"].get("turn", {}).get("status") == "completed":
    return
  store = AssistantTurnStore(paths)
  turn = store.get(completion["turn_id"])
  if turn.status != "completed":
    turn = store.complete(**completion)
  receipt["result"]["turn"] = turn.to_dict()
  atomic_write_json(receipt_path, receipt)


def _publish_chat_receipt(paths: ProjectPaths, thread_id: str, receipt_path: Path, receipt: dict[str, Any]) -> None:
  if receipt.get("published"):
    return
  messages = list_chat_messages(paths, thread_id=thread_id)
  known = {row["id"] for row in messages}
  replace_from = receipt.get("replace_from_message_id", "")
  if replace_from:
    boundary = next((index for index, row in enumerate(messages) if row["id"] == replace_from), None)
    if boundary is not None:
      messages = messages[:boundary] + receipt["messages"]
      atomic_write_text(_thread_messages_path(paths, thread_id), "".join(json.dumps(row, separators=(",", ":")) + "\n" for row in messages))
    elif not all(row["id"] in known for row in receipt["messages"]):
      raise OpenAuthorError("The message being replaced is no longer present. Review the conversation again.")
    # If the boundary is gone and all replacement ids are present, the atomic
    # transcript write succeeded before receipt finalization was interrupted.
  else:
    messages.extend(row for row in receipt["messages"] if row["id"] not in known)
    atomic_write_text(_thread_messages_path(paths, thread_id), "".join(json.dumps(row, separators=(",", ":")) + "\n" for row in messages))
  original_turn_id = receipt.get("superseded_turn_id", "")
  if original_turn_id:
    store = AssistantTurnStore(paths)
    try:
      original = store.get(original_turn_id)
    except OpenAuthorError:
      original = None
    if original is not None and original.status == "completed":
      store.supersede(original_turn_id, superseded_by=receipt["result"]["turn"]["turn_id"])
  receipt["published"] = True
  atomic_write_json(receipt_path, receipt)



@serialize_assistant_thread_mutation
def send_chat_message(paths: ProjectPaths, *, thread_id: str, request_id: str = "", is_cancelled: Any = None,
  replace_from_message_id: str = "", **kwargs: Any) -> dict[str, Any]:
  """Publish a turn once, even when its response is lost and delivery is retried.

  Failed/cancelled keyed turns never publish partial messages or pending tools.
  A durable completed receipt precedes transcript publication, closing the
  process-exit window between provider completion and response delivery.
  """
  request_id = request_id or kwargs.get("turn_id") or uuid.uuid4().hex
  kwargs["thread_id"] = thread_id
  if replace_from_message_id:
    kwargs["history_before_message_id"] = replace_from_message_id
  get_chat_thread(paths, thread_id)
  fingerprint = hashlib.sha256(json.dumps({key: value for key, value in kwargs.items() if key not in {"on_delta", "turn_id"}}, sort_keys=True).encode()).hexdigest()
  key = hashlib.sha256(f"{thread_id}:{request_id}".encode()).hexdigest()
  folder = _chat_delivery_folder(paths, thread_id)
  receipt_path = folder / f"{key}.json"
  attempt_path = folder / "attempts" / f"{key}.json"
  with project_write_lock(paths, resource=_chat_lock_resource(thread_id)):
    # Repair completed deliveries before accepting another turn in this chat.
    _recover_chat_deliveries(paths, thread_id)
    if receipt_path.exists():
      receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
      if receipt["fingerprint"] != fingerprint:
        raise OpenAuthorError("A chat request id cannot be reused for different content.")
      return receipt["result"]
    original_turn_id = ""
    if replace_from_message_id:
      original = next((row for row in list_chat_messages(paths, thread_id=thread_id)
                       if row["id"] == replace_from_message_id), None)
      if original is None:
        raise OpenAuthorError("The message being replaced is no longer present. Review the conversation again.")
      original_turn_id = str(original.get("turn_id", ""))
    logical_turn_id = str(kwargs.get("turn_id") or f"turn-{key[:32]}")
    attempt_turn_id = logical_turn_id
    owns_attempt = attempt_path.exists()
    if owns_attempt:
      attempt = json.loads(attempt_path.read_text(encoding="utf-8"))
      if attempt["fingerprint"] != fingerprint:
        raise OpenAuthorError("A chat request id cannot be reused for different content.")
      attempt_turn_id = attempt["turn_id"]
    turn_store = AssistantTurnStore(paths)
    try:
      previous_turn = turn_store.get(attempt_turn_id)
    except OpenAuthorError:
      previous_turn = None
    if previous_turn is not None:
      # Reusing a turn id must retain its original request contract, including
      # callers whose old turn predates the delivery-attempt journal.
      turn_store.claim(
        turn_id=attempt_turn_id, thread_id=thread_id, channel=str(kwargs.get("channel", "text")),
        request={
          "message": str(kwargs["message"]).strip(),
          "current_scene_id": kwargs.get("current_scene_id", ""),
          "scene_ids": list(kwargs.get("scene_ids") or []),
          "selected_text": kwargs.get("selected_text", ""),
          "codex_ids": list(kwargs.get("codex_ids") or []),
          "approved_codex_ids": list(kwargs.get("approved_codex_ids") or []),
          "context_overrides": dict(kwargs.get("context_overrides") or {}),
        },
      )
    if previous_turn is not None and owns_attempt and previous_turn.status in {"accepted", "running"}:
      # The thread lock proves this delivery's previous writer has stopped.
      # Without a durable result, a crashed attempt may require a paid retry.
      previous_turn = turn_store.fail(attempt_turn_id, message="Delivery stopped before its result was saved.", category="interrupted_delivery")
    if previous_turn is not None and previous_turn.status in {"failed", "interrupted"}:
      attempt_turn_id = f"turn-{uuid.uuid4().hex}"
    atomic_write_json(attempt_path, {
      "schema_version": 1, "fingerprint": fingerprint,
      "logical_turn_id": logical_turn_id, "turn_id": attempt_turn_id,
    })
    kwargs["turn_id"] = attempt_turn_id
    pending: list[dict[str, Any]] = []
    token = _pending_messages.set(pending)
    try:
      result = _send_chat_message(paths, is_cancelled=is_cancelled, **kwargs)
      if is_cancelled and is_cancelled():
        raise ChatInterrupted("Chat turn interrupted by user.")
      turn_completion = result.pop("_turn_completion", None)
      receipt = {"schema_version": 1, "fingerprint": fingerprint, "result": result, "messages": pending, "published": False}
      if replace_from_message_id:
        receipt["replace_from_message_id"] = replace_from_message_id
        receipt["superseded_turn_id"] = original_turn_id
      if turn_completion is not None:
        receipt["turn_completion"] = turn_completion
      atomic_write_json(receipt_path, receipt)
      _complete_chat_receipt(paths, receipt_path, receipt)
      _publish_chat_receipt(paths, thread_id, receipt_path, receipt)
      return receipt["result"]
    except Exception as error:
      # A result saved in a receipt is recoverable even if finalization or
      # publication fails. Without it, retain a failed attempt so Retry can
      # start another attempt under the same logical delivery identity.
      if not receipt_path.exists():
        try:
          turn = turn_store.get(attempt_turn_id)
          if turn.status in {"accepted", "running"}:
            if isinstance(error, ChatInterrupted):
              turn_store.interrupt(attempt_turn_id, message=str(error))
            else:
              turn_store.fail(attempt_turn_id, message=str(error), category=str(getattr(error, "category", "core_error")))
        except (OpenAuthorError, OSError):
          pass
      raise
    finally:
      _pending_messages.reset(token)



def _chat_memory_grants(paths: ProjectPaths, codex_ids: list[str] | None,
  approved_codex_ids: list[str] | None, memory_approvals: list[dict[str, str]] | None) -> list[dict[str, str]]:
  if memory_approvals is not None and not isinstance(memory_approvals, list):
    raise OpenAuthorError("Memory permissions must be a list of entry or detail selections.")
  grants = list(memory_approvals or [])
  approved = set(approved_codex_ids or []).intersection(codex_ids or [])
  for entity in list_entities(paths):
    if entity["id"] not in approved:
      continue
    get_assistant_memory(paths, entity["id"], approved_ids=approved)
    if entity.get("ai_visibility") == "ask":
      grant = {"entity_id": entity["id"]}
      if grant not in grants: grants.append(grant)
    for detail in entity.get("details", []):
      if detail.get("ai_visibility") == "ask":
        grant = {"entity_id": entity["id"], "detail_key": detail["key"]}
        if grant not in grants: grants.append(grant)
  return grants


def preview_chat_context(
  paths: ProjectPaths,
  *,
  thread_id: str,
  message: str,
  current_scene_id: str = "",
  scene_ids: list[str] | None = None,
  selected_text: str = "",
  codex_ids: list[str] | None = None,
  context_overrides: dict[str, Any] | None = None,
  memory_approvals: list[dict[str, str]] | None = None,
  story_approvals: list[str] | None = None,
  history_before_message_id: str = "",
  approved_codex_ids: list[str] | None = None,
  channel: str = "text",
) -> dict[str, Any]:
  """Resolve the exact initial provider payload without contacting a provider.

  Permissions are request parameters, never thread preferences or model args.
  The fingerprint lets the desktop refuse to send a stale reviewed payload.
  """
  thread = get_chat_thread(paths, thread_id)
  content = message.strip()
  if content == "":
    raise OpenAuthorError("message cannot be empty.")

  thread_profile = thread.get("context_profile", {})
  merged_profile = dict(thread_profile) if isinstance(thread_profile, dict) else {}
  if isinstance(context_overrides, dict):
    merged_profile.update(context_overrides)
  profile = _normalize_context_profile(merged_profile)

  memory_approvals = _chat_memory_grants(paths, codex_ids, approved_codex_ids, memory_approvals)
  fingerprint = memory_context_fingerprint(paths, memory_approvals)
  transcript = list_chat_messages(paths, thread_id=thread_id)
  if history_before_message_id:
    boundary = next((index for index, row in enumerate(transcript) if row["id"] == history_before_message_id), None)
    if boundary is None:
      raise OpenAuthorError("The message being edited is no longer present. Review the conversation again.")
    transcript = transcript[:boundary]
  eligible_history = current_privacy_history(transcript, fingerprint)
  history = _build_provider_history(
    eligible_history,
    token_budget=int(profile.get("history_token_budget", 4000)),
  )

  context_pack = build_context_pack(paths, ContextRequest(
    thread_id=thread_id, channel=channel, utterance=content, scope=profile["scope"],
    current_scene_id=current_scene_id, selected_text=selected_text,
    explicit_scene_ids=tuple(scene_ids or []), explicit_codex_ids=tuple(codex_ids or []),
    approved_codex_ids=tuple(approved_codex_ids or []), memory_approvals=tuple(memory_approvals or []),
    story_approvals=tuple(story_approvals or []), history=tuple(history), agent_mode=thread.get("mode") == "agent", bound_brief=True,
  ), context_policy_from_profile(profile))
  prompt_context = context_pack.provider_context
  history = context_pack.history
  context_used = {
    "scene_ids": [item.source_ref for item in context_pack.items if item.kind == "scene"],
    "nearby_scene_ids": [item.source_ref for item in context_pack.items if item.kind == "nearby_scene"],
    "codex_entity_ids": [item.source_ref for item in context_pack.items if item.kind == "codex"],
    "retrieval": prompt_context.get("retrieval", {}), "profile": profile,
    "context_pack": {"id": context_pack.pack_id, "budget": context_pack.budget, "citations": context_pack.citations},
    "review": {"scope": context_pack.scope, "scene_titles": [item.source_title for item in context_pack.items if item.kind == "scene"],
      "nearby_scene_titles": [item.source_title for item in context_pack.items if item.kind == "nearby_scene"],
      "selected_text_included": bool(prompt_context.get("selected_text")), "retrieval_result_count": len(context_pack.citations),
      "chapter_titles": [row["title"] for row in prompt_context["narrative_frame"]["chapters"]],
      "canon_fact_ids": list(dict.fromkeys([row["id"] for row in prompt_context["accepted_canon"]] + [row["id"] for row in prompt_context["story_memory"]["facts"]])),
      "storyline_name": prompt_context["active_storyline"].get("name", ""),
      "writing_voice_name": prompt_context.get("writing_voice", {}).get("name", ""),
      "warnings": prompt_context["review_warnings"], "omitted_item_count": len(context_pack.degradations)},
  }
  story_scene_ids = prompt_context["narrative_frame"]["focus_scene_ids"]
  grounding = prepare_story_grounding(paths, story_scene_ids, memory_approvals=memory_approvals, story_approvals=story_approvals)
  context_used["story_scene_ids"] = story_scene_ids
  context_used["privacy"] = {
    "fingerprint": fingerprint,
    "history_reset": len(eligible_history) != len(transcript),
    "history_messages_omitted": len(transcript) - len(eligible_history),
    "one_time_approval": bool(memory_approvals or story_approvals),
  }
  if channel == "text":
    system_prompt = context_pack.model_input["system_prompt"]
    user_prompt = context_pack.model_input["user_prompt"]
  else:
    # Voice-origin turns recorded through the completion adapter retain the
    # shared voice Context Pack rather than treating it as a text-shaped pack.
    system_prompt = context_pack.model_input["instructions"]
    user_prompt = content
  provider = str(thread.get("provider", "local"))
  model = str(thread.get("model", "")).strip() or DEFAULT_MODELS[provider]
  payload = {
    "system_prompt": system_prompt, "user_prompt": user_prompt, "history": history,
    "context": prompt_context, "context_used": context_used, "provider": provider, "model": model,
    "mode": thread.get("mode", "chat"),
  }
  payload["fingerprint"] = hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()
  payload["story_choices"] = grounding["choices"]
  payload["context_pack_id"] = context_pack.pack_id
  payload["estimated_input_tokens"] = _estimate_tokens(system_prompt + "\n" + "\n".join(row["content"] for row in history) + "\n" + user_prompt)
  payload["history_messages_included"] = len(history)
  payload["history_messages_omitted"] = len(transcript) - len(history)
  payload["history_budget_limited"] = history != _build_provider_history(eligible_history, token_budget=10**12)
  payload["memory_choices"] = [
    {
      "id": row["id"], "name": row["name"], "visibility": row.get("ai_visibility", "include"),
      "details": [{"key": detail["key"], "visibility": detail.get("ai_visibility", "include")} for detail in row.get("details", [])],
    }
    for row in list_entities(paths)
  ]
  return payload



@serialize_assistant_thread_mutation
def _send_chat_message(
  paths: ProjectPaths,
  *,
  thread_id: str,
  message: str,
  current_scene_id: str = "",
  scene_ids: list[str] | None = None,
  selected_text: str = "",
  codex_ids: list[str] | None = None,
  approved_codex_ids: list[str] | None = None,
  context_overrides: dict[str, Any] | None = None,
  on_delta: Any = None,
  turn_id: str = "",
  channel: str = "text",
  memory_approvals: list[dict[str, str]] | None = None,
  story_approvals: list[str] | None = None,
  expected_context_fingerprint: str = "",
  history_before_message_id: str = "",
  is_cancelled: Any = None,
) -> dict[str, Any]:
  memory_approvals = _chat_memory_grants(paths, codex_ids, approved_codex_ids, memory_approvals)
  prepared = preview_chat_context(paths, thread_id=thread_id, message=message, current_scene_id=current_scene_id,
    scene_ids=scene_ids, selected_text=selected_text, codex_ids=codex_ids, approved_codex_ids=approved_codex_ids,
    context_overrides=context_overrides, memory_approvals=memory_approvals, story_approvals=story_approvals,
    history_before_message_id=history_before_message_id, channel=channel)
  if expected_context_fingerprint and expected_context_fingerprint != prepared["fingerprint"]:
    raise OpenAuthorError("Context changed since the preview. Review context again before sending.")
  from .assistant.context import load_context_pack
  context_pack = load_context_pack(paths, prepared["context_pack_id"])
  thread = get_chat_thread(paths, thread_id)
  content = message.strip()
  history = prepared["history"]
  context_used = prepared["context_used"]
  profile = context_used["profile"]
  normalized_turn_id = turn_id.strip() or f"turn-{uuid.uuid4().hex}"
  turn_store = AssistantTurnStore(paths)
  turn_claim = turn_store.claim(
    turn_id=normalized_turn_id,
    thread_id=thread_id,
    channel=channel,
    request={
      "message": content,
      "current_scene_id": current_scene_id,
      "scene_ids": list(scene_ids or []),
      "selected_text": selected_text,
      "codex_ids": list(codex_ids or []),
      "approved_codex_ids": list(approved_codex_ids or []),
      "context_overrides": dict(context_overrides or {}),
    },
  )
  if not turn_claim.created:
    if turn_claim.turn.status == "completed":
      return _completed_turn_result(paths, turn=turn_claim.turn)
    raise OpenAuthorError(
      f"Assistant turn '{normalized_turn_id}' is already {turn_claim.turn.status}."
    )

  provider = str(thread.get("provider", "local"))
  model = str(thread.get("model", "")).strip() or DEFAULT_MODELS[provider]

  user_message = _append_chat_message(
    paths,
    thread_id=thread_id,
    role="user",
    content=content,
    context_used=context_used,
    turn_id=normalized_turn_id,
    channel=channel,
    turn_position=0,
  )
  turn_store.mark_running(
    normalized_turn_id,
    provider=provider,
    model=model,
    input_message_id=str(user_message["id"]),
  )
  turn_message_ids = [str(user_message["id"])]
  generation_ids: list[str] = []
  agent_mode = thread.get("mode") == "agent"
  system_prompt = prepared["system_prompt"]
  user_prompt = prepared["user_prompt"]
  tools = (context_pack.model_input["tools"] if channel == "text" else DEFAULT_TOOL_REGISTRY.provider_specs(channel=channel) if agent_mode else []) or None
  agent_auto_read_only = bool(profile.get("agent_auto_read_only", True))
  turn_branch, turn_base_commit = _capture_vcs_anchor(paths)
  turn_vcs = {"branch": turn_branch, "base_commit": turn_base_commit}

  conversation: list[dict[str, Any]] = list(history)
  round_prompt = user_prompt
  assistant_message: dict[str, Any] = {}
  executed_tool_messages: list[dict[str, Any]] = []
  pending_tool_calls: list[dict[str, Any]] = []

  for round_index in range(MAX_TOOL_ROUNDS):
    try:
      if is_cancelled and is_cancelled(): raise ChatInterrupted("Chat turn interrupted by user.")
      if memory_context_fingerprint(paths, memory_approvals) != context_used["privacy"]["fingerprint"]:
        raise OpenAuthorError("Story Memory access or content changed during this turn. Review fresh context.")
      if prepare_story_grounding(paths, context_used["story_scene_ids"], memory_approvals=memory_approvals, story_approvals=story_approvals)["context"] != prepared["context"]["story_memory"]:
        raise OpenAuthorError("Canon or relationship context changed during this turn. Review fresh context.")
      completion = complete_chat(
        paths,
        provider=provider,
        model=model,
        system_prompt=system_prompt,
        user_prompt=round_prompt,
        history=list(conversation),
        temperature=0.2,
        max_output_tokens=context_pack.model_input["max_output_tokens"],
        input_token_ceiling=context_pack.budget["ceiling"],
        response_token_reserve=context_pack.budget["allocations"]["response_reserve"],
        chat_mode=True,
        thread_id=thread_id,
        on_delta=on_delta,
        tools=tools,
        turn_id=normalized_turn_id,
        round_index=round_index,
      )
      if is_cancelled and is_cancelled(): raise ChatInterrupted("Chat turn interrupted by user.")
    except ChatInterrupted as error:
      turn_store.interrupt(normalized_turn_id, message=str(error))
      raise
    except Exception as error:
      turn_store.fail(
        normalized_turn_id,
        message=str(error),
        category=str(getattr(error, "category", "core_error")),
      )
      raise
    generation_id = str(completion.get("generation_id", "")).strip()
    if generation_id:
      generation_ids.append(generation_id)
    if round_prompt:
      conversation.append({"role": "user", "content": round_prompt})
      round_prompt = ""
    assistant_text = str(completion.get("text", ""))
    wire_tool_calls = completion.get("tool_calls", []) if agent_mode else []

    recorded_tool_calls: list[dict[str, Any]] = []
    round_pending: list[dict[str, Any]] = []
    tool_result_entries: list[dict[str, Any]] = []
    round_tool_messages: list[tuple[str, str, str]] = []
    for call in wire_tool_calls:
      internal_name = CHAT_TOOL_WIRE_NAMES.get(call["name"], call["name"])
      args = call["args"] if isinstance(call.get("args"), dict) else {}
      classification = _tool_classification(internal_name)
      tool_row: dict[str, Any] = {
        "id": call["id"],
        "tool": internal_name,
        "args": args,
        "classification": classification,
        "executed": False,
        "result_summary": "",
        "error": "",
      }
      if classification == "read" and agent_auto_read_only:
        try:
          result = _execute_tool(paths, internal_name, args, approved_codex_ids=tuple(set(approved_codex_ids or []).intersection(codex_ids or [])), memory_approvals=memory_approvals)
          tool_row["executed"] = True
          tool_row["result_summary"] = _safe_summary(result)
          result_json = json.dumps(
            {"tool": internal_name, "result": result},
            ensure_ascii=True,
          )
          round_tool_messages.append((str(call["id"]), internal_name, result_json))
          tool_result_entries.append(
            {
              "role": "tool",
              "tool_call_id": call["id"],
              "name": call["name"],
              "content": _clip_tool_result(result_json),
            }
          )
        except OpenAuthorError as error:
          tool_row["error"] = str(error)
          tool_result_entries.append(
            {
              "role": "tool",
              "tool_call_id": call["id"],
              "name": call["name"],
              "content": json.dumps(
                {"tool": internal_name, "error": str(error)},
                ensure_ascii=True,
              ),
            }
          )
      else:
        round_pending.append(tool_row)
      recorded_tool_calls.append(tool_row)

    assistant_message = _append_chat_message(
      paths,
      thread_id=thread_id,
      role="assistant",
      content=assistant_text,
      context_used={**context_used, "vcs": turn_vcs},
      tool_calls=recorded_tool_calls,
      usage={
        "input_tokens": completion.get("input_tokens"),
        "output_tokens": completion.get("output_tokens"),
        "latency_ms": completion.get("latency_ms"),
        "provider_attempts": completion.get("provider_attempts"),
        "estimated_cost_usd": completion.get("estimated_cost_usd"),
        "provider": provider,
        "model": model,
        "generation_id": completion.get("generation_id", ""),
      },
      turn_id=normalized_turn_id,
      channel=channel,
      turn_position=len(turn_message_ids),
    )
    turn_message_ids.append(str(assistant_message["id"]))
    for tool_call_id, tool_name, tool_content in round_tool_messages:
      tool_message = _append_chat_message(
        paths,
        thread_id=thread_id,
        role="tool",
        content=tool_content,
        context_used={"tool_call_id": tool_call_id, "tool": tool_name},
        turn_id=normalized_turn_id,
        channel=channel,
        turn_position=len(turn_message_ids),
      )
      turn_message_ids.append(str(tool_message["id"]))
      executed_tool_messages.append(tool_message)
    pending_tool_calls.extend(round_pending)

    # Continue only when every requested tool ran: pending calls need the
    # author's approval first, and no calls means the turn is finished.
    if not wire_tool_calls or round_pending or not tool_result_entries:
      break
    conversation.append(
      {
        "role": "assistant",
        "content": assistant_text,
        "tool_calls": [
          {"id": call["id"], "name": call["name"], "args": call["args"]}
          for call in wire_tool_calls
        ],
      }
    )
    conversation.extend(tool_result_entries)

  turn_completion = {
    "turn_id": normalized_turn_id,
    "message_ids": turn_message_ids,
    "generation_ids": generation_ids,
    "pending_tool_call_ids": [
      str(call.get("id", ""))
      for call in pending_tool_calls
      if str(call.get("id", "")).strip()
    ],
    "context_pack_id": context_pack.pack_id,
  }
  _touch_thread(paths, thread_id)
  return {
    "thread": get_chat_thread(paths, thread_id),
    "user_message": user_message,
    "assistant_message": assistant_message,
    "tool_messages": executed_tool_messages,
    "pending_tool_calls": pending_tool_calls,
    "turn": turn_store.get(normalized_turn_id).to_dict(),
    "_turn_completion": turn_completion,
  }


@serialize_assistant_thread_mutation
def regenerate_chat_turn(
  paths: ProjectPaths,
  *,
  thread_id: str,
  from_message_id: str,
  replacement_turn_id: str,
  message: str,
  current_scene_id: str = "",
  scene_ids: list[str] | None = None,
  selected_text: str = "",
  codex_ids: list[str] | None = None,
  approved_codex_ids: list[str] | None = None,
  context_overrides: dict[str, Any] | None = None,
  on_delta: Any = None,
  memory_approvals: list[dict[str, str]] | None = None,
  story_approvals: list[str] | None = None,
  expected_context_fingerprint: str = "",
  is_cancelled: Any = None,
) -> dict[str, Any]:
  """Replace a settled turn as one replay-safe thread mutation."""

  replacement_id = replacement_turn_id.strip()
  if replacement_id == "":
    raise OpenAuthorError("replacement_turn_id is required.")
  store = AssistantTurnStore(paths)
  try:
    existing = store.get(replacement_id)
  except OpenAuthorError:
    existing = None
  messages = list_chat_messages(paths, thread_id=thread_id)
  replaced = next(
    (row for row in messages if row.get("id") == from_message_id),
    None,
  )
  if existing is not None and replaced is None:
    return send_chat_message(
      paths,
      thread_id=thread_id,
      message=message,
      current_scene_id=current_scene_id,
      scene_ids=scene_ids,
      selected_text=selected_text,
      codex_ids=codex_ids,
      approved_codex_ids=approved_codex_ids,
      context_overrides=context_overrides,
      on_delta=on_delta,
      turn_id=replacement_id,
      channel="text",
      memory_approvals=memory_approvals,
      story_approvals=story_approvals,
      expected_context_fingerprint=expected_context_fingerprint,
      is_cancelled=is_cancelled,
      replace_from_message_id=from_message_id,
    )

  if replaced is None:
    raise OpenAuthorError(
      f"Message '{from_message_id}' not found in thread '{thread_id}'."
    )
  return send_chat_message(
    paths,
    thread_id=thread_id,
    message=message,
    current_scene_id=current_scene_id,
    scene_ids=scene_ids,
    selected_text=selected_text,
    codex_ids=codex_ids,
    approved_codex_ids=approved_codex_ids,
    context_overrides=context_overrides,
    on_delta=on_delta,
    turn_id=replacement_id,
    channel="text",
    memory_approvals=memory_approvals,
    story_approvals=story_approvals,
    expected_context_fingerprint=expected_context_fingerprint,
    is_cancelled=is_cancelled,
    replace_from_message_id=from_message_id,
  )


@serialize_assistant_thread_mutation
def execute_pending_tool_call(
  paths: ProjectPaths,
  *,
  thread_id: str,
  assistant_message_id: str,
  tool_index: int,
) -> dict[str, Any]:
  key = hashlib.sha256(f"{assistant_message_id}:{tool_index}".encode()).hexdigest()
  receipt_path = _chat_delivery_folder(paths, thread_id) / "tools" / f"{key}.json"
  with project_write_lock(paths, resource=_chat_lock_resource(thread_id)), project_write_lock(paths):
    get_chat_thread(paths, thread_id)
    _recover_chat_deliveries(paths, thread_id)
    if receipt_path.exists():
      receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
      if receipt.get("status") == "executing":
        raise OpenAuthorError("This tool may already have changed the book before its result was saved. Review the book and Revisions before requesting another change; automatic replay is disabled.")
      return receipt["result"]
    pending: list[dict[str, Any]] = []
    token = _pending_messages.set(pending)
    try:
      result = _execute_pending_tool_call(
        paths, thread_id=thread_id, assistant_message_id=assistant_message_id, tool_index=tool_index,
        before_execute=lambda: atomic_write_json(receipt_path, {"status": "executing"}),
      )
      receipt = {"schema_version": 1, "result": result, "messages": pending, "published": False}
      atomic_write_json(receipt_path, receipt)
      _publish_chat_receipt(paths, thread_id, receipt_path, receipt)
      return result
    finally:
      _pending_messages.reset(token)


def _execute_pending_tool_call(
  paths: ProjectPaths,
  *,
  thread_id: str,
  assistant_message_id: str,
  tool_index: int,
  before_execute: Any = lambda: None,
) -> dict[str, Any]:
  if tool_index < 0:
    raise OpenAuthorError("tool_index must be >= 0.")
  messages = list_chat_messages(paths, thread_id=thread_id)
  assistant = next(
    (
      row
      for row in messages
      if row.get("id") == assistant_message_id and row.get("role") == "assistant"
    ),
    None,
  )
  if assistant is None:
    raise OpenAuthorError(
      f"Assistant message '{assistant_message_id}' not found in thread '{thread_id}'."
    )
  tool_calls = assistant.get("tool_calls", [])
  if not isinstance(tool_calls, list) or tool_index >= len(tool_calls):
    raise OpenAuthorError("tool_index is out of range for this assistant message.")
  tool_call = tool_calls[tool_index]
  if not isinstance(tool_call, dict):
    raise OpenAuthorError("Invalid tool call payload.")
  tool_name = str(tool_call.get("tool", "")).strip()
  args = tool_call.get("args", {})
  if tool_name == "" or not isinstance(args, dict):
    raise OpenAuthorError("Invalid tool call payload.")
  tool_call_id = str(tool_call.get("id", "")).strip()
  run_store = ToolRunStore(paths)
  tool_run, created = run_store.claim(
    thread_id=thread_id,
    assistant_message_id=assistant_message_id,
    tool_call_id=tool_call_id,
    tool_name=tool_name,
    args=args,
  )
  if not created:
    existing_tool_message = next(
      (
        row
        for row in messages
        if row.get("role") == "tool"
        and isinstance(row.get("context_used"), dict)
        and row["context_used"].get("tool_call_id") == tool_call_id
        and row["context_used"].get("from_message_id") == assistant_message_id
      ),
      None,
    )
    if existing_tool_message is not None:
      if tool_run.status != "completed":
        tool_run = run_store.complete(
          tool_run,
          tool_message_id=str(existing_tool_message.get("id", "")),
        )
      try:
        saved_payload = json.loads(str(existing_tool_message.get("content", "{}")))
      except json.JSONDecodeError:
        saved_payload = {}
      saved_result = saved_payload.get("result", {}) if isinstance(saved_payload, dict) else {}
      saved_context = existing_tool_message.get("context_used", {})
      saved_vcs = (
        saved_context.get("vcs", {}) if isinstance(saved_context, dict) else {}
      )
      return {
        "assistant_message_id": assistant_message_id,
        "tool_index": tool_index,
        "tool": tool_name,
        "result": saved_result,
        "tool_message": existing_tool_message,
        "vcs": saved_vcs,
        "replayed": True,
      }
    raise OpenAuthorError(
      f"Approved tool action is already {tool_run.status}; it will not be executed again."
    )

  tool_run = run_store.mark_running(tool_run)
  _, before_commit = _capture_vcs_anchor(paths)
  try:
    before_execute()
    result = _execute_tool(paths, tool_name, args)
  except BaseException as error:
    run_store.fail(tool_run, error)
    raise
  snapshot_note = ""
  if _tool_classification(tool_name) in {"write", "risky"}:
    try:
      snapshot_note = create_snapshot(paths, f"chat agent: {tool_name}")
    except OpenAuthorError as error:
      snapshot_note = f"Snapshot failed: {error}"
  after_branch, after_commit = _capture_vcs_anchor(paths)
  vcs = {
    "branch": after_branch,
    "before_commit": before_commit,
    "after_commit": after_commit,
    "changed": before_commit != after_commit,
    "snapshot": snapshot_note,
  }
  tool_message = _append_chat_message(
    paths,
    thread_id=thread_id,
    role="tool",
    content=json.dumps(
      {"tool": tool_name, "result": result},
      ensure_ascii=True,
    ),
    context_used={
      "from_message_id": assistant_message_id,
      "tool_call_id": tool_call_id,
      "vcs": vcs,
    },
    turn_id=str(assistant.get("turn_id", "")),
    channel=str(assistant.get("channel", "text")),
    turn_position=(
      int(assistant.get("turn_position", 0)) + 1
      if isinstance(assistant.get("turn_position"), int)
      else None
    ),
  )
  refreshed_messages = list_chat_messages(paths, thread_id=thread_id)
  refreshed_assistant = next(
    row for row in refreshed_messages if row.get("id") == assistant_message_id
  )
  refreshed_calls = refreshed_assistant.get("tool_calls", [])
  if isinstance(refreshed_calls, list) and tool_index < len(refreshed_calls):
    updated_call = refreshed_calls[tool_index]
    if isinstance(updated_call, dict) and updated_call.get("id") == tool_call_id:
      updated_call["executed"] = True
      updated_call["result_summary"] = _safe_summary(result)
      updated_call["error"] = ""
  atomic_write_text(
    _thread_messages_path(paths, thread_id),
    "".join(
      json.dumps(row, separators=(",", ":")) + "\n"
      for row in refreshed_messages
    ),
  )
  run_store.complete(tool_run, tool_message_id=str(tool_message["id"]))
  _touch_thread(paths, thread_id)
  return {
    "assistant_message_id": assistant_message_id,
    "tool_index": tool_index,
    "tool": tool_name,
    "result": result,
    "tool_message": tool_message,
    "vcs": vcs,
    "replayed": False,
  }


def get_chat_turn_diff(
  paths: ProjectPaths,
  *,
  thread_id: str,
  message_id: str,
) -> dict[str, Any]:
  """Diff authoring artifacts between a chat turn's VCS anchor and HEAD."""
  normalized_message_id = message_id.strip()
  if normalized_message_id == "":
    raise OpenAuthorError("message_id cannot be empty.")
  messages = list_chat_messages(paths, thread_id=thread_id)
  row = next(
    (item for item in messages if item.get("id") == normalized_message_id),
    None,
  )
  if row is None:
    raise OpenAuthorError(
      f"Message '{normalized_message_id}' not found in thread '{thread_id}'."
    )
  context_used = row.get("context_used", {})
  vcs = context_used.get("vcs", {}) if isinstance(context_used, dict) else {}
  base_commit = str(
    vcs.get("base_commit") or vcs.get("before_commit") or ""
  ).strip()
  if base_commit == "":
    raise OpenAuthorError(
      f"Message '{normalized_message_id}' has no VCS anchor to diff from."
    )
  diff = diff_branches(paths, base=base_commit, head="HEAD")
  return {
    "thread_id": thread_id,
    "message_id": normalized_message_id,
    **diff,
  }


def _safe_summary(value: Any) -> str:
  raw = json.dumps(value, ensure_ascii=True)
  if len(raw) <= 240:
    return raw
  return raw[:237] + "..."


def _touch_thread(paths: ProjectPaths, thread_id: str) -> None:
  rows = _load_threads(paths)
  for row in rows:
    if row.get("id") == thread_id:
      row["updated_at"] = utc_now()
      break
  _write_threads(paths, rows)
