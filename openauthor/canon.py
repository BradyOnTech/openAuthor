from __future__ import annotations

import hashlib
import json
import re
import uuid
from collections import defaultdict
from typing import Any

from .codex import get_entity, list_entities
from .project import OpenAuthorError, ProjectPaths, atomic_write_json, utc_now
from .project_locks import serialized_project_access
from .scene_edits import workspace_edit_scope
from .scenes import get_scene, list_scene_details, list_scenes
from .story_observations import prose_trait_diagnostics

CANON_SCHEMA_VERSION = 1
FACT_STATUSES = {"accepted", "suggested", "rejected"}
DIAGNOSTIC_DISPOSITIONS = {"fixed", "dismissed", "intentional", "deferred"}
NONEXCLUSIVE_PREDICATES = {"is", "was", "has", "had", "owns", "knows", "believes", "can", "likes"}


def _memory_path(paths: ProjectPaths):
  return paths.root / "codex" / "memory.json"


def _default_memory() -> dict[str, Any]:
  return {
    "schema_version": CANON_SCHEMA_VERSION,
    "facts": [],
    "setups": [],
    "questions": [],
    "arcs": [],
    "dispositions": [],
  }


def _read_memory(paths: ProjectPaths) -> dict[str, Any]:
  path = _memory_path(paths)
  if not path.exists():
    return _default_memory()
  try:
    payload = json.loads(path.read_text(encoding="utf-8"))
  except (OSError, json.JSONDecodeError) as error:
    raise OpenAuthorError(f"Canon Memory is unreadable: {error}") from error
  if payload.get("schema_version") != CANON_SCHEMA_VERSION:
    raise OpenAuthorError("Unsupported Canon Memory schema version.")
  payload.setdefault("arcs", [])
  return payload


def _write_memory(paths: ProjectPaths, payload: dict[str, Any]) -> None:
  atomic_write_json(_memory_path(paths), payload)


def _clean_evidence(paths: ProjectPaths, evidence: list[dict[str, Any]]) -> list[dict[str, Any]]:
  cleaned: list[dict[str, Any]] = []
  scene_ids = {row["id"] for row in list_scenes(paths)}
  for row in evidence:
    scene_id = str(row.get("scene_id", "")).strip()
    excerpt = str(row.get("excerpt", "")).strip()
    if scene_id not in scene_ids:
      raise OpenAuthorError(f"Unknown evidence scene '{scene_id}'.")
    if not excerpt:
      raise OpenAuthorError("Canon evidence requires an excerpt.")
    body = get_scene(paths, scene_id)["body"]
    try:
      start, end = int(row.get("start", 0)), int(row.get("end", 0))
    except (TypeError, ValueError) as error:
      raise OpenAuthorError("Evidence offsets must be character positions in the current scene.") from error
    if start < 0 or end < start:
      raise OpenAuthorError("Evidence offsets must be character positions in the current scene.")
    if end > start:
      if body[start:end] != excerpt:
        raise OpenAuthorError("The selected evidence changed. Select the exact current passage again.")
    else:
      start = body.find(excerpt)
      if start < 0:
        raise OpenAuthorError("Evidence must be an exact passage from the current scene. Open the scene and copy the supporting words.")
      if body.find(excerpt, start + 1) >= 0:
        raise OpenAuthorError("This evidence excerpt occurs more than once. Include more surrounding words or provide exact selection offsets.")
      end = start + len(excerpt)
    cleaned.append({
      "scene_id": scene_id,
      "excerpt": excerpt,
      "start": start,
      "end": end,
    })
  if not cleaned:
    raise OpenAuthorError("A Canon Fact requires at least one manuscript evidence passage.")
  return cleaned


