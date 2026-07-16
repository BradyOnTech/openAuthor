from __future__ import annotations

import json
import os
import re
import tempfile
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree
from xml.sax.saxutils import escape

from .project import OpenAuthorError, ProjectPaths, atomic_write_json, next_scene_index, utc_now
from .scenes import build_scene_markdown, list_scene_details, scene_filename, scene_id

SUPPORTED_IMPORT_SUFFIXES = {".md", ".markdown", ".txt", ".docx"}
IMPORT_STRATEGIES = {"auto", "files", "headings", "single"}


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


def _scrivener_scenes(source: Path) -> tuple[list[dict[str, Any]], list[str]]:
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

  scenes: list[dict[str, Any]] = []
  warnings: list[str] = []

  def visit(item: ElementTree.Element) -> None:
    identifier = str(item.get("UUID", "")).strip()
    title = _clean_title(item.findtext("Title", default=""), "Untitled Scene")
    include = item.findtext("./MetaData/IncludeInCompile", default="Yes").strip().lower() != "no"
    candidates = [
      project_root / "Files" / "Data" / identifier / "content.rtf",
      project_root / "Files" / "Docs" / f"{identifier}.rtf",
    ]
    content_file = next((path for path in candidates if path.is_file()), None)
    if include and content_file is not None:
      body = _rtf_text(content_file)
      if body:
        scenes.append({
          "title": title,
          "body": body,
          "source_path": str(content_file),
          "source_format": "scrivener",
        })
      else:
        warnings.append(f"Scrivener binder item '{title}' has empty RTF content.")
    children = item.find("Children")
    if children is not None:
      for child in children.findall("BinderItem"):
        visit(child)

  children = draft.find("Children")
  if children is not None:
    for child in children.findall("BinderItem"):
      visit(child)
  if not scenes:
    raise OpenAuthorError("Scrivener Draft/Manuscript binder produced no scenes.")
  return scenes, warnings


def _docx_text(path: Path) -> str:
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
  paragraphs: list[str] = []
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
    if style_name.lower().startswith("heading") and value.strip():
      value = f"# {value.strip()}"
    paragraphs.append(value)
  return "\n".join(paragraphs).strip()


def _read_document(path: Path) -> str:
  if path.suffix.lower() == ".docx":
    return _docx_text(path)
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


def _split_headings(text: str, fallback_title: str, *, markdown: bool) -> list[tuple[str, str]]:
  if markdown:
    marker = re.compile(r"^(#{1,2})\s+(.+?)\s*$", re.MULTILINE)
  else:
    marker = re.compile(
      r"^(?P<title>(?:chapter|scene|part)\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s*[:.\-]\s*.*)?)$",
      re.MULTILINE | re.IGNORECASE,
    )
  matches = list(marker.finditer(text))
  if not matches:
    return [(fallback_title, text.strip())]

  sections: list[tuple[str, str]] = []
  preamble = text[:matches[0].start()].strip()
  if preamble:
    sections.append((fallback_title, preamble))
  for index, match in enumerate(matches):
    title_value = match.group(2) if markdown else match.group("title")
    end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
    body = text[match.end():end].strip()
    sections.append((_clean_title(title_value, fallback_title), body))
  return sections


def _single_scene(text: str, fallback_title: str, *, markdown: bool) -> tuple[str, str]:
  if markdown:
    heading = re.match(r"^#{1,2}\s+(.+?)\s*(?:\n+|$)", text)
    if heading:
      return _clean_title(heading.group(1), fallback_title), text[heading.end():].strip()
  return fallback_title, text.strip()


def _import_scenes(source: Path, strategy: str) -> tuple[list[dict[str, Any]], list[str]]:
  if strategy not in IMPORT_STRATEGIES:
    raise OpenAuthorError(f"Unknown import strategy '{strategy}'.")
  if _scrivener_project_file(source) is not None:
    return _scrivener_scenes(source)
  files = _source_files(source)
  resolved_strategy = strategy
  if strategy == "auto":
    resolved_strategy = "files" if source.is_dir() or len(files) > 1 else "headings"

  scenes: list[dict[str, Any]] = []
  warnings: list[str] = []
  for file_path in files:
    text = _read_document(file_path).strip()
    fallback = _clean_title(file_path.stem.replace("-", " ").replace("_", " "), "Untitled Scene")
    is_markdown_structure = file_path.suffix.lower() in {".md", ".markdown", ".docx"}
    if resolved_strategy in {"files", "single"}:
      parts = [_single_scene(text, fallback, markdown=is_markdown_structure)]
    else:
      parts = _split_headings(
        text,
        fallback,
        markdown=is_markdown_structure,
      )
    if not text:
      warnings.append(f"{file_path.name} is empty.")
    for title, body in parts:
      scenes.append({
        "title": title,
        "body": body,
        "source_path": str(file_path),
        "source_format": file_path.suffix.lower().lstrip("."),
      })
  if not scenes:
    raise OpenAuthorError("Import produced no scenes.")
  return scenes, warnings


