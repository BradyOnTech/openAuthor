from __future__ import annotations

import re
from typing import Any

from .codex import list_entities
from .planning import get_plan
from .project import OpenAuthorError, ProjectPaths
from .scenes import get_scene, list_scenes


def _excerpt(text: str, query: str, radius: int = 90) -> str:
  normalized = text.casefold()
  position = normalized.find(query.casefold())
  if position < 0:
    position = 0
  start = max(0, position - radius)
  end = min(len(text), position + len(query) + radius)
  fragment = " ".join(text[start:end].split())
  if start > 0:
    fragment = f"…{fragment}"
  if end < len(text):
    fragment = f"{fragment}…"
  return fragment


def _score(query: str, title: str, text: str) -> float:
  q = query.casefold()
  title_folded = title.casefold()
  text_folded = text.casefold()
  exact_title = 8 if q == title_folded else 0
  title_hits = title_folded.count(q) * 4
  text_hits = min(text_folded.count(q), 20)
  word_boundary = 2 if re.search(rf"\b{re.escape(q)}\b", text_folded) else 0
  return float(exact_title + title_hits + text_hits + word_boundary)


def search_project(paths: ProjectPaths, query: str, *, limit: int = 80) -> list[dict[str, Any]]:
  cleaned = " ".join(query.split())
  if len(cleaned) < 2:
    raise OpenAuthorError("Search query must contain at least two characters.")
  if limit < 1 or limit > 500:
    raise OpenAuthorError("Search limit must be between 1 and 500.")
  folded = cleaned.casefold()
  results: list[dict[str, Any]] = []

  for summary in list_scenes(paths):
    scene = get_scene(paths, summary["id"])
    searchable = "\n".join([
      scene.get("title", ""), scene.get("summary", ""), scene.get("pov", ""),
      scene.get("status", ""), scene.get("body", ""),
    ])
    if folded not in searchable.casefold():
      continue
    results.append({
      "source_kind": "scene",
      "source_id": scene["id"],
      "title": scene["title"] or scene["id"],
      "path": scene["path"],
      "excerpt": _excerpt(searchable, cleaned),
      "score": _score(cleaned, scene["title"], searchable),
    })

  for entity in list_entities(paths):
    detail_text = " ".join(
      f"{detail.get('key', '')} {detail.get('value', '')}"
      for detail in entity.get("details", [])
    )
    searchable = "\n".join([
      entity["name"], entity["type"], entity.get("category", ""),
      entity.get("description", ""), " ".join(entity.get("aliases", [])),
      " ".join(entity.get("tags", [])), detail_text, entity.get("notes", ""),
    ])
    if folded not in searchable.casefold():
      continue
    results.append({
      "source_kind": "memory",
      "source_id": entity["id"],
      "title": entity["name"],
      "path": "codex/codex.json",
      "excerpt": _excerpt(searchable, cleaned),
      "score": _score(cleaned, entity["name"], searchable),
    })

  plan = get_plan(paths)
  brief = plan["brief"]
  brief_text = "\n".join([
    brief.get("synopsis", ""), brief.get("genre", ""),
    " ".join(brief.get("themes", [])), brief.get("style_guide", ""),
    brief.get("outline", ""),
  ])
  if folded in brief_text.casefold():
    results.append({
      "source_kind": "plan",
      "source_id": "project-brief",
      "title": "Project Brief",
      "path": "manuscript/structure.json",
      "excerpt": _excerpt(brief_text, cleaned),
      "score": _score(cleaned, "Project Brief", brief_text),
    })
  for act in plan["acts"]:
    for chapter in act["chapters"]:
      searchable = "\n".join([act["title"], act.get("synopsis", ""), chapter["title"], chapter.get("synopsis", "")])
      if folded in searchable.casefold():
        results.append({
          "source_kind": "plan",
          "source_id": chapter["id"],
          "title": f"{act['title']} · {chapter['title']}",
          "path": "manuscript/structure.json",
          "excerpt": _excerpt(searchable, cleaned),
          "score": _score(cleaned, chapter["title"], searchable),
        })

  return sorted(results, key=lambda row: (-row["score"], row["source_kind"], row["title"]))[:limit]