@serialized_project_access
def add_canon_fact(
  paths: ProjectPaths,
  *,
  subject_entity_id: str,
  predicate: str,
  value: str,
  evidence: list[dict[str, Any]],
  confidence: float = 1.0,
  status: str = "accepted",
  valid_from_scene_id: str = "",
  valid_to_scene_id: str = "",
  knowledge: list[dict[str, Any]] | None = None,
  scope: str = "project",
) -> dict[str, Any]:
  if status not in FACT_STATUSES:
    raise OpenAuthorError(f"Invalid Canon Fact status '{status}'.")
  if not predicate.strip() or not value.strip():
    raise OpenAuthorError("Canon Fact predicate and value are required.")
  if not 0 <= confidence <= 1:
    raise OpenAuthorError("Canon Fact confidence must be between 0 and 1.")
  if subject_entity_id:
    get_entity(paths, subject_entity_id)
  scene_ids = {row["id"] for row in list_scenes(paths)}
  for boundary in (valid_from_scene_id, valid_to_scene_id):
    if boundary and boundary not in scene_ids:
      raise OpenAuthorError(f"Unknown validity scene '{boundary}'.")
  cleaned_knowledge: list[dict[str, Any]] = []
  for row in knowledge or []:
    character_id = str(row.get("character_entity_id", "")).strip()
    state = str(row.get("state", "knows")).strip()
    if state not in {"knows", "believes", "does_not_know"}:
      raise OpenAuthorError(f"Invalid knowledge state '{state}'.")
    get_entity(paths, character_id)
    learned_at = str(row.get("from_scene_id", "")).strip()
    if learned_at and learned_at not in scene_ids:
      raise OpenAuthorError(f"Unknown knowledge scene '{learned_at}'.")
    cleaned_knowledge.append({
      "character_entity_id": character_id,
      "state": state,
      "from_scene_id": learned_at,
    })
  now = utc_now()
  row = {
    "id": f"fact-{uuid.uuid4().hex[:12]}",
    "subject_entity_id": subject_entity_id,
    "predicate": predicate.strip(),
    "value": value.strip(),
    "status": status,
    "confidence": round(confidence, 4),
    "evidence": _clean_evidence(paths, evidence),
    "validity": {"from_scene_id": valid_from_scene_id, "to_scene_id": valid_to_scene_id},
    "knowledge": cleaned_knowledge,
    "scope": scope,
    "created_at": now,
    "updated_at": now,
  }
  payload = _read_memory(paths)
  payload["facts"].append(row)
  _write_memory(paths, payload)
  return row


def _fact_edit_version(paths: ProjectPaths, fact: dict[str, Any]) -> str:
  source = json.dumps([workspace_edit_scope(paths)[0], fact], sort_keys=True, ensure_ascii=False)
  return hashlib.sha256(source.encode("utf-8")).hexdigest()


@serialized_project_access
def list_canon_facts(paths: ProjectPaths, *, status: str | None = None, for_editing: bool = False) -> list[dict[str, Any]]:
  rows = _read_memory(paths)["facts"]
  if status:
    rows = [row for row in rows if row.get("status") == status]
  return [{**row, "edit_version": _fact_edit_version(paths, row)} for row in rows] if for_editing else rows


@serialized_project_access
def update_canon_fact(paths: ProjectPaths, fact_id: str, *, expected_version: str, changes: dict[str, Any]) -> dict[str, Any]:
  memory = _read_memory(paths)
  current = next((row for row in memory["facts"] if row["id"] == fact_id), None)
  if current is None:
    raise OpenAuthorError("This Canon Fact is no longer available. Reload Canon & Continuity.")
  if not expected_version or expected_version != _fact_edit_version(paths, current):
    raise OpenAuthorError("This Canon Fact or its Storyline changed since you opened it. Your edits were not saved. Reload and compare the saved fact before trying again.")
  allowed = {"predicate", "value", "status", "validity", "evidence"}
  if not isinstance(changes, dict) or not changes or set(changes) - allowed:
    raise OpenAuthorError("Supply only editable Canon Fact fields.")
  updated = {**current, **changes}
  for field in ("predicate", "value"):
    if not isinstance(updated[field], str) or not updated[field].strip():
      raise OpenAuthorError("A Canon Fact needs a predicate and a value.")
    updated[field] = updated[field].strip()
  if not isinstance(updated["status"], str) or updated["status"] not in FACT_STATUSES:
    raise OpenAuthorError("Invalid Canon Fact status.")
  validity = updated["validity"]
  if not isinstance(validity, dict) or set(validity) != {"from_scene_id", "to_scene_id"} or any(not isinstance(value, str) for value in validity.values()):
    raise OpenAuthorError("A Canon Fact needs valid scene boundaries.")
  if "evidence" in changes and changes["evidence"] != current["evidence"]:
    evidence = changes["evidence"]
    if not isinstance(evidence, list) or any(not isinstance(row, dict) or not isinstance(row.get("scene_id"), str) or not isinstance(row.get("excerpt"), str) for row in evidence):
      raise OpenAuthorError("Canon evidence needs scene identifiers and exact excerpts.")
    updated["evidence"] = _clean_evidence(paths, [{"scene_id": row["scene_id"], "excerpt": row["excerpt"]} for row in evidence])
  # Retiring an obsolete fact must still work when its original source was
  # removed. Accepting or correcting active canon requires current sources.
  if updated["status"] == "accepted":
    positions = _scene_positions(paths)
    if any(boundary and boundary not in positions for boundary in validity.values()):
      raise OpenAuthorError("A validity scene is unavailable. Choose a current scene.")
    if _validity_range(updated, positions)[0] > _validity_range(updated, positions)[1]:
      raise OpenAuthorError("The fact cannot stop being true before it begins.")
    for evidence in updated["evidence"]:
      body = get_scene(paths, evidence["scene_id"])["body"]
      if not evidence["excerpt"].strip() or evidence["excerpt"] not in body:
        raise OpenAuthorError("A supporting passage is missing from the current scene. Correct the excerpt before accepting this fact.")
  if updated != current:
    updated["updated_at"] = utc_now()
    memory["facts"] = [updated if row["id"] == fact_id else row for row in memory["facts"]]
    _write_memory(paths, memory)
  return {**updated, "edit_version": _fact_edit_version(paths, updated)}


