from __future__ import annotations

import hashlib
import difflib
import json
import re
import time
import uuid
import zlib
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from .codex import export_codex_json, replace_runtime_codex_from_snapshot
from .project import OpenAuthorError, ProjectPaths, atomic_write_bytes, atomic_write_text, utc_now
from .project_locks import serialized_project_access
from .project_lock import project_write_lock
from .scenes import split_scene_text
from .book_transactions import recoverable_book_edit, validate_project_identity_write

# Record format written by this version. Format 1 (a full manifest in every
# record, objects as plain text) stays readable forever and is never rewritten.
REVISION_SCHEMA_VERSION = 2
# A format-2 record normally lists only the paths that differ from its parent.
# Writers store a full manifest at least this often, so reading any Revision
# opens a bounded number of ancestors.
FULL_MANIFEST_INTERVAL = 50
# Readers accept longer chains than this version writes, so the interval can be
# tuned without stranding history; anything beyond the bound is damage.
_MAX_MANIFEST_DISTANCE = 1024
# New objects are zlib streams in "<digest>.z" beside the legacy plain-text
# "<digest>" files. A digest always names the uncompressed UTF-8 content.
_PACKED_SUFFIX = ".z"
_PACKED_PREFIX = "openauthor-object"
_PACKED_VERSION = "2"
# DEFLATE can only refer back this far, so a larger dictionary is wasted.
_DICTIONARY_WINDOW = 32 * 1024
# How many successive versions of one file may be stored against the same
# earlier object before a self-contained copy is written again.
SHARED_BASE_LIMIT = 32
_DIGEST = re.compile(r"[0-9a-f]{64}")
STATIC_BOOK_PATHS = [
  "manuscript/structure.json",
  ".openauthor/project.json",
  ".openauthor/provider_pricing.json",
  ".openauthor/generation_budget_policy.json",
  ".openauthor/editorial_passes.json",
  ".openauthor/style_profile.json",
  ".openauthor/last_import_report.json",
  "codex/codex.json",
  "codex/suggestions.json",
  "codex/memory.json",
]


def ensure_revision_store(paths: ProjectPaths) -> None:
  paths.revision_objects_dir.mkdir(parents=True, exist_ok=True)
  paths.revision_records_dir.mkdir(parents=True, exist_ok=True)


@serialized_project_access
def revision_head(paths: ProjectPaths) -> str:
  if not paths.revision_head_file.exists():
    return ""
  return paths.revision_head_file.read_text(encoding="utf-8").strip()


def _book_files(paths: ProjectPaths) -> list[Path]:
  if not paths.codex_db.exists() and (paths.root / "codex/codex.json").is_file():
    replace_runtime_codex_from_snapshot(paths)
  export_codex_json(paths)
  files = [path for path in sorted(paths.scenes_dir.glob("*.md")) if path.is_file()]
  for relative in STATIC_BOOK_PATHS:
    candidate = paths.root / relative
    if candidate.is_file():
      files.append(candidate)
  return sorted(set(files), key=lambda path: str(path.relative_to(paths.root)))


class _UnreadableFormat(OpenAuthorError):
  """History written by a newer openAuthor, as opposed to damaged history."""


def _object_paths(paths: ProjectPaths, digest: str) -> tuple[Path, Path]:
  """Return the legacy plain-text location and the packed location of an object."""
  plain = paths.revision_objects_dir / digest[:2] / digest[2:]
  return plain, plain.with_name(plain.name + _PACKED_SUFFIX)


def _dictionary(base: bytes) -> bytes:
  return base[-_DICTIONARY_WINDOW:]


