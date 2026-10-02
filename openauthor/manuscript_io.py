from __future__ import annotations

import json
import hashlib
import os
import re
import tempfile
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree
from xml.sax.saxutils import escape

from .project import OpenAuthorError, ProjectPaths, atomic_write_json, next_scene_index, utc_now
from .project_locks import serialized_project_access
from .planning import list_manuscript_scenes
from .scenes import build_scene_markdown, list_scene_details, scene_filename, scene_id, split_scene_text
from .import_structure import ResolvedManuscript, append_import_structure, correct_sections, infer_section_roles, resolve_sections, split_sections

SUPPORTED_IMPORT_SUFFIXES = {".md", ".markdown", ".txt", ".docx"}
IMPORT_STRATEGIES = {"auto", "files", "headings", "single"}
MANUSCRIPT_EXPORT_LOSSES = [
  "Project brief, beats, planning notes, scene timeline/labels, Story Memory and Canon, AI chats, Change Sets, Versions and Storylines are not included. Use a full backup to preserve the project.",
  "Scene IDs and timestamps are regenerated on manuscript re-import.",
  "Part and chapter synopses are not included; only their titles and reading hierarchy are exported.",
]


def _rtf_text(path: Path) -> str:
  try:
    source = path.read_bytes().decode("latin-1")
  except OSError as error:
    raise OpenAuthorError(f"Unable to read Scrivener RTF '{path}': {error}") from error

  destinations = {
    "fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header",
    "footer", "filetbl", "listtable", "listoverridetable", "revtbl", "xmlnstbl",
  }
  output: list[str] = []
  stack: list[tuple[bool, int]] = []
  skip_destination = False
  unicode_fallback = 1
  skip_plain_chars = 0
  index = 0
  while index < len(source):
    char = source[index]
    if char == "{":
      stack.append((skip_destination, unicode_fallback))
      index += 1
      continue
    if char == "}":
      if stack:
        skip_destination, unicode_fallback = stack.pop()
      index += 1
      continue
    if char != "\\":
      if not skip_destination and skip_plain_chars == 0 and char not in "\r\n":
        output.append(char)
      elif skip_plain_chars > 0:
        skip_plain_chars -= 1
      index += 1
      continue

    index += 1
    if index >= len(source):
      break
    symbol = source[index]
    if symbol in "{}\\":
      if not skip_destination:
        output.append(symbol)
      index += 1
      continue
    if symbol == "'" and index + 2 < len(source):
      try:
        decoded = bytes([int(source[index + 1:index + 3], 16)]).decode("cp1252")
      except (ValueError, UnicodeDecodeError):
        decoded = ""
      if not skip_destination and skip_plain_chars == 0:
        output.append(decoded)
      elif skip_plain_chars > 0:
        skip_plain_chars -= 1
      index += 3
      continue
    if symbol == "*":
      skip_destination = True
      index += 1
      continue
    if not symbol.isalpha():
      if not skip_destination:
        if symbol == "~":
          output.append(" ")
        elif symbol == "_":
          output.append("-")
      index += 1
      continue

    start = index
    while index < len(source) and source[index].isalpha():
      index += 1
    word = source[start:index]
    sign = 1
    if index < len(source) and source[index] == "-":
      sign = -1
      index += 1
    number_start = index
    while index < len(source) and source[index].isdigit():
      index += 1
    number = sign * int(source[number_start:index]) if index > number_start else None
    if index < len(source) and source[index] == " ":
      index += 1

    if word in destinations:
      skip_destination = True
    elif word == "uc" and number is not None:
      unicode_fallback = max(0, number)
    elif word == "u" and number is not None and not skip_destination:
      codepoint = number if number >= 0 else number + 65536
      output.append(chr(codepoint))
      skip_plain_chars = unicode_fallback
    elif not skip_destination and word in {"par", "line"}:
      output.append("\n")
    elif not skip_destination and word == "tab":
      output.append("\t")

  text = "".join(output).replace("\r", "")
  text = re.sub(r"[ \t]+\n", "\n", text)
  text = re.sub(r"\n{3,}", "\n\n", text)
  return text.strip()


def _scrivener_project_file(source: Path) -> tuple[Path, Path] | None:
  resolved = source.expanduser().resolve()
  if resolved.is_file() and resolved.suffix.lower() == ".scrivx":
    return resolved.parent, resolved
  if resolved.is_dir():
    candidates = sorted(resolved.glob("*.scrivx"))
    if candidates:
      return resolved, candidates[0]
  return None


