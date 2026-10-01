"""The only Story Memory representation permitted across an AI boundary.

Author storage and search retain the complete records. AI callers receive an
allowlisted projection; private notes never leave through this interface.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

from .codex import list_entities
from .project import OpenAuthorError, ProjectPaths


def memory_for_ai(
  paths: ProjectPaths, memory_approvals: list[dict[str, str]] | None = None,
) -> list[dict[str, Any]]:
  entities = list_entities(paths)
  approved: set[tuple[str, str | None]] = set()
  if memory_approvals is not None and not isinstance(memory_approvals, list):
    raise OpenAuthorError("Memory permissions must be a list of entry or detail selections.")
  for grant in memory_approvals or []:
    if not isinstance(grant, dict) or set(grant) - {"entity_id", "detail_key"}:
      raise OpenAuthorError("Invalid one-time Memory permission.")
    entity = next((row for row in entities if row["id"] == grant.get("entity_id")), None)
    detail_key = grant.get("detail_key")
    target = entity if detail_key is None else next((
      row for row in (entity or {}).get("details", []) if row.get("key") == detail_key
    ), None)
    if target is None or target.get("ai_visibility") != "ask":
      raise OpenAuthorError("One-time permission is only available for existing Ask first entries or details. Review context again.")
    approved.add((entity["id"], detail_key))
  allowed_ids = {
    row["id"] for row in entities
    if row.get("ai_visibility", "include") == "include" or (row["id"], None) in approved
  }
  if any(entity_id not in allowed_ids for entity_id, _ in approved):
    raise OpenAuthorError("A detail needs permission for its parent entry too. Excluded entries cannot be approved.")
  result: list[dict[str, Any]] = []
  for entity in entities:
    if entity["id"] not in allowed_ids:
      continue
    public = {
      key: entity[key]
      for key in ("id", "type", "name", "description", "category", "aliases", "tags", "scope")
      if key in entity
    }
    public["details"] = [
      {key: detail[key] for key in ("key", "type", "value") if key in detail}
      for detail in entity.get("details", [])
      if (detail.get("ai_visibility", "include") == "include" or (entity["id"], detail.get("key")) in approved)
      and (detail.get("type") != "entity" or (
        isinstance(detail.get("value"), str) and detail["value"] in allowed_ids
      ))
    ]
    result.append(public)
  return result


def memory_context_fingerprint(paths: ProjectPaths, memory_approvals: list[dict[str, str]] | None = None) -> str:
  """Invalidate previously supplied context after any public Memory change.

  Starting a fresh provider history is conservative but necessary: an earlier
  answer can paraphrase a fact, so substring redaction cannot revoke it safely.
  The local transcript remains untouched and readable by the author.
  """
  payload = {"policy_version": 2, "memory": memory_for_ai(paths, memory_approvals)}
  return hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()


def current_privacy_history(
  rows: list[dict[str, Any]], fingerprint: str,
) -> list[dict[str, Any]]:
  boundary = 0
  for index, row in enumerate(rows):
    privacy = row.get("context_used", {}).get("privacy", {})
    if privacy.get("fingerprint") != fingerprint or privacy.get("one_time_approval"):
      boundary = index + 1
  return rows[boundary:]