def _parse_packed(raw: bytes, digest: str) -> tuple[str, int, bytes]:
  """Split a packed object into (base digest or "", ordinal, zlib stream)."""
  header, separator, body = raw.partition(b"\n")
  fields = header.decode("ascii", "replace").split(" ")
  if not separator or fields[0] != _PACKED_PREFIX:
    raise OpenAuthorError(f"Revision object '{digest}' failed its integrity check.")
  if fields[1:] == [_PACKED_VERSION, "zlib"]:
    return "", 0, body
  if (
    len(fields) == 5 and fields[1:3] == [_PACKED_VERSION, "zlib-dict"]
    and _DIGEST.fullmatch(fields[3]) and re.fullmatch(r"[0-9]{1,9}", fields[4])
  ):
    return fields[3], int(fields[4]), body
  if fields[1:2] == [_PACKED_VERSION] and fields[2:3] in (["zlib"], ["zlib-dict"]):
    # A known form with a malformed header is damage, not a newer format.
    raise OpenAuthorError(f"Revision object '{digest}' failed its integrity check.")
  raise _UnreadableFormat(
    f"Revision object '{digest}' is stored in a form this version of openAuthor cannot read. "
    "Update openAuthor to open this book's history; nothing was changed."
  )


def _inflate(body: bytes, dictionary: bytes = b"") -> bytes:
  inflater = zlib.decompressobj(zdict=dictionary) if dictionary else zlib.decompressobj()
  data = inflater.decompress(body) + inflater.flush()
  if not inflater.eof or inflater.unused_data:
    raise zlib.error("incomplete or trailing data")
  return data


def _deflate(data: bytes, dictionary: bytes = b"") -> bytes:
  deflater = zlib.compressobj(6, zdict=dictionary) if dictionary else zlib.compressobj(6)
  return deflater.compress(data) + deflater.flush()


def _read_object(paths: ProjectPaths, digest: str, relative_path: str = "", *, self_contained: bool = False) -> str:
  """Return verified object content from whichever stored form is intact.

  ``self_contained`` refuses an object that needs another object to be read:
  only one level of dependency is ever written, so nothing can loop.
  """
  plain, packed = _object_paths(paths, digest)
  found = False
  unreadable: _UnreadableFormat | None = None
  dependency = ""
  for location in (packed, plain):
    if not location.exists():
      continue
    found = True
    try:
      if location is plain:
        data = location.read_text(encoding="utf-8").encode("utf-8")
      else:
        base, _, body = _parse_packed(location.read_bytes(), digest)
        if not base:
          data = _inflate(body)
        elif self_contained:
          continue
        else:
          dependency = base
          data = _inflate(body, _dictionary(_read_object(paths, base, relative_path, self_contained=True).encode("utf-8")))
          dependency = ""
      if hashlib.sha256(data).hexdigest() == digest:
        return data.decode("utf-8")
    except _UnreadableFormat as error:
      unreadable = error
    except (OpenAuthorError, OSError, ValueError, zlib.error):
      # Fall through to the other stored form, then report below.
      pass
  if not found:
    raise OpenAuthorError(f"Revision object '{digest}' is missing for '{relative_path}'.")
  if unreadable is not None:
    raise unreadable
  if dependency:
    raise OpenAuthorError(
      f"Revision object '{digest}' failed its integrity check: "
      f"object '{dependency}', which it was stored against, is missing or damaged."
    )
  raise OpenAuthorError(f"Revision object '{digest}' failed its integrity check.")


def _shared_base(paths: ProjectPaths, previous: str) -> tuple[str, int] | None:
  """Choose the object the next version of a file is stored against.

  Successive versions share the same self-contained object rather than chaining
  through each other, so reading any version opens at most two files and a
  damaged dependent never affects its neighbours.
  """
  _, packed = _object_paths(paths, previous)
  if packed.exists():
    base, ordinal, _ = _parse_packed(packed.read_bytes(), previous)
    if base:
      return (base, ordinal + 1) if ordinal < SHARED_BASE_LIMIT else None
  return previous, 1