def _scrivener_sections(source: Path) -> tuple[list[dict[str, Any]], list[str]]:
  project = _scrivener_project_file(source)
  if project is None:
    raise OpenAuthorError(f"No Scrivener .scrivx project file found in {source}.")
  project_root, project_file = project
  try:
    xml_root = ElementTree.parse(project_file).getroot()
  except (OSError, ElementTree.ParseError) as error:
    raise OpenAuthorError(f"Unable to read Scrivener project '{project_file}': {error}") from error

  draft = next(
    (item for item in xml_root.iter("BinderItem") if item.get("Type") == "DraftFolder"),
    None,
  )
  if draft is None:
    raise OpenAuthorError("Scrivener project does not contain a Draft/Manuscript binder.")

  sections: list[dict[str, Any]] = []
  warnings: list[str] = ["Scrivener import preserves Draft binder order, prose and up to part/chapter hierarchy. Research, snapshots, annotations, rich formatting and excluded binder subtrees are not imported. Keep the original project."]

  def visit(item: ElementTree.Element, level: int = 1) -> None:
    identifier = str(item.get("UUID", item.get("ID", ""))).strip()
    title = _clean_title(item.findtext("Title", default=""), "Untitled Scene")
    include = item.findtext("./MetaData/IncludeInCompile", default="Yes").strip().lower() != "no"
    if not include:
      warnings.append(f"Excluded binder item '{title}' and its descendants were skipped.")
      return
    if identifier and not re.fullmatch(r"[A-Za-z0-9_-]+", identifier):
      raise OpenAuthorError(f"Invalid Scrivener binder identifier for '{title}'.")
    candidates = [
      project_root / "Files" / "Data" / identifier / "content.rtf",
      project_root / "Files" / "Docs" / f"{identifier}.rtf",
    ]
    content_file = next((path for path in candidates if identifier and path.is_file()), None)
    if content_file is not None:
      if not content_file.resolve().is_relative_to(project_root):
        raise OpenAuthorError(f"Scrivener content for '{title}' escapes the selected project.")
      body = _rtf_text(content_file)
      if not body:
        warnings.append(f"Scrivener binder item '{title}' has empty RTF content.")
    else:
      body = ""
    children = item.find("Children")
    has_children = children is not None and len(children) > 0
    is_folder = item.get("Type", "").lower() == "folder"
    nested_groups = has_children and any(child.get("Type", "").lower() == "folder" or child.find("Children/BinderItem") is not None for child in children)
    role = "act" if nested_groups and level == 1 else "chapter" if has_children or is_folder else "scene"
    if is_folder and not has_children:
      warnings.append(f"Empty binder folder '{title}' is represented as a chapter. Correct its role to Part / Act in the preview if needed.")
    if level > 2 and has_children:
      warnings.append(f"Nested binder group '{title}' is represented as a chapter; deeper grouping is flattened.")
    sections.append({"title": title, "body": body, "source_path": str(content_file or project_file),
                     "source_group": str(project_file), "source_format": "scrivener", "root_title": source.stem,
                     "role": role, "level": level, "heading": title})
    if children is not None:
      for child in children.findall("BinderItem"):
        visit(child, level + 1)

  children = draft.find("Children")
  if children is not None:
    for child in children.findall("BinderItem"):
      visit(child)
  return sections, warnings


