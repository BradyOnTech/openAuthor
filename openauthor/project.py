from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
import shutil
import tempfile
import uuid
import zipfile
from typing import Any

PROJECT_MARKER = ".openauthor/project.json"
CODEX_IMPORT_DIRECTORY_NAMES = {
  "character",
  "characters",
  "location",
  "locations",
  "lore",
  "item",
  "items",
  "faction",
  "factions",
  "event",
  "events",
}
ARCHIVE_NOISE_DIRECTORY_NAMES = {"__macosx"}
ARCHIVE_CONTENT_DIRECTORY_NAMES = {"manuscript", "scenes", "codex", *CODEX_IMPORT_DIRECTORY_NAMES}


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
  revisions_dir: Path
  revision_objects_dir: Path
  revision_records_dir: Path
  revision_head_file: Path
  structure_file: Path


def utc_now() -> str:
  return datetime.now(UTC).isoformat()


def atomic_write_text(path: Path, content: str) -> None:
  from .book_transactions import write_transaction_text
  if write_transaction_text(path, content):
    return
  path.parent.mkdir(parents=True, exist_ok=True)
  fd, temp_name = tempfile.mkstemp(
    prefix=f".{path.name}.",
    suffix=".tmp",
    dir=path.parent,
  )
  try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
      handle.write(content)
      handle.flush()
      os.fsync(handle.fileno())
    os.replace(temp_name, path)
    directory_fd = os.open(path.parent, os.O_RDONLY)
    try:
      os.fsync(directory_fd)
    finally:
      os.close(directory_fd)
  except BaseException:
    try:
      os.unlink(temp_name)
    except FileNotFoundError:
      pass
    raise


def atomic_write_json(path: Path, payload: Any) -> None:
  atomic_write_text(path, json.dumps(payload, indent=2) + "\n")


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
    revisions_dir=project_dir / "revisions",
    revision_objects_dir=project_dir / "revisions" / "objects",
    revision_records_dir=project_dir / "revisions" / "records",
    revision_head_file=project_dir / "revisions" / "HEAD",
    structure_file=root / "manuscript" / "structure.json",
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
  ensure_project_identity(paths)
  return paths