def _store_object(paths: ProjectPaths, content: str, *, previous: str = "") -> str:
  """Store content once, by the digest of its uncompressed bytes.

  ``previous`` is the digest the same book path had in the parent Revision.
  An autosave changes a few sentences, so its content is deflated with the
  earlier version as a preset dictionary when that is clearly smaller.
  """
  data = content.encode("utf-8")
  digest = hashlib.sha256(data).hexdigest()
  plain, packed = _object_paths(paths, digest)
  if packed.exists() or plain.exists():
    return digest
  header = f"{_PACKED_PREFIX} {_PACKED_VERSION} zlib\n"
  body = _deflate(data)
  if previous and previous != digest:
    try:
      choice = _shared_base(paths, previous)
      dictionary = _dictionary(_read_object(paths, choice[0], self_contained=True).encode("utf-8")) if choice else b""
      if dictionary:
        against = _deflate(data, dictionary)
        if len(against) * 2 <= len(body) and _inflate(against, dictionary) == data:
          header = f"{_PACKED_PREFIX} {_PACKED_VERSION} zlib-dict {choice[0]} {choice[1]}\n"
          body = against
    except (OpenAuthorError, OSError, zlib.error):
      # Older history that cannot be read never blocks saving new work; the
      # self-contained form prepared above depends on nothing.
      pass
  atomic_write_bytes(packed, header.encode("ascii") + body)
  return digest


# A file whose modification time is this close to "now" could be rewritten in
# place within the same filesystem timestamp tick and keep an identical stat
# record, so it is always read again rather than trusted (as Git does for its
# index). Two seconds covers the coarsest timestamps in common use.
_SETTLED_AFTER_NS = 2_000_000_000


def _file_signature(file_path: Path) -> tuple[tuple[int, int, int, int], bool]:
  status = file_path.stat()
  settled = time.time_ns() - status.st_mtime_ns > _SETTLED_AFTER_NS
  return (status.st_ino, status.st_size, status.st_mtime_ns, status.st_ctime_ns), settled


def _read_book_file(file_path: Path) -> str:
  try:
    return file_path.read_text(encoding="utf-8")
  except UnicodeDecodeError as error:
    raise OpenAuthorError(
      f"Book file {file_path} is not valid UTF-8 text (unreadable byte at position {error.start}). "
      "Open it in a text editor, re-save it with UTF-8 encoding, then try again. Nothing was changed."
    ) from error


@serialized_project_access
def create_revision(
  paths: ProjectPaths,
  message: str,
  *,
  kind: str = "manual",
  metadata: dict[str, Any] | None = None,
  skip_unchanged: bool = False,
  known_digests: dict[str, tuple[tuple[int, int, int, int], str]] | None = None,
  manifest_memo: "_ManifestMemo | None" = None,
) -> str:
  """Record the current book files as a Revision.

  ``known_digests`` lets one operation that records two Revisions under a
  single lock hold (before and after an edit) hash each untouched file once:
  it maps a book path to the stat record and object digest seen earlier in the
  same process. Every writer replaces files atomically, which changes the stat
  record, so a matching settled record means the stored object is current.
  ``manifest_memo`` likewise lets that operation rebuild the parent manifest
  once; a remembered manifest is still checked against its Revision id.
  """
  ensure_revision_store(paths)
  parent = revision_head(paths)
  parent_record: dict[str, Any] | None = None
  parent_manifest: dict[str, str] = {}
  if parent:
    try:
      parent_record = _load_record(paths, parent)
      parent_manifest = _full_manifest(paths, parent_record, manifest_memo)
    except OpenAuthorError:
      if skip_unchanged:
        raise
      # A named version can still be recorded over damaged history: it is
      # written self-contained, depending on nothing older.
      parent_record, parent_manifest = None, {}

  manifest: dict[str, str] = {}
  for file_path in _book_files(paths):
    relative = file_path.relative_to(paths.root).as_posix()
    previous = parent_manifest.get(relative, "")
    if known_digests is None:
      manifest[relative] = _store_object(paths, _read_book_file(file_path), previous=previous)
      continue
    signature, settled = _file_signature(file_path)
    known = known_digests.get(relative)
    if known is not None and settled and known[0] == signature:
      manifest[relative] = known[1]
      continue
    manifest[relative] = _store_object(paths, _read_book_file(file_path), previous=previous)
    if settled:
      known_digests[relative] = (signature, manifest[relative])
    else:
      known_digests.pop(relative, None)

  if skip_unchanged and parent and parent_manifest == manifest:
    return parent
  record: dict[str, Any] = {
    "schema_version": REVISION_SCHEMA_VERSION,
    "id": "",
    "parent": parent,
    "created_at": utc_now(),
    "message": message.strip(),
    "kind": kind.strip() or "manual",
  }
  difference = _manifest_difference(parent_record, parent_manifest, manifest)
  if difference is None:
    record["manifest"] = manifest
  else:
    record["manifest_delta"] = difference
  record["file_count"] = len(manifest)
  record["nonce"] = uuid.uuid4().hex
  record["metadata"] = metadata or {}
  revision_id = record["id"] = _identity(record, manifest)
  if manifest_memo is not None:
    manifest_memo.remember(revision_id, dict(manifest))
  # Every object above is already durable, and every ancestor a difference
  # refers to was read back just now, before this record becomes visible.
  atomic_write_text(
    paths.revision_records_dir / f"{revision_id}.json",
    json.dumps(record, separators=(",", ":")) + "\n",
  )
  atomic_write_text(paths.revision_head_file, f"{revision_id}\n")
  return revision_id


