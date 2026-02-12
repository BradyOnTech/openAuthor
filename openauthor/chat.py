from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from typing import Any

from .ai import DEFAULT_MODELS, SUPPORTED_PROVIDERS, complete_chat
from .checks import run_continuity_checks
from .codex import add_entity, get_entity, list_entities, update_entity
from .git_ops import (
  create_branch,
  create_snapshot,
  current_branch,
  get_branch_workspace_status,
  merge_branches,
  preflight_merge,
  run_git,
  switch_branch,
)
from .project import OpenAuthorError, ProjectPaths, utc_now
from .proposals import create_proposal
from .retrieval import query_retrieval_index
from .scenes import get_scene, list_scenes

CHAT_MODES = {"chat", "agent"}
INCLUDE_CODEX_MODES = {"off", "explicit", "auto", "auto_and_explicit"}
RETRIEVAL_MODES = {"off", "auto", "required"}
CHAT_TOOL_BLOCK_START = "[[OA_TOOL_CALLS_BEGIN]]"
CHAT_TOOL_BLOCK_END = "[[OA_TOOL_CALLS_END]]"


def _thread_messages_path(paths: ProjectPaths, thread_id: str) -> Path:
  return paths.chat_threads_dir / f"{thread_id}.jsonl"


def _default_context_profile() -> dict[str, Any]:
  return {
    "include_current_scene": True,
    "include_selection": True,
    "include_recent_scenes_radius": 1,
    "include_codex": "auto_and_explicit",
    "retrieval_mode": "off",
    "retrieval_limit": 5,
    "retrieval_min_score": 0.0,
    "retrieval_require_fresh": False,
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
  paths.chat_threads_index_file.write_text(
    json.dumps(normalized, indent=2) + "\n",
    encoding="utf-8",
  )


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
  message_path = _thread_messages_path(paths, thread_id)
  message_path.parent.mkdir(parents=True, exist_ok=True)
  with message_path.open("a", encoding="utf-8") as handle:
    handle.write(json.dumps(row, separators=(",", ":")) + "\n")
  return row


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
  thread: dict[str, Any],
  message: str,
  current_scene_id: str,
  selected_text: str,
  explicit_codex_ids: list[str],
  context_overrides: dict[str, Any] | None,
) -> tuple[dict[str, Any], dict[str, Any]]:
  profile = _normalize_context_profile(
    (
      {
        **(thread.get("context_profile", {}) if isinstance(thread.get("context_profile", {}), dict) else {}),
        **(context_overrides if isinstance(context_overrides, dict) else {}),
      }
      if context_overrides is not None
      else thread.get("context_profile", {})
    )
  )
  include_current_scene = bool(profile.get("include_current_scene", True))
  include_selection = bool(profile.get("include_selection", True))
  radius = int(profile.get("include_recent_scenes_radius", 1))
  include_codex_mode = str(profile.get("include_codex", "off"))

  selected_scene_ids: list[str] = []
  selected_scene_rows: list[dict[str, Any]] = []
  normalized_scene_id = current_scene_id.strip()
  if include_current_scene and normalized_scene_id:
    scene = get_scene(paths, normalized_scene_id)
    selected_scene_ids.append(normalized_scene_id)
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

  codex_rows = list_entities(paths)
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
      retrieval_payload = {
        "mode": retrieval_mode,
        "used": len(retrieval_result.get("results", [])) > 0,
        "result_count": retrieval_result.get("result_count", 0),
        "citations": retrieval_result.get("results", []),
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
    "current_scene": selected_scene_rows,
    "nearby_scenes": nearby_scene_rows,
    "selected_text": selected_text if include_selection else "",
    "codex_entities": included_codex,
    "continuity_issues": run_continuity_checks(paths),
    "retrieval": retrieval_payload,
  }
  context_used = {
    "scene_ids": selected_scene_ids,
    "nearby_scene_ids": nearby_scene_ids,
    "codex_entity_ids": included_entity_ids,
    "retrieval": retrieval_payload,
    "profile": profile,
  }
  return context_for_prompt, context_used


def _tool_call_template() -> str:
  return (
    "Agent mode tool protocol:\n"
    f"If tools are needed, append exactly one block:\n"
    f"{CHAT_TOOL_BLOCK_START}\n"
    '[{"tool":"scene.list","args":{}}]\n'
    f"{CHAT_TOOL_BLOCK_END}\n"
    "Supported tools: scene.list, scene.get, codex.list, codex.get, retrieval.query, "
    "check.continuity, branch.status, proposal.add, proposal.generate, codex.add, "
    "codex.update, snapshot.create, branch.create, branch.switch, merge.preflight, merge.apply.\n"
    "Return normal chat text outside the tool block."
  )


def _parse_tool_calls(text: str) -> tuple[str, list[dict[str, Any]]]:
  pattern = re.compile(
    rf"{re.escape(CHAT_TOOL_BLOCK_START)}\s*(.*?)\s*{re.escape(CHAT_TOOL_BLOCK_END)}",
    flags=re.DOTALL,
  )
  match = pattern.search(text)
  if match is None:
    return text.strip(), []
  json_block = match.group(1).strip()
  if json_block == "":
    return text.strip(), []
  try:
    payload = json.loads(json_block)
  except json.JSONDecodeError:
    return text.strip(), []
  if not isinstance(payload, list):
    return text.strip(), []
  rows: list[dict[str, Any]] = []
  for item in payload:
    if not isinstance(item, dict):
      continue
    tool = str(item.get("tool", "")).strip()
    args = item.get("args", {})
    if tool == "" or not isinstance(args, dict):
      continue
    rows.append({"tool": tool, "args": args})
  clean_text = (text[: match.start()] + text[match.end() :]).strip()
  return clean_text, rows


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