def preview_manuscript_import(source: Path, *, strategy: str = "auto") -> dict[str, Any]:
  scenes, warnings = _import_scenes(source, strategy)
  return {
    "source": str(source.expanduser().resolve()),
    "strategy": strategy,
    "scene_count": len(scenes),
    "word_count": sum(len(scene["body"].split()) for scene in scenes),
    "warnings": warnings,
    "scenes": [
      {
        "position": index,
        "title": scene["title"],
        "source_path": scene["source_path"],
        "source_format": scene["source_format"],
        "word_count": len(scene["body"].split()),
        "excerpt": scene["body"][:240],
      }
      for index, scene in enumerate(scenes, start=1)
    ],
  }


def import_manuscript(
  paths: ProjectPaths,
  source: Path,
  *,
  strategy: str = "auto",
) -> dict[str, Any]:
  scenes, warnings = _import_scenes(source, strategy)
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
          summary="",
          pov="",
          status="draft",
          body=str(scene["body"]),
        ),
        encoding="utf-8",
      )
      staged.append((staged_path, target, scene_id(index)))

    committed: list[Path] = []
    try:
      for staged_path, target, _ in staged:
        os.replace(staged_path, target)
        committed.append(target)
    except OSError as error:
      for target in committed:
        target.unlink(missing_ok=True)
      raise OpenAuthorError(f"Import was rolled back after a filesystem error: {error}") from error

  report = {
    "imported_at": utc_now(),
    "source": str(source.expanduser().resolve()),
    "strategy": strategy,
    "scene_count": len(staged),
    "scene_ids": [identifier for _, _, identifier in staged],
    "word_count": sum(len(scene["body"].split()) for scene in scenes),
    "warnings": warnings,
  }
  # Import never promotes inferred names to canon. It only prepares a review queue.
  from .story_memory import extract_memory_suggestions
  report["story_memory_suggestions"] = extract_memory_suggestions(
    paths,
    scene_ids=report["scene_ids"],
  )
  atomic_write_json(paths.project_dir / "last_import_report.json", report)
  from .product_signals import record_product_event
  record_product_event(
    paths,
    "manuscript_imported",
    format=str(scenes[0].get("source_format", "unknown")) if scenes else "unknown",
    scene_count=len(staged),
  )
  return report


def _export_markdown(paths: ProjectPaths, target: Path) -> dict[str, Any]:
  target.mkdir(parents=True, exist_ok=True)
  if any(target.iterdir()):
    raise OpenAuthorError(f"Markdown export destination must be empty: {target}")
  scenes = list_scene_details(paths)
  files: list[str] = []
  for index, scene in enumerate(scenes, start=1):
    output = target / scene_filename(index, scene["title"])
    source = paths.root / scene["path"]
    output.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
    files.append(output.name)
  return {"format": "markdown", "target": str(target), "files": files, "losses": []}


def _paragraph_xml(text: str, *, heading: bool = False, page_break: bool = False) -> str:
  properties = "<w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr>" if heading else ""
  break_xml = "<w:r><w:br w:type=\"page\"/></w:r>" if page_break else ""
  return f"<w:p>{properties}{break_xml}<w:r><w:t xml:space=\"preserve\">{escape(text)}</w:t></w:r></w:p>"


def _export_docx(paths: ProjectPaths, target: Path) -> dict[str, Any]:
  if target.exists():
    raise OpenAuthorError(f"DOCX export target already exists: {target}")
  target.parent.mkdir(parents=True, exist_ok=True)
  paragraphs: list[str] = []
  scenes = list_scene_details(paths)
  for index, scene in enumerate(scenes):
    if index:
      paragraphs.append(_paragraph_xml("", page_break=True))
    paragraphs.append(_paragraph_xml(scene["title"], heading=True))
    body = re.sub(r"^#\s+.*(?:\n+|$)", "", scene["body"], count=1).strip()
    for line in body.splitlines() or [""]:
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
  return {
    "format": "docx",
    "target": str(target),
    "files": [target.name],
    "losses": [
      "Scene metadata other than title is not represented in DOCX.",
      "Comments, tracked changes, and source typography are not available in the scene model.",
    ],
  }


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