def _docx_paragraphs(path: Path) -> list[tuple[str, int, str]]:
  try:
    with zipfile.ZipFile(path) as archive:
      document = archive.read("word/document.xml")
  except (zipfile.BadZipFile, KeyError, OSError) as error:
    raise OpenAuthorError(f"Unable to read DOCX '{path}': {error}") from error
  try:
    root = ElementTree.fromstring(document)
  except ElementTree.ParseError as error:
    raise OpenAuthorError(f"DOCX document XML is invalid: {error}") from error
  namespace = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
  paragraphs: list[tuple[str, int, str]] = []
  for paragraph in root.iter(f"{namespace}p"):
    pieces: list[str] = []
    for node in paragraph.iter():
      if node.tag == f"{namespace}t" and node.text:
        pieces.append(node.text)
      elif node.tag == f"{namespace}tab":
        pieces.append("\t")
      elif node.tag in {f"{namespace}br", f"{namespace}cr"}:
        pieces.append("\n")
    value = "".join(pieces)
    style = paragraph.find(f"{namespace}pPr/{namespace}pStyle")
    style_name = style.get(f"{namespace}val", "") if style is not None else ""
    role = {"OpenAuthorAct": "act", "OpenAuthorChapter": "chapter", "OpenAuthorScene": "scene"}.get(style_name, "")
    heading = re.fullmatch(r"heading\s*([1-9])", style_name, re.IGNORECASE)
    outline = paragraph.find(f"{namespace}pPr/{namespace}outlineLvl")
    outline_value = outline.get(f"{namespace}val", "") if outline is not None else ""
    level = {"act": 1, "chapter": 2, "scene": 3}.get(role, 0) or (int(heading.group(1)) if heading else int(outline_value) + 1 if outline_value in {str(n) for n in range(9)} else 0)
    paragraphs.append((value, level if value.strip() else 0, role))
  return paragraphs


def _docx_sections(path: Path, fallback: str) -> list[dict[str, Any]]:
  sections: list[dict[str, Any]] = []
  current: dict[str, Any] = {"title": fallback, "body": "", "level": 0, "heading": ""}
  for text, level, role in _docx_paragraphs(path):
    if level:
      if current["body"].strip() or current["heading"]:
        current["body"] = current["body"].strip()
        sections.append(current)
      title = text.strip() if role else " ".join(text.split())
      current = {"title": title, "body": "", "level": level, "heading": f"{'#' * level} {title}"}
      if role:
        current.update(role=role, keep_empty=role == "scene")
    else:
      current["body"] += text + "\n"
  if current["body"].strip() or current["heading"]:
    current["body"] = current["body"].strip()
    sections.append(current)
  infer_section_roles(sections)
  return sections


def _read_document(path: Path) -> str:
  if path.suffix.lower() == ".docx":
    return "\n".join(f"{'#' * level} {text}" if level else text for text, level, _ in _docx_paragraphs(path)).strip()
  try:
    return path.read_text(encoding="utf-8-sig")
  except UnicodeDecodeError as error:
    raise OpenAuthorError(
      f"'{path}' is not UTF-8 text. Save it as UTF-8 or DOCX before importing."
    ) from error
  except OSError as error:
    raise OpenAuthorError(f"Unable to read '{path}': {error}") from error


def _source_files(source: Path) -> list[Path]:
  resolved = source.expanduser().resolve()
  if not resolved.exists():
    raise OpenAuthorError(f"Import source does not exist: {resolved}")
  if resolved.is_file():
    if resolved.suffix.lower() not in SUPPORTED_IMPORT_SUFFIXES:
      raise OpenAuthorError("Import supports Markdown, TXT, and DOCX files.")
    return [resolved]
  files = sorted(
    path for path in resolved.rglob("*")
    if path.is_file() and path.suffix.lower() in SUPPORTED_IMPORT_SUFFIXES
  )
  if not files:
    raise OpenAuthorError(f"No Markdown, TXT, or DOCX files found in {resolved}.")
  return files


def _clean_title(value: str, fallback: str) -> str:
  cleaned = re.sub(r"^[#\s]+", "", value).strip().strip("*_")
  return cleaned or fallback


def _single_scene(text: str, fallback_title: str, *, markdown: bool) -> tuple[str, str]:
  if markdown:
    heading = re.match(r"^#{1,2}\s+(.+?)\s*(?:\n+|$)", text)
    if heading:
      return _clean_title(heading.group(1), fallback_title), text[heading.end():].strip()
  return fallback_title, text.strip()


