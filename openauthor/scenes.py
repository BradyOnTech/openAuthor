from __future__ import annotations

from datetime import UTC, datetime
import json
import os
import re
from pathlib import Path
from typing import Any

from .project import OpenAuthorError, ProjectPaths, atomic_write_text, next_scene_index, utc_now
from .project_locks import serialized_project_access
from .reading_order import ordered_scene_ids


def slugify(value: str) -> str:
  slug = value.lower().strip()
  slug = re.sub(r"[^a-z0-9]+", "-", slug)
  slug = re.sub(r"-+", "-", slug).strip("-")
  return slug or "untitled-scene"


def scene_filename(index: int, title: str) -> str:
  return f"{index:04d}-{slugify(title)}.md"


def scene_id(index: int) -> str:
  return f"scene-{index:04d}"


def _serialize_front_matter_value(value: str) -> str:
  # Multi-line or quote-leading values are JSON-encoded so they cannot break
  # the line-oriented frontmatter block (e.g. inject a `---` terminator).
  if "\n" in value or "\r" in value or value != value.strip() or value.startswith('"'):
    return json.dumps(value, ensure_ascii=False)
  return value


def _parse_front_matter_value(raw: str) -> str:
  stripped = raw.strip()
  if stripped.startswith('"') and stripped.endswith('"') and len(stripped) >= 2:
    try:
      decoded = json.loads(stripped)
    except json.JSONDecodeError:
      return stripped
    if isinstance(decoded, str):
      return decoded
  return stripped


def render_scene_markdown(
  *,
  scene_identifier: str,
  title: str,
  summary: str,
  pov: str,
  status: str,
  created_at: str,
  updated_at: str,
  body: str,
) -> str:
  return (
    "---\n"
    f"id: {_serialize_front_matter_value(scene_identifier)}\n"
    f"title: {_serialize_front_matter_value(title)}\n"
    f"summary: {_serialize_front_matter_value(summary)}\n"
    f"pov: {_serialize_front_matter_value(pov)}\n"
    f"status: {_serialize_front_matter_value(status)}\n"
    f"created_at: {_serialize_front_matter_value(created_at)}\n"
    f"updated_at: {_serialize_front_matter_value(updated_at)}\n"
    "---\n\n"
    f"{body.rstrip()}\n"
  )


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
  # The title already has a dedicated, editable field in every authoring
  # surface. Duplicating it into prose makes blank scenes look pre-filled and
  # inflates manuscript word counts, so new scene bodies contain prose only.
  initial_body = body.rstrip()
  return render_scene_markdown(
    scene_identifier=scene_identifier,
    title=title,
    summary=summary,
    pov=pov,
    status=status,
    created_at=timestamp,
    updated_at=timestamp,
    body=initial_body,
  )


@serialized_project_access
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
  for _ in range(10_000):
    filename = scene_filename(index, title)
    file_path = paths.scenes_dir / filename
    # Exclusive create so concurrent adds cannot silently overwrite each other;
    # an index already claimed under a different slug also forces a bump.
    if any(paths.scenes_dir.glob(f"{index:04d}-*.md")):
      index += 1
      continue
    try:
      fd = os.open(file_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
      index += 1
      continue
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
      handle.write(
        build_scene_markdown(
          scene_identifier=scene_id(index),
          title=title,
          summary=summary,
          pov=pov,
          status=status,
          body=body,
        )
      )
    from .product_signals import record_product_event
    record_product_event(paths, "scene_created", word_count=len(body.split()))
    return file_path
  raise OpenAuthorError("Unable to allocate a scene index.")


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
    parsed[key.strip()] = _parse_front_matter_value(value)
  body = text[end + len("\n---\n") :].lstrip("\n")
  return parsed, body


def _scene_detail(paths: ProjectPaths, scene_file: Path) -> dict[str, str]:
  text = scene_file.read_text(encoding="utf-8")
  front_matter, body = split_scene_text(text)
  return {
    "id": front_matter.get("id", scene_file.stem),
    "title": front_matter.get("title", scene_file.stem),
    "summary": front_matter.get("summary", ""),
    "pov": front_matter.get("pov", ""),
    "status": front_matter.get("status", "draft"),
    "created_at": front_matter.get("created_at", ""),
    "updated_at": front_matter.get("updated_at", ""),
    "path": str(scene_file.relative_to(paths.root)),
    "body": body,
  }


@serialized_project_access
def list_scene_details(paths: ProjectPaths) -> list[dict[str, str]]:
  rows = [
    _scene_detail(paths, scene_file)
    for scene_file in sorted(paths.scenes_dir.glob("*.md"))
  ]
  positions = {scene_id: index for index, scene_id in enumerate(ordered_scene_ids(paths, [row["id"] for row in rows]))}
  return sorted(rows, key=lambda row: positions[row["id"]])


def list_scenes(paths: ProjectPaths) -> list[dict[str, Any]]:
  rows: list[dict[str, Any]] = []
  for detail in list_scene_details(paths):
    body = detail["body"]
    summary = {key: value for key, value in detail.items() if key != "body"}
    summary["word_count"] = len(body.split())
    rows.append(summary)
  return rows


@serialized_project_access
def find_scene_file(paths: ProjectPaths, scene_identifier: str) -> Path:
  for scene_file in sorted(paths.scenes_dir.glob("*.md")):
    front_matter = parse_front_matter(scene_file)
    if front_matter.get("id") == scene_identifier:
      return scene_file
  raise OpenAuthorError(f"Unknown scene id '{scene_identifier}'.")


@serialized_project_access
def get_scene(paths: ProjectPaths, scene_identifier: str) -> dict[str, Any]:
  from .scene_edits import scene_edit_version

  for scene_file in sorted(paths.scenes_dir.glob("*.md")):
    detail = _scene_detail(paths, scene_file)
    if detail["id"] == scene_identifier:
      return {**detail, "edit_version": scene_edit_version(paths, detail)}
  raise OpenAuthorError(f"Unknown scene id '{scene_identifier}'.")


@serialized_project_access
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
  current = _scene_detail(paths, scene_file)
  fields = {"title": title, "summary": summary, "pov": pov, "status": status, "body": body}
  if all(
    value is None or (value.rstrip("\n") == current[key].rstrip("\n") if key == "body" else value == current[key])
    for key, value in fields.items()
  ):
    return scene_file
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

  content = render_scene_markdown(
    scene_identifier=updated["id"],
    title=updated["title"],
    summary=updated["summary"],
    pov=updated["pov"],
    status=updated["status"],
    created_at=updated["created_at"],
    updated_at=updated["updated_at"],
    body=updated["body"],
  )
  atomic_write_text(scene_file, content)
  return scene_file