def _identity(record: dict[str, Any], manifest: dict[str, str]) -> str:
  """A Revision id commits to its parent, description and complete manifest."""
  payload = {
    "parent": record["parent"],
    "created_at": record["created_at"],
    "message": record["message"],
    "kind": record["kind"],
    "manifest": manifest,
    "nonce": record["nonce"],
  }
  return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def _distance(record: dict[str, Any]) -> int:
  """How many records separate this one from a full manifest (0 = it has one)."""
  return record["manifest_delta"]["distance"] if "manifest_delta" in record else 0


def _manifest_difference(
  parent_record: dict[str, Any] | None,
  parent_manifest: dict[str, str],
  manifest: dict[str, str],
) -> dict[str, Any] | None:
  """Describe ``manifest`` relative to its parent, or None to store it whole."""
  if parent_record is None:
    return None
  distance = _distance(parent_record) + 1
  if distance > FULL_MANIFEST_INTERVAL:
    return None
  changed = {relative: digest for relative, digest in manifest.items() if parent_manifest.get(relative) != digest}
  removed = sorted(relative for relative in parent_manifest if relative not in manifest)
  if len(changed) + len(removed) >= len(manifest):
    return None
  return {"distance": distance, "changed": changed, "removed": removed}


def _restore_book_manifest(paths: ProjectPaths, revision_id: str) -> None:
  record = get_revision(paths, revision_id)
  contents = {relative: _read_object(paths, digest, relative) for relative, digest in record["manifest"].items()}
  for relative in contents:
    candidate = (paths.root / relative).resolve()
    if not candidate.is_relative_to(paths.root.resolve()):
      raise OpenAuthorError(f"Revision path escapes project: {relative}")
  current = [path for path in paths.scenes_dir.glob("*.md") if path.is_file()]
  current.extend(paths.root / relative for relative in STATIC_BOOK_PATHS)
  for path in current:
    if path.relative_to(paths.root).as_posix() not in contents:
      path.unlink(missing_ok=True)
  for relative, content in contents.items():
    atomic_write_text(paths.root / relative, content)
  replace_runtime_codex_from_snapshot(paths)
  atomic_write_text(paths.revision_head_file, f"{revision_id}\n")


