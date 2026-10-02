"""Resolve document boundaries before committing any manuscript files."""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from typing import Any

from .project import OpenAuthorError


@dataclass
class ResolvedManuscript:
  """Prose and ordered outline boundaries, including containers without prose."""
  scenes: list[dict[str, Any]]
  outline: list[dict[str, Any]]


def correct_sections(sections: list[dict[str, Any]], corrections: dict[str, Any] | None) -> None:
  if corrections is None:
    return
  if not isinstance(corrections, dict) or set(corrections) - {section["id"] for section in sections}:
    raise OpenAuthorError("Import corrections refer to unknown sections. Refresh the preview.")
  for section in sections:
    change = corrections.get(section["id"], {})
    if not isinstance(change, dict) or set(change) - {"title", "role"}:
      raise OpenAuthorError("Import corrections may change only section title and role.")
    if "role" in change:
      if not isinstance(change["role"], str) or change["role"] not in {"act", "chapter", "scene", "text"}:
        raise OpenAuthorError("Section role must be act, chapter, scene or text.")
      section["role"] = change["role"]
    if "title" in change:
      title = change["title"]
      if not isinstance(title, str) or not title.strip() or len(title) > 1000 or "\n" in title or "\r" in title:
        raise OpenAuthorError("Section titles must be one nonempty line, up to 1000 characters.")
      section["title"] = title.strip()

def split_sections(text: str, fallback: str, *, markdown: bool) -> list[dict[str, Any]]:
  sections: list[dict[str, Any]] = []
  title, level, heading = fallback, 0, ""
  body: list[str] = []
  fence = ""
  for line in text.splitlines():
    stripped = line.lstrip()
    fenced = re.match(r"^(`{3,}|~{3,})", stripped) if markdown else None
    if fenced:
      marker = fenced.group(1)
      if not fence:
        fence = marker
      elif marker[0] == fence[0] and len(marker) >= len(fence):
        fence = ""
      body.append(line)
      continue
    match = re.match(r"^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$", line) if markdown and not fence else None
    plain = re.match(r"^((act|part|chapter|scene)\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s*[:.\-]\s*.*)?)$", line, re.IGNORECASE) if not markdown else None
    if match or plain:
      if heading or "\n".join(body).strip():
        sections.append({"title": title, "body": "\n".join(body).strip(), "level": level, "heading": heading})
      title = (match.group(2) if match else plain.group(1)).strip().strip("*_")
      level = len(match.group(1)) if match else {"part": 1, "act": 1, "chapter": 2, "scene": 3}[plain.group(2).lower()]
      heading, body = line, []
    else:
      body.append(line)
  if heading or "\n".join(body).strip():
    sections.append({"title": title, "body": "\n".join(body).strip(), "level": level, "heading": heading})
  infer_section_roles(sections)
  return sections


def infer_section_roles(sections: list[dict[str, Any]]) -> None:
  for index, section in enumerate(sections):
    # Exported DOCX paragraph styles provide explicit, editable roles.
    if section.get("role"):
      continue
    descendants: list[int] = []
    for following in sections[index + 1:]:
      if following["level"] <= section["level"]:
        break
      descendants.append(following["level"])
    label = section["title"].lower()
    if section["level"] and re.match(r"^(act|part)\b", label):
      role = "act"
    elif section["level"] and re.match(r"^chapter\b", label):
      role = "chapter"
    elif section["level"] and len(set(descendants)) >= 2:
      role = "act"
    elif section["level"] and descendants:
      role = "chapter"
    else:
      role = "scene"
    section["role"] = role


