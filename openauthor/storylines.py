from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from typing import Any

from .git_ops import (
  create_branch,
  create_snapshot,
  current_branch,
  diff_branches,
  initialize_git,
  list_branches,
  run_git,
  show_file_at_ref,
  switch_branch,
)
from .project import OpenAuthorError, ProjectPaths, atomic_write_json, utc_now
from .project_locks import serialized_project_access
from .proposals import create_proposal, get_proposal, set_proposal_draft
from .revisions import revision_head
from .scenes import get_scene, split_scene_text

STORYLINE_SCHEMA_VERSION = 1


def _store_path(paths: ProjectPaths) -> Path:
  return paths.workspace_dir / "storylines.json"


def _read_store(paths: ProjectPaths) -> dict[str, Any]:
  path = _store_path(paths)
  if not path.exists():
    return {"schema_version": STORYLINE_SCHEMA_VERSION, "primary_branch": "", "storylines": []}
  try:
    payload = json.loads(path.read_text(encoding="utf-8"))
  except (OSError, json.JSONDecodeError) as error:
    raise OpenAuthorError(f"Storyline metadata is unreadable: {error}") from error
  if payload.get("schema_version") != STORYLINE_SCHEMA_VERSION:
    raise OpenAuthorError("Unsupported Storyline schema version.")
  return payload


def _write_store(paths: ProjectPaths, payload: dict[str, Any]) -> None:
  atomic_write_json(_store_path(paths), payload)


def _slug(value: str) -> str:
  return re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-") or "experiment"


def _ensure_storyline_repo(paths: ProjectPaths) -> tuple[dict[str, Any], str]:
  initialize_git(paths)
  try:
    create_snapshot(paths, "Establish trusted book state for Storylines")
  except OpenAuthorError as error:
    if "nothing to commit" not in str(error).lower():
      raise
  branch = current_branch(paths)
  if branch == "HEAD":
    raise OpenAuthorError("Storylines require a named primary line of development.")
  store = _read_store(paths)
  if not store.get("primary_branch"):
    store["primary_branch"] = branch
    _write_store(paths, store)
  return store, branch


@serialized_project_access
def create_storyline(
  paths: ProjectPaths,
  *,
  name: str,
  hypothesis: str,
  intended_scope: str = "",
  success_criteria: str = "",
  protected_constraints: list[str] | None = None,
  switch: bool = True,
) -> dict[str, Any]:
  if not name.strip() or not hypothesis.strip():
    raise OpenAuthorError("Storyline name and experiment hypothesis are required.")
  store, source_branch = _ensure_storyline_repo(paths)
  branch_name = f"storyline/{_slug(name)}-{uuid.uuid4().hex[:6]}"
  create_branch(paths, name=branch_name, from_ref=source_branch, switch=switch)
  now = utc_now()
  row = {
    "id": f"storyline-{uuid.uuid4().hex[:12]}",
    "name": name.strip(),
    "branch": branch_name,
    "status": "active",
    "source_branch": source_branch,
    "base_revision": revision_head(paths),
    "experiment_brief": {
      "hypothesis": hypothesis.strip(),
      "protected_constraints": [value.strip() for value in protected_constraints or [] if value.strip()],
      "intended_scope": intended_scope.strip(),
      "success_criteria": success_criteria.strip(),
    },
    "created_at": now,
    "updated_at": now,
    "last_activity_at": now,
  }
  store["storylines"].append(row)
  _write_store(paths, store)
  from .product_signals import record_product_event
  record_product_event(paths, "storyline_created")
  return row


@serialized_project_access
def active_storyline_context(paths: ProjectPaths) -> dict[str, Any]:
  """The active experiment's author intent, without diffing other Storylines."""
  store = _read_store(paths)
  if not store["storylines"]:
    return {}
  branch = current_branch(paths)
  active = next((row for row in store["storylines"] if row["branch"] == branch), None)
  if active is None:
    return {}
  brief = active.get("experiment_brief", {})
  return {
    "id": active["id"], "name": active["name"], "branch": branch,
    "experiment_brief": {key: brief.get(key, [] if key == "protected_constraints" else "")
                         for key in ("hypothesis", "protected_constraints", "intended_scope", "success_criteria")},
  }