def _markdown_bundle_sections(source: Path) -> tuple[list[dict[str, Any]], list[str]]:
  root = source.expanduser().resolve()
  try:
    manifest = json.loads((root / "openauthor-manuscript.json").read_text(encoding="utf-8"))
  except (ValueError, OSError) as error:
    raise OpenAuthorError(f"Unable to read manuscript export manifest: {error}") from error
  if not isinstance(manifest, dict) or manifest.get("schema_version") != 1 or not isinstance(manifest.get("sections"), list):
    raise OpenAuthorError("Unsupported manuscript export manifest.")
  sections: list[dict[str, Any]] = []
  used: set[Path] = set()
  for section in manifest["sections"]:
    if not isinstance(section, dict) or not isinstance(section.get("role"), str) or section["role"] not in {"act", "chapter", "scene"} or not isinstance(section.get("title"), str):
      raise OpenAuthorError("Invalid section in manuscript export manifest.")
    role, title = section["role"], section["title"]
    body, metadata = "", {}
    path = root / "openauthor-manuscript.json"
    if role == "scene":
      relative = section.get("file")
      if not isinstance(relative, str) or Path(relative).is_absolute():
        raise OpenAuthorError("Invalid scene file in manuscript export manifest.")
      path = (root / relative).resolve()
      if not path.is_relative_to(root) or path.suffix.lower() != ".md" or path in used:
        raise OpenAuthorError("Manuscript export references a duplicate or unsafe scene path.")
      used.add(path)
      metadata, body = split_scene_text(_read_document(path))
      title = metadata.get("title", title)
    sections.append({"title": title, "body": body.rstrip(), "role": role,
                     "level": {"act": 1, "chapter": 2, "scene": 3}[role], "heading": title,
                     "source_path": str(path), "source_group": str(root), "source_format": "markdown",
                     "root_title": root.name, "metadata": {key: metadata[key] for key in ("summary", "pov", "status") if key in metadata},
                     "keep_empty": role == "scene"})
  return sections, ["Reading hierarchy and scene metadata are loaded from the openAuthor manuscript manifest.", *MANUSCRIPT_EXPORT_LOSSES]


def _import_sections(source: Path, strategy: str) -> tuple[list[dict[str, Any]], list[str]]:
  if strategy not in IMPORT_STRATEGIES:
    raise OpenAuthorError(f"Unknown import strategy '{strategy}'.")
  if _scrivener_project_file(source) is not None:
    return _scrivener_sections(source)
  if (source.expanduser() / "openauthor-manuscript.json").is_file():
    return _markdown_bundle_sections(source)
  files = _source_files(source)
  resolved_strategy = strategy
  if strategy == "auto":
    resolved_strategy = "files" if source.is_dir() or len(files) > 1 else "headings"

  sections: list[dict[str, Any]] = []
  warnings: list[str] = []
  for file_path in files:
    if file_path.suffix.lower() == ".docx":
      warnings.append(f"{file_path.name}: paragraph text and heading levels are imported; rich formatting, images, comments, tracked changes, headers and footnotes are not preserved. Keep the original file.")
    text = _read_document(file_path).strip()
    fallback = _clean_title(file_path.stem.replace("-", " ").replace("_", " "), "Untitled Scene")
    is_markdown_structure = file_path.suffix.lower() in {".md", ".markdown", ".docx"}
    if file_path.suffix.lower() == ".docx":
      parts = _docx_sections(file_path, fallback)
      if resolved_strategy in {"files", "single"} and parts:
        if len(parts) > 1 or parts[0]["role"] in {"act", "chapter"}:
          warnings.append(f"{file_path.name}: {resolved_strategy.title()} strategy flattens the outline into one scene; empty parts and chapters are not retained as Plan containers. Choose Headings to retain and review boundaries.")
        first, *rest = parts
        body = "\n\n".join([first["body"], *("\n\n".join(value for value in (part["heading"], part["body"]) if value) for part in rest)]).strip()
        parts = [dict(first, body=body, role="scene", level=0)]
    elif resolved_strategy in {"files", "single"}:
      boundaries = split_sections(text, fallback, markdown=is_markdown_structure)
      if len(boundaries) > 1 or any(part["role"] in {"act", "chapter"} for part in boundaries):
        warnings.append(f"{file_path.name}: {resolved_strategy.title()} strategy flattens the outline into one scene; empty parts and chapters are not retained as Plan containers. Choose Headings to retain and review boundaries.")
      title, body = _single_scene(text, fallback, markdown=is_markdown_structure)
      parts = [{"title": title, "body": body, "role": "scene", "level": 0, "heading": ""}]
    else:
      parts = split_sections(text, fallback, markdown=is_markdown_structure)
    if not text:
      warnings.append(f"{file_path.name} is empty.")
    sections.extend(dict(part, root_title=fallback,
                     source_path=str(file_path), source_format=file_path.suffix.lower().lstrip("."))
                    for part in parts)
  return sections, warnings


