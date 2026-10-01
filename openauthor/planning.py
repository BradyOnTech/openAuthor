from __future__ import annotations

import json
import uuid
from typing import Any

from .project import OpenAuthorError, ProjectPaths, atomic_write_json, utc_now
from .scenes import list_scenes

PLAN_SCHEMA_VERSION = 2


def _default_plan() -> dict[str, Any]:
  return {
    "schema_version": PLAN_SCHEMA_VERSION,
    "brief": {"synopsis": "", "genre": "", "themes": [], "style_guide": "", "outline": ""},
    "acts": [],
    "unassigned_scene_ids": [],
    "beats": [],
    "notes": [],
    "scene_metadata": {},
  }


def _read_plan(paths: ProjectPaths) -> dict[str, Any]:
  if not paths.structure_file.exists():
    return _default_plan()
  try:
    payload = json.loads(paths.structure_file.read_text(encoding="utf-8"))
  except (OSError, json.JSONDecodeError) as error:
    raise OpenAuthorError(f"Manuscript structure is unreadable: {error}") from error
  schema_version = payload.get("schema_version")
  if schema_version == 1:
    payload["schema_version"] = PLAN_SCHEMA_VERSION
    payload["scene_metadata"] = {}
  elif schema_version != PLAN_SCHEMA_VERSION:
    raise OpenAuthorError("Unsupported manuscript structure schema version.")
  payload.setdefault("scene_metadata", {})
  return payload


def get_plan(paths: ProjectPaths, *, persist: bool = True) -> dict[str, Any]:
  plan = _read_plan(paths)
  current_scene_ids = [str(scene["id"]) for scene in list_scenes(paths)]
  current = set(current_scene_ids)
  seen: set[str] = set()
  for act_position, act in enumerate(plan.get("acts", []), start=1):
    act["position"] = act_position
    for chapter_position, chapter in enumerate(act.get("chapters", []), start=1):
      chapter["position"] = chapter_position
      ordered_scene_ids: list[str] = []
      for value in chapter.get("scene_ids", []):
        scene_id = str(value)
        if scene_id in current and scene_id not in seen:
          ordered_scene_ids.append(scene_id)
          seen.add(scene_id)
      chapter["scene_ids"] = ordered_scene_ids
  unassigned: list[str] = []
  for value in plan.get("unassigned_scene_ids", []):
    scene_id = str(value)
    if scene_id in current and scene_id not in seen:
      unassigned.append(scene_id)
      seen.add(scene_id)
  unassigned.extend(scene_id for scene_id in current_scene_ids if scene_id not in seen)
  plan["unassigned_scene_ids"] = unassigned
  plan["beats"] = [beat for beat in plan.get("beats", []) if beat.get("scene_id") in current]
  plan["notes"] = [note for note in plan.get("notes", []) if not note.get("scene_id") or note.get("scene_id") in current]
  plan["scene_metadata"] = {
    scene_id: {
      "timeline_position": str(value.get("timeline_position", "")).strip(),
      "labels": [str(label).strip() for label in value.get("labels", []) if str(label).strip()],
    }
    for scene_id, value in plan.get("scene_metadata", {}).items()
    if scene_id in current and isinstance(value, dict)
  }
  if persist:
    atomic_write_json(paths.structure_file, plan)
  return plan


def update_scene_metadata(
  paths: ProjectPaths,
  *,
  scene_id: str,
  timeline_position: str | None = None,
  labels: list[str] | None = None,
) -> dict[str, Any]:
  plan = get_plan(paths)
  if scene_id not in {str(scene["id"]) for scene in list_scenes(paths)}:
    raise OpenAuthorError(f"Unknown scene '{scene_id}'.")
  current = plan["scene_metadata"].get(scene_id, {"timeline_position": "", "labels": []})
  if timeline_position is not None:
    current["timeline_position"] = timeline_position.strip()
  if labels is not None:
    current["labels"] = list(dict.fromkeys(value.strip() for value in labels if value.strip()))
  plan["scene_metadata"][scene_id] = current
  atomic_write_json(paths.structure_file, plan)
  return current


