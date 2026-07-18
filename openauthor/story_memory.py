from __future__ import annotations

import hashlib
import json
import re
from collections import Counter, defaultdict
from typing import Any

from .codex import add_entity, list_entities, update_entity
from .project import OpenAuthorError, ProjectPaths, atomic_write_json, utc_now
from .scenes import get_scene, list_scenes

SUGGESTION_SCHEMA_VERSION = 1
SUGGESTION_STATUSES = {"pending", "accepted", "rejected", "deferred"}
NAME_PATTERN = re.compile(r"\b[A-Z][a-z]+(?:\s+(?:[A-Z][a-z]+|of|the)){0,2}\b")
NAME_STOPWORDS = {
  "A", "An", "And", "As", "At", "But", "By", "For", "From", "He", "Her",
  "His", "I", "If", "In", "It", "Its", "No", "Not", "Of", "On", "Or",
  "She", "So", "That", "The", "Their", "Then", "They", "This", "To", "We",
  "When", "Where", "Who", "With", "You",
}
NAME_TITLES = {
  "captain", "chancellor", "colonel", "dame", "detective", "doctor", "dr",
  "general", "inspector", "king", "lady", "lord", "prince", "princess",
  "professor", "queen", "sir",
}


def _suggestions_path(paths: ProjectPaths):
  return paths.root / "codex" / "suggestions.json"


def _read_store(paths: ProjectPaths) -> dict[str, Any]:
  path = _suggestions_path(paths)
  if not path.exists():
    return {"schema_version": SUGGESTION_SCHEMA_VERSION, "suggestions": []}
  try:
    payload = json.loads(path.read_text(encoding="utf-8"))
  except (OSError, json.JSONDecodeError) as error:
    raise OpenAuthorError(f"Story Memory suggestions are unreadable: {error}") from error
  if payload.get("schema_version") != SUGGESTION_SCHEMA_VERSION:
    raise OpenAuthorError("Unsupported Story Memory suggestion schema version.")
  return payload


def _suggestion_id(entity_type: str, name: str) -> str:
  digest = hashlib.sha256(f"{entity_type}:{name.casefold()}".encode("utf-8")).hexdigest()[:16]
  return f"memory-suggestion-{digest}"


def _fact_suggestion_id(entity_id: str, predicate: str, value: str) -> str:
  digest = hashlib.sha256(
    f"{entity_id}:{predicate.casefold()}:{value.casefold()}".encode("utf-8")
  ).hexdigest()[:16]
  return f"memory-fact-suggestion-{digest}"


def _identity_key(name: str) -> str:
  parts = name.casefold().split()
  if len(parts) > 1 and parts[0].rstrip(".") in NAME_TITLES:
    parts = parts[1:]
  return " ".join(parts)


def _consolidate_character_names(
  counts: Counter[str],
  evidence: dict[str, list[dict[str, Any]]],
  pov_names: set[str],
) -> dict[str, list[str]]:
  """Merge an unambiguous short name into the full name seen in the manuscript."""
  full_names = [name for name in counts if len(name.split()) > 1]
  aliases: dict[str, list[str]] = defaultdict(list)
  for short_name in list(counts):
    if len(short_name.split()) != 1:
      continue
    short_key = short_name.casefold()
    matches = [
      full_name for full_name in full_names
      if short_key in {full_name.split()[0].casefold(), full_name.split()[-1].casefold()}
    ]
    if len(matches) != 1:
      continue
    canonical_name = matches[0]
    counts[canonical_name] += counts.pop(short_name)
    for item in evidence.pop(short_name, []):
      identity = (item.get("scene_id"), item.get("start"), item.get("end"))
      existing = {
        (row.get("scene_id"), row.get("start"), row.get("end"))
        for row in evidence[canonical_name]
      }
      if identity not in existing and len(evidence[canonical_name]) < 3:
        evidence[canonical_name].append(item)
    aliases[canonical_name].append(short_name)
    if short_name in pov_names:
      pov_names.discard(short_name)
      pov_names.add(canonical_name)
  return aliases


def _matching_entity(
  entities: list[dict[str, Any]],
  name: str,
  aliases: list[str],
) -> dict[str, Any] | None:
  candidate_names = {_identity_key(name), *(_identity_key(alias) for alias in aliases)}
  for entity in entities:
    entity_names = {
      _identity_key(str(entity.get("name", ""))),
      *(_identity_key(str(alias)) for alias in entity.get("aliases", [])),
    }
    if candidate_names & entity_names:
      return entity
  return None


