"""Canonical reading order, independent of scene storage and Plan mutations."""
from __future__ import annotations

import json

from .project import OpenAuthorError, ProjectPaths


def ordered_scene_ids(paths: ProjectPaths, available_ids: list[str]) -> list[str]:
  if not paths.structure_file.exists():
    return list(available_ids)
  try:
    plan = json.loads(paths.structure_file.read_text(encoding="utf-8"))
    if not isinstance(plan, dict) or plan.get("schema_version") not in {1, 2}:
      raise ValueError("Unsupported manuscript structure schema version.")
    requested = [
      scene_id
      for act in plan.get("acts", [])
      for chapter in act.get("chapters", [])
      for scene_id in chapter.get("scene_ids", [])
    ] + plan.get("unassigned_scene_ids", [])
    if not all(isinstance(scene_id, str) for scene_id in requested):
      raise ValueError("Scene references must be strings.")
  except (OSError, ValueError, TypeError, AttributeError) as error:
    raise OpenAuthorError(f"Manuscript structure is unreadable: {error}") from error
  available = set(available_ids)
  seen: set[str] = set()
  ordered: list[str] = []
  for scene_id in [*requested, *available_ids]:
    if scene_id in available and scene_id not in seen:
      ordered.append(scene_id)
      seen.add(scene_id)
  return ordered
