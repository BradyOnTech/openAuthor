from __future__ import annotations

import hashlib
import difflib
import json
import uuid
from pathlib import Path
from typing import Any

from .codex import export_codex_json
from .project import OpenAuthorError, ProjectPaths, atomic_write_json, atomic_write_text, utc_now
from .scenes import split_scene_text

REVISION_SCHEMA_VERSION = 1
STATIC_BOOK_PATHS = [
  "manuscript/structure.json",
  ".openauthor/project.json",
  ".openauthor/provider_pricing.json",
  ".openauthor/generation_budget_policy.json",
  ".openauthor/editorial_passes.json",
  ".openauthor/style_profile.json",
  "codex/codex.json",
  "codex/suggestions.json",
  "codex/memory.json",
]


def ensure_revision_store(paths: ProjectPaths) -> None:
  paths.revision_objects_dir.mkdir(parents=True, exist_ok=True)
  paths.revision_records_dir.mkdir(parents=True, exist_ok=True)


def revision_head(paths: ProjectPaths) -> str:
  if not paths.revision_head_file.exists():
    return ""
  return paths.revision_head_file.read_text(encoding="utf-8").strip()


def _book_files(paths: ProjectPaths) -> list[Path]:
  try:
    export_codex_json(paths)
  except OpenAuthorError:
    pass
  files = [path for path in sorted(paths.scenes_dir.glob("*.md")) if path.is_file()]
  for relative in STATIC_BOOK_PATHS:
    candidate = paths.root / relative
    if candidate.is_file():
      files.append(candidate)
  return sorted(set(files), key=lambda path: str(path.relative_to(paths.root)))


def _store_object(paths: ProjectPaths, content: str) -> str:
  digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
  object_path = paths.revision_objects_dir / digest[:2] / digest[2:]
  if not object_path.exists():
    atomic_write_text(object_path, content)
  return digest