def recover_interrupted_edit(paths: ProjectPaths) -> bool:
  interrupted = (paths.workspace_dir / "book-transaction.json").exists()
  with project_write_lock(paths):
    journal = paths.workspace_dir / "author-edit.json"
    if not journal.exists():
      return interrupted
    try:
      transaction = json.loads(journal.read_text(encoding="utf-8"))
      before = transaction["before"]
      current = get_revision(paths, revision_head(paths))
      committed = current.get("metadata", {}).get("edit_transaction_id") == transaction["id"]
      if not committed:
        _restore_book_manifest(paths, before)
      journal.unlink()
    except (KeyError, ValueError, OSError) as error:
      raise OpenAuthorError(f"Interrupted edit recovery failed: {error}") from error
    return True


@contextmanager
def checkpointed_edit(paths: ProjectPaths, message: str, *, kind: str = "author_edit", metadata: dict[str, Any] | None = None):
  """Keep edits recoverable across command failure or process termination."""
  with project_write_lock(paths):
    recover_interrupted_edit(paths)
    with recoverable_book_edit(paths):
      digests: dict[str, tuple[tuple[int, int, int, int], str]] = {}
      memo = _ManifestMemo()
      before = create_revision(paths, f"Before {message}", kind=f"{kind}_before", skip_unchanged=True, known_digests=digests, manifest_memo=memo)
      transaction_id = uuid.uuid4().hex
      yield before
      create_revision(paths, message, kind=kind, metadata={**(metadata or {}), "edit_transaction_id": transaction_id, "before_revision": before}, skip_unchanged=kind == "author_edit", known_digests=digests, manifest_memo=memo)


def _valid_entry(relative: Any, digest: Any = None) -> bool:
  if not isinstance(relative, str):
    return False
  valid_path = relative in STATIC_BOOK_PATHS or (relative.startswith("manuscript/scenes/") and len(Path(relative).parts) == 3 and relative.endswith(".md"))
  if not valid_path or ".." in Path(relative).parts:
    return False
  return digest is None or (isinstance(digest, str) and bool(_DIGEST.fullmatch(digest)))


def _load_record(paths: ProjectPaths, revision_id: str) -> dict[str, Any]:
  """Read one stored record, in either format, exactly as written.

  A format-1 record carries ``manifest``. A format-2 record carries either
  ``manifest`` or ``manifest_delta``; use ``_full_manifest`` (or the public
  ``get_revision``) whenever the complete manifest is needed.
  """
  normalized = revision_id.strip()
  if not normalized:
    raise OpenAuthorError("Revision id cannot be empty.")
  if not _DIGEST.fullmatch(normalized):
    raise OpenAuthorError(f"Invalid revision id '{normalized}'.")
  record_path = paths.revision_records_dir / f"{normalized}.json"
  if not record_path.exists():
    raise OpenAuthorError(f"Unknown revision '{normalized}'.")
  try:
    payload = json.loads(record_path.read_text(encoding="utf-8"))
  except (OSError, ValueError) as error:
    raise OpenAuthorError(f"Revision '{normalized}' is unreadable: {error}") from error
  if not isinstance(payload, dict) or payload.get("id") != normalized:
    raise OpenAuthorError(f"Revision '{normalized}' has invalid metadata.")
  version = payload.get("schema_version")
  if isinstance(version, int) and not isinstance(version, bool) and version > REVISION_SCHEMA_VERSION:
    raise OpenAuthorError(
      f"Revision '{normalized}' was written in record format {version}, which this version of openAuthor cannot read. "
      "Update openAuthor to open this book's history; nothing was changed."
    )
  if version not in (1, 2) or isinstance(version, bool):
    raise OpenAuthorError(f"Revision '{normalized}' has invalid metadata.")
  if version == 2:
    parent = payload.get("parent")
    if (
      any(not isinstance(payload.get(field), str) for field in ("parent", "created_at", "message", "kind", "nonce"))
      or (parent and not _DIGEST.fullmatch(parent))
      or not isinstance(payload.get("file_count"), int) or isinstance(payload.get("file_count"), bool)
      or ("manifest" in payload) == ("manifest_delta" in payload)
    ):
      raise OpenAuthorError(f"Revision '{normalized}' has invalid metadata.")
  if "manifest_delta" in payload and version == 2:
    difference = payload["manifest_delta"]
    if (
      not isinstance(difference, dict) or not payload["parent"]
      or not isinstance(difference.get("distance"), int) or isinstance(difference.get("distance"), bool)
      or not 1 <= difference["distance"] <= _MAX_MANIFEST_DISTANCE
      or not isinstance(difference.get("changed"), dict) or not isinstance(difference.get("removed"), list)
    ):
      raise OpenAuthorError(f"Revision '{normalized}' has an invalid manifest.")
    if (
      any(not _valid_entry(relative, digest) for relative, digest in difference["changed"].items())
      or any(not _valid_entry(relative) or relative in difference["changed"] for relative in difference["removed"])
    ):
      raise OpenAuthorError(f"Revision '{normalized}' has an invalid object entry.")
    return payload
  manifest = payload.get("manifest")
  if not isinstance(manifest, dict):
    raise OpenAuthorError(f"Revision '{normalized}' has an invalid manifest.")
  if any(not _valid_entry(relative, digest) for relative, digest in manifest.items()):
    raise OpenAuthorError(f"Revision '{normalized}' has an invalid object entry.")
  return payload