def resolve_sections(sections: list[dict[str, Any]], warnings: list[str]) -> ResolvedManuscript:
  scenes: list[dict[str, Any]] = []
  outline: list[dict[str, Any]] = []
  group = ""
  act: dict[str, Any] | None = None
  chapter: dict[str, Any] | None = None
  for section in sections:
    source = section["source_path"]
    if section.get("source_group", source) != group:
      group = section.get("source_group", source)
      act = chapter = None
    role = section["role"]
    if role != "text":
      if act and section["level"] <= act["level"]:
        act = chapter = None
      if chapter and section["level"] <= chapter["level"]:
        chapter = None
    if (role == "act" and act) or (role == "chapter" and chapter):
      warnings.append(f"Nested {role} '{section['title']}' is flattened to the supported part/chapter hierarchy. Check its parentage in the resulting reading order.")
    if role == "act":
      act, chapter = section, None
    elif role == "chapter":
      chapter = section
    location = {
      "act_key": act["id"] if act else (f"file:{group}" if chapter else ""),
      "act_title": act["title"] if act else section["root_title"],
      "chapter_key": chapter["id"] if chapter else (f"{act['id']}:scenes" if act else ""),
      "chapter_title": chapter["title"] if chapter else ("Opening" if act else ""),
    }
    if role in {"act", "chapter"}:
      outline.append({"role": role, **location})
    body = section["body"]
    if role == "text":
      body = "\n\n".join(value for value in (section["heading"], body) if value)
      if scenes and scenes[-1]["source_path"] == source and scenes[-1]["chapter_key"] == (chapter["id"] if chapter else (f"{act['id']}:scenes" if act else "")):
        scenes[-1]["body"] += "\n\n" + body
        continue
    if not body.strip() and not (role == "scene" and section.get("keep_empty")):
      if role == "scene":
        warnings.append(f"Empty heading '{section['title']}' does not create a scene.")
      continue
    scenes.append({
      "title": section["title"], "body": body,
      "metadata": section.get("metadata", {}),
      "source_path": source, "source_format": section["source_format"],
      **location,
    })
    outline.append({"role": "scene", "scene_index": len(scenes) - 1, **location,
                    "source_path": source})
  return ResolvedManuscript(scenes, outline)


def append_import_structure(plan: dict[str, Any], manuscript: ResolvedManuscript, ids: list[str]) -> list[dict[str, Any]]:
  """Append the reviewed outline, returning imported acts without existing-prose wrappers."""
  if len(ids) != len(manuscript.scenes):
    raise OpenAuthorError("Import scene identifiers do not match the resolved manuscript.")
  if not any(item["role"] in {"act", "chapter"} or item["chapter_key"] for item in manuscript.outline):
    plan["unassigned_scene_ids"].extend(ids)
    return []

  def new_act(title: str) -> dict[str, Any]:
    act = {"id": f"act-{uuid.uuid4().hex[:10]}", "title": title, "synopsis": "", "position": len(plan["acts"]) + 1, "chapters": []}
    plan["acts"].append(act)
    return act

  def new_chapter(act: dict[str, Any], title: str, scene_ids: list[str]) -> dict[str, Any]:
    chapter = {"id": f"chapter-{uuid.uuid4().hex[:10]}", "title": title, "synopsis": "", "position": len(act["chapters"]) + 1, "scene_ids": scene_ids}
    act["chapters"].append(chapter)
    return chapter

  # Existing unassigned prose must remain before the newly appended manuscript.
  if plan["unassigned_scene_ids"]:
    new_chapter(new_act("Existing manuscript"), "Unassigned scenes", list(plan["unassigned_scene_ids"]))
    plan["unassigned_scene_ids"] = []
  imported_start = len(plan["acts"])
  act_key = chapter_key = None
  act = chapter = None
  for item in manuscript.outline:
    next_act = item["act_key"] or f"file:{item['source_path']}"
    next_chapter = item["chapter_key"] or f"{next_act}:unassigned"
    if act_key != next_act:
      act = new_act(item["act_title"] or "Imported manuscript")
      act_key, chapter_key = next_act, None
    if item["role"] == "act":
      continue
    if chapter_key != next_chapter:
      chapter = new_chapter(act, item["chapter_title"] or "Opening", [])
      chapter_key = next_chapter
    if item["role"] == "scene":
      chapter["scene_ids"].append(ids[item["scene_index"]])
  return plan["acts"][imported_start:]