def _scene_locations(plan: dict[str, Any]) -> dict[str, dict[str, Any]]:
  locations: dict[str, dict[str, Any]] = {}
  narrative_index = 0
  for act in plan["acts"]:
    for chapter in act["chapters"]:
      for position, scene_id in enumerate(chapter["scene_ids"], start=1):
        locations[scene_id] = {
          "act_id": act["id"],
          "act_title": act["title"],
          "chapter_id": chapter["id"],
          "chapter_title": chapter["title"],
          "chapter_position": position,
          "narrative_index": narrative_index,
        }
        narrative_index += 1
  for position, scene_id in enumerate(plan["unassigned_scene_ids"], start=1):
    locations[scene_id] = {
      "act_id": "",
      "act_title": "",
      "chapter_id": "",
      "chapter_title": "Unassigned",
      "chapter_position": position,
      "narrative_index": narrative_index,
    }
    narrative_index += 1
  return locations


def preview_scene_move(
  paths: ProjectPaths,
  *,
  scene_id: str,
  chapter_id: str | None,
  before_scene_id: str | None = None,
) -> dict[str, Any]:
  """Describe a structural move without mutating the manuscript plan."""
  plan = get_plan(paths)
  locations = _scene_locations(plan)
  if scene_id not in locations:
    raise OpenAuthorError(f"Unknown scene '{scene_id}'.")
  source = locations[scene_id]
  if chapter_id:
    target_chapter = next(
      (
        (act, chapter)
        for act in plan["acts"]
        for chapter in act["chapters"]
        if chapter["id"] == chapter_id
      ),
      None,
    )
    if target_chapter is None:
      raise OpenAuthorError(f"Unknown chapter '{chapter_id}'.")
    target_act, target = target_chapter
    destination = [value for value in target["scene_ids"] if value != scene_id]
    target_label = target["title"]
    target_act_id = target_act["id"]
  else:
    destination = [value for value in plan["unassigned_scene_ids"] if value != scene_id]
    target_label = "Unassigned"
    target_act_id = ""
  insertion = destination.index(before_scene_id) if before_scene_id in destination else len(destination)
  anchor = destination[insertion] if insertion < len(destination) else ""
  crossed: list[str] = []
  if anchor and anchor in locations:
    start = source["narrative_index"]
    end = locations[anchor]["narrative_index"]
    crossed = [
      candidate
      for candidate, location in sorted(locations.items(), key=lambda item: item[1]["narrative_index"])
      if candidate != scene_id and min(start, end) <= location["narrative_index"] < max(start, end)
    ]
  warnings: list[str] = []
  metadata = plan["scene_metadata"].get(scene_id, {})
  timeline = str(metadata.get("timeline_position", "")).strip()
  neighbor_ids = []
  if insertion > 0:
    neighbor_ids.append(destination[insertion - 1])
  if insertion < len(destination):
    neighbor_ids.append(destination[insertion])
  neighbor_timelines = [
    str(plan["scene_metadata"].get(value, {}).get("timeline_position", "")).strip()
    for value in neighbor_ids
  ]
  neighbor_timelines = [value for value in neighbor_timelines if value]
  if timeline and neighbor_timelines:
    warnings.append(
      f"Check story time: this scene is '{timeline}' beside "
      + ", ".join(f"'{value}'" for value in neighbor_timelines)
      + "."
    )
  if source["act_id"] != target_act_id:
    warnings.append("This crosses an act boundary; review setup, escalation, and payoff timing.")
  if crossed:
    warnings.append(f"This changes the reading order around {len(crossed)} scene(s).")
  return {
    "scene_id": scene_id,
    "from": source,
    "to": {
      "act_id": target_act_id,
      "chapter_id": chapter_id or "",
      "chapter_title": target_label,
      "before_scene_id": before_scene_id or "",
      "position": insertion + 1,
    },
    "crossed_scene_ids": crossed,
    "warnings": warnings,
    "summary": (
      f"Move from {source['chapter_title']} to {target_label} at position {insertion + 1}."
      if source["chapter_id"] != (chapter_id or "")
      else f"Reorder within {target_label} to position {insertion + 1}."
    ),
  }


def update_brief(
  paths: ProjectPaths,
  *,
  synopsis: str | None = None,
  genre: str | None = None,
  themes: list[str] | None = None,
  style_guide: str | None = None,
  outline: str | None = None,
) -> dict[str, Any]:
  plan = get_plan(paths)
  brief = plan["brief"]
  for key, value in {
    "synopsis": synopsis,
    "genre": genre,
    "style_guide": style_guide,
    "outline": outline,
  }.items():
    if value is not None:
      brief[key] = value
  if themes is not None:
    brief["themes"] = [value.strip() for value in themes if value.strip()]
  atomic_write_json(paths.structure_file, plan)
  return plan


