from __future__ import annotations

import json
import hashlib
import uuid
from contextvars import ContextVar
from pathlib import Path
from typing import Any

from .ai import DEFAULT_MODELS, SUPPORTED_PROVIDERS, _estimate_tokens, complete_chat
from .checks import run_continuity_checks
from .codex import add_entity, get_entity, list_entities, update_entity
from .ai_visibility import current_privacy_history, memory_context_fingerprint, memory_for_ai
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
from .project_lock import project_write_lock
from .story_context import story_plan_for_ai
from .story_grounding import prepare_story_grounding, STORY_GROUNDING_INSTRUCTIONS

_pending_messages: ContextVar[list[dict[str, Any]] | None] = ContextVar("pending_chat_messages", default=None)

CHAT_MODES = {"chat", "agent"}
INCLUDE_CODEX_MODES = {"off", "explicit", "auto", "auto_and_explicit"}
RETRIEVAL_MODES = {"off", "auto", "required"}
MAX_TOOL_ROUNDS = 4


def _schema(properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
  return {"type": "object", "properties": properties, "required": required}


CHAT_TOOL_SPECS: list[dict[str, Any]] = [
  {
    "name": "scene.list",
    "description": "List all scenes with ids, titles, POV, and status.",
    "parameters": _schema({}, []),
  },
  {
    "name": "scene.get",
    "description": "Fetch one scene (frontmatter and body) by id.",
    "parameters": _schema(
      {"id": {"type": "string", "description": "Scene id, e.g. scene-0001."}},
      ["id"],
    ),
  },
  {
    "name": "codex.list",
    "description": "List codex entities (characters, places, items, lore).",
    "parameters": _schema({}, []),
  },
  {
    "name": "codex.get",
    "description": "Fetch one codex entity by id.",
    "parameters": _schema(
      {"id": {"type": "string", "description": "Codex entity id."}},
      ["id"],
    ),
  },
  {
    "name": "retrieval.query",
    "description": "Search the local manuscript/codex retrieval index; returns cited excerpts.",
    "parameters": _schema(
      {
        "text": {"type": "string", "description": "Search query."},
        "limit": {"type": "integer", "description": "Max results (default 5)."},
        "min_score": {"type": "number", "description": "Minimum relevance score."},
        "require_fresh": {"type": "boolean", "description": "Fail if the index is stale."},
      },
      ["text"],
    ),
  },
  {
    "name": "check.continuity",
    "description": "Run continuity checks across the whole project.",
    "parameters": _schema({}, []),
  },
  {
    "name": "branch.status",
    "description": "Show the git branch and workspace status of the project.",
    "parameters": _schema({}, []),
  },
  {
    "name": "proposal.add",
    "description": "Queue a manuscript edit proposal for the author to review (never edits directly).",
    "parameters": _schema(
      {
        "title": {"type": "string", "description": "Short proposal title."},
        "instruction": {"type": "string", "description": "Proposal body with Intent, Constraints, Edit Plan, Continuity Notes sections."},
        "scene_id": {"type": "string", "description": "Target scene id."},
      },
      ["title", "instruction", "scene_id"],
    ),
  },
  {
    "name": "proposal.generate",
    "description": "Generate a full AI proposal for a scene through the budgeted generation pipeline.",
    "parameters": _schema(
      {
        "scene_id": {"type": "string", "description": "Target scene id."},
        "instruction": {"type": "string", "description": "What the proposal should accomplish."},
        "title": {"type": "string", "description": "Optional proposal title."},
        "provider": {"type": "string", "description": "AI provider (defaults to local)."},
        "model": {"type": "string", "description": "Optional model override."},
        "retrieval_mode": {"type": "string", "description": "off, auto, or required."},
      },
      ["scene_id", "instruction"],
    ),
  },
  {
    "name": "codex.add",
    "description": "Add a codex entity.",
    "parameters": _schema(
      {
        "type": {"type": "string", "description": "Entity type (character, place, item, lore)."},
        "name": {"type": "string", "description": "Entity name."},
        "description": {"type": "string", "description": "Entity description."},
      },
      ["type", "name"],
    ),
  },
  {
    "name": "codex.update",
    "description": "Update fields on an existing codex entity.",
    "parameters": _schema(
      {
        "id": {"type": "string", "description": "Entity id."},
        "type": {"type": "string", "description": "New entity type."},
        "name": {"type": "string", "description": "New name."},
        "description": {"type": "string", "description": "New description."},
      },
      ["id"],
    ),
  },
  {
    "name": "snapshot.create",
    "description": "Create a git snapshot commit of the current authoring state.",
    "parameters": _schema(
      {"message": {"type": "string", "description": "Snapshot commit message."}},
      ["message"],
    ),
  },
  {
    "name": "branch.create",
    "description": "Create (and by default switch to) a new draft branch.",
    "parameters": _schema(
      {
        "name": {"type": "string", "description": "Branch name."},
        "from_ref": {"type": "string", "description": "Optional base ref."},
        "no_switch": {"type": "boolean", "description": "Create without switching."},
      },
      ["name"],
    ),
  },
  {
    "name": "branch.switch",
    "description": "Switch to an existing branch.",
    "parameters": _schema(
      {"name": {"type": "string", "description": "Branch name."}},
      ["name"],
    ),
  },
  {
    "name": "merge.preflight",
    "description": "Check whether a branch merge would apply cleanly.",
    "parameters": _schema(
      {
        "base": {"type": "string", "description": "Base branch."},
        "head": {"type": "string", "description": "Head branch."},
      },
      ["base", "head"],
    ),
  },
  {
    "name": "merge.apply",
    "description": "Merge one branch into another. Requires author approval.",
    "parameters": _schema(
      {
        "base": {"type": "string", "description": "Base branch."},
        "head": {"type": "string", "description": "Head branch."},
      },
      ["base", "head"],
    ),
  },
]

CHAT_TOOL_WIRE_NAMES = {
  spec["name"].replace(".", "_"): spec["name"] for spec in CHAT_TOOL_SPECS
}


def _chat_tool_specs() -> list[dict[str, Any]]:
  return [
    {
      "name": spec["name"].replace(".", "_"),
      "description": spec["description"],
      "parameters": spec["parameters"],
    }
    for spec in CHAT_TOOL_SPECS
  ]


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
  executed = {
    (str(row.get("context_used", {}).get("from_message_id", "")), str(row.get("context_used", {}).get("tool_call_id", ""))): row
    for row in rows if row.get("role") == "tool"
  }
  for row in rows:
    for call in row.get("tool_calls", []):
      result = executed.get((str(row.get("id", "")), str(call.get("id", ""))))
      if result:
        call["executed"] = True
        call["result_summary"] = str(result.get("content", ""))[:2000]
  if limit is not None:
    return rows[-limit:]
  return rows


def truncate_chat_messages(
  paths: ProjectPaths,
  *,
  thread_id: str,
  from_message_id: str,
) -> dict[str, Any]:
  with project_write_lock(paths, resource=_chat_lock_resource(thread_id)):
    _recover_chat_deliveries(paths, thread_id)
    return _truncate_chat_messages(paths, thread_id=thread_id, from_message_id=from_message_id)


def _truncate_chat_messages(paths: ProjectPaths, *, thread_id: str, from_message_id: str) -> dict[str, Any]:
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
  pending = _pending_messages.get()
  if pending is not None:
    pending.append(row)
    return row
  message_path = _thread_messages_path(paths, thread_id)
  message_path.parent.mkdir(parents=True, exist_ok=True)
  with message_path.open("a", encoding="utf-8") as handle:
    handle.write(json.dumps(row, separators=(",", ":")) + "\n")
  return row


def _history_entry(row: dict[str, Any]) -> dict[str, str] | None:
  role = str(row.get("role", ""))
  content = str(row.get("content", ""))
  if content.strip() == "":
    return None
  if role in {"user", "assistant"}:
    return {"role": role, "content": content}
  if role == "tool":
    clipped = content if len(content) <= 2000 else content[:1997] + "..."
    return {"role": "user", "content": f"Tool result:\n{clipped}"}
  return None


def _build_provider_history(
  rows: list[dict[str, Any]],
  *,
  token_budget: int,
) -> list[dict[str, str]]:
  if token_budget <= 0:
    return []
  selected: list[dict[str, str]] = []
  used_tokens = 0
  for row in reversed(rows):
    entry = _history_entry(row)
    if entry is None:
      continue
    entry_tokens = _estimate_tokens(entry["content"])
    if used_tokens + entry_tokens > token_budget:
      break
    selected.append(entry)
    used_tokens += entry_tokens
  selected.reverse()

  # Providers such as Anthropic require alternating roles starting with the
  # user, so merge consecutive same-role entries and drop a leading assistant.
  merged: list[dict[str, str]] = []
  for entry in selected:
    if merged and merged[-1]["role"] == entry["role"]:
      merged[-1] = {
        "role": entry["role"],
        "content": merged[-1]["content"] + "\n\n" + entry["content"],
      }
    else:
      merged.append(dict(entry))
  while merged and merged[0]["role"] == "assistant":
    merged.pop(0)
  return merged


def _resolve_nearby_scene_ids(
  paths: ProjectPaths,
  *,
  scene_id: str,
  radius: int,
) -> list[str]:
  rows = list_scenes(paths)
  ids = [str(row.get("id", "")).strip() for row in rows if str(row.get("id", "")).strip()]
  if scene_id not in ids:
    return []
  index = ids.index(scene_id)
  start = max(0, index - radius)
  end = min(len(ids), index + radius + 1)
  return ids[start:end]


def _resolve_context(
  paths: ProjectPaths,
  *,
  profile: dict[str, Any],
  message: str,
  current_scene_id: str,
  explicit_scene_ids: list[str],
  selected_text: str,
  explicit_codex_ids: list[str],
  memory_approvals: list[dict[str, str]] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
  include_current_scene = bool(profile.get("include_current_scene", True))
  include_selection = bool(profile.get("include_selection", True))
  radius = int(profile.get("include_recent_scenes_radius", 1))
  include_codex_mode = str(profile.get("include_codex", "off"))

  selected_scene_ids: list[str] = []
  selected_scene_rows: list[dict[str, Any]] = []
  normalized_scene_id = current_scene_id.strip()
  requested_scene_ids: list[str] = []
  if include_current_scene and normalized_scene_id:
    requested_scene_ids.append(normalized_scene_id)
  for item in explicit_scene_ids:
    scene_id = item.strip()
    if scene_id and scene_id not in requested_scene_ids:
      requested_scene_ids.append(scene_id)
  scene_inventory = list_scenes(paths)
  if profile.get("scope") == "project" and not requested_scene_ids:
    # Book scope stays bounded for novel-scale projects. Retrieval supplies
    # query-relevant passages when available; first/last scenes provide a
    # useful offline anchor when the index has not been built yet.
    anchor_ids = [
      str(scene_inventory[0].get("id", "")).strip() if scene_inventory else "",
      str(scene_inventory[-1].get("id", "")).strip() if scene_inventory else "",
    ]
    for scene_id in anchor_ids:
      if scene_id and scene_id not in requested_scene_ids:
        requested_scene_ids.append(scene_id)
  for scene_id in requested_scene_ids:
    scene = get_scene(paths, scene_id)
    selected_scene_ids.append(scene_id)
    selected_scene_rows.append(scene)

  nearby_scene_ids: list[str] = []
  nearby_scene_rows: list[dict[str, Any]] = []
  if normalized_scene_id and radius > 0:
    nearby_scene_ids = [
      item
      for item in _resolve_nearby_scene_ids(paths, scene_id=normalized_scene_id, radius=radius)
      if item != normalized_scene_id
    ]
    nearby_scene_rows = [get_scene(paths, item) for item in nearby_scene_ids]

  codex_rows = memory_for_ai(paths, memory_approvals)
  explicit_ids = {item.strip() for item in explicit_codex_ids if item.strip()}
  explicit_entity_ids: list[str] = []
  auto_entity_ids: list[str] = []
  context_text = " ".join(
    [
      message,
      selected_text if include_selection else "",
      " ".join(str(row.get("body", "")) for row in selected_scene_rows),
    ]
  ).lower()
  for entity in codex_rows:
    entity_id = str(entity.get("id", "")).strip()
    if entity_id == "":
      continue
    entity_name = str(entity.get("name", "")).strip().lower()
    if entity_id in explicit_ids:
      explicit_entity_ids.append(entity_id)
      continue
    if include_codex_mode in {"auto", "auto_and_explicit"} and entity_name and entity_name in context_text:
      auto_entity_ids.append(entity_id)

  included_entity_ids: list[str] = []
  if include_codex_mode == "off":
    included_entity_ids = []
  elif include_codex_mode == "explicit":
    included_entity_ids = explicit_entity_ids
  elif include_codex_mode == "auto":
    included_entity_ids = auto_entity_ids
  else:
    seen: set[str] = set()
    for entity_id in [*explicit_entity_ids, *auto_entity_ids]:
      if entity_id in seen:
        continue
      seen.add(entity_id)
      included_entity_ids.append(entity_id)

  included_codex = [
    entity
    for entity in codex_rows
    if str(entity.get("id", "")).strip() in set(included_entity_ids)
  ]
  # An author-selected one-turn permission also explicitly selects that entry,
  # even if automatic matching or the thread's Memory preference is disabled.
  for entity in codex_rows:
    if any(grant["entity_id"] == entity["id"] for grant in memory_approvals or []) and entity["id"] not in included_entity_ids:
      included_entity_ids.append(entity["id"])
      included_codex.append(entity)

  retrieval_mode = str(profile.get("retrieval_mode", "off"))
  retrieval_payload: dict[str, Any] = {
    "mode": retrieval_mode,
    "used": False,
    "result_count": 0,
    "citations": [],
    "error": "",
    "degraded": False,
  }
  if retrieval_mode != "off":
    query_text = " ".join(
      part
      for part in [
        message.strip(),
        selected_text.strip() if include_selection else "",
        normalized_scene_id,
      ]
      if part
    )
    try:
      retrieval_result = query_retrieval_index(
        paths,
        query=query_text,
        limit=int(profile.get("retrieval_limit", 5)),
        min_score=float(profile.get("retrieval_min_score", 0.0)),
        require_fresh=bool(profile.get("retrieval_require_fresh", False)),
      )
      citations = [
        {
          "source_type": row.get("source_type", ""),
          "source_ref": row.get("source_ref", ""),
          "source_path": row.get("source_path", ""),
          "source_title": row.get("source_title", ""),
          "chunk_id": row.get("chunk_id", ""),
          "score": row.get("score"),
          "excerpt": _clip_tool_result(str(row.get("text", "")), 240),
        }
        for row in retrieval_result.get("results", [])
        if isinstance(row, dict)
      ]
      retrieval_payload = {
        "mode": retrieval_mode,
        "used": len(citations) > 0,
        "result_count": retrieval_result.get("result_count", 0),
        "citations": citations,
        "index": retrieval_result.get("index", {}),
        "degraded": False,
        "error": "",
      }
    except OpenAuthorError as error:
      if retrieval_mode == "required":
        raise
      retrieval_payload["degraded"] = True
      retrieval_payload["error"] = str(error)

  context_for_prompt = {
    "story_plan": story_plan_for_ai(paths, selected_scene_ids, book_scope=profile.get("scope") == "project"),
    "current_scene": selected_scene_rows,
    "nearby_scenes": nearby_scene_rows,
    "selected_text": selected_text if include_selection else "",
    "codex_entities": included_codex,
    "continuity_issues": run_continuity_checks(paths),
    "retrieval": retrieval_payload,
    "book_scene_index": [
      {
        "id": row.get("id", ""),
        "title": row.get("title", ""),
        "summary": row.get("summary", ""),
        "pov": row.get("pov", ""),
        "status": row.get("status", ""),
      }
      for row in scene_inventory[:40]
    ] if profile.get("scope") == "project" else [],
    "book_scene_count": len(scene_inventory) if profile.get("scope") == "project" else 0,
  }
  context_used = {
    "scene_ids": selected_scene_ids,
    "nearby_scene_ids": nearby_scene_ids,
    "codex_entity_ids": included_entity_ids,
    "retrieval": retrieval_payload,
    "profile": profile,
  }
  return context_for_prompt, context_used


def _tool_classification(tool_name: str) -> str:
  read_only_tools = {
    "scene.list",
    "scene.get",
    "codex.list",
    "codex.get",
    "retrieval.query",
    "check.continuity",
    "branch.status",
  }
  risky_tools = {"merge.apply"}
  if tool_name in read_only_tools:
    return "read"
  if tool_name in risky_tools:
    return "risky"
  return "write"


def _execute_tool(
  paths: ProjectPaths, tool_name: str, args: dict[str, Any],
  *, memory_approvals: list[dict[str, str]] | None = None,
) -> Any:
  if tool_name == "scene.list":
    return list_scenes(paths)
  if tool_name == "scene.get":
    return get_scene(paths, str(args.get("id", "")).strip())
  if tool_name == "codex.list":
    return memory_for_ai(paths, memory_approvals)
  if tool_name == "codex.get":
    entity_id = str(args.get("id", "")).strip()
    entity = next((row for row in memory_for_ai(paths, memory_approvals) if row["id"] == entity_id), None)
    if entity is None:
      raise OpenAuthorError("Story Memory entry is unavailable to the Assistant. Ask the author to review its access settings.")
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
    return get_entity(paths, entity_id)
  if tool_name == "codex.update":
    return update_entity(
      paths,
      entity_id=str(args.get("id", "")).strip(),
      kind=(str(args.get("type", "")).strip() or None),
      name=(str(args.get("name", "")).strip() or None),
      description=(str(args.get("description", "")) if "description" in args else None),
    )
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


def _chat_lock_resource(thread_id: str) -> str:
  return "chat-" + hashlib.sha256(thread_id.encode()).hexdigest()


def _chat_delivery_folder(paths: ProjectPaths, thread_id: str) -> Path:
  return paths.chats_dir / "deliveries" / hashlib.sha256(thread_id.encode()).hexdigest()


def _recover_chat_deliveries(paths: ProjectPaths, thread_id: str) -> None:
  folder = _chat_delivery_folder(paths, thread_id)
  for stored in sorted([*folder.glob("*.json"), *(folder / "tools").glob("*.json")]):
    receipt = json.loads(stored.read_text(encoding="utf-8"))
    if receipt.get("status") != "executing":
      _publish_chat_receipt(paths, thread_id, stored, receipt)


def _publish_chat_receipt(paths: ProjectPaths, thread_id: str, receipt_path: Path, receipt: dict[str, Any]) -> None:
  if receipt.get("published"):
    return
  messages = list_chat_messages(paths, thread_id=thread_id)
  known = {row["id"] for row in messages}
  messages.extend(row for row in receipt["messages"] if row["id"] not in known)
  atomic_write_text(_thread_messages_path(paths, thread_id), "".join(json.dumps(row, separators=(",", ":")) + "\n" for row in messages))
  receipt["published"] = True
  atomic_write_json(receipt_path, receipt)


def send_chat_message(paths: ProjectPaths, *, request_id: str = "", is_cancelled: Any = None, **kwargs: Any) -> dict[str, Any]:
  """Publish a turn once, even when its response is lost and delivery is retried.

  Failed/cancelled keyed turns never publish partial messages or pending tools.
  A durable completed receipt precedes transcript publication, closing the
  process-exit window between provider completion and response delivery.
  """
  request_id = request_id or uuid.uuid4().hex
  thread_id = str(kwargs["thread_id"])
  get_chat_thread(paths, thread_id)
  fingerprint = hashlib.sha256(json.dumps({key: value for key, value in kwargs.items() if key != "on_delta"}, sort_keys=True).encode()).hexdigest()
  key = hashlib.sha256(f"{thread_id}:{request_id}".encode()).hexdigest()
  folder = _chat_delivery_folder(paths, thread_id)
  receipt_path = folder / f"{key}.json"
  with project_write_lock(paths, resource=_chat_lock_resource(thread_id)):
    # Repair completed deliveries before accepting another turn in this chat.
    _recover_chat_deliveries(paths, thread_id)
    if receipt_path.exists():
      receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
      if receipt["fingerprint"] != fingerprint:
        raise OpenAuthorError("A chat request id cannot be reused for different content.")
      return receipt["result"]
    pending: list[dict[str, Any]] = []
    token = _pending_messages.set(pending)
    try:
      result = _send_chat_message(paths, is_cancelled=is_cancelled, **kwargs)
      if is_cancelled and is_cancelled():
        from .ai import ChatInterrupted
        raise ChatInterrupted("Chat turn interrupted by user.")
      receipt = {"schema_version": 1, "fingerprint": fingerprint, "result": result, "messages": pending, "published": False}
      atomic_write_json(receipt_path, receipt)
      _publish_chat_receipt(paths, thread_id, receipt_path, receipt)
      return result
    finally:
      _pending_messages.reset(token)


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

  fingerprint = memory_context_fingerprint(paths, memory_approvals)
  prompt_context, context_used = _resolve_context(
    paths,
    profile=profile,
    message=content,
    current_scene_id=current_scene_id,
    explicit_scene_ids=scene_ids or [],
    selected_text=selected_text,
    explicit_codex_ids=codex_ids or [],
    memory_approvals=memory_approvals,
  )
  story_scene_ids = [current_scene_id] if current_scene_id else context_used["scene_ids"]
  grounding = prepare_story_grounding(paths, story_scene_ids, memory_approvals=memory_approvals, story_approvals=story_approvals)
  prompt_context["story_memory"] = grounding["context"]
  context_used["story_scene_ids"] = story_scene_ids
  transcript = list_chat_messages(paths, thread_id=thread_id)
  if history_before_message_id:
    boundary = next((index for index, row in enumerate(transcript) if row["id"] == history_before_message_id), None)
    if boundary is None:
      raise OpenAuthorError("The message being edited is no longer present. Review the conversation again.")
    transcript = transcript[:boundary]
  eligible_history = current_privacy_history(transcript, fingerprint)
  context_used["privacy"] = {
    "fingerprint": fingerprint,
    "history_reset": len(eligible_history) != len(transcript),
    "history_messages_omitted": len(transcript) - len(eligible_history),
    "one_time_approval": bool(memory_approvals or story_approvals),
  }
  history = _build_provider_history(
    eligible_history,
    token_budget=int(profile.get("history_token_budget", 4000)),
  )

  agent_mode = thread.get("mode") == "agent"
  system_prompt = (
    "You are openAuthor's fiction assistant. Stay grounded in provided context, "
    "be explicit about assumptions, and avoid direct manuscript mutation language."
    + " " + STORY_GROUNDING_INSTRUCTIONS
  )
  if agent_mode:
    system_prompt = system_prompt + (
      "\n\nUse the available tools to read project state and to queue changes. "
      "Write and merge tools are not executed immediately: they are held for "
      "the author's approval, so say so when you use one."
    )
  user_prompt = (
    "User message:\n"
    f"{content}\n\n"
    "Context JSON:\n"
    f"{json.dumps(prompt_context, indent=2)}\n"
  )
  provider = str(thread.get("provider", "local"))
  model = str(thread.get("model", "")).strip() or DEFAULT_MODELS[provider]
  payload = {
    "system_prompt": system_prompt, "user_prompt": user_prompt, "history": history,
    "context": prompt_context, "context_used": context_used, "provider": provider, "model": model,
    "mode": thread.get("mode", "chat"),
  }
  payload["fingerprint"] = hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()
  payload["story_choices"] = grounding["choices"]
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


def _send_chat_message(
  paths: ProjectPaths,
  *,
  thread_id: str,
  message: str,
  current_scene_id: str = "",
  scene_ids: list[str] | None = None,
  selected_text: str = "",
  codex_ids: list[str] | None = None,
  context_overrides: dict[str, Any] | None = None,
  on_delta: Any = None,
  is_cancelled: Any = None,
  memory_approvals: list[dict[str, str]] | None = None,
  story_approvals: list[str] | None = None,
  expected_context_fingerprint: str = "",
) -> dict[str, Any]:
  prepared = preview_chat_context(
    paths, thread_id=thread_id, message=message, current_scene_id=current_scene_id,
    scene_ids=scene_ids, selected_text=selected_text, codex_ids=codex_ids,
    context_overrides=context_overrides, memory_approvals=memory_approvals, story_approvals=story_approvals,
  )
  if expected_context_fingerprint and expected_context_fingerprint != prepared["fingerprint"]:
    raise OpenAuthorError("Context changed since the preview. Review context again before sending.")
  content = message.strip()
  context_used = prepared["context_used"]
  profile = context_used["profile"]
  fingerprint = context_used["privacy"]["fingerprint"]
  history = prepared["history"]
  system_prompt, user_prompt = prepared["system_prompt"], prepared["user_prompt"]
  provider, model = prepared["provider"], prepared["model"]
  agent_mode = prepared["mode"] == "agent"
  user_message = _append_chat_message(paths, thread_id=thread_id, role="user", content=content, context_used=context_used)
  tools = _chat_tool_specs() if agent_mode else None
  agent_auto_read_only = bool(profile.get("agent_auto_read_only", True))
  turn_branch, turn_base_commit = _capture_vcs_anchor(paths)
  turn_vcs = {"branch": turn_branch, "base_commit": turn_base_commit}

  conversation: list[dict[str, Any]] = list(history)
  round_prompt = user_prompt
  assistant_message: dict[str, Any] = {}
  executed_tool_messages: list[dict[str, Any]] = []
  pending_tool_calls: list[dict[str, Any]] = []

  for _ in range(MAX_TOOL_ROUNDS):
    if memory_context_fingerprint(paths, memory_approvals) != fingerprint:
      raise OpenAuthorError("Story Memory access or content changed during this turn. Please send again with fresh context.")
    if prepare_story_grounding(paths, context_used["story_scene_ids"], memory_approvals=memory_approvals, story_approvals=story_approvals)["context"] != prepared["context"]["story_memory"]:
      raise OpenAuthorError("Canon or relationship context changed during this turn. Review fresh context before continuing.")
    if is_cancelled and is_cancelled():
      from .ai import ChatInterrupted
      raise ChatInterrupted("Chat turn interrupted by user.")
    completion = complete_chat(
      paths,
      provider=provider,
      model=model,
      system_prompt=system_prompt,
      user_prompt=round_prompt,
      history=list(conversation),
      temperature=0.2,
      max_output_tokens=900,
      chat_mode=True,
      thread_id=thread_id,
      on_delta=on_delta,
      tools=tools,
    )
    if is_cancelled and is_cancelled():
      from .ai import ChatInterrupted
      raise ChatInterrupted("Chat turn interrupted by user.")
    if round_prompt:
      conversation.append({"role": "user", "content": round_prompt})
      round_prompt = ""
    assistant_text = str(completion.get("text", ""))
    wire_tool_calls = completion.get("tool_calls", []) if agent_mode else []

    recorded_tool_calls: list[dict[str, Any]] = []
    round_pending: list[dict[str, Any]] = []
    tool_result_entries: list[dict[str, Any]] = []
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
          result = _execute_tool(paths, internal_name, args, memory_approvals=memory_approvals)
          tool_row["executed"] = True
          tool_row["result_summary"] = _safe_summary(result)
          result_json = json.dumps(
            {"tool": internal_name, "result": result},
            ensure_ascii=True,
          )
          tool_message = _append_chat_message(
            paths,
            thread_id=thread_id,
            role="tool",
            content=result_json,
            context_used={"tool_call_id": call["id"], "tool": internal_name, "privacy": context_used["privacy"]},
          )
          executed_tool_messages.append(tool_message)
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
    )
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

  _touch_thread(paths, thread_id)
  return {
    "thread": get_chat_thread(paths, thread_id),
    "user_message": user_message,
    "assistant_message": assistant_message,
    "tool_messages": executed_tool_messages,
    "pending_tool_calls": pending_tool_calls,
  }


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
  paths: ProjectPaths, *, thread_id: str, assistant_message_id: str, tool_index: int, before_execute: Any,
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
  # Older books have tool result messages but no delivery receipts.
  for message in messages:
    context = message.get("context_used", {})
    if (message.get("role") == "tool" and context.get("from_message_id") == assistant_message_id
        and context.get("tool_call_id") == tool_call.get("id")):
      saved = json.loads(message["content"])
      return {
        "assistant_message_id": assistant_message_id, "tool_index": tool_index,
        "tool": tool_name, "result": saved["result"], "tool_message": message,
        "vcs": context.get("vcs", {}),
      }
  _, before_commit = _capture_vcs_anchor(paths)
  before_execute()
  result = _execute_tool(paths, tool_name, args)
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
      "tool_call_id": str(tool_call.get("id", "")),
      "vcs": vcs,
    },
  )
  _touch_thread(paths, thread_id)
  return {
    "assistant_message_id": assistant_message_id,
    "tool_index": tool_index,
    "tool": tool_name,
    "result": result,
    "tool_message": tool_message,
    "vcs": vcs,
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
