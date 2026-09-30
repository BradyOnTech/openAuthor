"""Explicit, per-request story grounding. Local review choices are never a prompt."""
from __future__ import annotations

import json
from typing import Any

from .ai_visibility import memory_for_ai
from .canon import list_canon_facts, resolve_fact_knowledge
from .codex import list_relationships
from .project import OpenAuthorError, ProjectPaths
from .scenes import get_scene, list_scenes

STORY_GROUNDING_INSTRUCTIONS = (
  "Approved Canon records constrain world facts only in applies_to_scene_ids. "
  "They are not permission to reveal a fact in narration or dialogue: respect the recorded character knowledge, "
  "and treat absent knowledge as unknown, not as knows or does_not_know. "
  "Do not resolve conflicting records by invention; flag the conflict. "
  "Unshared or omitted records are unknown, not evidence that no constraint exists. "
)


def prepare_story_grounding(
  paths: ProjectPaths, scene_ids: list[str], *,
  memory_approvals: list[dict[str, str]] | None = None,
  story_approvals: list[str] | None = None,
  character_budget: int = 12000,
) -> dict[str, Any]:
  if story_approvals is not None and (not isinstance(story_approvals, list) or any(not isinstance(value, str) for value in story_approvals)):
    raise OpenAuthorError("Story permissions must be a list of Canon Fact or relationship ids.")
  allowed = {row["id"]: row for row in memory_for_ai(paths, memory_approvals)}
  positions = {row["id"]: index for index, row in enumerate(list_scenes(paths))}
  targets = list(dict.fromkeys(scene_ids))
  if any(scene_id not in positions for scene_id in targets):
    raise OpenAuthorError("Story grounding requires current scene ids.")
  approved = set(story_approvals or [])
  choices = []
  context: dict[str, Any] = {"facts": [], "relationships": [], "limits": {
    "character_budget": character_budget, "omitted_by_budget": 0, "not_approved": 0,
    "unavailable": 0, "private_notes_included": False,
  }}
  records = [("fact", row) for row in list_canon_facts(paths)] + [("relationship", row) for row in list_relationships(paths)]
  evidence_bodies: dict[str, str] = {}

  def evidence_is_current(passages: list[dict[str, Any]]) -> bool:
    if not passages:
      return False
    for passage in passages:
      source_id = passage.get("scene_id", "")
      if source_id not in positions:
        return False
      if source_id not in evidence_bodies:
        evidence_bodies[source_id] = get_scene(paths, source_id)["body"]
      start, end, excerpt = passage.get("start"), passage.get("end"), passage.get("excerpt")
      if type(start) is not int or type(end) is not int or not excerpt or not 0 <= start < end:
        return False
      if evidence_bodies[source_id][start:end] != excerpt:
        return False
    return True

  def knowledge_at_scenes(fact: dict[str, Any], applicable: list[str]) -> list[dict[str, Any]]:
    result = []
    for row in resolve_fact_knowledge(fact, applicable, positions):
      character = row.get("character_entity_id", "")
      if character not in allowed:
        continue
      result.append({"character_entity_id": character, "character_name": allowed[character]["name"], "state": row["state"], "applies_to_scene_ids": row["applies_to_scene_ids"]})
    return result
  known = {row["id"] for _, row in records}
  if approved - known:
    raise OpenAuthorError("A selected story record no longer exists. Review context again.")
  for kind, row in records:
    entity_ids = [row.get("subject_entity_id")] if kind == "fact" else [row["source_entity_id"], row["target_entity_id"]]
    reason = ""
    if any(entity_id and entity_id not in allowed for entity_id in entity_ids):
      reason = "Allow the linked Memory entries first; excluded entries cannot be approved."
    elif kind == "fact" and row.get("status") != "accepted":
      reason = "Only accepted Canon Facts can be used."
    elif kind == "fact" and not evidence_is_current(row.get("evidence", [])):
      reason = "Source evidence changed or is unverified; relink the exact current passage in Canon."
    elif not targets:
      reason = "Select a scene to determine when this record applies."
    validity = row.get("validity", {}) if kind == "fact" else {"from_scene_id": row.get("valid_from_scene_id", ""), "to_scene_id": row.get("valid_to_scene_id", "")}
    start, end = validity.get("from_scene_id", ""), validity.get("to_scene_id", "")
    if not reason and any(boundary and boundary not in positions for boundary in (start, end)):
      reason = "A validity boundary no longer names a current scene."
    if not reason and positions.get(start, -1) > positions.get(end, len(positions)):
      reason = "The validity range ends before it starts in manuscript reading order."
    applies = [scene_id for scene_id in targets if positions.get(start, -1) <= positions[scene_id] <= positions.get(end, len(positions))]
    if not applies and not reason:
      reason = "Outside the selected scenes' validity range."
    if kind == "fact":
      subject = allowed.get(row.get("subject_entity_id"), {}).get("name", "World")
      label = f"{subject} · {row['predicate']}: {row['value']}"
      projected = {key: row[key] for key in ("id", "subject_entity_id", "predicate", "value", "confidence", "evidence", "validity")}
      projected["subject_name"] = subject
      projected["knowledge"] = knowledge_at_scenes(row, applies)
    else:
      label = f"{row['source_name']} · {row['relation']} · {row['target_name']}"
      projected = {key: row[key] for key in ("id", "source_entity_id", "source_name", "target_entity_id", "target_name", "relation")}
      projected["validity"] = validity
    projected["applies_to_scene_ids"] = applies
    choice = {"id": row["id"], "kind": kind, "label": label, "eligible": not reason, "reason": reason, "approved": row["id"] in approved, "included": False}
    choices.append(choice)
    if reason:
      context["limits"]["unavailable"] += 1
      if row["id"] in approved:
        raise OpenAuthorError(f"A selected story record is no longer available: {reason} Review context again.")
      continue
    if row["id"] not in approved:
      context["limits"]["not_approved"] += 1
      continue
    size = len(json.dumps(projected, ensure_ascii=False))
    if size > character_budget:
      context["limits"]["omitted_by_budget"] += 1
      choice["reason"] = "Selected but omitted: this record exceeds the remaining story context budget."
      continue
    character_budget -= size
    choice["included"] = True
    context["facts" if kind == "fact" else "relationships"].append(projected)
  return {"context": context, "choices": choices}
