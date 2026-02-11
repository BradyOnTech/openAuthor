from __future__ import annotations

import re
from pathlib import Path

from .project import ProjectPaths, next_scene_index, utc_now


def slugify(value: str) -> str:
  slug = value.lower().strip()
  slug = re.sub(r"[^a-z0-9]+", "-", slug)
  slug = re.sub(r"-+", "-", slug).strip("-")
  return slug or "untitled-scene"


def scene_filename(index: int, title: str) -> str:
  return f"{index:04d}-{slugify(title)}.md"


def scene_id(index: int) -> str:
  return f"scene-{index:04d}"


def build_scene_markdown(
  *,
  scene_identifier: str,
  title: str,
  summary: str,
  pov: str,
  status: str,
  body: str,
) -> str:
  timestamp = utc_now()
  return (
    "---\n"
    f"id: {scene_identifier}\n"
    f"title: {title}\n"
    f"summary: {summary}\n"
    f"pov: {pov}\n"
    f"status: {status}\n"
    f"created_at: {timestamp}\n"
    f"updated_at: {timestamp}\n"
    "---\n\n"
    f"# {title}\n\n"
    f"{body.rstrip()}\n"
  )


def add_scene(
  paths: ProjectPaths,
  *,
  title: str,
  summary: str = "",
  pov: str = "",
  status: str = "draft",
  body: str = "",
) -> Path:
  index = next_scene_index(paths)
  filename = scene_filename(index, title)
  file_path = paths.scenes_dir / filename
  file_path.write_text(
    build_scene_markdown(
      scene_identifier=scene_id(index),
      title=title,
      summary=summary,
      pov=pov,
      status=status,
      body=body,
    ),
    encoding="utf-8",
  )
  return file_path


def parse_front_matter(scene_file: Path) -> dict[str, str]:
  text = scene_file.read_text(encoding="utf-8")
  if not text.startswith("---\n"):
    return {}
  end = text.find("\n---\n", 4)
  if end == -1:
    return {}
  block = text[4:end]
  parsed: dict[str, str] = {}
  for line in block.splitlines():
    if ":" not in line:
      continue
    key, value = line.split(":", 1)
    parsed[key.strip()] = value.strip()
  return parsed


def list_scenes(paths: ProjectPaths) -> list[dict[str, str]]:
  rows: list[dict[str, str]] = []
  for scene_file in sorted(paths.scenes_dir.glob("*.md")):
    front_matter = parse_front_matter(scene_file)
    rows.append(
      {
        "id": front_matter.get("id", scene_file.stem),
        "title": front_matter.get("title", scene_file.stem),
        "status": front_matter.get("status", "unknown"),
        "path": str(scene_file.relative_to(paths.root)),
      }
    )
  return rows
