from __future__ import annotations

from datetime import UTC, datetime
import re
from pathlib import Path

from .project import OpenAuthorError, ProjectPaths, next_scene_index, utc_now


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
  front_matter, _ = split_scene_text(text)
  return front_matter


def split_scene_text(text: str) -> tuple[dict[str, str], str]:
  if not text.startswith("---\n"):
    return {}, text
  end = text.find("\n---\n", 4)
  if end == -1:
    return {}, text
  block = text[4:end]
  parsed: dict[str, str] = {}
  for line in block.splitlines():
    if ":" not in line:
      continue
    key, value = line.split(":", 1)
    parsed[key.strip()] = value.strip()
  body = text[end + len("\n---\n") :].lstrip("\n")
  return parsed, body


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


def find_scene_file(paths: ProjectPaths, scene_identifier: str) -> Path:
  for scene_file in sorted(paths.scenes_dir.glob("*.md")):
    front_matter = parse_front_matter(scene_file)
    if front_matter.get("id") == scene_identifier:
      return scene_file
  raise OpenAuthorError(f"Unknown scene id '{scene_identifier}'.")


def get_scene(paths: ProjectPaths, scene_identifier: str) -> dict[str, str]:
  scene_file = find_scene_file(paths, scene_identifier)
  text = scene_file.read_text(encoding="utf-8")
  front_matter, body = split_scene_text(text)
  return {
    "id": front_matter.get("id", scene_identifier),
    "title": front_matter.get("title", ""),
    "summary": front_matter.get("summary", ""),
    "pov": front_matter.get("pov", ""),
    "status": front_matter.get("status", "draft"),
    "created_at": front_matter.get("created_at", ""),
    "updated_at": front_matter.get("updated_at", ""),
    "path": str(scene_file.relative_to(paths.root)),
    "body": body,
  }


def update_scene(
  paths: ProjectPaths,
  *,
  scene_identifier: str,
  title: str | None = None,
  summary: str | None = None,
  pov: str | None = None,
  status: str | None = None,
  body: str | None = None,
) -> Path:
  scene_file = find_scene_file(paths, scene_identifier)
  current = get_scene(paths, scene_identifier)
  updated = {
    "id": current["id"],
    "title": title if title is not None else current["title"],
    "summary": summary if summary is not None else current["summary"],
    "pov": pov if pov is not None else current["pov"],
    "status": status if status is not None else current["status"],
    "created_at": current["created_at"] or utc_now(),
    "updated_at": datetime.now(UTC).isoformat(),
    "body": body if body is not None else current["body"],
  }

  content = (
    "---\n"
    f"id: {updated['id']}\n"
    f"title: {updated['title']}\n"
    f"summary: {updated['summary']}\n"
    f"pov: {updated['pov']}\n"
    f"status: {updated['status']}\n"
    f"created_at: {updated['created_at']}\n"
    f"updated_at: {updated['updated_at']}\n"
    "---\n\n"
    f"# {updated['title']}\n\n"
    f"{updated['body'].rstrip()}\n"
  )
  scene_file.write_text(content, encoding="utf-8")
  return scene_file