@serialized_project_access
def review_canon_fact(
  paths: ProjectPaths,
  fact_id: str,
  *,
  disposition: str,
  evidence: list[dict[str, Any]] | None = None,
  expected_updated_at: str | None = None,
) -> dict[str, Any]:
  if disposition not in {"accepted", "rejected"}:
    raise OpenAuthorError("A Canon Fact review must accept or retire the fact.")
  memory = _read_memory(paths)
  fact = next((row for row in memory["facts"] if row["id"] == fact_id), None)
  if fact is None:
    raise OpenAuthorError(f"Unknown Canon Fact '{fact_id}'.")
  if expected_updated_at is not None and fact["updated_at"] != expected_updated_at:
    raise OpenAuthorError("This Canon Fact changed since you opened it. Reload and review the current evidence before saving.")
  if evidence is not None or disposition == "accepted":
    fact["evidence"] = _clean_evidence(paths, evidence if evidence is not None else fact["evidence"])
  fact["status"] = disposition
  fact["updated_at"] = utc_now()
  _write_memory(paths, memory)
  return fact


@serialized_project_access
def add_setup(
  paths: ProjectPaths,
  *,
  description: str,
  setup_scene_id: str,
  excerpt: str,
) -> dict[str, Any]:
  if not description.strip():
    raise OpenAuthorError("Setup description is required.")
  evidence = _clean_evidence(paths, [{"scene_id": setup_scene_id, "excerpt": excerpt}])[0]
  now = utc_now()
  row = {
    "id": f"setup-{uuid.uuid4().hex[:12]}",
    "description": description.strip(),
    "status": "open",
    "setup_evidence": evidence,
    "payoff_evidence": None,
    "created_at": now,
    "updated_at": now,
  }
  payload = _read_memory(paths)
  payload["setups"].append(row)
  _write_memory(paths, payload)
  return row


@serialized_project_access
def resolve_setup(
  paths: ProjectPaths,
  setup_id: str,
  *,
  payoff_scene_id: str,
  excerpt: str,
) -> dict[str, Any]:
  payload = _read_memory(paths)
  row = next((item for item in payload["setups"] if item["id"] == setup_id), None)
  if row is None:
    raise OpenAuthorError(f"Unknown setup '{setup_id}'.")
  row["status"] = "paid_off"
  row["payoff_evidence"] = _clean_evidence(paths, [{"scene_id": payoff_scene_id, "excerpt": excerpt}])[0]
  row["updated_at"] = utc_now()
  _write_memory(paths, payload)
  return row


@serialized_project_access
def list_setups(paths: ProjectPaths) -> list[dict[str, Any]]:
  return _read_memory(paths)["setups"]