def _execute_tool(paths: ProjectPaths, tool_name: str, args: dict[str, Any]) -> Any:
  if tool_name == "scene.list":
    return list_scenes(paths)
  if tool_name == "scene.get":
    return get_scene(paths, str(args.get("id", "")).strip())
  if tool_name == "codex.list":
    return list_entities(paths)
  if tool_name == "codex.get":
    return get_entity(paths, str(args.get("id", "")).strip())
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


def send_chat_message(
  paths: ProjectPaths,
  *,
  thread_id: str,
  message: str,
  current_scene_id: str = "",
  selected_text: str = "",
  codex_ids: list[str] | None = None,
  context_overrides: dict[str, Any] | None = None,
) -> dict[str, Any]:
  thread = get_chat_thread(paths, thread_id)
  content = message.strip()
  if content == "":
    raise OpenAuthorError("message cannot be empty.")

  prompt_context, context_used = _resolve_context(
    paths,
    thread=thread,
    message=content,
    current_scene_id=current_scene_id,
    selected_text=selected_text,
    explicit_codex_ids=codex_ids or [],
    context_overrides=context_overrides,
  )

  user_message = _append_chat_message(
    paths,
    thread_id=thread_id,
    role="user",
    content=content,
    context_used=context_used,
  )
  system_prompt = (
    "You are openAuthor's fiction assistant. Stay grounded in provided context, "
    "be explicit about assumptions, and avoid direct manuscript mutation language."
  )
  if thread.get("mode") == "agent":
    system_prompt = system_prompt + "\n\n" + _tool_call_template()
  user_prompt = (
    "User message:\n"
    f"{content}\n\n"
    "Context JSON:\n"
    f"{json.dumps(prompt_context, indent=2)}\n"
  )
  provider = str(thread.get("provider", "local"))
  model = str(thread.get("model", "")).strip() or DEFAULT_MODELS[provider]
  completion = complete_chat(
    paths,
    provider=provider,
    model=model,
    system_prompt=system_prompt,
    user_prompt=user_prompt,
    temperature=0.2,
    max_output_tokens=900,
    chat_mode=thread.get("mode") == "agent",
  )
  assistant_text = completion.get("text", "")
  clean_text, raw_tool_calls = _parse_tool_calls(assistant_text)
  profile = _normalize_context_profile(
    (
      {
        **(thread.get("context_profile", {}) if isinstance(thread.get("context_profile", {}), dict) else {}),
        **(context_overrides if isinstance(context_overrides, dict) else {}),
      }
      if context_overrides is not None
      else thread.get("context_profile", {})
    )
  )
  agent_auto_read_only = bool(profile.get("agent_auto_read_only", True))
  pending_tool_calls: list[dict[str, Any]] = []
  recorded_tool_calls: list[dict[str, Any]] = []
  executed_tool_messages: list[dict[str, Any]] = []

  for row in raw_tool_calls:
    tool_name = str(row.get("tool", "")).strip()
    args = row.get("args", {})
    if tool_name == "" or not isinstance(args, dict):
      continue
    classification = _tool_classification(tool_name)
    tool_row: dict[str, Any] = {
      "tool": tool_name,
      "args": args,
      "classification": classification,
      "executed": False,
      "result_summary": "",
      "error": "",
    }
    if classification == "read" and agent_auto_read_only:
      try:
        result = _execute_tool(paths, tool_name, args)
        tool_row["executed"] = True
        tool_row["result_summary"] = _safe_summary(result)
        tool_message = _append_chat_message(
          paths,
          thread_id=thread_id,
          role="tool",
          content=json.dumps(
            {"tool": tool_name, "result": result},
            ensure_ascii=True,
          ),
          context_used=context_used,
        )
        executed_tool_messages.append(tool_message)
      except OpenAuthorError as error:
        tool_row["error"] = str(error)
    else:
      pending_tool_calls.append(tool_row)
    recorded_tool_calls.append(tool_row)

  assistant_message = _append_chat_message(
    paths,
    thread_id=thread_id,
    role="assistant",
    content=clean_text if clean_text else assistant_text,
    context_used=context_used,
    tool_calls=recorded_tool_calls,
    usage={
      "input_tokens": completion.get("input_tokens"),
      "output_tokens": completion.get("output_tokens"),
      "latency_ms": completion.get("latency_ms"),
      "provider_attempts": completion.get("provider_attempts"),
      "estimated_cost_usd": completion.get("estimated_cost_usd"),
      "provider": provider,
      "model": model,
    },
  )

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
  result = _execute_tool(paths, tool_name, args)
  tool_message = _append_chat_message(
    paths,
    thread_id=thread_id,
    role="tool",
    content=json.dumps(
      {"tool": tool_name, "result": result},
      ensure_ascii=True,
    ),
    context_used={"from_message_id": assistant_message_id},
  )
  _touch_thread(paths, thread_id)
  return {
    "assistant_message_id": assistant_message_id,
    "tool_index": tool_index,
    "tool": tool_name,
    "result": result,
    "tool_message": tool_message,
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