def queue_memory_suggestion(
  paths: ProjectPaths,
  *,
  title: str,
  content: str,
  scene_id: str = "",
  source: str = "assistant",
) -> dict[str, Any]:
  if not content.strip():
    raise OpenAuthorError("Story Memory suggestion content is required.")
  normalized_title = title.strip() or "Assistant insight"
  digest = hashlib.sha256(
    f"{source}:{scene_id}:{normalized_title}:{content.strip()}".encode("utf-8")
  ).hexdigest()[:16]
  suggestion_id = f"memory-assistant-suggestion-{digest}"
  store = _read_store(paths)
  existing = next((row for row in store["suggestions"] if row.get("id") == suggestion_id), None)
  if existing is not None:
    return existing
  suggestion = {
    "id": suggestion_id,
    "kind": "memory_note",
    "entity_type": "lore",
    "name": normalized_title,
    "description": content.strip(),
    "details": [{"key": "source", "value": source, "type": "text"}],
    "confidence": 0.5,
    "reason": "Promoted for author review from an Assistant conversation",
    "evidence": ([{"scene_id": scene_id, "path": "", "excerpt": content.strip()[:240], "start": 0, "end": 0}] if scene_id else []),
    "status": "pending",
    "created_at": utc_now(),
    "updated_at": utc_now(),
  }
  store["suggestions"].append(suggestion)
  atomic_write_json(_suggestions_path(paths), store)
  return suggestion


def list_memory_suggestions(
  paths: ProjectPaths,
  *,
  status: str | None = None,
) -> list[dict[str, Any]]:
  if status is not None and status not in SUGGESTION_STATUSES:
    raise OpenAuthorError(f"Invalid Story Memory suggestion status '{status}'.")
  rows = _read_store(paths)["suggestions"]
  if status is not None:
    rows = [row for row in rows if row.get("status") == status]
  return sorted(rows, key=lambda row: (-float(row.get("confidence", 0)), row.get("name", "")))


