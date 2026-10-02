from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from typing import Any

from .codex import ENTITY_TYPES, add_entity, add_relationship, list_entities, list_relationships, update_entity
from .project import OpenAuthorError, ProjectPaths, atomic_write_json, utc_now
from .scenes import get_scene, list_scene_details, list_scenes
from .project_locks import serialized_project_access
from .scene_edits import workspace_edit_scope

SUGGESTION_SCHEMA_VERSION = 1
SUGGESTION_STATUSES = {"pending", "accepted", "rejected", "deferred"}
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
SENTENCE_TRANSITIONS = {"meanwhile", "however", "nevertheless", "therefore", "afterward", "finally", "suddenly", "instead", "still", "yet", "otherwise", "eventually"}
SPATIAL_OPENERS = {"beyond", "beneath", "above", "across", "behind", "beside", "between", "inside", "outside", "through", "under"}
CLAUSE_OPENERS = {"after", "before", "once", "while", "until", "although", "unless", "without", "since"}
RELATION_PATTERNS = {
  "trusts": r"trusts?",
  "distrusts": r"(?:distrusts?|does\s+not\s+trust)",
  "protects": r"(?:protects?|guards?)",
  "loves": r"loves?",
  "fears": r"fears?",
  "owes": r"owes?",
  "betrayed": r"betrayed",
  "serves": r"serves?",
  "works for": r"works\s+for",
  "is sibling of": r"(?:is|was)\s+(?:the\s+)?(?:brother|sister|sibling)\s+of",
  "is parent of": r"(?:is|was)\s+(?:the\s+)?(?:mother|father|parent)\s+of",
  "is child of": r"(?:is|was)\s+(?:the\s+)?(?:son|daughter|child)\s+of",
}
SYMMETRIC_RELATIONS = {"is sibling of"}


def _proper_name_mentions(body: str):
  """Keep Unicode spelling and source offsets without an ASCII-only capital class."""
  words: list[tuple[str, int, int]] = []
  cursor = 0
  while cursor < len(body):
    if not body[cursor].isalpha():
      cursor += 1
      continue
    start = cursor
    cursor += 1
    while cursor < len(body):
      char = body[cursor]
      if char.isalpha() or unicodedata.category(char).startswith("M"):
        cursor += 1
      elif char in "'’‐‑-" and cursor + 1 < len(body) and body[cursor + 1].isalpha():
        cursor += 1
      else:
        break
    value = body[start:cursor]
    end = cursor - 2 if value.endswith(("'s", "’s")) else cursor
    words.append((body[start:end], start, end))
  stopwords = {word.casefold() for word in NAME_STOPWORDS}
  particles = {"of", "the", "de", "del", "da", "di", "van", "von"}

  def capitalized(value: str) -> bool:
    return value[0].isupper() and any(char.islower() for char in value) and value.casefold() not in stopwords

  index = 0
  while index < len(words):
    first = words[index]
    if not capitalized(first[0]):
      index += 1
      continue
    # Capitalization alone is not evidence of a person. Suppress grammatical
    # openers without banning the same spelling when it is used as a name.
    following = words[index + 1] if index + 1 < len(words) else None
    separator = body[first[2]:following[1]] if following else body[first[2]:]
    transition = first[0].casefold() in SENTENCE_TRANSITIONS and separator.lstrip().startswith(",")
    spatial = (first[0].casefold() in SPATIAL_OPENERS and following is not None
      and separator.isspace() and following[0].casefold() in {"the", "a", "an", "his", "her", "their", "our", "my", "this", "that"})
    clause = (first[0].casefold() in CLAUSE_OPENERS and following is not None and separator.isspace()
      and following[0].casefold() in {"the", "a", "an", "his", "her", "their", "our", "my", "this", "that", "he", "she", "it", "they", "we", "dawn", "dusk", "noon", "midnight", "sunrise", "sunset"})
    modifier = (first[0].casefold() in {"only", "even"} and following is not None
      and separator.isspace() and capitalized(following[0]))
    if transition or spatial or clause or modifier:
      index += 1
      continue
    end_index = index
    while end_index + 1 < len(words) and end_index - index < 5:
      following = words[end_index + 1]
      gap = body[words[end_index][2]:following[1]]
      title_period = words[end_index][0].casefold() in NAME_TITLES and gap.startswith(".") and gap[1:].isspace()
      if (not gap.isspace() and not title_period) or "\n\n" in gap:
        break
      if capitalized(following[0]):
        end_index += 1
        continue
      if following[0] in particles and end_index + 2 < len(words):
        after = words[end_index + 2]
        second_gap = body[following[2]:after[1]]
        if capitalized(after[0]) and second_gap.isspace() and "\n\n" not in second_gap:
          end_index += 2
          continue
      break
    start, end = first[1], words[end_index][2]
    yield unicodedata.normalize("NFC", " ".join(body[start:end].split())), start, end
    index = end_index + 1


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