@serialized_project_access
def add_open_question(
  paths: ProjectPaths,
  *,
  question: str,
  scene_id: str = "",
  intentionally_unresolved: bool = False,
) -> dict[str, Any]:
  if not question.strip():
    raise OpenAuthorError("Open Question text is required.")
  if scene_id and scene_id not in {row["id"] for row in list_scenes(paths)}:
    raise OpenAuthorError(f"Unknown question scene '{scene_id}'.")
  now = utc_now()
  row = {
    "id": f"question-{uuid.uuid4().hex[:12]}",
    "question": question.strip(),
    "scene_id": scene_id,
    "status": "intentionally_unresolved" if intentionally_unresolved else "open",
    "answer": "",
    "created_at": now,
    "updated_at": now,
  }
  payload = _read_memory(paths)
  payload["questions"].append(row)
  _write_memory(paths, payload)
  return row


@serialized_project_access
def list_open_questions(paths: ProjectPaths) -> list[dict[str, Any]]:
  return _read_memory(paths)["questions"]


@serialized_project_access
def add_arc_state(
  paths: ProjectPaths,
  *,
  character_entity_id: str,
  dimension: str,
  value: str,
  scene_id: str,
  excerpt: str,
  state_type: str = "observed",
) -> dict[str, Any]:
  character = get_entity(paths, character_entity_id)
  if character.get("type") != "character":
    raise OpenAuthorError("Character Arc States require a character Story Memory entry.")
  if not dimension.strip() or not value.strip():
    raise OpenAuthorError("Arc dimension and state are required.")
  if state_type not in {"observed", "planned"}:
    raise OpenAuthorError("Arc state type must be observed or planned.")
  evidence = _clean_evidence(paths, [{"scene_id": scene_id, "excerpt": excerpt}])[0]
  now = utc_now()
  row = {
    "id": f"arc-state-{uuid.uuid4().hex[:12]}",
    "character_entity_id": character_entity_id,
    "dimension": dimension.strip(),
    "value": value.strip(),
    "scene_id": scene_id,
    "state_type": state_type,
    "evidence": evidence,
    "created_at": now,
    "updated_at": now,
  }
  payload = _read_memory(paths)
  payload["arcs"].append(row)
  _write_memory(paths, payload)
  return row


@serialized_project_access
def list_arc_states(paths: ProjectPaths, *, character_entity_id: str | None = None) -> list[dict[str, Any]]:
  rows = _read_memory(paths)["arcs"]
  if character_entity_id:
    rows = [row for row in rows if row.get("character_entity_id") == character_entity_id]
  positions = _scene_positions(paths)
  return sorted(rows, key=lambda row: (positions.get(row.get("scene_id", ""), 10**9), row.get("dimension", ""), row.get("created_at", "")))


def _scene_positions(paths: ProjectPaths) -> dict[str, int]:
  return {row["id"]: index for index, row in enumerate(list_scenes(paths), start=1)}


def _validity_range(fact: dict[str, Any], positions: dict[str, int]) -> tuple[int, int]:
  validity = fact.get("validity", {})
  start = positions.get(validity.get("from_scene_id"), 0)
  end = positions.get(validity.get("to_scene_id"), 10**9)
  return start, end


def resolve_fact_knowledge(fact: dict[str, Any], scene_ids: list[str], positions: dict[str, int]) -> list[dict[str, Any]]:
  """Resolve author-recorded knowledge in current reading order, retaining tied claims."""
  validity = fact.get("validity", {})
  boundaries = [validity.get("from_scene_id", ""), validity.get("to_scene_id", "")]
  if any(boundary and boundary not in positions for boundary in boundaries):
    return []
  first, last = _validity_range(fact, positions)
  applicable = [scene_id for scene_id in dict.fromkeys(scene_ids) if scene_id in positions and first <= positions[scene_id] <= last]
  rows = [row for row in fact.get("knowledge", []) if row.get("state") in {"knows", "believes", "does_not_know"}
    and (not row.get("from_scene_id") or row["from_scene_id"] in positions)]
  result = []
  for row in rows:
    start = positions.get(row.get("from_scene_id", ""), -1)
    later = [positions[other["from_scene_id"]] for other in rows if other.get("character_entity_id") == row.get("character_entity_id")
      and other.get("from_scene_id") in positions and positions[other["from_scene_id"]] > start]
    end = min(later, default=10**9)
    targets = [scene_id for scene_id in applicable if start <= positions[scene_id] < end]
    if targets:
      result.append({**row, "applies_to_scene_ids": targets})
  return result