class _ManifestMemo(dict):
  """Manifests rebuilt during one operation, bounded to the newest few."""

  def remember(self, revision_id: str, manifest: dict[str, str]) -> None:
    self[revision_id] = manifest
    while len(self) > 2 * FULL_MANIFEST_INTERVAL + 8:
      del self[next(iter(self))]


def _full_manifest(paths: ProjectPaths, record: dict[str, Any], memo: _ManifestMemo | None = None) -> dict[str, str]:
  """Return the complete path-to-digest manifest of a stored record.

  This is the only place a ``manifest_delta`` is interpreted. It walks towards
  the nearest full manifest (each step must be exactly one closer, so the walk
  is bounded and cannot loop), replays the recorded differences, and then
  checks the result against the Revision id, which commits to the complete
  manifest. A missing or damaged ancestor therefore raises; it can never
  produce a different manifest.
  """
  revision_id = record["id"]
  if "manifest" in record:
    manifest = dict(record["manifest"])
    if record["schema_version"] == 2 and (len(manifest) != record["file_count"] or _identity(record, manifest) != revision_id):
      raise OpenAuthorError(f"Revision '{revision_id}' failed its integrity check: its file list does not match its id.")
    return manifest
  pending: list[dict[str, Any]] = []
  current = record
  manifest = None
  while manifest is None:
    if memo is not None and current["id"] in memo:
      manifest = dict(memo[current["id"]])
    elif "manifest" in current:
      manifest = dict(current["manifest"])
    else:
      pending.append(current)
      ancestor = current["parent"]
      try:
        parent = _load_record(paths, ancestor)
      except OpenAuthorError as error:
        raise OpenAuthorError(
          f"Revision '{revision_id}' cannot be read because an earlier revision it depends on, '{ancestor}', "
          f"is missing or damaged ({error}) Restore .openauthor/revisions from a backup to recover this history."
        ) from error
      if _distance(parent) != _distance(current) - 1:
        raise OpenAuthorError(
          f"Revision '{revision_id}' cannot be read because its recorded changes do not line up with "
          f"the earlier revision '{ancestor}'. Restore .openauthor/revisions from a backup to recover this history."
        )
      current = parent
  for item in reversed(pending):
    difference = item["manifest_delta"]
    for relative in difference["removed"]:
      manifest.pop(relative, None)
    manifest.update(difference["changed"])
    if len(manifest) != item["file_count"]:
      break
    if memo is not None:
      memo.remember(item["id"], dict(manifest))
  if len(manifest) != record["file_count"] or _identity(record, manifest) != revision_id:
    raise OpenAuthorError(
      f"Revision '{revision_id}' failed its integrity check: its recorded changes no longer reproduce its file list, "
      "so an earlier revision it depends on is damaged. Restore .openauthor/revisions from a backup to recover this history."
    )
  return manifest


