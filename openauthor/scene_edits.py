"""Optimistic, field-aware editor saves with durable conflict copies."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from .project import OpenAuthorError, ProjectPaths, atomic_write_json, read_project_config, utc_now
from .project_locks import serialized_project_access

EDIT_FIELDS = ("title", "body", "summary", "pov", "status")
_DIGEST = re.compile(r"^[a-f0-9]{64}$")


def _digest(value: str) -> str:
  return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _field_digest(field: str, value: str) -> str:
  return _digest(value.rstrip() if field == "body" else value)


def workspace_edit_scope(paths: ProjectPaths) -> tuple[str, str]:
  # Reading HEAD avoids spawning Git per scene. Linked worktrees/submodules use
  # a gitdir pointer; an enclosing repository also governs a nested book.
  root = paths.root.resolve()
  project_id = str(read_project_config(paths).get("project_id", ""))
  if not project_id:
    raise OpenAuthorError("Project identity is required for a guarded scene edit.")
  for parent in (root, *root.parents):
    marker = parent / ".git"
    if not marker.exists():
      continue
    try:
      git_dir = marker
      if marker.is_file():
        pointer = marker.read_text(encoding="utf-8").strip()
        if not pointer.startswith("gitdir: ") or len(pointer) > 4096:
          raise OpenAuthorError("Cannot identify the current Storyline: invalid Git directory pointer.")
        git_dir = (parent / pointer[8:]).resolve()
      head = (git_dir / "HEAD").read_text(encoding="utf-8").strip()
    except OSError as error:
      raise OpenAuthorError("Cannot identify the current Storyline. Scene access was stopped.") from error
    if not (head.startswith("ref: refs/heads/") or re.fullmatch(r"[a-fA-F0-9]{40,64}", head)) or len(head) > 4096:
      raise OpenAuthorError("Cannot identify the current Storyline: invalid Git HEAD.")
    name = head.removeprefix("ref: refs/heads/") if head.startswith("ref:") else f"Detached {head[:12]}"
    return _digest(f"{root}\n{project_id}\n{git_dir.resolve()}\n{head}"), name
  return _digest(f"{root}\n{project_id}\nunversioned"), "Local manuscript"


def scene_edit_version(paths: ProjectPaths, scene: dict[str, Any]) -> dict[str, Any]:
  workspace, storyline = workspace_edit_scope(paths)
  return {
    "schema_version": 1,
    "workspace": workspace,
    "storyline": storyline,
    "scene_id": scene["id"],
    "fields": {field: _field_digest(field, str(scene[field])) for field in EDIT_FIELDS},
  }


def _validate_version(version: Any, scene_id: str) -> dict[str, Any]:
  if (
    not isinstance(version, dict) or version.get("schema_version") != 1
    or version.get("scene_id") != scene_id
    or not isinstance(version.get("workspace"), str) or not _DIGEST.fullmatch(version["workspace"])
    or not isinstance(version.get("fields"), dict)
    or any(not isinstance(version["fields"].get(field), str) or not _DIGEST.fullmatch(version["fields"][field]) for field in EDIT_FIELDS)
  ):
    raise OpenAuthorError("A valid loaded-scene version is required. Reopen the scene before saving.")
  return version


class SceneEditConflict(OpenAuthorError):
  def __init__(self, details: dict[str, Any]) -> None:
    super().__init__("Scene changed elsewhere. Your draft was preserved; review both versions before saving.")
    self.details = details


@serialized_project_access
def save_scene_edit(
  paths: ProjectPaths,
  *,
  scene_identifier: str,
  expected_version: dict[str, Any],
  changes: dict[str, str],
) -> dict[str, Any]:
  """Compare and write under one lock; return the exact committed version.

  Unrelated fields merge. A same-content retry is idempotent. A Storyline change
  never merges implicitly, even when both branches contain identical prose.
  Conflict archives are local authoring data, not telemetry or cloud payloads.
  """
  from .scenes import get_scene, update_scene

  expected = _validate_version(expected_version, scene_identifier)
  if not changes or any(field not in EDIT_FIELDS or not isinstance(value, str) for field, value in changes.items()):
    raise OpenAuthorError("Supply only editable scene fields with text values.")
  current = get_scene(paths, scene_identifier)
  actual = current["edit_version"]
  changed_storyline = expected["workspace"] != actual["workspace"]
  conflicts = [
    field for field, value in changes.items()
    if expected["fields"][field] != actual["fields"][field]
    and _field_digest(field, value) != actual["fields"][field]
  ]
  if changed_storyline or conflicts:
    record = {
      "schema_version": 1,
      "scene_id": scene_identifier,
      "expected_version": expected,
      "draft": changes,
      "current": current,
      "reason": "storyline_changed" if changed_storyline else "scene_changed",
      "conflicting_fields": conflicts,
    }
    identity = _digest(json.dumps(record, sort_keys=True, ensure_ascii=False))
    destination = paths.workspace_dir / "scene-conflicts" / f"{identity}.json"
    try:
      if not destination.exists():
        atomic_write_json(destination, {**record, "created_at": utc_now()})
    except OSError as error:
      raise OpenAuthorError("Scene changed elsewhere and the conflict copy could not be stored. Keep the editor open; the manuscript was not changed.") from error
    raise SceneEditConflict({
      "code": "scene_edit_conflict",
      "reason": record["reason"],
      "conflicting_fields": conflicts,
      "current": current,
      "recovery_path": destination.relative_to(paths.root).as_posix(),
    })
  if any(_field_digest(field, value) != actual["fields"][field] for field, value in changes.items()):
    update_scene(paths, scene_identifier=scene_identifier, **changes)
  return get_scene(paths, scene_identifier)