def _diagnostic_id(code: str, refs: list[str]) -> str:
  digest = hashlib.sha256(f"{code}:{':'.join(sorted(refs))}".encode("utf-8")).hexdigest()[:16]
  return f"memory-diagnostic-{digest}"


def _knowledge_mention(body: str, value: str, names: set[str]) -> re.Match[str] | None:
  # Match original text so evidence offsets survive Unicode case changes.
  pattern = (r"(?<!\w)" if value[0].isalnum() or value[0] == "_" else "") + re.escape(value)
  pattern += r"(?!\w)" if value[-1].isalnum() or value[-1] == "_" else ""
  subject = "|".join(re.escape(name) for name in names if name)
  ignorance = re.compile(rf"(?<!\w)(?:{subject}|I|he|she|they)\s+(?:"
    r"(?:did|does|do)\s+not\s+know|(?:didn|doesn|don)['’]t\s+know|"
    r"(?:was|were|is|are)\s+unaware|(?:had|has|have)\s+no\s+idea|knew\s+nothing)\b", re.IGNORECASE)
  for match in re.finditer(pattern, body, re.IGNORECASE):
    # Suppress only explicit ignorance in this clause, not unrelated negation
    # elsewhere in the sentence or later affirmative mentions of the same fact.
    prefix = re.split(r"[.!?;\n]|\b(?:but|however|yet)\b", body[:match.start()], flags=re.IGNORECASE)[-1]
    if not ignorance.search(prefix):
      return match
  return None