def add_act(paths: ProjectPaths, *, title: str, synopsis: str = "") -> dict[str, Any]:
  if not title.strip():
    raise OpenAuthorError("Act title is required.")
  plan = get_plan(paths)
  act = {
    "id": f"act-{uuid.uuid4().hex[:10]}",
    "title": title.strip(),
    "synopsis": synopsis.strip(),
    "position": len(plan["acts"]) + 1,
    "chapters": [],
  }
  plan["acts"].append(act)
  atomic_write_json(paths.structure_file, plan)
  return act


def add_chapter(paths: ProjectPaths, *, act_id: str, title: str, synopsis: str = "") -> dict[str, Any]:
  if not title.strip():
    raise OpenAuthorError("Chapter title is required.")
  plan = get_plan(paths)
  act = next((row for row in plan["acts"] if row["id"] == act_id), None)
  if act is None:
    raise OpenAuthorError(f"Unknown act '{act_id}'.")
  chapter = {
    "id": f"chapter-{uuid.uuid4().hex[:10]}",
    "title": title.strip(),
    "synopsis": synopsis.strip(),
    "position": len(act["chapters"]) + 1,
    "scene_ids": [],
  }
  act["chapters"].append(chapter)
  atomic_write_json(paths.structure_file, plan)
  return chapter


def assign_scene(
  paths: ProjectPaths,
  *,
  scene_id: str,
  chapter_id: str | None,
  before_scene_id: str | None = None,
) -> dict[str, Any]:
  plan = get_plan(paths)
  if scene_id not in {str(scene["id"]) for scene in list_scenes(paths)}:
    raise OpenAuthorError(f"Unknown scene '{scene_id}'.")
  for act in plan["acts"]:
    for chapter in act["chapters"]:
      chapter["scene_ids"] = [value for value in chapter["scene_ids"] if value != scene_id]
  plan["unassigned_scene_ids"] = [value for value in plan["unassigned_scene_ids"] if value != scene_id]

  if chapter_id:
    target = next(
      (chapter for act in plan["acts"] for chapter in act["chapters"] if chapter["id"] == chapter_id),
      None,
    )
    if target is None:
      raise OpenAuthorError(f"Unknown chapter '{chapter_id}'.")
    destination = target["scene_ids"]
  else:
    destination = plan["unassigned_scene_ids"]
  if before_scene_id and before_scene_id in destination:
    destination.insert(destination.index(before_scene_id), scene_id)
  else:
    destination.append(scene_id)
  atomic_write_json(paths.structure_file, plan)
  return plan


def add_beat(
  paths: ProjectPaths,
  *,
  scene_id: str,
  summary: str,
  status: str = "planned",
) -> dict[str, Any]:
  if not summary.strip():
    raise OpenAuthorError("Beat summary is required.")
  plan = get_plan(paths)
  if scene_id not in {str(scene["id"]) for scene in list_scenes(paths)}:
    raise OpenAuthorError(f"Unknown scene '{scene_id}'.")
  scene_beats = [beat for beat in plan["beats"] if beat["scene_id"] == scene_id]
  beat = {
    "id": f"beat-{uuid.uuid4().hex[:10]}",
    "scene_id": scene_id,
    "summary": summary.strip(),
    "status": status,
    "position": len(scene_beats) + 1,
    "created_at": utc_now(),
  }
  plan["beats"].append(beat)
  atomic_write_json(paths.structure_file, plan)
  return beat


def add_scene_note(
  paths: ProjectPaths,
  *,
  content: str,
  scene_id: str = "",
  title: str = "Assistant note",
  source: str = "author",
) -> dict[str, Any]:
  if not content.strip():
    raise OpenAuthorError("Note content is required.")
  plan = get_plan(paths)
  if scene_id and scene_id not in {str(scene["id"]) for scene in list_scenes(paths)}:
    raise OpenAuthorError(f"Unknown scene '{scene_id}'.")
  note = {
    "id": f"note-{uuid.uuid4().hex[:12]}",
    "scene_id": scene_id,
    "title": title.strip() or "Assistant note",
    "content": content.strip(),
    "source": source.strip() or "author",
    "created_at": utc_now(),
  }
  plan["notes"].append(note)
  atomic_write_json(paths.structure_file, plan)
  return note