def _relationship_key(source_entity_id: str, target_entity_id: str, relation: str) -> tuple[str, str, str]:
  source = source_entity_id
  target = target_entity_id
  normalized_relation = " ".join(relation.casefold().split())
  if normalized_relation in SYMMETRIC_RELATIONS and source > target:
    source, target = target, source
  return source, target, normalized_relation


def _relationship_suggestion_id(source_entity_id: str, target_entity_id: str, relation: str) -> str:
  source, target, normalized_relation = _relationship_key(source_entity_id, target_entity_id, relation)
  digest = hashlib.sha256(f"{source}:{normalized_relation}:{target}".encode("utf-8")).hexdigest()[:16]
  return f"memory-relationship-suggestion-{digest}"


def _relationship_candidates(
  scenes: list[dict[str, Any]],
  entities: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
  mention_entities: dict[str, list[dict[str, Any]]] = defaultdict(list)
  mention_labels: dict[str, str] = {}
  for entity in entities:
    for mention in [entity["name"], *entity.get("aliases", [])]:
      cleaned = str(mention).strip()
      if not cleaned:
        continue
      key = cleaned.casefold()
      mention_entities[key].append(entity)
      mention_labels[key] = cleaned
  unambiguous = {
    key: rows[0] for key, rows in mention_entities.items()
    if len({row["id"] for row in rows}) == 1
  }
  if len(unambiguous) < 2:
    return {}
  mention_pattern = "|".join(
    re.escape(mention_labels[key])
    for key in sorted(unambiguous, key=lambda value: len(mention_labels[value]), reverse=True)
  )
  compiled = [
    (
      relation,
      re.compile(
        rf"\b(?P<source>{mention_pattern})\s+(?:{pattern})\s+(?P<target>{mention_pattern})\b",
        flags=re.IGNORECASE,
      ),
    )
    for relation, pattern in RELATION_PATTERNS.items()
  ]
  candidates: dict[str, dict[str, Any]] = {}
  for scene in scenes:
    body = str(scene.get("body", ""))
    for relation, pattern in compiled:
      for match in pattern.finditer(body):
        source = unambiguous.get(match.group("source").casefold())
        target = unambiguous.get(match.group("target").casefold())
        if source is None or target is None or source["id"] == target["id"]:
          continue
        suggestion_id = _relationship_suggestion_id(source["id"], target["id"], relation)
        candidate = candidates.setdefault(suggestion_id, {
          "id": suggestion_id,
          "kind": "relationship_create",
          "source_entity_id": source["id"],
          "source_name": source["name"],
          "target_entity_id": target["id"],
          "target_name": target["name"],
          "relation": relation,
          "name": f"{source['name']} {relation} {target['name']}",
          "description": "Explicit relationship statement found in manuscript prose.",
          "confidence": 0.82,
          "reason": "Explicit named relationship in manuscript prose",
          "valid_from_scene_id": scene["id"],
          "valid_to_scene_id": "",
          "evidence": [],
        })
        if len(candidate["evidence"]) < 3:
          candidate["evidence"].append({
            "scene_id": scene["id"],
            "path": scene["path"],
            "excerpt": match.group(0),
            "start": match.start(),
            "end": match.end(),
          })
        candidate["confidence"] = min(0.96, round(0.82 + (len(candidate["evidence"]) - 1) * 0.05, 2))
  return candidates


def _identity_key(name: str) -> str:
  normalized = unicodedata.normalize("NFC", name).casefold().replace("’", "'").replace("‐", "-").replace("‑", "-")
  parts = normalized.split()
  if len(parts) > 1 and parts[0].rstrip(".") in NAME_TITLES:
    parts = parts[1:]
  return " ".join(parts)


def _evidence_fingerprint(scene: dict[str, Any], evidence: dict[str, Any]) -> str:
  # POV metadata is independent of prose. Hashing the whole scene for it would
  # manufacture a Memory merge conflict when only the scene's prose diverges.
  source = {"pov": scene.get("pov", "")}
  if evidence.get("source_field") != "pov":
    source["body"] = scene.get("body", "")
  return hashlib.sha256(json.dumps(source, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def _consolidate_character_names(
  counts: Counter[str],
  evidence: dict[str, list[dict[str, Any]]],
  pov_names: set[str],
) -> dict[str, list[str]]:
  """Merge an unambiguous short name into the full name seen in the manuscript."""
  aliases: dict[str, list[str]] = defaultdict(list)

  def merge(short_name: str, canonical_name: str) -> None:
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

  equivalent: dict[str, list[str]] = defaultdict(list)
  for name in counts:
    equivalent[_identity_key(name)].append(name)
  for names in equivalent.values():
    canonical = min(names, key=lambda name: (name not in pov_names, len(name.split()), -counts[name], name))
    for variant in names:
      if variant != canonical:
        merge(variant, canonical)

  full_names = [name for name in counts if len(_identity_key(name).split()) > 1]
  for short_name in list(counts):
    short_key = _identity_key(short_name)
    if len(short_key.split()) != 1:
      continue
    matches = [full_name for full_name in full_names
               if short_key in {_identity_key(full_name).split()[0], _identity_key(full_name).split()[-1]}]
    if len(matches) == 1:
      canonical = matches[0]
      inherited = aliases.pop(short_name, [])
      merge(short_name, canonical)
      aliases[canonical].extend(inherited)
  return aliases


def _matching_entity(
  entities: list[dict[str, Any]],
  name: str,
  aliases: list[str],
) -> dict[str, Any] | None:
  primary = _identity_key(name)
  exact = [entity for entity in entities if _identity_key(entity["name"]) == primary]
  matching = exact or [entity for entity in entities if primary in {_identity_key(str(alias)) for alias in entity.get("aliases", [])}]
  if not matching:
    # A new full name must not be swallowed by another full name merely because
    # both have the same short alias. An existing mononym can be extended.
    candidate_aliases = {_identity_key(alias) for alias in aliases}
    matching = [entity for entity in entities if len(_identity_key(entity["name"]).split()) == 1 and _identity_key(entity["name"]) in candidate_aliases]
  if len(matching) > 1:
    raise OpenAuthorError("This suggestion's identity is ambiguous. Correct it to the intended character's full name before accepting.")
  return matching[0] if matching else None


def _review_version(paths: ProjectPaths, suggestion: dict[str, Any], cache: dict | None = None) -> str:
  cache = cache if cache is not None else {}
  sources = {}
  for evidence in suggestion.get("evidence", []):
    identifier = evidence.get("scene_id", "")
    if not identifier:
      continue
    if identifier not in cache:
      try:
        scene = get_scene(paths, identifier)
        cache[identifier] = {"body": scene["body"], "pov": scene.get("pov", "")}
      except OpenAuthorError:
        cache[identifier] = {"missing": True}
    sources[identifier] = cache[identifier]
  value = {"workspace": workspace_edit_scope(paths)[0], "suggestion": {key: value for key, value in suggestion.items() if key != "review_version"}, "sources": sources}
  return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _versioned_suggestion(paths: ProjectPaths, suggestion: dict[str, Any], cache: dict | None = None) -> dict[str, Any]:
  return {**suggestion, "review_version": _review_version(paths, suggestion, cache)}


def _check_review_version(paths: ProjectPaths, suggestion: dict[str, Any], expected_version: str | None) -> None:
  if expected_version is not None and (not expected_version or _review_version(paths, suggestion) != expected_version):
    raise OpenAuthorError("The suggestion, source or Storyline changed. Refresh and review the current evidence before deciding or correcting it.")


@serialized_project_access
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
    return _versioned_suggestion(paths, existing)
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
  return _versioned_suggestion(paths, suggestion)


@serialized_project_access
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
  cache: dict = {}
  return [_versioned_suggestion(paths, row, cache) for row in sorted(rows, key=lambda row: (-float(row.get("confidence", 0)), row.get("name", "")))]


@serialized_project_access
def extract_memory_suggestions(
  paths: ProjectPaths,
  *,
  scene_ids: list[str] | None = None,
) -> dict[str, Any]:
  selected = set(scene_ids or [])
  all_scenes = list_scene_details(paths)
  scenes = [row for row in all_scenes if not selected or row["id"] in selected]
  entities = list_entities(paths)
  relationships = list_relationships(paths)
  existing_relationships = {
    _relationship_key(row["source_entity_id"], row["target_entity_id"], row["relation"])
    for row in relationships
  }
  existing_names: set[str] = set()
  for entity in entities:
    existing_names.add(_identity_key(entity["name"]))
    existing_names.update(_identity_key(str(alias)) for alias in entity.get("aliases", []))

  counts: Counter[str] = Counter()
  evidence: dict[str, list[dict[str, Any]]] = defaultdict(list)
  pov_names: set[str] = set()
  fact_candidates: dict[str, dict[str, Any]] = {}
  scene_details: list[dict[str, Any]] = []
  for scene in all_scenes:
    # Character identity is manuscript-wide even when a save only refreshes
    # facts and relationships in one scene. Otherwise a short name splits off
    # whenever its full-name introduction happens to be in another scene.
    pov = str(scene.get("pov", "")).strip()
    if pov:
      pov_names.add(pov)
      counts[pov] += 3
      evidence[pov].append({
        "scene_id": scene["id"],
        "path": scene["path"],
        "excerpt": f"POV: {pov}",
        "source_field": "pov",
        "start": 0,
        "end": 0,
      })
    body = str(scene.get("body", ""))
    for name, mention_start, mention_end in _proper_name_mentions(body):
      if name in NAME_STOPWORDS or len(name) < 3:
        continue
      counts[name] += 1
      if len(evidence[name]) < 3:
        start = max(0, mention_start - 70)
        end = min(len(body), mention_end + 100)
        evidence[name].append({
          "scene_id": scene["id"],
          "path": scene["path"],
          "excerpt": " ".join(body[start:end].split()),
          "anchor_text": body[mention_start:mention_end],
          "start": mention_start,
          "end": mention_end,
        })
    if selected and scene["id"] not in selected:
      continue
    scene_details.append(scene)
    for entity in entities:
      names = [entity["name"], *entity.get("aliases", [])]
      for entity_name in names:
        if not str(entity_name).strip():
          continue
        try:
          identity = _matching_entity(entities, entity_name, [])
        except OpenAuthorError:
          # A shared nickname cannot support a fact about either person until
          # the author supplies an unambiguous identity.
          continue
        if identity is None or identity["id"] != entity["id"]:
          continue
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
  relationship_candidates = _relationship_candidates(scene_details, entities)

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
    if (
      suggestion.get("kind") == "relationship_create"
      and suggestion.get("status") in {"pending", "deferred"}
      and _relationship_key(
        str(suggestion.get("source_entity_id", "")),
        str(suggestion.get("target_entity_id", "")),
        str(suggestion.get("relation", "")),
      ) in existing_relationships
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
        and alias_suggestion.get("origin") != "ai_scan"
      ):
        previous.pop(alias_id)
  added = 0
  refreshed = 0
  candidate_ids: set[str] = set()
  repeated_short_names = {_identity_key(name) for name, count in counts.items() if count >= 2 and len(_identity_key(name).split()) == 1}
  for name, count in counts.items():
    parts = _identity_key(name).split()
    # A shared "Mara" must not absorb or erase the explicitly named Mara Voss
    # and Mara Lynn. Retain their own evidence without assigning the nickname.
    ambiguous_short_support = len(parts) > 1 and bool({parts[0], parts[-1]} & repeated_short_names)
    if _identity_key(name) in existing_names or (count < 2 and not ambiguous_short_support):
      continue
    entity_type = "character"
    suggestion_id = _suggestion_id(entity_type, name)
    candidate_ids.add(suggestion_id)
    current = previous.get(suggestion_id)
    if current and current.get("origin") == "ai_scan":
      # A local capitalization pass cannot reinterpret reviewed AI evidence or
      # refresh its source stamp. Preserve it for a fresh, explicit AI review.
      continue
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
      "reason": "POV metadata and repeated proper-name mentions" if name in pov_names else "Explicit full-name mention; short-name references are ambiguous" if count < 2 else "Repeated proper-name mentions",
      "evidence": evidence[name],
      "status": current.get("status", "pending") if current else "pending",
      "created_at": current.get("created_at", utc_now()) if current else utc_now(),
    }
    if current and current.get("author_corrected"):
      row["name"] = current.get("name", row["name"])
      row["description"] = current.get("description", row["description"])
      row["entity_type"] = current.get("entity_type", row["entity_type"])
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
    candidate_ids.add(suggestion_id)
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
  for suggestion_id, candidate in relationship_candidates.items():
    relationship_key = _relationship_key(
      candidate["source_entity_id"], candidate["target_entity_id"], candidate["relation"]
    )
    if relationship_key in existing_relationships:
      continue
    candidate_ids.add(suggestion_id)
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
    if current:
      refreshed += 1
    else:
      added += 1
    previous[suggestion_id] = candidate
  source_scenes = {scene["id"]: scene for scene in all_scenes}
  scanned_scene_ids = {scene["id"] for scene in scene_details}
  for suggestion_id, row in list(previous.items()):
    if suggestion_id in candidate_ids:
      if row.get("origin") == "ai_scan":
        continue
      for item in row.get("evidence", []):
        item["source_sha256"] = _evidence_fingerprint(source_scenes[item["scene_id"]], item)
    elif (row.get("kind") in {"entity_create", "canon_fact", "relationship_create"}
          and row.get("status") in {"pending", "deferred"} and not row.get("author_corrected")
          and row.get("origin") != "ai_scan"
          and row.get("evidence") and (row.get("kind") == "entity_create" or all(item.get("scene_id") in scanned_scene_ids for item in row["evidence"]))):
      # Identity is refreshed across the book. Facts and relationships are
      # retired only when wholly supported by the selected scenes. Decisions
      # and author corrections remain author-owned.
      previous.pop(suggestion_id)
  store["suggestions"] = list(previous.values())
  atomic_write_json(_suggestions_path(paths), store)
  return {
    "scanned_scenes": len(scenes),
    "added": added,
    "refreshed": refreshed,
    "pending": len([row for row in store["suggestions"] if row["status"] == "pending"]),
    "suggestions": list_memory_suggestions(paths),
  }


@serialized_project_access
def review_memory_suggestion(
  paths: ProjectPaths,
  suggestion_id: str,
  *,
  disposition: str,
  expected_version: str | None = None,
) -> dict[str, Any]:
  if disposition not in SUGGESTION_STATUSES - {"pending"}:
    raise OpenAuthorError("Suggestion disposition must be accepted, rejected, or deferred.")
  store = _read_store(paths)
  suggestion = next((row for row in store["suggestions"] if row.get("id") == suggestion_id), None)
  if suggestion is None:
    raise OpenAuthorError(f"Unknown Story Memory suggestion '{suggestion_id}'.")
  _check_review_version(paths, suggestion, expected_version)
  if suggestion.get("status") != "pending" and suggestion.get("status") != "deferred":
    raise OpenAuthorError("This Story Memory suggestion has already been decided.")
  created_entity_id = ""
  created_relationship_id = ""
  if disposition == "accepted":
    if suggestion.get("classification_uncertain") and not suggestion.get("type_confirmed"):
      raise OpenAuthorError("This entry's classification is uncertain. Correct and confirm its type before accepting it.")
    if suggestion.get("kind") in {"entity_create", "canon_fact", "relationship_create"}:
      for item in suggestion.get("evidence", []):
        current_scene = get_scene(paths, item["scene_id"])
        if item.get("source_sha256") != _evidence_fingerprint(current_scene, item):
          raise OpenAuthorError("The source prose or POV changed, or this suggestion predates evidence validation. Run a fresh Memory scan before accepting it.")
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
    elif suggestion.get("kind") == "relationship_create":
      relationship_key = _relationship_key(
        suggestion["source_entity_id"], suggestion["target_entity_id"], suggestion["relation"]
      )
      existing_relationship = next((
        row for row in list_relationships(paths)
        if _relationship_key(row["source_entity_id"], row["target_entity_id"], row["relation"]) == relationship_key
      ), None)
      if existing_relationship:
        created_relationship_id = existing_relationship["id"]
      else:
        relationship = add_relationship(
          paths,
          source_entity_id=suggestion["source_entity_id"],
          target_entity_id=suggestion["target_entity_id"],
          relation=suggestion["relation"],
          notes=suggestion.get("description", ""),
          valid_from_scene_id=suggestion.get("valid_from_scene_id", ""),
          valid_to_scene_id=suggestion.get("valid_to_scene_id", ""),
        )
        created_relationship_id = relationship["id"]
    else:
      aliases = [
        str(alias).strip() for alias in suggestion.get("aliases", [])
        if str(alias).strip() and str(alias).casefold() != suggestion["name"].casefold()
      ]
      entities = list_entities(paths)
      existing = _matching_entity(entities, suggestion["name"], aliases)
      if existing:
        # Entity creation carries an author-reviewable type. Generic Assistant
        # notes can refer to any existing identity and retain their association.
        if suggestion.get("kind") == "entity_create" and existing["type"] != suggestion["entity_type"]:
          raise OpenAuthorError(
            f"An existing {existing['type']} entry named '{existing['name']}' matches this "
            f"{suggestion['entity_type']} suggestion. Resolve the identity or correct the "
            "suggestion before accepting it; nothing was changed."
          )
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
  suggestion["created_relationship_id"] = created_relationship_id
  if disposition == "accepted" and suggestion.get("kind") in {"entity_create", "memory_note"}:
    accepted_entity = next(row for row in list_entities(paths) if row["id"] == created_entity_id)
    for other in store["suggestions"]:
      if other is suggestion or other.get("kind") not in {"entity_create", "memory_note"}:
        continue
      compatible_type = other.get("kind") == "memory_note" or other.get("entity_type") == accepted_entity["type"]
      if other.get("classification_uncertain") and not other.get("type_confirmed"):
        compatible_type = False
      if other.get("status") in {"pending", "deferred"} and compatible_type and _matching_entity([accepted_entity], str(other.get("name", "")), other.get("aliases", [])):
        other["status"] = "accepted"
        other["decided_at"] = suggestion["decided_at"]
        other["created_entity_id"] = created_entity_id
        other["merged_into_suggestion_id"] = suggestion_id
  atomic_write_json(_suggestions_path(paths), store)
  from .product_signals import record_product_event
  record_product_event(paths, "story_memory_suggestion_reviewed", disposition=disposition)
  return _versioned_suggestion(paths, suggestion)


@serialized_project_access
def correct_memory_suggestion(
  paths: ProjectPaths,
  suggestion_id: str,
  *,
  name: str | None = None,
  description: str | None = None,
  predicate: str | None = None,
  value: str | None = None,
  entity_type: str | None = None,
  expected_version: str | None = None,
) -> dict[str, Any]:
  store = _read_store(paths)
  suggestion = next((row for row in store["suggestions"] if row.get("id") == suggestion_id), None)
  if suggestion is None:
    raise OpenAuthorError(f"Unknown Story Memory suggestion '{suggestion_id}'.")
  _check_review_version(paths, suggestion, expected_version)
  if suggestion.get("status") not in {"pending", "deferred"}:
    raise OpenAuthorError("Only pending or deferred Story Memory suggestions can be corrected.")
  if entity_type is not None and (suggestion.get("kind") != "entity_create" or entity_type not in ENTITY_TYPES):
    raise OpenAuthorError("Choose a supported entity type for an entity suggestion.")
  updates = {
    "name": name,
    "description": description,
    "predicate": predicate,
    "value": value,
    "entity_type": entity_type,
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
  if entity_type is not None:
    suggestion["type_confirmed"] = True
  suggestion["corrected_at"] = utc_now()
  suggestion["updated_at"] = utc_now()
  atomic_write_json(_suggestions_path(paths), store)
  return _versioned_suggestion(paths, suggestion)