def get_revision(paths: ProjectPaths, revision_id: str) -> dict[str, Any]:
  """Return a Revision with its complete ``manifest``, whatever its stored form."""
  record = _load_record(paths, revision_id)
  if record["schema_version"] == 1:
    return record
  return {
    "schema_version": record["schema_version"],
    "id": record["id"],
    "parent": record["parent"],
    "created_at": record["created_at"],
    "message": record["message"],
    "kind": record["kind"],
    "manifest": _full_manifest(paths, record),
    "metadata": record.get("metadata", {}),
  }


def read_file_at_revision(paths: ProjectPaths, revision_id: str, relative_path: str) -> str:
  record = get_revision(paths, revision_id)
  digest = str(record.get("manifest", {}).get(relative_path, "")).strip()
  if not digest:
    raise OpenAuthorError(f"Revision '{revision_id}' does not contain '{relative_path}'.")
  return _read_object(paths, digest, relative_path)


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
  verified_objects: set[str] = set()
  memo = _ManifestMemo()
  current = head
  while current:
    if current in visited:
      errors.append(f"Revision parent cycle detected at '{current}'.")
      break
    visited.add(current)
    try:
      record = _load_record(paths, current)
      manifest = _full_manifest(paths, record, memo)
    except OpenAuthorError as error:
      errors.append(str(error))
      break
    for relative, digest in manifest.items():
      if digest not in verified_objects:
        try:
          _read_object(paths, digest, relative)
          verified_objects.add(digest)
        except (OpenAuthorError, OSError) as error:
          errors.append(str(error))
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
    record = _load_record(paths, current)
    rows.append({
      "id": record["id"],
      "parent": record.get("parent", ""),
      "created_at": record.get("created_at", ""),
      "message": record.get("message", ""),
      "kind": record.get("kind", ""),
      "file_count": len(record["manifest"]) if record["schema_version"] == 1 else record["file_count"],
      "metadata": record.get("metadata", {}),
    })
    current = str(record.get("parent", "")).strip()
  return rows


def compare_revisions(paths: ProjectPaths, base_revision: str, head_revision: str, *, include_unchanged: bool = False) -> dict[str, Any]:
  base = get_revision(paths, base_revision)
  head = get_revision(paths, head_revision)
  base_manifest = base.get("manifest", {})
  head_manifest = head.get("manifest", {})
  changed_files: list[dict[str, Any]] = []
  for relative in sorted(set(base_manifest).union(head_manifest)):
    before_digest = str(base_manifest.get(relative, ""))
    after_digest = str(head_manifest.get(relative, ""))
    if before_digest == after_digest and not include_unchanged:
      continue
    before = _read_object(paths, before_digest, relative) if before_digest else ""
    after = _read_object(paths, after_digest, relative) if after_digest else ""
    if before_digest == after_digest:
      status = "unchanged"
    elif not before_digest:
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
    "changed_file_count": sum(file["status"] != "unchanged" for file in changed_files),
    "files": changed_files,
  }


@serialized_project_access
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

  # Validate every object before touching live files or the runtime database.
  contents = {relative: _read_object(paths, manifest[relative], relative) for relative in selected}
  if ".openauthor/project.json" in contents:
    validate_project_identity_write(paths, contents[".openauthor/project.json"])

  try:
    with checkpointed_edit(paths, f"Restore {revision_id[:12]}", kind="restore", metadata={"restored_from": revision_id, "paths": selected}):
      for relative in selected:
        atomic_write_text(paths.root / relative, contents[relative])
      if "codex/codex.json" in selected:
        replace_runtime_codex_from_snapshot(paths)
  except (OSError, OpenAuthorError) as error:
    raise OpenAuthorError(f"Restore was rolled back: {error}") from error
  record = get_revision(paths, revision_head(paths))
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