@serialized_project_access
def run_canon_diagnostics(
  paths: ProjectPaths,
  *,
  affected_scene_ids: list[str] | None = None,
) -> dict[str, Any]:
  memory = _read_memory(paths)
  positions = _scene_positions(paths)
  facts = [row for row in memory["facts"] if row.get("status") == "accepted"]
  scenes = list_scene_details(paths)
  scene_bodies = {scene["id"]: scene["body"] for scene in scenes}
  diagnostics = prose_trait_diagnostics(scenes, list_entities(paths))
  source_records = [("Canon Fact", row, row["evidence"]) for row in facts]
  source_records.extend(("Setup or payoff", row, [item for item in [row.get("setup_evidence"), row.get("payoff_evidence")] if item]) for row in memory["setups"])
  source_records.extend(("Character Arc", row, [row["evidence"]]) for row in memory.get("arcs", []))
  for kind, record, passages in source_records:
    missing = [item for item in passages if not item.get("excerpt") or item["excerpt"] not in scene_bodies.get(item.get("scene_id"), "")]
    if missing:
      diagnostics.append({
        "id": _diagnostic_id("stale_evidence", [record["id"]]),
        "code": "stale_evidence",
        "severity": "warning",
        "title": "Source evidence needs review",
        "message": f"{kind} evidence no longer appears in its cited scene, or was never an exact quote. Review the current prose before relying on this record. The author-owned record has not been changed.",
        "fact_ids": [record["id"]] if kind == "Canon Fact" else [],
        "scene_ids": list(dict.fromkeys(item["scene_id"] for item in missing)),
        "evidence": missing,
      })
  groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
  for fact in facts:
    groups[(fact.get("subject_entity_id", ""), fact["predicate"].casefold())].append(fact)
    start, end = _validity_range(fact, positions)
    if start > end:
      diagnostics.append({
        "id": _diagnostic_id("impossible_validity", [fact["id"]]),
        "code": "impossible_validity",
        "severity": "error",
        "title": "Fact ends before it becomes true",
        "message": f"'{fact['predicate']}: {fact['value']}' has an impossible validity range.",
        "fact_ids": [fact["id"]],
        "scene_ids": [fact["validity"]["from_scene_id"], fact["validity"]["to_scene_id"]],
        "evidence": fact["evidence"],
      })
  for rows in groups.values():
    for index, left in enumerate(rows):
      for right in rows[index + 1:]:
        left_range = _validity_range(left, positions)
        right_range = _validity_range(right, positions)
        overlaps = max(left_range[0], right_range[0]) <= min(left_range[1], right_range[1])
        exclusive = left["predicate"].casefold().strip() not in NONEXCLUSIVE_PREDICATES
        if exclusive and overlaps and left["value"].casefold() != right["value"].casefold():
          diagnostics.append({
            "id": _diagnostic_id("conflicting_facts", [left["id"], right["id"]]),
            "code": "conflicting_facts",
            "severity": "error",
            "title": "Conflicting Canon Facts",
            "message": f"'{left['predicate']}' is both '{left['value']}' and '{right['value']}' in the same story interval.",
            "fact_ids": [left["id"], right["id"]],
            "scene_ids": sorted({item["scene_id"] for item in left["evidence"] + right["evidence"]}),
            "evidence": left["evidence"] + right["evidence"],
          })

  arc_groups: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
  for arc in memory.get("arcs", []):
    arc_groups[(arc.get("character_entity_id", ""), arc.get("dimension", "").casefold(), arc.get("scene_id", ""))].append(arc)
  for rows in arc_groups.values():
    observed_values = {row.get("value", "").casefold() for row in rows if row.get("state_type") == "observed"}
    planned_values = {row.get("value", "").casefold() for row in rows if row.get("state_type") == "planned"}
    distinct = {row.get("value", "").casefold() for row in rows}
    if len(observed_values) > 1:
      diagnostics.append({
        "id": _diagnostic_id("arc_state_conflict", [row["id"] for row in rows]),
        "code": "arc_state_conflict",
        "severity": "warning",
        "title": "Conflicting Character Arc States",
        "message": f"Multiple observed values are recorded for '{rows[0]['dimension']}' in the same scene.",
        "fact_ids": [],
        "arc_state_ids": [row["id"] for row in rows],
        "scene_ids": [rows[0]["scene_id"]],
        "evidence": [row["evidence"] for row in rows],
      })
    elif observed_values and planned_values and observed_values != planned_values and len(distinct) > 1:
      diagnostics.append({
        "id": _diagnostic_id("arc_plan_divergence", [row["id"] for row in rows]),
        "code": "arc_plan_divergence",
        "severity": "info",
        "title": "Character Arc diverged from plan",
        "message": f"The observed '{rows[0]['dimension']}' state differs from the planned state in this scene.",
        "fact_ids": [],
        "arc_state_ids": [row["id"] for row in rows],
        "scene_ids": [rows[0]["scene_id"]],
        "evidence": [row["evidence"] for row in rows],
      })

  entities: dict[str, dict[str, Any]] = {}
  scenes_by_id = {scene["id"]: scene for scene in scenes}
  for fact in facts:
    for knowledge in resolve_fact_knowledge(fact, list(positions), positions):
      if knowledge.get("state") != "does_not_know":
        continue
      character_id = knowledge["character_entity_id"]
      if character_id not in entities:
        entities[character_id] = get_entity(paths, character_id)
      character = entities[character_id]
      names = {character["name"].casefold(), *(str(alias).casefold() for alias in character.get("aliases", []))}
      for scene_id in knowledge["applies_to_scene_ids"]:
        scene = scenes_by_id[scene_id]
        if scene.get("pov", "").casefold() not in names:
          continue
        value = fact["value"]
        body = scene.get("body", "")
        mention = _knowledge_mention(body, value, names)
        if mention:
          diagnostics.append({
            "id": _diagnostic_id("pov_knowledge_leak", [fact["id"], character_id, scene["id"]]),
            "code": "pov_knowledge_leak",
            "severity": "warning",
            "title": "Possible POV knowledge leak",
            "message": f"{character['name']} is marked as not knowing '{value}', but this phrase appears in their POV scene. A mention alone does not prove they know it; review the narrative context.",
            "fact_ids": [fact["id"]],
            "scene_ids": [scene["id"]],
            "evidence": [*fact["evidence"], {"scene_id": scene["id"], "excerpt": mention.group(), "start": mention.start(), "end": mention.end()}],
          })

  manuscript_length = len(positions)
  for setup in memory["setups"]:
    if setup.get("status") != "open":
      continue
    setup_position = positions.get(setup["setup_evidence"]["scene_id"], 0)
    if manuscript_length - setup_position >= 5:
      diagnostics.append({
        "id": _diagnostic_id("unresolved_setup", [setup["id"]]),
        "code": "unresolved_setup",
        "severity": "info",
        "title": "Setup remains unresolved",
        "message": setup["description"],
        "fact_ids": [],
        "scene_ids": [setup["setup_evidence"]["scene_id"]],
        "evidence": [setup["setup_evidence"]],
      })

  disposition_map = {row["diagnostic_id"]: row for row in memory["dispositions"]}
  for diagnostic in diagnostics:
    diagnostic["disposition"] = disposition_map.get(diagnostic["id"])
  if affected_scene_ids:
    affected = set(affected_scene_ids)
    diagnostics = [
      row for row in diagnostics
      if affected.intersection(row["scene_ids"]) or row["code"] == "conflicting_facts"
    ]
  return {
    "generated_at": utc_now(),
    "coverage": {
      "method": "Local, limited pattern checks plus author-recorded Canon, knowledge, setups and arcs.",
      "limitations": ["Not a comprehensive plot, timeline, motivation or prose-quality analysis.", "Physical-detail warnings are unconfirmed observations, not Canon Facts.", "Knowledge checks match literal phrases and a limited set of English ignorance expressions; dialogue and paraphrases still require author review."],
    },
    "affected_scene_ids": affected_scene_ids or [],
    "incremental": affected_scene_ids is not None,
    "diagnostics": diagnostics,
    "summary": {
      "errors": sum(row["severity"] == "error" for row in diagnostics),
      "warnings": sum(row["severity"] == "warning" for row in diagnostics),
      "info": sum(row["severity"] == "info" for row in diagnostics),
    },
  }