@serialized_project_access
def list_storylines(paths: ProjectPaths) -> dict[str, Any]:
  store = _read_store(paths)
  branch_rows = []
  current = ""
  try:
    branch_rows = list_branches(paths)
    current = next((row["name"] for row in branch_rows if row["current"]), "")
  except OpenAuthorError:
    pass
  known = {row["name"] for row in branch_rows}
  rows = []
  for storyline in store["storylines"]:
    row = dict(storyline)
    row["current"] = row["branch"] == current
    row["branch_available"] = row["branch"] in known
    if row["branch"] in known and store.get("primary_branch") in known:
      try:
        comparison = diff_branches(paths, base=store["primary_branch"], head=row["branch"])
        row["divergence"] = {
          "ahead_by": comparison["ahead_by"],
          "behind_by": comparison["behind_by"],
          "changed_files": len(comparison["files"]),
          "changed_scenes": sum(item["path"].startswith("manuscript/scenes/") for item in comparison["files"]),
        }
      except OpenAuthorError:
        row["divergence"] = {"ahead_by": 0, "behind_by": 0, "changed_files": 0, "changed_scenes": 0}
    rows.append(row)
  return {"primary_branch": store.get("primary_branch", ""), "current_branch": current, "storylines": rows}


@serialized_project_access
def switch_storyline(paths: ProjectPaths, storyline_id: str | None = None, *, primary: bool = False) -> dict[str, Any]:
  store = _read_store(paths)
  current = current_branch(paths)
  active_storyline = next((row for row in store["storylines"] if row["branch"] == current), None)
  if active_storyline is not None:
    create_snapshot(paths, f"Save Storyline progress: {active_storyline['name']}")
    active_storyline["last_activity_at"] = utc_now()
    active_storyline["updated_at"] = utc_now()
    _write_store(paths, store)
  if primary:
    branch = store.get("primary_branch", "")
  else:
    storyline = next((row for row in store["storylines"] if row["id"] == storyline_id), None)
    if storyline is None:
      raise OpenAuthorError(f"Unknown Storyline '{storyline_id}'.")
    branch = storyline["branch"]
    storyline["last_activity_at"] = utc_now()
    storyline["updated_at"] = utc_now()
    _write_store(paths, store)
  if not branch:
    raise OpenAuthorError("Primary Storyline is not initialized.")
  result = switch_branch(paths, name=branch)
  return {"branch": result["name"], "current": result["current"], "primary": primary}


