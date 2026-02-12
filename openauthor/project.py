from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
import shutil

PROJECT_MARKER = ".openauthor/project.json"


class OpenAuthorError(RuntimeError):
  pass


@dataclass(frozen=True)
class ProjectPaths:
  root: Path
  project_dir: Path
  workspace_dir: Path
  config_file: Path
  scenes_dir: Path
  codex_db: Path
  legacy_proposals_dir: Path
  proposals_dir: Path
  generations_dir: Path
  retrieval_dir: Path
  retrieval_index_file: Path
  chats_dir: Path
  chat_threads_dir: Path
  chat_threads_index_file: Path
  pricing_file: Path
  budget_policy_file: Path


def utc_now() -> str:
  return datetime.now(UTC).isoformat()


def get_project_paths(root: Path) -> ProjectPaths:
  project_dir = root / ".openauthor"
  workspace_dir = project_dir / "workspace"
  chats_dir = workspace_dir / "chats"
  return ProjectPaths(
    root=root,
    project_dir=project_dir,
    workspace_dir=workspace_dir,
    config_file=project_dir / "project.json",
    scenes_dir=root / "manuscript" / "scenes",
    codex_db=root / "codex" / "codex.sqlite3",
    legacy_proposals_dir=project_dir / "proposals",
    proposals_dir=workspace_dir / "proposals",
    generations_dir=project_dir / "generations",
    retrieval_dir=project_dir / "retrieval",
    retrieval_index_file=project_dir / "retrieval" / "index.json",
    chats_dir=chats_dir,
    chat_threads_dir=chats_dir / "threads",
    chat_threads_index_file=chats_dir / "threads.json",
    pricing_file=project_dir / "provider_pricing.json",
    budget_policy_file=project_dir / "generation_budget_policy.json",
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
  paths = get_project_paths(root)
  ensure_workspace_layout(paths)
  return paths


def initialize_project(root: Path, name: str | None = None) -> ProjectPaths:
  root = root.resolve()
  paths = get_project_paths(root)
  paths.project_dir.mkdir(parents=True, exist_ok=True)
  paths.scenes_dir.mkdir(parents=True, exist_ok=True)
  paths.codex_db.parent.mkdir(parents=True, exist_ok=True)
  paths.legacy_proposals_dir.mkdir(parents=True, exist_ok=True)
  ensure_workspace_layout(paths)
  paths.generations_dir.mkdir(parents=True, exist_ok=True)
  paths.retrieval_dir.mkdir(parents=True, exist_ok=True)

  if not paths.config_file.exists():
    project_name = name or root.name
    config = {
      "name": project_name,
      "created_at": utc_now(),
      "storage": {
        "scene_format": "markdown-frontmatter",
        "codex": "sqlite",
        "proposals": "workspace-json",
        "chats": "workspace-jsonl",
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

  if not paths.budget_policy_file.exists():
    paths.budget_policy_file.write_text(
      json.dumps(
        {
          "schema_version": 1,
          "enforcement": "fail_closed",
          "per_run": {
            "max_input_tokens": None,
            "max_output_tokens": None,
            "max_total_tokens": None,
            "max_estimated_cost_usd": None,
          },
          "rolling": {
            "daily_tokens": None,
            "daily_estimated_cost_usd": None,
            "weekly_tokens": None,
            "weekly_estimated_cost_usd": None,
          },
        },
        indent=2,
      )
      + "\n",
      encoding="utf-8",
    )

  return paths


def ensure_workspace_layout(paths: ProjectPaths) -> None:
  paths.workspace_dir.mkdir(parents=True, exist_ok=True)
  paths.proposals_dir.mkdir(parents=True, exist_ok=True)
  paths.chats_dir.mkdir(parents=True, exist_ok=True)
  paths.chat_threads_dir.mkdir(parents=True, exist_ok=True)
  if not paths.chat_threads_index_file.exists():
    paths.chat_threads_index_file.write_text("[]\n", encoding="utf-8")
  _migrate_legacy_proposals(paths)


def _migrate_legacy_proposals(paths: ProjectPaths) -> None:
  legacy_dir = paths.legacy_proposals_dir
  if not legacy_dir.exists():
    return
  for legacy_file in sorted(legacy_dir.glob("*.json")):
    target = paths.proposals_dir / legacy_file.name
    if target.exists():
      continue
    shutil.move(str(legacy_file), str(target))


def next_scene_index(paths: ProjectPaths) -> int:
  highest = 0
  pattern = re.compile(r"^(\d{4})-.*\.md$")
  for scene_file in paths.scenes_dir.glob("*.md"):
    match = pattern.match(scene_file.name)
    if match:
      highest = max(highest, int(match.group(1)))
  return highest + 1
