"""Recover cooperating multi-file book edits before exposing their state.

The journal is local author data: it contains exact original and intended bytes.
Only mutable authoring files participate; immutable Revision objects remain as
unreachable history after rollback. The shared project lock owns this interface.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import tempfile
import threading
import uuid
from contextlib import contextmanager
from functools import wraps
from pathlib import Path
from typing import Any

from .project import OpenAuthorError, ProjectPaths, read_project_config

_LOCAL = threading.local()
_JOURNAL = "book-transaction.json"


def _after_fork() -> None:
  global _LOCAL
  _LOCAL = threading.local()


if hasattr(os, "register_at_fork"):
  os.register_at_fork(after_in_child=_after_fork)


def _sync_directory(directory: Path) -> None:
  descriptor = os.open(directory, os.O_RDONLY)
  try:
    os.fsync(descriptor)
  finally:
    os.close(descriptor)


def _replace_bytes(path: Path, content: bytes | None, *, exclusive: bool = False) -> None:
  path.parent.mkdir(parents=True, exist_ok=True)
  if content is None:
    path.unlink(missing_ok=True)
    _sync_directory(path.parent)
    return
  descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
  try:
    with os.fdopen(descriptor, "wb") as handle:
      handle.write(content)
      handle.flush()
      os.fsync(handle.fileno())
    if exclusive:
      os.link(name, path)
      os.unlink(name)
    else:
      os.replace(name, path)
    _sync_directory(path.parent)
  finally:
    if os.path.exists(name):
      os.unlink(name)


def _encoded(content: bytes | None) -> str | None:
  return None if content is None else base64.b64encode(content).decode("ascii")


def _decoded(content: Any) -> bytes | None:
  if content is None:
    return None
  if not isinstance(content, str):
    raise ValueError("Invalid transaction content")
  return base64.b64decode(content, validate=True)


def _current(path: Path) -> bytes | None:
  if path.is_symlink():
    raise OpenAuthorError("Book recovery refuses symbolic-link targets.")
  return path.read_bytes() if path.exists() else None


def _relative(paths: ProjectPaths, path: Path) -> str:
  root = paths.root.resolve()
  candidate = path.absolute()
  if candidate.is_symlink() or not candidate.resolve().is_relative_to(root):
    raise OpenAuthorError("Book transaction target escapes the project or is a symbolic link.")
  return candidate.relative_to(root).as_posix()


def _participates(relative: str) -> bool:
  from .revisions import STATIC_BOOK_PATHS
  parts = Path(relative).parts
  return (
    relative in STATIC_BOOK_PATHS
    or len(parts) == 3 and parts[:2] == ("manuscript", "scenes") and relative.endswith(".md")
    or len(parts) == 4 and parts[:3] == (".openauthor", "workspace", "proposals") and relative.endswith(".json")
    or relative == ".openauthor/revisions/HEAD"
  )


def _scope(paths: ProjectPaths) -> str:
  from .scene_edits import workspace_edit_scope
  return workspace_edit_scope(paths)[0]


def validate_project_identity_write(paths: ProjectPaths, content: str) -> None:
  """A book edit may restore metadata, but cannot replace its owning identity."""
  try:
    restored = json.loads(content)
  except (TypeError, ValueError) as error:
    raise OpenAuthorError("Restored project metadata is invalid; no book files were changed.") from error
  identity = restored.get("project_id") if isinstance(restored, dict) else None
  if not isinstance(identity, str) or not identity.strip() or identity != read_project_config(paths).get("project_id"):
    raise OpenAuthorError("A book edit cannot change or remove its current project identity. Restore selected files without .openauthor/project.json when using different or legacy project metadata.")


def _save(paths: ProjectPaths, journal: dict[str, Any]) -> None:
  _replace_bytes(paths.workspace_dir / _JOURNAL, (json.dumps(journal, sort_keys=True) + "\n").encode("utf-8"))


def _load(paths: ProjectPaths) -> dict[str, Any] | None:
  location = paths.workspace_dir / _JOURNAL
  if not location.exists():
    return None
  try:
    journal = json.loads(location.read_text(encoding="utf-8"))
    if (
      not isinstance(journal, dict) or journal.get("schema_version") != 1
      or journal.get("phase") not in {"active", "committed", "resolving"}
      or not isinstance(journal.get("scope"), str) or not isinstance(journal.get("files"), dict)
    ):
      raise ValueError("Invalid transaction record")
    for relative, row in journal["files"].items():
      if not isinstance(relative, str) or not _participates(relative) or _relative(paths, paths.root / relative) != relative:
        raise ValueError("Invalid transaction path")
      if not isinstance(row, dict) or not isinstance(row.get("written"), list) or not row["written"]:
        raise ValueError("Invalid transaction file record")
      _decoded(row["before"])
      for content in row["written"]:
        _decoded(content)
      if "resolved" in row:
        _decoded(row["resolved"])
      if "reviewed_current" in row:
        _decoded(row["reviewed_current"])
    return journal
  except (OSError, ValueError, KeyError) as error:
    raise OpenAuthorError("The interrupted book edit journal is damaged. Preserve it and restore a verified backup before editing.") from error


def _retire(paths: ProjectPaths) -> None:
  (paths.workspace_dir / _JOURNAL).unlink(missing_ok=True)
  _sync_directory(paths.workspace_dir)


def _rebuild_runtime(paths: ProjectPaths, journal: dict[str, Any]) -> None:
  if "codex/codex.json" in journal["files"]:
    from .codex import replace_runtime_codex_from_snapshot
    replace_runtime_codex_from_snapshot(paths)


def _conflicts(paths: ProjectPaths, journal: dict[str, Any]) -> list[str]:
  conflicts = []
  for relative, row in journal["files"].items():
    actual = _encoded(_current(paths.root / relative))
    allowed = [row["before"], *row["written"]]
    if "reviewed_current" in row:
      allowed.append(row["reviewed_current"])
    if "resolved" in row:
      allowed.append(row["resolved"])
    if actual not in allowed:
      conflicts.append(relative)
  return conflicts


def recover_book_transaction(paths: ProjectPaths) -> bool:
  """Called while the outer project lock is held, before normal readers run."""
  if getattr(_LOCAL, "inspection", False) or getattr(_LOCAL, "transaction", None) is not None:
    return False
  journal = _load(paths)
  if journal is None:
    return False
  if _scope(paths) != journal["scope"]:
    raise OpenAuthorError("Interrupted book edit belongs to another Storyline. Return to its Storyline, then run project recovery-status; no files were replaced.")
  if journal["phase"] == "committed":
    _rebuild_runtime(paths, journal)
    _retire(paths)
    return True
  if _conflicts(paths, journal):
    raise OpenAuthorError("Interrupted book edit overlaps newer external writing. Run project recovery-status and review project recovery-resolve before continuing; no files were replaced.")
  # Validate every target before touching any; a second interrupted rollback is
  # safe because each original/resolved value is also a permitted journal value.
  for relative, row in journal["files"].items():
    desired = row.get("resolved", row["before"])
    target = paths.root / relative
    if relative in _conflicts(paths, {**journal, "files": {relative: row}}):
      raise OpenAuthorError("Newer writing appeared during recovery. Run project recovery-status again.")
    if _encoded(_current(target)) != desired:
      _replace_bytes(target, _decoded(desired))
  _rebuild_runtime(paths, journal)
  _retire(paths)
  return True


def write_transaction_text(path: Path, content: str, *, exclusive: bool = False) -> bool:
  """The shared atomic writer delegates participating files to this module."""
  active = getattr(_LOCAL, "transaction", None)
  if active is None:
    return False
  paths, journal = active
  relative = _relative(paths, path)
  if not _participates(relative):
    return False
  if relative == ".openauthor/project.json":
    validate_project_identity_write(paths, content)
  actual = _encoded(_current(path))
  row = journal["files"].get(relative)
  if row is None:
    row = {"before": actual, "written": []}
    journal["files"][relative] = row
  elif actual not in [row["before"], *row["written"]]:
    raise OpenAuthorError("Newer external writing appeared during a book edit; recovery comparison is required.")
  intended = _encoded(content.encode("utf-8"))
  if not row["written"] or row["written"][-1] != intended:
    row["written"].append(intended)
  _save(paths, journal)
  _replace_bytes(path, content.encode("utf-8"), exclusive=exclusive)
  return True


@contextmanager
def recoverable_book_edit(paths: ProjectPaths):
  """Publish one cooperating edit, or durably restore its exact original files."""
  from .project_locks import project_lock
  with project_lock(paths):
    if getattr(_LOCAL, "transaction", None) is not None:
      if _LOCAL.transaction[0].root.resolve() != paths.root.resolve():
        raise OpenAuthorError("A book edit cannot nest an edit to another project.")
      yield
      return
    journal = {"schema_version": 1, "id": uuid.uuid4().hex, "phase": "active", "scope": _scope(paths), "files": {}}
    _LOCAL.transaction = (paths, journal)
    try:
      yield
      if journal["files"]:
        if _scope(paths) != journal["scope"] or any(
          _encoded(_current(paths.root / relative)) != row["written"][-1]
          for relative, row in journal["files"].items()
        ):
          raise OpenAuthorError("Book edit changed scope or overlaps newer writing; inspect project recovery-status.")
        journal["phase"] = "committed"
        _save(paths, journal)
        _retire(paths)
    except BaseException:
      _LOCAL.transaction = None
      recover_book_transaction(paths)
      raise
    finally:
      _LOCAL.transaction = None


def recoverable_project_edit(operation):
  @wraps(operation)
  def wrapped(paths, *args, **kwargs):
    with recoverable_book_edit(paths):
      return operation(paths, *args, **kwargs)
  return wrapped


@contextmanager
def _inspect_recovery(paths: ProjectPaths):
  from .project_locks import project_lock
  previous = getattr(_LOCAL, "inspection", False)
  _LOCAL.inspection = True
  try:
    with project_lock(paths):
      yield
  finally:
    _LOCAL.inspection = previous


def _status(paths: ProjectPaths, journal: dict[str, Any] | None) -> dict[str, Any]:
  if journal is None:
    return {"pending": False}
  rows = []
  conflicts = _conflicts(paths, journal)
  for relative, row in journal["files"].items():
    actual = _encoded(_current(paths.root / relative))
    comparison = {"path": relative, "before": row["before"], "current": actual, "intended": row["written"][-1], "conflict": relative in conflicts}
    for name in ("before", "current", "intended"):
      content = _decoded(comparison[name])
      comparison[name + "_text"] = None if content is None else content.decode("utf-8", errors="replace")
    rows.append(comparison)
  try:
    matches = _scope(paths) == journal["scope"]
  except OpenAuthorError:
    matches = False
  result = {"pending": True, "transaction_id": journal["id"], "phase": journal["phase"], "scope_matches": matches, "files": rows}
  result["fingerprint"] = hashlib.sha256(json.dumps({"journal": journal, "current": result}, sort_keys=True).encode("utf-8")).hexdigest()
  result["content_encoding"] = "base64; exact file bytes; private author data"
  return result


def transaction_recovery_status(paths: ProjectPaths) -> dict[str, Any]:
  """Read the comparison without triggering automatic recovery or normal reads."""
  with _inspect_recovery(paths):
    return _status(paths, _load(paths))


def resolve_transaction_recovery(paths: ProjectPaths, *, fingerprint: str, decisions: dict[str, str]) -> dict[str, Any]:
  """Explicitly keep or restore reviewed conflicts, retaining kept work outside HEAD."""
  with _inspect_recovery(paths):
    journal = _load(paths)
    status = _status(paths, journal)
    if not journal or status.get("fingerprint") != fingerprint:
      raise OpenAuthorError("Recovery comparison changed. Run project recovery-status and review it again.")
    if not status["scope_matches"]:
      raise OpenAuthorError("Return to the interrupted edit's original Storyline before resolving recovery.")
    preserved_committed = journal["phase"] == "committed"
    if preserved_committed:
      if decisions:
        raise OpenAuthorError("This book edit already committed. Recovery preserves its completed files and newer writing; use an empty decision object to finish journal retirement. Recovery choices cannot roll back a committed edit.")
    else:
      conflicts = {row["path"] for row in status["files"] if row["conflict"]}
      if set(decisions) != conflicts or any(value not in {"keep_current", "restore_before"} for value in decisions.values()):
        raise OpenAuthorError("Choose keep_current or restore_before for every conflicting file in the reviewed comparison.")
      for row in status["files"]:
        if row["path"] in conflicts:
          journal["files"][row["path"]]["reviewed_current"] = row["current"]
          journal["files"][row["path"]]["resolved"] = row["current"] if decisions[row["path"]] == "keep_current" else row["before"]
      journal["phase"] = "resolving"
      _save(paths, journal)
    # Inspection deliberately bypasses the lock hook; call recovery explicitly.
    _LOCAL.inspection = False
    try:
      recover_book_transaction(paths)
    finally:
      _LOCAL.inspection = True
    return {"recovered": True, "preserved_committed": preserved_committed, "kept_paths": sorted(path for path, choice in decisions.items() if choice == "keep_current")}