def _resolve_import(source: Path, strategy: str, corrections: dict[str, Any] | None = None) -> tuple[ResolvedManuscript, list[str], list[dict[str, Any]], str]:
  sections, warnings = _import_sections(source, strategy)
  for index, section in enumerate(sections, start=1):
    section["id"] = f"section-{index:04d}"
  correct_sections(sections, corrections)
  fingerprint = hashlib.sha256(json.dumps({"strategy": strategy, "sections": sections}, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
  manuscript = resolve_sections(sections, warnings)
  if not manuscript.outline:
    raise OpenAuthorError("Import produced no scenes or outline containers.")
  return manuscript, warnings, sections, fingerprint


def preview_manuscript_import(source: Path, *, strategy: str = "auto", corrections: dict[str, Any] | None = None) -> dict[str, Any]:
  manuscript, warnings, sections, fingerprint = _resolve_import(source, strategy, corrections)
  scenes = manuscript.scenes
  plan: dict[str, Any] = {"acts": [], "unassigned_scene_ids": []}
  preview_ids = [str(index) for index in range(len(scenes))]
  append_import_structure(plan, manuscript, preview_ids)
  locations = {identifier: {"act_title": act["title"], "chapter_title": chapter["title"]}
               for act in plan["acts"] for chapter in act["chapters"] for identifier in chapter["scene_ids"]}
  if plan["acts"] and any(not scene["chapter_key"] for scene in scenes):
    warnings.append("Ungrouped prose is placed in Opening chapters to preserve the source reading order. Check the resulting reading order below.")
  return {
    "source": str(source.expanduser().resolve()),
    "strategy": strategy,
    "scene_count": len(scenes),
    "act_count": len(plan["acts"]),
    "chapter_count": sum(len(act["chapters"]) for act in plan["acts"]),
    "word_count": sum(len(scene["body"].split()) for scene in scenes),
    "warnings": warnings,
    "fingerprint": fingerprint,
    "outline": [{"title": act["title"], "chapters": [
      {"title": chapter["title"], "scene_positions": [int(value) + 1 for value in chapter["scene_ids"]]}
      for chapter in act["chapters"]]} for act in plan["acts"]],
    "sections": [{key: value for key, value in section.items() if key not in {"body", "heading"}}
                 | {"word_count": len(section["body"].split()), "excerpt": section["body"][:240]}
                 for section in sections],
    "scenes": [
      {
        "position": index,
        "title": scene["title"],
        "source_path": scene["source_path"],
        "source_format": scene["source_format"],
        "word_count": len(scene["body"].split()),
        "excerpt": scene["body"][:240],
        **locations.get(str(index - 1), {"act_title": "", "chapter_title": ""}),
      }
      for index, scene in enumerate(scenes, start=1)
    ],
  }


@serialized_project_access
def import_manuscript(
  paths: ProjectPaths,
  source: Path,
  *,
  strategy: str = "auto",
  corrections: dict[str, Any] | None = None,
  expected_fingerprint: str | None = None,
) -> dict[str, Any]:
  manuscript, warnings, _, fingerprint = _resolve_import(source, strategy, corrections)
  if expected_fingerprint is not None and expected_fingerprint != fingerprint:
    raise OpenAuthorError("Import source or corrections changed. Refresh the preview before importing.")
  from .revisions import checkpointed_edit
  with checkpointed_edit(paths, f"Import {source.name}", kind="manuscript_import"):
    return _commit_import(paths, source, strategy, manuscript, warnings)


def _commit_import(paths: ProjectPaths, source: Path, strategy: str, manuscript: ResolvedManuscript, warnings: list[str]) -> dict[str, Any]:
  from .planning import get_plan
  plan = get_plan(paths, persist=False)
  scenes = manuscript.scenes
  if plan["unassigned_scene_ids"] and any(item["role"] in {"act", "chapter"} or item["chapter_key"] for item in manuscript.outline):
    warnings.append("Existing unassigned scenes were grouped under 'Existing manuscript' to preserve their reading order before the import.")
  start_index = next_scene_index(paths)
  staged: list[tuple[Path, Path, str]] = []
  paths.workspace_dir.mkdir(parents=True, exist_ok=True)
  with tempfile.TemporaryDirectory(prefix="import-", dir=paths.workspace_dir) as tmp:
    staging = Path(tmp)
    for offset, scene in enumerate(scenes):
      index = start_index + offset
      title = str(scene["title"])
      filename = scene_filename(index, title)
      target = paths.scenes_dir / filename
      if target.exists() or any(paths.scenes_dir.glob(f"{index:04d}-*.md")):
        raise OpenAuthorError(f"Import target collision at scene index {index}.")
      staged_path = staging / filename
      staged_path.write_text(
        build_scene_markdown(
          scene_identifier=scene_id(index),
          title=title,
          summary=scene.get("metadata", {}).get("summary", ""),
          pov=scene.get("metadata", {}).get("pov", ""),
          status=scene.get("metadata", {}).get("status", "draft"),
          body=str(scene["body"]),
        ),
        encoding="utf-8",
      )
      staged.append((staged_path, target, scene_id(index)))

    committed: list[Path] = []
    try:
      for staged_path, target, _ in staged:
        from .book_transactions import write_transaction_text
        if not write_transaction_text(target, staged_path.read_text(encoding="utf-8"), exclusive=True):
          os.replace(staged_path, target)
        committed.append(target)
      imported_acts = append_import_structure(plan, manuscript, [identifier for _, _, identifier in staged])
      atomic_write_json(paths.structure_file, plan)
    except OSError as error:
      for target in committed:
        target.unlink(missing_ok=True)
      raise OpenAuthorError(f"Import was rolled back after a filesystem error: {error}") from error

  report = {
    "imported_at": utc_now(),
    "source": str(source.expanduser().resolve()),
    "strategy": strategy,
    "scene_count": len(staged),
    "act_count": len(imported_acts),
    "chapter_count": sum(len(act["chapters"]) for act in imported_acts),
    "scene_ids": [identifier for _, _, identifier in staged],
    "word_count": sum(len(scene["body"].split()) for scene in scenes),
    "warnings": warnings,
  }
  # Import never promotes inferred names to canon. It only prepares a review queue.
  from .story_memory import extract_memory_suggestions
  if report["scene_ids"]:
    report["story_memory_suggestions"] = extract_memory_suggestions(paths, scene_ids=report["scene_ids"])
  atomic_write_json(paths.project_dir / "last_import_report.json", report)
  from .product_signals import record_product_event
  record_product_event(
    paths,
    "manuscript_imported",
    format=str(scenes[0].get("source_format", "unknown")) if scenes else "unknown",
    scene_count=len(staged),
  )
  return report


def _export_sections(paths: ProjectPaths, scenes: list[dict[str, Any]]) -> list[dict[str, Any]]:
  from .planning import get_plan
  plan = get_plan(paths, persist=False)
  by_id = {scene["id"]: scene for scene in scenes}
  sections: list[dict[str, Any]] = []
  for act in plan["acts"]:
    sections.append({"role": "act", "title": act["title"]})
    for chapter in act["chapters"]:
      sections.append({"role": "chapter", "title": chapter["title"]})
      sections.extend({"role": "scene", "title": by_id[identifier]["title"], "scene_id": identifier} for identifier in chapter["scene_ids"])
  if plan["acts"] and plan["unassigned_scene_ids"]:
    sections.extend([{"role": "act", "title": "Unassigned scenes"}, {"role": "chapter", "title": "Unassigned scenes"}])
  sections.extend({"role": "scene", "title": by_id[identifier]["title"], "scene_id": identifier} for identifier in plan["unassigned_scene_ids"])
  return sections


def _export_markdown(paths: ProjectPaths, target: Path) -> dict[str, Any]:
  target.mkdir(parents=True, exist_ok=True)
  if any(target.iterdir()):
    raise OpenAuthorError(f"Markdown export destination must be empty: {target}")
  scenes = list_manuscript_scenes(paths)
  files: list[str] = []
  names: dict[str, str] = {}
  for index, scene in enumerate(scenes, start=1):
    output = target / scene_filename(index, scene["title"])
    source = paths.root / scene["path"]
    output.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
    files.append(output.name)
    names[scene["id"]] = output.name
  sections = _export_sections(paths, scenes)
  for section in sections:
    if section["role"] == "scene":
      section["file"] = names[section.pop("scene_id")]
  atomic_write_json(target / "openauthor-manuscript.json", {"schema_version": 1, "sections": sections})
  files.append("openauthor-manuscript.json")
  return {"format": "markdown", "target": str(target), "files": files, "preserves": ["Scene prose and metadata", "Part/chapter/scene reading hierarchy, including empty parts and chapters, via openauthor-manuscript.json"], "losses": [*MANUSCRIPT_EXPORT_LOSSES, "Keep openauthor-manuscript.json with all scene files. Importing individual files without it cannot recover empty parts and chapters or their parentage."]}


def _paragraph_xml(text: str, *, heading: int = 0, role: str = "", page_break: bool = False) -> str:
  style = f"OpenAuthor{role.title()}" if role else f"Heading{heading}"
  properties = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if heading else ""
  break_xml = "<w:r><w:br w:type=\"page\"/></w:r>" if page_break else ""
  return f"<w:p>{properties}{break_xml}<w:r><w:t xml:space=\"preserve\">{escape(text)}</w:t></w:r></w:p>"


def _export_docx(paths: ProjectPaths, target: Path) -> dict[str, Any]:
  if target.exists():
    raise OpenAuthorError(f"DOCX export target already exists: {target}")
  target.parent.mkdir(parents=True, exist_ok=True)
  paragraphs: list[str] = []
  scenes = list_scene_details(paths)
  by_id = {scene["id"]: scene for scene in scenes}
  sections = _export_sections(paths, scenes)
  structured = any(section["role"] != "scene" for section in sections)
  for section in sections:
    heading = {"act": 1, "chapter": 2, "scene": 3}[section["role"]] if structured else 1
    paragraphs.append(_paragraph_xml(section["title"], heading=heading, role=section["role"]))
    if section["role"] != "scene":
      continue
    scene = by_id[section["scene_id"]]
    for line in scene["body"].rstrip().splitlines() or [""]:
      paragraphs.append(_paragraph_xml(line))
  document = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    f"<w:body>{''.join(paragraphs)}<w:sectPr/></w:body></w:document>"
  )
  content_types = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    '</Types>'
  )
  relationships = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    '</Relationships>'
  )
  with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    archive.writestr("[Content_Types].xml", content_types)
    archive.writestr("_rels/.rels", relationships)
    archive.writestr("word/document.xml", document)
    archive.writestr("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
    styles = ''.join(f'<w:style w:type="paragraph" w:styleId="Heading{level}"><w:name w:val="heading {level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="{level - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="{size}"/></w:rPr></w:style>' for level, size in [(1, 36), (2, 30), (3, 26)])
    styles += ''.join(f'<w:style w:type="paragraph" w:styleId="OpenAuthor{role}"><w:name w:val="openAuthor {role}"/><w:basedOn w:val="Heading{level}"/><w:next w:val="Normal"/><w:pPr><w:outlineLvl w:val="{level - 1}"/></w:pPr></w:style>' for role, level in [("Act", 1), ("Chapter", 2), ("Scene", 3 if structured else 1)])
    archive.writestr("word/styles.xml", f'<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>{styles}</w:styles>')
  return {
    "format": "docx",
    "target": str(target),
    "files": [target.name],
    "preserves": ["Scene prose and part/chapter/scene roles, including empty parts and chapters, while openAuthor paragraph styles are retained."],
    "losses": [
      *MANUSCRIPT_EXPORT_LOSSES,
      "Scene metadata other than title is not represented in DOCX.",
      "Markdown formatting syntax is exported as literal text, not typeset formatting.",
      "Other editors can remove section styles. Without them, heading roles are inferred and empty headings may be omitted; review and correct the import preview. Files/Single strategy flattens hierarchy into prose.",
      "Comments, tracked changes, and source typography are not available in the scene model.",
    ],
  }


@serialized_project_access
def export_manuscript(paths: ProjectPaths, target: Path, *, format: str) -> dict[str, Any]:
  normalized = format.strip().lower()
  resolved = target.expanduser().resolve()
  if normalized == "markdown":
    report = _export_markdown(paths, resolved)
    report_path = resolved / "openauthor-export-report.json"
  elif normalized == "docx":
    report = _export_docx(paths, resolved)
    report_path = resolved.with_suffix(resolved.suffix + ".report.json")
  else:
    raise OpenAuthorError("Export format must be 'markdown' or 'docx'.")
  report.update({"exported_at": utc_now(), "scene_count": len(list_scene_details(paths))})
  atomic_write_json(report_path, report)
  report["report_path"] = str(report_path)
  from .product_signals import record_product_event
  record_product_event(
    paths,
    "manuscript_exported",
    format=normalized,
    scene_count=report["scene_count"],
    loss_count=len(report["losses"]),
  )
  return report