def extract_memory_suggestions(
  paths: ProjectPaths,
  *,
  scene_ids: list[str] | None = None,
) -> dict[str, Any]:
  selected = set(scene_ids or [])
  scenes = [row for row in list_scenes(paths) if not selected or row["id"] in selected]
  entities = list_entities(paths)
  existing_names: set[str] = set()
  for entity in entities:
    existing_names.add(_identity_key(entity["name"]))
    existing_names.update(_identity_key(str(alias)) for alias in entity.get("aliases", []))

  counts: Counter[str] = Counter()
  evidence: dict[str, list[dict[str, Any]]] = defaultdict(list)
  pov_names: set[str] = set()
  fact_candidates: dict[str, dict[str, Any]] = {}
  for scene_summary in scenes:
    scene = get_scene(paths, scene_summary["id"])
    pov = str(scene.get("pov", "")).strip()
    if pov:
      pov_names.add(pov)
      counts[pov] += 3
      evidence[pov].append({
        "scene_id": scene["id"],
        "path": scene["path"],
        "excerpt": f"POV: {pov}",
        "start": 0,
        "end": 0,
      })
    body = str(scene.get("body", ""))
    for match in NAME_PATTERN.finditer(body):
      name = match.group(0).strip()
      if name in NAME_STOPWORDS or len(name) < 3:
        continue
      counts[name] += 1
      if len(evidence[name]) < 3:
        start = max(0, match.start() - 70)
        end = min(len(body), match.end() + 100)
        evidence[name].append({
          "scene_id": scene["id"],
          "path": scene["path"],
          "excerpt": " ".join(body[start:end].split()),
          "start": match.start(),
          "end": match.end(),
        })
    for entity in entities:
      names = [entity["name"], *entity.get("aliases", [])]
      for entity_name in names:
        pattern = re.compile(
          rf"\b{re.escape(entity_name)}\s+(is|was|has|owns|knows|believes|lives\s+in)\s+([^.!?\n]{{2,120}})",
          flags=re.IGNORECASE,
        )
        for match in pattern.finditer(body):
          predicate = " ".join(match.group(1).lower().split())
          value = match.group(2).strip(" ,;:")
          suggestion_id = _fact_suggestion_id(entity["id"], predicate, value)
          fact_candidates[suggestion_id] = {
            "id": suggestion_id,
            "kind": "canon_fact",
            "subject_entity_id": entity["id"],
            "subject_name": entity["name"],
            "name": f"{entity['name']}: {predicate} {value}",
            "predicate": predicate,
            "value": value,
            "confidence": 0.72,
            "reason": "Declarative statement mentioning an accepted Story Memory entry",
            "evidence": [{
              "scene_id": scene["id"],
              "path": scene["path"],
              "excerpt": match.group(0),
              "start": match.start(),
              "end": match.end(),
            }],
          }

  name_aliases = _consolidate_character_names(counts, evidence, pov_names)

  store = _read_store(paths)
  previous = {row["id"]: row for row in store["suggestions"]}
  for suggestion_id, suggestion in list(previous.items()):
    if (
      suggestion.get("kind") == "entity_create"
      and suggestion.get("status") in {"pending", "deferred"}
      and not suggestion.get("author_corrected")
      and _identity_key(str(suggestion.get("name", ""))) in existing_names
    ):
      previous.pop(suggestion_id)
  for aliases in name_aliases.values():
    for alias in aliases:
      alias_id = _suggestion_id("character", alias)
      alias_suggestion = previous.get(alias_id)
      if (
        alias_suggestion
        and alias_suggestion.get("status") in {"pending", "deferred"}
        and not alias_suggestion.get("author_corrected")
      ):
        previous.pop(alias_id)
  added = 0
  refreshed = 0
  for name, count in counts.items():
    if _identity_key(name) in existing_names or count < 2:
      continue
    entity_type = "character"
    suggestion_id = _suggestion_id(entity_type, name)
    current = previous.get(suggestion_id)
    confidence = min(0.95, 0.45 + count * 0.08 + (0.15 if name in pov_names else 0))
    # Keep author-owned review metadata when prose evidence is refreshed. The
    # extraction pass is derived state: changing its timestamp alone must not
    # manufacture a Storyline conflict when two branches infer the same result.
    row = {
      **(current or {}),
      "id": suggestion_id,
      "kind": "entity_create",
      "entity_type": entity_type,
      "name": name,
      "aliases": name_aliases.get(name, []),
      "description": f"Appears in {len({item['scene_id'] for item in evidence[name]})} scene(s).",
      "details": [],
      "confidence": round(confidence, 2),
      "reason": "POV metadata and repeated proper-name mentions" if name in pov_names else "Repeated proper-name mentions",
      "evidence": evidence[name],
      "status": current.get("status", "pending") if current else "pending",
      "created_at": current.get("created_at", utc_now()) if current else utc_now(),
    }
    if current and current.get("author_corrected"):
      row["name"] = current.get("name", row["name"])
      row["description"] = current.get("description", row["description"])
    row["updated_at"] = (
      current.get("updated_at", current.get("created_at", utc_now()))
      if current
      else utc_now()
    )
    if current:
      refreshed += 1
    else:
      added += 1
    previous[suggestion_id] = row
  for suggestion_id, candidate in fact_candidates.items():
    current = previous.get(suggestion_id)
    candidate = {
      **(current or {}),
      **candidate,
      "status": current.get("status", "pending") if current else "pending",
      "created_at": current.get("created_at", utc_now()) if current else utc_now(),
      "updated_at": (
        current.get("updated_at", current.get("created_at", utc_now()))
        if current
        else utc_now()
      ),
    }
    if current and current.get("author_corrected"):
      for key in ("name", "description", "predicate", "value"):
        if key in current:
          candidate[key] = current[key]
    if current:
      refreshed += 1
    else:
      added += 1
    previous[suggestion_id] = candidate
  store["suggestions"] = list(previous.values())
  atomic_write_json(_suggestions_path(paths), store)
  return {
    "scanned_scenes": len(scenes),
    "added": added,
    "refreshed": refreshed,
    "pending": len([row for row in store["suggestions"] if row["status"] == "pending"]),
    "suggestions": list_memory_suggestions(paths),
  }