@serialized_project_access
def disposition_diagnostic(
  paths: ProjectPaths,
  diagnostic_id: str,
  *,
  disposition: str,
  notes: str = "",
) -> dict[str, Any]:
  if disposition not in DIAGNOSTIC_DISPOSITIONS:
    raise OpenAuthorError(f"Invalid diagnostic disposition '{disposition}'.")
  current = run_canon_diagnostics(paths)["diagnostics"]
  if not any(row["id"] == diagnostic_id for row in current):
    raise OpenAuthorError(f"Unknown current diagnostic '{diagnostic_id}'.")
  memory = _read_memory(paths)
  row = next((item for item in memory["dispositions"] if item["diagnostic_id"] == diagnostic_id), None)
  if row is None:
    row = {"diagnostic_id": diagnostic_id, "created_at": utc_now()}
    memory["dispositions"].append(row)
  row.update({"disposition": disposition, "notes": notes.strip(), "updated_at": utc_now()})
  _write_memory(paths, memory)
  return row


@serialized_project_access
def assess_story_memory_impact(
  paths: ProjectPaths,
  *,
  scene_id: str,
  before_body: str,
  after_body: str,
) -> dict[str, Any]:
  memory = _read_memory(paths)
  affected: list[dict[str, Any]] = []
  warnings: list[str] = []
  before_folded = before_body.casefold()
  after_folded = after_body.casefold()
  for fact in memory["facts"]:
    if fact.get("status") != "accepted":
      continue
    supported_here = any(row.get("scene_id") == scene_id for row in fact.get("evidence", []))
    value = str(fact.get("value", ""))
    removed_value = value and value.casefold() in before_folded and value.casefold() not in after_folded
    introduced_value = value and value.casefold() not in before_folded and value.casefold() in after_folded
    if supported_here or removed_value or introduced_value:
      reason = "This scene is cited as evidence for the fact."
      if removed_value:
        reason = "The proposed prose removes the fact's recorded value."
        warnings.append(f"May invalidate Canon Fact: {fact['predicate']} = {value}")
      elif introduced_value:
        reason = "The proposed prose introduces a recorded Canon value."
      affected.append({
        "kind": "canon_fact",
        "id": fact["id"],
        "label": f"{fact['predicate']}: {value}",
        "reason": reason,
      })
  for setup in memory["setups"]:
    evidence_rows = [setup.get("setup_evidence"), setup.get("payoff_evidence")]
    if any(row and row.get("scene_id") == scene_id for row in evidence_rows):
      affected.append({
        "kind": "setup_payoff",
        "id": setup["id"],
        "label": setup["description"],
        "reason": "This scene anchors the setup or payoff.",
      })
  return {
    "affected": affected,
    "warnings": warnings,
    "risk": "high" if warnings else "medium" if affected else "low",
  }