@serialized_project_access
def compare_storyline(paths: ProjectPaths, storyline_id: str) -> dict[str, Any]:
  store = _read_store(paths)
  storyline = next((row for row in store["storylines"] if row["id"] == storyline_id), None)
  if storyline is None:
    raise OpenAuthorError(f"Unknown Storyline '{storyline_id}'.")
  if current_branch(paths) == storyline["branch"]:
    create_snapshot(paths, f"Compare Storyline: {storyline['name']}")
    storyline["last_activity_at"] = utc_now()
    storyline["updated_at"] = utc_now()
    _write_store(paths, store)
  primary = store.get("primary_branch", "")
  raw = diff_branches(paths, base=primary, head=storyline["branch"])
  scenes: list[dict[str, Any]] = []
  categories: dict[str, int] = {"scenes": 0, "plan": 0, "story_memory": 0, "settings": 0}
  for file in raw["files"]:
    path = file["path"]
    if path.startswith("manuscript/scenes/"):
      categories["scenes"] += 1
      before = show_file_at_ref(paths, primary, path) or ""
      after = show_file_at_ref(paths, storyline["branch"], path) or ""
      before_meta, before_body = split_scene_text(before)
      after_meta, after_body = split_scene_text(after)
      scenes.append({
        "path": path,
        "scene_id": after_meta.get("id") or before_meta.get("id") or Path(path).stem,
        "title": after_meta.get("title") or before_meta.get("title") or Path(path).stem,
        "status": file["status"],
        "word_count_before": len(before_body.split()),
        "word_count_after": len(after_body.split()),
        "word_count_delta": len(after_body.split()) - len(before_body.split()),
        "prose_changed": before_body != after_body,
      })
    elif path == "manuscript/structure.json":
      categories["plan"] += 1
    elif path.startswith("codex/"):
      categories["story_memory"] += 1
    else:
      categories["settings"] += 1
  semantic_delta = _semantic_storyline_delta(paths, primary, storyline["branch"])
  changed_semantics = sum(
    len(section[kind])
    for section in semantic_delta.values()
    for kind in ("added", "changed", "removed")
  )
  risks: list[str] = []
  if semantic_delta["canon_facts"]["removed"]:
    risks.append("The experiment removes accepted Canon Facts; verify their evidence before integration.")
  if semantic_delta["setups"]["removed"]:
    risks.append("A tracked setup/payoff disappears in the experiment.")
  protected = storyline.get("experiment_brief", {}).get("protected_constraints", [])
  if protected and categories["story_memory"]:
    risks.append("Story Memory changed while protected constraints are active; review the semantic delta.")
  return {
    "storyline": storyline,
    "primary_branch": primary,
    "ahead_by": raw["ahead_by"],
    "behind_by": raw["behind_by"],
    "categories": categories,
    "scenes": scenes,
    "files": raw["files"],
    "word_count_delta": sum(row["word_count_delta"] for row in scenes),
    "semantic_delta": semantic_delta,
    "impact_analysis": {
      "before": {
        "hypothesis": storyline.get("experiment_brief", {}).get("hypothesis", ""),
        "success_criteria": storyline.get("experiment_brief", {}).get("success_criteria", ""),
        "protected_constraints": protected,
      },
      "after": {
        "changed_scene_count": len([row for row in scenes if row["prose_changed"]]),
        "semantic_change_count": changed_semantics,
        "word_count_delta": sum(row["word_count_delta"] for row in scenes),
        "risks": risks,
        "summary": f"{len([row for row in scenes if row['prose_changed']])} scenes and {changed_semantics} story-model records diverge from Primary.",
      },
    },
  }


def _json_at_ref(paths: ProjectPaths, ref: str, path: str, default: dict[str, Any]) -> dict[str, Any]:
  raw = show_file_at_ref(paths, ref, path)
  if raw is None:
    return default
  try:
    payload = json.loads(raw)
  except json.JSONDecodeError:
    return default
  return payload if isinstance(payload, dict) else default


def _record_delta(before: list[dict[str, Any]], after: list[dict[str, Any]], *, label_keys: tuple[str, ...]) -> dict[str, list[dict[str, str]]]:
  before_map = {str(row.get("id", "")): row for row in before if row.get("id")}
  after_map = {str(row.get("id", "")): row for row in after if row.get("id")}
  def label(row: dict[str, Any]) -> str:
    values = [str(row.get(key, "")).strip() for key in label_keys]
    return ": ".join(value for value in values if value) or str(row.get("id", ""))
  def digest(row: dict[str, Any]) -> str:
    comparable = {key: value for key, value in row.items() if key not in {"created_at", "updated_at"}}
    return json.dumps(comparable, sort_keys=True, separators=(",", ":"))
  return {
    "added": [{"id": key, "label": label(after_map[key])} for key in sorted(after_map.keys() - before_map.keys())],
    "removed": [{"id": key, "label": label(before_map[key])} for key in sorted(before_map.keys() - after_map.keys())],
    "changed": [{"id": key, "label": label(after_map[key])} for key in sorted(before_map.keys() & after_map.keys()) if digest(before_map[key]) != digest(after_map[key])],
  }