def review_memory_suggestion(
  paths: ProjectPaths,
  suggestion_id: str,
  *,
  disposition: str,
) -> dict[str, Any]:
  if disposition not in SUGGESTION_STATUSES - {"pending"}:
    raise OpenAuthorError("Suggestion disposition must be accepted, rejected, or deferred.")
  store = _read_store(paths)
  suggestion = next((row for row in store["suggestions"] if row.get("id") == suggestion_id), None)
  if suggestion is None:
    raise OpenAuthorError(f"Unknown Story Memory suggestion '{suggestion_id}'.")
  if suggestion.get("status") != "pending" and suggestion.get("status") != "deferred":
    raise OpenAuthorError("This Story Memory suggestion has already been decided.")
  created_entity_id = ""
  if disposition == "accepted":
    if suggestion.get("kind") == "canon_fact":
      from .canon import add_canon_fact
      fact = add_canon_fact(
        paths,
        subject_entity_id=suggestion["subject_entity_id"],
        predicate=suggestion["predicate"],
        value=suggestion["value"],
        evidence=suggestion["evidence"],
        confidence=float(suggestion.get("confidence", 0.5)),
      )
      suggestion["created_fact_id"] = fact["id"]
    else:
      aliases = [
        str(alias).strip() for alias in suggestion.get("aliases", [])
        if str(alias).strip() and str(alias).casefold() != suggestion["name"].casefold()
      ]
      entities = list_entities(paths)
      existing = _matching_entity(entities, suggestion["name"], aliases)
      if existing:
        merged_aliases = list(existing.get("aliases", []))
        known = {str(alias).casefold() for alias in merged_aliases}
        known.add(existing["name"].casefold())
        for alias in [suggestion["name"], *aliases]:
          if alias.casefold() not in known:
            merged_aliases.append(alias)
            known.add(alias.casefold())
        if merged_aliases != existing.get("aliases", []):
          update_entity(paths, entity_id=existing["id"], aliases=merged_aliases)
        created_entity_id = existing["id"]
      else:
        created_entity_id = add_entity(
          paths,
          kind=suggestion["entity_type"],
          name=suggestion["name"],
          description=suggestion.get("description", ""),
          aliases=aliases,
          details=suggestion.get("details", []),
          notes=f"Accepted from suggestion {suggestion_id}. Evidence remains in codex/suggestions.json.",
        )
  suggestion["status"] = disposition
  suggestion["decided_at"] = utc_now()
  suggestion["created_entity_id"] = created_entity_id
  if disposition == "accepted" and suggestion.get("kind") != "canon_fact":
    accepted_names = {
      suggestion["name"].casefold(),
      *(str(alias).casefold() for alias in suggestion.get("aliases", [])),
    }
    for other in store["suggestions"]:
      if other is suggestion or other.get("kind") == "canon_fact":
        continue
      other_names = {
        str(other.get("name", "")).casefold(),
        *(str(alias).casefold() for alias in other.get("aliases", [])),
      }
      if other.get("status") in {"pending", "deferred"} and accepted_names & other_names:
        other["status"] = "accepted"
        other["decided_at"] = suggestion["decided_at"]
        other["created_entity_id"] = created_entity_id
        other["merged_into_suggestion_id"] = suggestion_id
  atomic_write_json(_suggestions_path(paths), store)
  from .product_signals import record_product_event
  record_product_event(paths, "story_memory_suggestion_reviewed", disposition=disposition)
  return suggestion


def correct_memory_suggestion(
  paths: ProjectPaths,
  suggestion_id: str,
  *,
  name: str | None = None,
  description: str | None = None,
  predicate: str | None = None,
  value: str | None = None,
) -> dict[str, Any]:
  store = _read_store(paths)
  suggestion = next((row for row in store["suggestions"] if row.get("id") == suggestion_id), None)
  if suggestion is None:
    raise OpenAuthorError(f"Unknown Story Memory suggestion '{suggestion_id}'.")
  if suggestion.get("status") not in {"pending", "deferred"}:
    raise OpenAuthorError("Only pending or deferred Story Memory suggestions can be corrected.")
  updates = {
    "name": name,
    "description": description,
    "predicate": predicate,
    "value": value,
  }
  changed = False
  for key, candidate in updates.items():
    if candidate is None:
      continue
    normalized = candidate.strip()
    if key in {"name", "predicate", "value"} and not normalized:
      raise OpenAuthorError(f"Corrected suggestion {key} cannot be blank.")
    suggestion[key] = normalized
    changed = True
  if not changed:
    raise OpenAuthorError("No Story Memory suggestion corrections provided.")
  suggestion["author_corrected"] = True
  suggestion["corrected_at"] = utc_now()
  suggestion["updated_at"] = utc_now()
  atomic_write_json(_suggestions_path(paths), store)
  return suggestion
