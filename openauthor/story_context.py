"""Saved author guidance shared by editorial context builders.

The private scratchpad is intentionally not part of this projection. Guidance
is bounded and every omission is reported alongside the context, not hidden.
"""
from __future__ import annotations

from typing import Any

from .planning import get_plan
from .project import ProjectPaths


def story_plan_for_ai(paths: ProjectPaths, scene_ids: list[str], *, book_scope: bool = False) -> dict[str, Any]:
  plan = get_plan(paths, persist=False)
  remaining = 24000
  clipped: list[str] = []

  def take(value: Any, label: str, limit: int) -> str:
    nonlocal remaining
    text = str(value or "")
    count = min(len(text), limit, remaining)
    remaining -= count
    if count < len(text):
      clipped.append(label)
    return text[:count]

  brief = plan.get("brief", {})
  # Style is preserved ahead of a long synopsis or outline.
  guidance = {
    key: take(brief.get(key, ""), f"brief.{key}", limit)
    for key, limit in (("style_guide", 6000), ("genre", 300), ("synopsis", 6000), ("outline", 8000))
  }
  guidance["themes"] = [take(value, "brief.themes", 300) for value in brief.get("themes", [])[:20]]
  if len(brief.get("themes", [])) > 20:
    clipped.append("brief.themes")
  relevant_ids = set(scene_ids)
  acts = []
  omitted_chapters = 0
  for act in plan.get("acts", []):
    relevant = [chapter for chapter in act.get("chapters", []) if book_scope or relevant_ids.intersection(chapter.get("scene_ids", []))]
    if not relevant:
      continue
    if not remaining:
      omitted_chapters += len(relevant)
      continue
    chapters = []
    for chapter in relevant:
      if len(chapters) >= 40 or not remaining:
        omitted_chapters += 1
        continue
      chapters.append({
        "id": chapter["id"], "title": take(chapter.get("title"), "chapter.title", 200),
        "synopsis": take(chapter.get("synopsis"), "chapter.synopsis", 1600),
        "scene_ids": chapter.get("scene_ids", [])[:200],
      })
      if len(chapter.get("scene_ids", [])) > 200:
        clipped.append("chapter.scene_ids")
    acts.append({
      "id": act["id"], "title": take(act.get("title"), "act.title", 200),
      "synopsis": take(act.get("synopsis"), "act.synopsis", 1600), "chapters": chapters,
    })
  beats = [beat for beat in plan.get("beats", []) if beat.get("scene_id") in relevant_ids]
  included_beats = []
  for beat in beats:
    if len(included_beats) >= 40 or not remaining:
      break
    included_beats.append({
      "scene_id": beat["scene_id"], "position": beat.get("position"), "status": beat.get("status", "planned"),
      "summary": take(beat.get("summary"), "beat.summary", 1600),
    })
  return {
    "brief": guidance, "structure": acts, "beats": included_beats,
    "limits": {
      "text_character_budget": 24000, "clipped_fields": sorted(set(clipped)),
      "omitted_chapters": omitted_chapters, "omitted_relevant_beats": len(beats) - len(included_beats),
      "private_notes_included": False,
    },
  }
