from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

PROJECT_MARKER = ".openauthor/project.json"


class OpenAuthorError(RuntimeError):
  pass


@dataclass(frozen=True)
class ProjectPaths:
  root: Path
  project_dir: Path
  config_file: Path
  scenes_dir: Path
  codex_db: Path
  proposals_dir: Path
  generations_dir: Path
  pricing_file: Path


def utc_now() -> str:
  return datetime.now(UTC).isoformat()


def get_project_paths(root: Path) -> ProjectPaths:
  project_dir = root / ".openauthor"
  return ProjectPaths(
    root=root,
    project_dir=project_dir,
    config_file=project_dir / "project.json",
    scenes_dir=root / "manuscript" / "scenes",
    codex_db=root / "codex" / "codex.sqlite3",
    proposals_dir=project_dir / "proposals",
    generations_dir=project_dir / "generations",
    pricing_file=project_dir / "provider_pricing.json",
  )


def find_project_root(start: Path) -> Path | None:
  current = start.resolve()
  for candidate in (current, *current.parents):
    if (candidate / PROJECT_MARKER).exists():
      return candidate
  return None


def resolve_project(start: Path) -> ProjectPaths:
  root = find_project_root(start)
  if root is None:
    raise OpenAuthorError(
      "Not inside an openAuthor project. Run `openauthor init` first."
    )
  return get_project_paths(root)


def initialize_project(root: Path, name: str | None = None) -> ProjectPaths:
  root = root.resolve()
  paths = get_project_paths(root)
  paths.project_dir.mkdir(parents=True, exist_ok=True)
  paths.scenes_dir.mkdir(parents=True, exist_ok=True)
  paths.codex_db.parent.mkdir(parents=True, exist_ok=True)
  paths.proposals_dir.mkdir(parents=True, exist_ok=True)
  paths.generations_dir.mkdir(parents=True, exist_ok=True)

  if not paths.config_file.exists():
    project_name = name or root.name
    config = {
      "name": project_name,
      "created_at": utc_now(),
      "storage": {
        "scene_format": "markdown-frontmatter",
        "codex": "sqlite",
        "proposals": "json",
      },
    }
    paths.config_file.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")

  manuscript_readme = paths.root / "manuscript" / "README.md"
  if not manuscript_readme.exists():
    manuscript_readme.write_text(
      "# Manuscript\n\n"
      "Scene files live in `manuscript/scenes/` and are versioned in git.\n",
      encoding="utf-8",
    )

  if not paths.pricing_file.exists():
    paths.pricing_file.write_text(
      json.dumps(
        {
          "openai": {},
          "anthropic": {},
          "local": {
            "heuristic-v1": {
              "input_per_million": 0.0,
              "output_per_million": 0.0,
            }
          },
        },
        indent=2,
      )
      + "\n",
      encoding="utf-8",
    )

  return paths


def next_scene_index(paths: ProjectPaths) -> int:
  highest = 0
  pattern = re.compile(r"^(\d{4})-.*\.md$")
  for scene_file in paths.scenes_dir.glob("*.md"):
    match = pattern.match(scene_file.name)
    if match:
      highest = max(highest, int(match.group(1)))
  return highest + 1