def _semantic_storyline_delta(paths: ProjectPaths, primary: str, storyline_ref: str) -> dict[str, dict[str, list[dict[str, str]]]]:
  empty_memory = {"facts": [], "setups": [], "questions": [], "arcs": []}
  before_memory = _json_at_ref(paths, primary, "codex/memory.json", empty_memory)
  after_memory = _json_at_ref(paths, storyline_ref, "codex/memory.json", empty_memory)
  empty_plan = {"acts": []}
  before_plan = _json_at_ref(paths, primary, "manuscript/structure.json", empty_plan)
  after_plan = _json_at_ref(paths, storyline_ref, "manuscript/structure.json", empty_plan)
  before_arcs = [
    {"id": act.get("id"), "title": act.get("title", ""), "synopsis": act.get("synopsis", ""), "chapters": act.get("chapters", [])}
    for act in before_plan.get("acts", [])
  ]
  after_arcs = [
    {"id": act.get("id"), "title": act.get("title", ""), "synopsis": act.get("synopsis", ""), "chapters": act.get("chapters", [])}
    for act in after_plan.get("acts", [])
  ]
  before_arcs.extend({**row, "id": f"character:{row.get('id', '')}", "title": f"{row.get('dimension', '')}: {row.get('value', '')}"} for row in before_memory.get("arcs", []))
  after_arcs.extend({**row, "id": f"character:{row.get('id', '')}", "title": f"{row.get('dimension', '')}: {row.get('value', '')}"} for row in after_memory.get("arcs", []))
  return {
    "canon_facts": _record_delta(before_memory.get("facts", []), after_memory.get("facts", []), label_keys=("predicate", "value")),
    "setups": _record_delta(before_memory.get("setups", []), after_memory.get("setups", []), label_keys=("description",)),
    "open_questions": _record_delta(before_memory.get("questions", []), after_memory.get("questions", []), label_keys=("question",)),
    "arcs": _record_delta(before_arcs, after_arcs, label_keys=("title",)),
  }


@serialized_project_access
def create_storyline_integration_changes(
  paths: ProjectPaths,
  storyline_id: str,
  *,
  scene_paths: list[str],
) -> dict[str, Any]:
  store = _read_store(paths)
  storyline = next((row for row in store["storylines"] if row["id"] == storyline_id), None)
  if storyline is None:
    raise OpenAuthorError(f"Unknown Storyline '{storyline_id}'.")
  primary = store.get("primary_branch", "")
  if current_branch(paths) != primary:
    raise OpenAuthorError("Switch to the primary Storyline before preparing integration Change Sets.")
  comparison = compare_storyline(paths, storyline_id)
  available = {row["path"]: row for row in comparison["scenes"] if row["prose_changed"]}
  selected = sorted(set(scene_paths))
  if not selected:
    raise OpenAuthorError("Select at least one changed scene to integrate.")
  unknown = [path for path in selected if path not in available]
  if unknown:
    raise OpenAuthorError(f"Selected paths are not changed Storyline scenes: {', '.join(unknown)}")
  proposals: list[dict[str, Any]] = []
  change_group_id = f"storyline-group-{uuid.uuid4().hex[:12]}"
  for path in selected:
    row = available[path]
    target_text = show_file_at_ref(paths, storyline["branch"], path)
    if target_text is None:
      raise OpenAuthorError(f"Storyline scene is unavailable: {path}")
    _, target_body = split_scene_text(target_text)
    current = get_scene(paths, row["scene_id"])
    if current["body"] == target_body:
      continue
    proposal_id = create_proposal(
      paths,
      title=f"Integrate {storyline['name']}: {row['title']}",
      instruction=f"Bring the selected scene from Storyline '{storyline['name']}' into the primary manuscript.",
      scene_id=row["scene_id"],
      proposed_body=target_body,
      source="storyline_integration",
      revision_intent={
        "goal": f"Integrate selected Storyline scene from {storyline['name']}",
        "scope": "scene",
        "constraints": storyline["experiment_brief"].get("protected_constraints", []),
        "protected_elements": [],
      },
      change_group_id=change_group_id,
    )
    proposal = set_proposal_draft(
      paths,
      proposal_id=proposal_id,
      proposed_body=target_body,
      draft={
        "generation_id": "",
        "provider": "storyline",
        "model": storyline["branch"],
        "temperature": 0,
        "max_output_tokens": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "latency_ms": 0,
        "estimated_cost_usd": 0,
        "changed": True,
        "log_path": "",
        "created_at": utc_now(),
      },
    )
    proposals.append(proposal)
  return {"storyline_id": storyline_id, "change_group_id": change_group_id, "proposal_count": len(proposals), "proposals": proposals}


