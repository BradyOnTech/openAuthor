from __future__ import annotations

from collections import Counter
import re

from .codex import list_entities
from .project import ProjectPaths
from .scenes import list_scene_details

SEVERITY_ORDER = {"error": 0, "warning": 1, "info": 2}


def _normalize(value: str) -> str:
  return value.strip().lower()


def _word_count(value: str) -> int:
  return len(re.findall(r"\b\w+\b", value))


def run_continuity_checks(paths: ProjectPaths) -> list[dict[str, str]]:
  scene_details = list_scene_details(paths)
  character_names = {
    _normalize(row["name"])
    for row in list_entities(paths, kind="character")
    if row.get("name")
  }

  issues: list[dict[str, str]] = []

  title_counts = Counter(row["title"].strip() for row in scene_details if row["title"].strip())
  duplicate_titles = {title for title, count in title_counts.items() if count > 1}

  for scene in scene_details:
    scene_id = scene["id"]
    scene_path = scene["path"]
    title = scene["title"].strip()
    summary = scene["summary"].strip()
    pov = scene["pov"].strip()
    status = scene["status"].strip().lower()
    body = scene["body"]
    if not summary:
      issues.append(
        {
          "id": f"{scene_id}:summary-missing",
          "severity": "warning",
          "code": "scene_summary_missing",
          "title": "Scene summary is empty",
          "message": "Add a concise summary so outline and retrieval context stay reliable.",
          "scene_id": scene_id,
          "path": scene_path,
        }
      )

    if _word_count(body) < 10:
      issues.append(
        {
          "id": f"{scene_id}:body-too-short",
          "severity": "warning",
          "code": "scene_body_short",
          "title": "Scene body is very short",
          "message": "This scene has fewer than 10 words and may be incomplete.",
          "scene_id": scene_id,
          "path": scene_path,
        }
      )

    if status in {"revised", "final"} and _word_count(body) < 80:
      issues.append(
        {
          "id": f"{scene_id}:status-length-mismatch",
          "severity": "warning",
          "code": "scene_status_length_mismatch",
          "title": "Scene status suggests polish, but body is brief",
          "message": "A revised/final scene under 80 words is often accidental.",
          "scene_id": scene_id,
          "path": scene_path,
        }
      )

    if pov and _normalize(pov) not in character_names:
      issues.append(
        {
          "id": f"{scene_id}:pov-not-in-codex",
          "severity": "warning",
          "code": "pov_not_in_codex",
          "title": "POV is not present in character codex",
          "message": f"Scene POV '{pov}' has no matching character entity.",
          "scene_id": scene_id,
          "path": scene_path,
        }
      )

    if title in duplicate_titles:
      issues.append(
        {
          "id": f"{scene_id}:duplicate-title",
          "severity": "warning",
          "code": "duplicate_scene_title",
          "title": "Duplicate scene title",
          "message": f"Scene title '{title}' appears multiple times.",
          "scene_id": scene_id,
          "path": scene_path,
        }
      )

  return sorted(
    issues,
    key=lambda item: (
      SEVERITY_ORDER.get(item["severity"], 99),
      item["scene_id"],
      item["code"],
    ),
  )
