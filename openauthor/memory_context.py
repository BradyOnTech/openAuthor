"""Author-controlled Story Memory projection for model-facing reads.

The author store remains complete. An explicit reference is not permission:
only a trusted caller's per-request approval can release an `ask` entry/detail.
Excluded entries and private notes cannot be released by that approval.
"""

from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from typing import Any, Iterable, Mapping

from .codex import get_entity, list_entities
from .project import OpenAuthorError, ProjectPaths


def memory_for_assistant(entity: Mapping[str, Any], *, approved: bool = False) -> dict[str, Any] | None:
  visibility = entity.get("ai_visibility", "include")
  if visibility != "include" and not (visibility == "ask" and approved):
    return None
  result = {key: deepcopy(entity[key]) for key in (
    "id", "type", "name", "description", "category", "aliases", "tags", "scope",
  ) if key in entity}
  result["details"] = [
    {key: deepcopy(detail[key]) for key in ("key", "type", "value") if key in detail}
    for detail in entity.get("details", [])
    if isinstance(detail, dict) and (
      detail.get("ai_visibility", "include") == "include"
      or (detail.get("ai_visibility") == "ask" and approved)
    )
  ]
  return result


def list_assistant_memory(paths: ProjectPaths, *, approved_ids: Iterable[str] = ()) -> list[dict[str, Any]]:
  approved = set(approved_ids)
  return [projected for entity in list_entities(paths)
          if (projected := memory_for_assistant(entity, approved=entity["id"] in approved)) is not None]


def get_assistant_memory(paths: ProjectPaths, entity_id: str, *, approved_ids: Iterable[str] = ()) -> dict[str, Any]:
  entity = get_entity(paths, entity_id)
  projected = memory_for_assistant(entity, approved=entity_id in set(approved_ids))
  if projected is None:
    if entity.get("ai_visibility") == "ask":
      raise OpenAuthorError("This Story Memory entry requires author permission. Select it in chat and allow it for this request.")
    raise OpenAuthorError("This Story Memory entry is excluded from AI context.")
  return projected


def memory_access_stamp(entities: Iterable[Mapping[str, Any]], *, approved_ids: Iterable[str] = ()) -> dict[str, Any]:
  approved = sorted(set(approved_ids))
  state = [
    {"id": entity["id"], "visibility": entity.get("ai_visibility", "include"),
     "content": memory_for_assistant(entity, approved=entity["id"] in approved)}
    for entity in sorted(entities, key=lambda entity: str(entity["id"]))
  ]
  digest = hashlib.sha256(json.dumps(state, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
  return {"policy_version": 1, "approved_ids": approved, "digest": digest}
