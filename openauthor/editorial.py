from __future__ import annotations

import json
import re
import uuid
from typing import Any

from .project import OpenAuthorError, ProjectPaths, atomic_write_json, utc_now

EDITORIAL_PASS_SCHEMA_VERSION = 1
BUILT_IN_PASSES = [
  ("pacing", "Pacing", "Improve narrative momentum without deleting necessary setup.", ["momentum", "scene purpose", "compression", "breathing room"]),
  ("dialogue", "Dialogue", "Make dialogue character-specific, purposeful, and subtext-aware.", ["voice distinction", "subtext", "exposition", "rhythm"]),
  ("motivation", "Character Motivation", "Clarify what the POV character wants, fears, and chooses in this scene.", ["goal", "obstacle", "choice", "emotional causality"]),
  ("clarity", "Prose Clarity", "Improve readability and precision while preserving the author's voice.", ["clarity", "specificity", "sentence flow", "voice preservation"]),
  ("tension", "Tension", "Increase uncertainty, pressure, or consequence without artificial melodrama.", ["stakes", "friction", "reversal", "release"]),
  ("pov", "POV Integrity", "Keep perception, language, and knowledge grounded in the selected point of view.", ["psychic distance", "knowledge", "filtering", "voice"]),
  ("setup-payoff", "Setup & Payoff", "Strengthen promises and echoes that earn later developments.", ["setup", "echo", "payoff", "reader expectation"]),
]


def _passes_path(paths: ProjectPaths):
  return paths.project_dir / "editorial_passes.json"


def ensure_editorial_passes(paths: ProjectPaths) -> None:
  path = _passes_path(paths)
  if path.exists():
    return
  created_at = utc_now()
  atomic_write_json(path, {
    "schema_version": EDITORIAL_PASS_SCHEMA_VERSION,
    "passes": [
      {
        "id": f"pass-{slug}",
        "name": name,
        "goal": goal,
        "instruction": (
          f"Run an editorial {name.lower()} pass. {goal} "
          "Make only changes that serve this goal and explain each meaningful hunk."
        ),
        "context_policy": {"current_scene": True, "nearby_scenes": 1, "story_memory": "auto"},
        "evaluation_criteria": criteria,
        "built_in": True,
        "created_at": created_at,
        "updated_at": created_at,
      }
      for slug, name, goal, criteria in BUILT_IN_PASSES
    ],
  })


def _read_passes(paths: ProjectPaths) -> dict[str, Any]:
  ensure_editorial_passes(paths)
  try:
    payload = json.loads(_passes_path(paths).read_text(encoding="utf-8"))
  except (OSError, json.JSONDecodeError) as error:
    raise OpenAuthorError(f"Editorial Pass library is unreadable: {error}") from error
  if payload.get("schema_version") != EDITORIAL_PASS_SCHEMA_VERSION:
    raise OpenAuthorError("Unsupported Editorial Pass schema version.")
  return payload


def list_editorial_passes(paths: ProjectPaths) -> list[dict[str, Any]]:
  return sorted(_read_passes(paths)["passes"], key=lambda row: (not row.get("built_in", False), row["name"]))


def add_editorial_pass(
  paths: ProjectPaths,
  *,
  name: str,
  goal: str,
  instruction: str,
  evaluation_criteria: list[str] | None = None,
) -> dict[str, Any]:
  if not name.strip() or not goal.strip() or not instruction.strip():
    raise OpenAuthorError("Editorial Pass name, goal, and instruction are required.")
  payload = _read_passes(paths)
  slug = re.sub(r"[^a-z0-9]+", "-", name.casefold()).strip("-")
  if any(row["name"].casefold() == name.strip().casefold() for row in payload["passes"]):
    raise OpenAuthorError(f"An Editorial Pass named '{name}' already exists.")
  now = utc_now()
  row = {
    "id": f"pass-{slug or uuid.uuid4().hex[:10]}-{uuid.uuid4().hex[:6]}",
    "name": name.strip(),
    "goal": goal.strip(),
    "instruction": instruction.strip(),
    "context_policy": {"current_scene": True, "nearby_scenes": 1, "story_memory": "auto"},
    "evaluation_criteria": [value.strip() for value in evaluation_criteria or [] if value.strip()],
    "built_in": False,
    "created_at": now,
    "updated_at": now,
  }
  payload["passes"].append(row)
  atomic_write_json(_passes_path(paths), payload)
  return row