def initialize_project(
  root: Path,
  name: str | None = None,
  project_id: str | None = None,
) -> ProjectPaths:
  root = root.resolve()
  paths = get_project_paths(root)
  created_new = not paths.config_file.exists()
  paths.project_dir.mkdir(parents=True, exist_ok=True)
  paths.scenes_dir.mkdir(parents=True, exist_ok=True)
  paths.codex_db.parent.mkdir(parents=True, exist_ok=True)
  paths.legacy_proposals_dir.mkdir(parents=True, exist_ok=True)
  ensure_workspace_layout(paths)
  paths.generations_dir.mkdir(parents=True, exist_ok=True)
  paths.retrieval_dir.mkdir(parents=True, exist_ok=True)
  paths.revision_objects_dir.mkdir(parents=True, exist_ok=True)
  paths.revision_records_dir.mkdir(parents=True, exist_ok=True)

  if not paths.config_file.exists():
    project_name = name or root.name
    config = {
      "project_id": (project_id or "").strip() or str(uuid.uuid4()),
      "name": project_name,
      "created_at": utc_now(),
      "storage": {
        "scene_format": "markdown-frontmatter",
        "codex": "sqlite",
        "proposals": "workspace-json",
        "chats": "workspace-jsonl",
      },
    }
    atomic_write_json(paths.config_file, config)

  manuscript_readme = paths.root / "manuscript" / "README.md"
  if not manuscript_readme.exists():
    manuscript_readme.write_text(
      "# Manuscript\n\n"
      "Scene files live in `manuscript/scenes/` and are revisioned locally by openAuthor.\n",
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

  ensure_project_identity(paths, expected_project_id=project_id)
  if not paths.structure_file.exists():
    atomic_write_json(paths.structure_file, {
      "schema_version": 2,
      "brief": {
        "synopsis": "",
        "genre": "",
        "themes": [],
        "style_guide": "",
        "outline": "",
      },
      "acts": [],
      "unassigned_scene_ids": [],
      "beats": [],
      "notes": [],
      "scene_metadata": {},
    })
  if created_new:
    from .product_signals import record_product_event
    record_product_event(paths, "project_created")
  return paths


def ensure_workspace_layout(paths: ProjectPaths) -> None:
  paths.workspace_dir.mkdir(parents=True, exist_ok=True)
  paths.proposals_dir.mkdir(parents=True, exist_ok=True)
  paths.chats_dir.mkdir(parents=True, exist_ok=True)
  paths.chat_threads_dir.mkdir(parents=True, exist_ok=True)
  paths.revision_objects_dir.mkdir(parents=True, exist_ok=True)
  paths.revision_records_dir.mkdir(parents=True, exist_ok=True)
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


def read_project_config(paths: ProjectPaths) -> dict:
  if not paths.config_file.exists():
    raise OpenAuthorError("Project metadata missing. Re-run `openauthor init`.")
  try:
    raw = json.loads(paths.config_file.read_text(encoding="utf-8"))
  except json.JSONDecodeError as error:
    raise OpenAuthorError(f"Invalid project metadata JSON: {error}") from error
  if not isinstance(raw, dict):
    raise OpenAuthorError("Invalid project metadata shape. Expected object.")
  return raw


def write_project_config(paths: ProjectPaths, config: dict) -> None:
  atomic_write_json(paths.config_file, config)


def ensure_project_identity(paths: ProjectPaths, expected_project_id: str | None = None) -> dict:
  config = read_project_config(paths)
  raw_id = str(config.get("project_id", "")).strip()
  if not raw_id:
    raw_id = str(uuid.uuid4())
    config["project_id"] = raw_id
  if expected_project_id:
    normalized_expected = expected_project_id.strip()
    if raw_id != normalized_expected:
      raise OpenAuthorError(
        "Project id mismatch. "
        f"Expected '{normalized_expected}', found '{raw_id}'."
      )
  if "name" not in config or not str(config.get("name", "")).strip():
    config["name"] = paths.root.name
  if "created_at" not in config or not str(config.get("created_at", "")).strip():
    config["created_at"] = utc_now()
  if "storage" not in config or not isinstance(config.get("storage"), dict):
    config["storage"] = {
      "scene_format": "markdown-frontmatter",
      "codex": "sqlite",
      "proposals": "workspace-json",
      "chats": "workspace-jsonl",
    }
  write_project_config(paths, config)
  return config


def inspect_project(paths: ProjectPaths) -> dict:
  config = ensure_project_identity(paths)
  return {
    "project_id": config.get("project_id"),
    "name": config.get("name", ""),
    "created_at": config.get("created_at", ""),
    "project_root": str(paths.root),
    "config_path": str(paths.config_file),
    "storage": config.get("storage", {}),
  }


def _safe_extract_zip(archive_path: Path, destination: Path) -> None:
  with zipfile.ZipFile(archive_path, "r") as archive:
    for member in archive.infolist():
      raw_name = member.filename.strip()
      if raw_name == "":
        continue
      normalized_name = raw_name.replace("\\", "/")
      member_path = Path(normalized_name)
      if member_path.is_absolute():
        raise OpenAuthorError(f"Archive contains absolute path entry '{raw_name}'.")
      if ".." in member_path.parts:
        raise OpenAuthorError(f"Archive contains unsafe parent path entry '{raw_name}'.")
      target = (destination / member_path).resolve()
      try:
        target.relative_to(destination.resolve())
      except ValueError as error:
        raise OpenAuthorError(f"Archive entry escapes destination: '{raw_name}'.") from error
    archive.extractall(destination)


def _is_noise_archive_entry(path: Path) -> bool:
  name = path.name.strip()
  if name == "":
    return True
  lowered = name.lower()
  if lowered in ARCHIVE_NOISE_DIRECTORY_NAMES:
    return True
  return name.startswith(".")


def _is_content_directory_name(name: str) -> bool:
  return name.strip().lower() in ARCHIVE_CONTENT_DIRECTORY_NAMES


def _project_candidate_score(path: Path) -> int:
  score = 0
  if (path / PROJECT_MARKER).exists():
    score += 16
  if (path / "manuscript").is_dir() or (path / "scenes").is_dir():
    score += 8
  if (
    (path / "codex" / "codex.sqlite3").is_file() or
    (path / "codex.sqlite3").is_file() or
    (path / "codex" / "codex.json").is_file() or
    (path / "codex.json").is_file()
  ):
    score += 4
  if any((path / name).is_dir() for name in CODEX_IMPORT_DIRECTORY_NAMES):
    score += 2
  codex_dir = path / "codex"
  if codex_dir.is_dir() and any((codex_dir / name).is_dir() for name in CODEX_IMPORT_DIRECTORY_NAMES):
    score += 2
  return score


def _choose_archive_root(extracted_root: Path) -> Path:
  if (extracted_root / PROJECT_MARKER).exists():
    return extracted_root

  meaningful_children = [
    path for path in extracted_root.iterdir()
    if not _is_noise_archive_entry(path)
  ]
  directories = [path for path in meaningful_children if path.is_dir()]

  if len(meaningful_children) == 1 and len(directories) == 1:
    return directories[0]

  if len(directories) == 1:
    candidate = directories[0]
    if (candidate / PROJECT_MARKER).exists():
      return candidate
    if not _is_content_directory_name(candidate.name):
      return candidate

  if directories:
    marker_directories = [path for path in directories if (path / PROJECT_MARKER).exists()]
    if len(marker_directories) == 1:
      return marker_directories[0]

    project_like_directories = [
      path for path in directories
      if not _is_content_directory_name(path.name)
    ]
    if not project_like_directories:
      return extracted_root

    scored = sorted(
      [(_project_candidate_score(path), path) for path in project_like_directories],
      key=lambda row: row[0],
      reverse=True,
    )
    top_score = scored[0][0]
    if top_score > 0:
      best = [path for score, path in scored if score == top_score]
      if len(best) == 1:
        return best[0]

  return extracted_root


def _copy_tree_contents(source: Path, destination: Path) -> None:
  destination.mkdir(parents=True, exist_ok=True)
  for child in source.iterdir():
    target = destination / child.name
    if child.is_dir():
      shutil.copytree(child, target, dirs_exist_ok=True)
    else:
      target.parent.mkdir(parents=True, exist_ok=True)
      shutil.copy2(child, target)


def _same_path(left: Path, right: Path) -> bool:
  return left.resolve() == right.resolve()


def _import_from_source_root(
  source_root: Path,
  root: Path,
  *,
  name: str | None = None,
  project_id: str | None = None,
) -> tuple[ProjectPaths, dict[str, Any]]:
  source_root = source_root.resolve()
  root = root.resolve()

  mode = "scaffold"
  imported = {
    "manuscript": False,
    "codex_sqlite": False,
    "codex_snapshot": False,
    "project_marker": False,
  }

  if (source_root / PROJECT_MARKER).exists():
    mode = "project"
    imported["project_marker"] = True
    if not _same_path(source_root, root):
      _copy_tree_contents(source_root, root)
    paths = initialize_project(root, name=name, project_id=project_id)
  else:
    paths = initialize_project(root, name=name, project_id=project_id)
    manuscript_root = source_root / "manuscript"
    scenes_root = source_root / "scenes"
    manuscript_target = paths.root / "manuscript"
    if _same_path(source_root, root):
      if scenes_root.exists() and scenes_root.is_dir():
        if not _same_path(scenes_root, paths.scenes_dir):
          _copy_tree_contents(scenes_root, paths.scenes_dir)
        imported["manuscript"] = True
      elif manuscript_root.exists() and manuscript_root.is_dir():
        imported["manuscript"] = True
    else:
      if manuscript_root.exists() and manuscript_root.is_dir():
        if not _same_path(manuscript_root, manuscript_target):
          _copy_tree_contents(manuscript_root, manuscript_target)
        imported["manuscript"] = True
      elif scenes_root.exists() and scenes_root.is_dir():
        if not _same_path(scenes_root, paths.scenes_dir):
          _copy_tree_contents(scenes_root, paths.scenes_dir)
        imported["manuscript"] = True

    codex_sqlite_candidates = [
      source_root / "codex" / "codex.sqlite3",
      source_root / "codex.sqlite3",
    ]
    codex_snapshot_candidates = [
      source_root / "codex" / "codex.json",
      source_root / "codex.json",
    ]
    sqlite_candidate = next(
      (candidate for candidate in codex_sqlite_candidates if candidate.exists() and candidate.is_file()),
      None,
    )
    if sqlite_candidate is not None:
      if not _same_path(sqlite_candidate, paths.codex_db):
        paths.codex_db.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(sqlite_candidate, paths.codex_db)
      imported["codex_sqlite"] = True
    else:
      snapshot_candidate = next(
        (candidate for candidate in codex_snapshot_candidates if candidate.exists() and candidate.is_file()),
        None,
      )
      if snapshot_candidate is not None:
        target_snapshot = paths.root / "codex" / "codex.json"
        if not _same_path(snapshot_candidate, target_snapshot):
          target_snapshot.parent.mkdir(parents=True, exist_ok=True)
          shutil.copy2(snapshot_candidate, target_snapshot)
        from .codex import replace_runtime_codex_from_snapshot

        replace_runtime_codex_from_snapshot(paths)
        imported["codex_snapshot"] = True
      else:
        from .codex import import_codex_from_directory

        codex_folder_import = import_codex_from_directory(paths, source_root)
        if codex_folder_import.get("imported"):
          imported["codex_folder"] = True
          imported["codex_folder_entities"] = int(codex_folder_import.get("entities", 0))

  config = ensure_project_identity(paths, expected_project_id=project_id)
  return paths, {
    "mode": mode,
    "source_root": str(source_root),
    "project_id": config.get("project_id"),
    "imported": imported,
  }


def initialize_project_from_folder(
  source_path: Path,
  root: Path,
  *,
  name: str | None = None,
  project_id: str | None = None,
) -> tuple[ProjectPaths, dict[str, Any]]:
  source_root = source_path.resolve()
  if not source_root.exists() or not source_root.is_dir():
    raise OpenAuthorError(f"Folder source does not exist: {source_root}")

  root = root.resolve()
  if root.exists() and not root.is_dir():
    raise OpenAuthorError(f"Import destination is not a directory: {root}")
  if root.exists() and not _same_path(root, source_root) and any(root.iterdir()):
    raise OpenAuthorError(
      f"Import destination must be empty or missing: {root}"
    )

  paths, summary = _import_from_source_root(
    source_root,
    root,
    name=name,
    project_id=project_id,
  )
  summary["source_path"] = str(source_root)
  return paths, summary


def initialize_project_from_zip(
  archive_path: Path,
  root: Path,
  *,
  name: str | None = None,
  project_id: str | None = None,
) -> tuple[ProjectPaths, dict[str, Any]]:
  archive = archive_path.resolve()
  if not archive.exists() or not archive.is_file():
    raise OpenAuthorError(f"Archive does not exist: {archive}")
  if archive.suffix.lower() != ".zip":
    raise OpenAuthorError("Only .zip archives are supported for import.")

  root = root.resolve()
  if root.exists() and not root.is_dir():
    raise OpenAuthorError(f"Import destination is not a directory: {root}")
  if root.exists() and any(root.iterdir()):
    raise OpenAuthorError(
      f"Import destination must be empty or missing: {root}"
    )

  with tempfile.TemporaryDirectory(prefix="openauthor-import-") as temp_dir_raw:
    temp_root = Path(temp_dir_raw).resolve()
    _safe_extract_zip(archive, temp_root)
    source_root = _choose_archive_root(temp_root)
    paths, summary = _import_from_source_root(
      source_root,
      root,
      name=name,
      project_id=project_id,
    )
    summary["archive_path"] = str(archive)
    return paths, summary