@serialized_project_access
def update_storyline_status(paths: ProjectPaths, storyline_id: str, *, status: str) -> dict[str, Any]:
  if status not in {"active", "archived"}:
    raise OpenAuthorError("Storyline status must be active or archived.")
  store = _read_store(paths)
  storyline = next((row for row in store["storylines"] if row["id"] == storyline_id), None)
  if storyline is None:
    raise OpenAuthorError(f"Unknown Storyline '{storyline_id}'.")
  storyline["status"] = status
  storyline["updated_at"] = utc_now()
  _write_store(paths, store)
  return storyline


@serialized_project_access
def rename_storyline(paths: ProjectPaths, storyline_id: str, *, name: str) -> dict[str, Any]:
  if not name.strip():
    raise OpenAuthorError("Storyline name is required.")
  store = _read_store(paths)
  storyline = next((row for row in store["storylines"] if row["id"] == storyline_id), None)
  if storyline is None:
    raise OpenAuthorError(f"Unknown Storyline '{storyline_id}'.")
  old_branch = storyline["branch"]
  new_branch = f"storyline/{_slug(name)}-{uuid.uuid4().hex[:6]}"
  if current_branch(paths) == old_branch:
    run_git(paths, ["branch", "-m", new_branch], check=True)
  else:
    run_git(paths, ["branch", "-m", old_branch, new_branch], check=True)
  storyline["name"] = name.strip()
  storyline["branch"] = new_branch
  storyline["updated_at"] = utc_now()
  _write_store(paths, store)
  return storyline


@serialized_project_access
def duplicate_storyline(paths: ProjectPaths, storyline_id: str, *, name: str) -> dict[str, Any]:
  if not name.strip():
    raise OpenAuthorError("Duplicated Storyline name is required.")
  store = _read_store(paths)
  source = next((row for row in store["storylines"] if row["id"] == storyline_id), None)
  if source is None:
    raise OpenAuthorError(f"Unknown Storyline '{storyline_id}'.")
  branch_name = f"storyline/{_slug(name)}-{uuid.uuid4().hex[:6]}"
  create_branch(paths, name=branch_name, from_ref=source["branch"], switch=False)
  now = utc_now()
  row = {
    **source,
    "id": f"storyline-{uuid.uuid4().hex[:12]}",
    "name": name.strip(),
    "branch": branch_name,
    "status": "active",
    "source_branch": source["branch"],
    "created_at": now,
    "updated_at": now,
    "last_activity_at": now,
  }
  store["storylines"].append(row)
  _write_store(paths, store)
  return row


@serialized_project_access
def save_storyline_progress(paths: ProjectPaths, storyline_id: str) -> dict[str, Any]:
  store = _read_store(paths)
  storyline = next((row for row in store["storylines"] if row["id"] == storyline_id), None)
  if storyline is None:
    raise OpenAuthorError(f"Unknown Storyline '{storyline_id}'.")
  if current_branch(paths) != storyline["branch"]:
    raise OpenAuthorError("Switch to this Storyline before saving its progress.")
  result = create_snapshot(paths, f"Storyline progress: {storyline['name']}")
  storyline["last_activity_at"] = utc_now()
  storyline["updated_at"] = utc_now()
  _write_store(paths, store)
  return {"storyline": storyline, "snapshot": result}