def create_revision(
  paths: ProjectPaths,
  message: str,
  *,
  kind: str = "manual",
  metadata: dict[str, Any] | None = None,
) -> str:
  ensure_revision_store(paths)
  manifest: dict[str, str] = {}
  for file_path in _book_files(paths):
    relative = file_path.relative_to(paths.root).as_posix()
    manifest[relative] = _store_object(paths, file_path.read_text(encoding="utf-8"))

  created_at = utc_now()
  parent = revision_head(paths)
  identity_payload = {
    "parent": parent,
    "created_at": created_at,
    "message": message.strip(),
    "kind": kind.strip() or "manual",
    "manifest": manifest,
    "nonce": uuid.uuid4().hex,
  }
  revision_id = hashlib.sha256(
    json.dumps(identity_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
  ).hexdigest()
  record = {
    "schema_version": REVISION_SCHEMA_VERSION,
    "id": revision_id,
    "parent": parent,
    "created_at": created_at,
    "message": message.strip(),
    "kind": kind.strip() or "manual",
    "manifest": manifest,
    "metadata": metadata or {},
  }
  atomic_write_json(paths.revision_records_dir / f"{revision_id}.json", record)
  atomic_write_text(paths.revision_head_file, f"{revision_id}\n")
  return revision_id


def get_revision(paths: ProjectPaths, revision_id: str) -> dict[str, Any]:
  normalized = revision_id.strip()
  if not normalized:
    raise OpenAuthorError("Revision id cannot be empty.")
  record_path = paths.revision_records_dir / f"{normalized}.json"
  if not record_path.exists():
    raise OpenAuthorError(f"Unknown revision '{normalized}'.")
  try:
    payload = json.loads(record_path.read_text(encoding="utf-8"))
  except (OSError, json.JSONDecodeError) as error:
    raise OpenAuthorError(f"Revision '{normalized}' is unreadable: {error}") from error
  if payload.get("id") != normalized or payload.get("schema_version") != REVISION_SCHEMA_VERSION:
    raise OpenAuthorError(f"Revision '{normalized}' has invalid metadata.")
  return payload


def read_file_at_revision(paths: ProjectPaths, revision_id: str, relative_path: str) -> str:
  record = get_revision(paths, revision_id)
  digest = str(record.get("manifest", {}).get(relative_path, "")).strip()
  if not digest:
    raise OpenAuthorError(f"Revision '{revision_id}' does not contain '{relative_path}'.")
  object_path = paths.revision_objects_dir / digest[:2] / digest[2:]
  if not object_path.exists():
    raise OpenAuthorError(f"Revision object '{digest}' is missing for '{relative_path}'.")
  content = object_path.read_text(encoding="utf-8")
  actual = hashlib.sha256(content.encode("utf-8")).hexdigest()
  if actual != digest:
    raise OpenAuthorError(f"Revision object '{digest}' failed its integrity check.")
  return content


def verify_revision_store(paths: ProjectPaths) -> dict[str, Any]:
  missing_directories = [
    directory
    for directory in (paths.revision_objects_dir, paths.revision_records_dir)
    if not directory.is_dir()
  ]
  if missing_directories:
    return {
      "ready": False,
      "head": "",
      "revision_count": 0,
      "errors": ["Revision store directories are missing."],
    }
  head = revision_head(paths)
  if not head:
    return {"ready": True, "head": "", "revision_count": 0, "errors": []}

  errors: list[str] = []
  visited: set[str] = set()
  current = head
  while current:
    if current in visited:
      errors.append(f"Revision parent cycle detected at '{current}'.")
      break
    visited.add(current)
    try:
      record = get_revision(paths, current)
    except OpenAuthorError as error:
      errors.append(str(error))
      break
    for relative, digest in record.get("manifest", {}).items():
      object_path = paths.revision_objects_dir / str(digest)[:2] / str(digest)[2:]
      if not object_path.exists():
        errors.append(f"Missing revision object for '{relative}' in '{current}'.")
    current = str(record.get("parent", "")).strip()
  return {
    "ready": not errors,
    "head": head,
    "revision_count": len(visited),
    "errors": errors,
  }


def list_revisions(paths: ProjectPaths, *, limit: int = 50) -> list[dict[str, Any]]:
  if limit < 1:
    raise OpenAuthorError("Revision list limit must be positive.")
  rows: list[dict[str, Any]] = []
  current = revision_head(paths)
  visited: set[str] = set()
  while current and len(rows) < limit:
    if current in visited:
      raise OpenAuthorError(f"Revision parent cycle detected at '{current}'.")
    visited.add(current)
    record = get_revision(paths, current)
    rows.append({
      "id": record["id"],
      "parent": record.get("parent", ""),
      "created_at": record.get("created_at", ""),
      "message": record.get("message", ""),
      "kind": record.get("kind", ""),
      "file_count": len(record.get("manifest", {})),
      "metadata": record.get("metadata", {}),
    })
    current = str(record.get("parent", "")).strip()
  return rows


def compare_revisions(paths: ProjectPaths, base_revision: str, head_revision: str) -> dict[str, Any]:
  base = get_revision(paths, base_revision)
  head = get_revision(paths, head_revision)
  base_manifest = base.get("manifest", {})
  head_manifest = head.get("manifest", {})
  changed_files: list[dict[str, Any]] = []
  for relative in sorted(set(base_manifest).union(head_manifest)):
    before_digest = str(base_manifest.get(relative, ""))
    after_digest = str(head_manifest.get(relative, ""))
    if before_digest == after_digest:
      continue
    before = read_file_at_revision(paths, base_revision, relative) if before_digest else ""
    after = read_file_at_revision(paths, head_revision, relative) if after_digest else ""
    if not before_digest:
      status = "added"
    elif not after_digest:
      status = "deleted"
    else:
      status = "modified"
    diff = "".join(difflib.unified_diff(
      before.splitlines(keepends=True),
      after.splitlines(keepends=True),
      fromfile=f"{base_revision[:12]}/{relative}",
      tofile=f"{head_revision[:12]}/{relative}",
    ))
    changed_files.append({
      "path": relative,
      "status": status,
      "before": before,
      "after": after,
      "diff": diff,
    })
  return {
    "base_revision": base_revision,
    "head_revision": head_revision,
    "changed_file_count": len(changed_files),
    "files": changed_files,
  }


def restore_revision(
  paths: ProjectPaths,
  revision_id: str,
  *,
  relative_paths: list[str] | None = None,
) -> dict[str, Any]:
  target = get_revision(paths, revision_id)
  manifest = target.get("manifest", {})
  selected = sorted(set(relative_paths or manifest.keys()))
  if not selected:
    raise OpenAuthorError("The selected Revision contains no restorable files.")
  unknown = [relative for relative in selected if relative not in manifest]
  if unknown:
    raise OpenAuthorError(f"Revision does not contain: {', '.join(unknown)}")
  for relative in selected:
    candidate = (paths.root / relative).resolve()
    try:
      candidate.relative_to(paths.root.resolve())
    except ValueError as error:
      raise OpenAuthorError(f"Restore path escapes the project: {relative}") from error

  before_revision = create_revision(
    paths,
    f"Before restoring {revision_id[:12]}",
    kind="restore_before",
    metadata={"restored_from": revision_id, "paths": selected},
  )
  previous: dict[str, str | None] = {}
  try:
    for relative in selected:
      destination = paths.root / relative
      previous[relative] = destination.read_text(encoding="utf-8") if destination.exists() else None
      atomic_write_text(destination, read_file_at_revision(paths, revision_id, relative))
    restored_revision = create_revision(
      paths,
      f"Restore {revision_id[:12]}",
      kind="restore",
      metadata={
        "restored_from": revision_id,
        "restore_before_revision": before_revision,
        "paths": selected,
      },
    )
  except (OSError, OpenAuthorError) as error:
    for relative, content in previous.items():
      destination = paths.root / relative
      if content is None:
        destination.unlink(missing_ok=True)
      else:
        atomic_write_text(destination, content)
    raise OpenAuthorError(f"Restore was rolled back: {error}") from error
  record = get_revision(paths, restored_revision)
  record["restored_from"] = revision_id
  record["restored_paths"] = selected
  return record


def revision_retrospective(paths: ProjectPaths, base_revision: str, head_revision: str) -> dict[str, Any]:
  comparison = compare_revisions(paths, base_revision, head_revision)
  changed_scenes: list[dict[str, Any]] = []
  word_delta = 0
  for file in comparison["files"]:
    if not file["path"].startswith("manuscript/scenes/"):
      continue
    before_meta, before_body = split_scene_text(file["before"])
    after_meta, after_body = split_scene_text(file["after"])
    before_words = len(before_body.split())
    after_words = len(after_body.split())
    delta = after_words - before_words
    word_delta += delta
    changed_scenes.append({
      "path": file["path"],
      "scene_id": after_meta.get("id") or before_meta.get("id") or Path(file["path"]).stem,
      "title": after_meta.get("title") or before_meta.get("title") or Path(file["path"]).stem,
      "status": file["status"],
      "word_count_before": before_words,
      "word_count_after": after_words,
      "word_count_delta": delta,
    })
  head = get_revision(paths, head_revision)
  proposal_id = str(head.get("metadata", {}).get("proposal_id", ""))
  intent = ""
  accepted_hunks: list[str] = []
  if proposal_id:
    proposal_path = paths.proposals_dir / f"{proposal_id}.json"
    if proposal_path.exists():
      try:
        proposal = json.loads(proposal_path.read_text(encoding="utf-8"))
      except json.JSONDecodeError:
        proposal = {}
      intent = str(proposal.get("revision_intent", {}).get("goal", proposal.get("instruction", "")))
      accepted_hunks = [str(value) for value in proposal.get("accepted_hunk_ids", [])]
  memory_changes = next((file for file in comparison["files"] if file["path"] == "codex/memory.json"), None)
  remaining_goals: list[dict[str, Any]] = []
  try:
    from .canon import list_setups, run_canon_diagnostics
    for diagnostic in run_canon_diagnostics(paths)["diagnostics"]:
      if not diagnostic.get("disposition"):
        remaining_goals.append({"kind": "diagnostic", "label": diagnostic["title"], "severity": diagnostic["severity"]})
    for setup in list_setups(paths):
      if setup.get("status") == "open":
        remaining_goals.append({"kind": "setup", "label": setup["description"], "severity": "info"})
  except OpenAuthorError:
    pass
  return {
    "base_revision": base_revision,
    "head_revision": head_revision,
    "intent": intent,
    "accepted_hunk_ids": accepted_hunks,
    "changed_scenes": changed_scenes,
    "word_count_delta": word_delta,
    "story_memory_changed": memory_changes is not None,
    "changed_artifact_count": comparison["changed_file_count"],
    "remaining_goals": remaining_goals,
    "summary": (
      f"{len(changed_scenes)} scene{'s' if len(changed_scenes) != 1 else ''} changed; "
      f"{word_delta:+d} words; {len(accepted_hunks)} accepted Change Hunk{'s' if len(accepted_hunks) != 1 else ''}."
    ),
  }
