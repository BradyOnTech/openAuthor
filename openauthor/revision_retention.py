"""Thin old automatic editor saves out of a book's Revision history.

This is the only code that removes history. It removes nothing but editor
saves (kind ``author_edit`` recorded by ``scene update``) that are older than
the policy's window, are not the newest of their clock hour (or day) within
their uninterrupted run, and are not pointed at by anything else in the
project. Every other Revision, and every file outside ``.openauthor/revisions``
and the policy file, is left exactly as it is.

Order of work, which is what makes an interruption harmless:

1. Survey, without the project lock: every record, every reference to a
   Revision id held outside the store, and a plan. Every Revision that will
   remain is rebuilt and every object it uses is read back before anything is
   removed; a failure stops the run with nothing changed.
2. In short holds of the project lock: re-check what changed since the survey,
   write an intent journal, give the Revision that follows a thinned run a
   complete manifest and a link to the nearest remaining older Revision
   (written and synced first), then remove the thinned records newest first,
   then the objects nothing uses any more, then retire the journal.

Records are immutable for everyone else and only one thinning run exists at a
time, so a survey taken outside the lock stays true except for what each hold
re-reads: the head, new records, and the reference scan.
"""

from __future__ import annotations

import json
import os
import re
import time
from collections import deque
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterator

from . import revisions as store
from .project import OpenAuthorError, ProjectPaths, atomic_write_bytes
from .project_locks import project_lock

try:
  import fcntl
except ImportError:  # pragma: no cover - unsupported non-POSIX host
  fcntl = None  # type: ignore[assignment]

POLICY_FILE_NAME = "revision_retention.json"
DEFAULT_POLICY: dict[str, Any] = {"enabled": True, "keep_all_days": 7, "daily_after_days": 90}
DUE_AFTER_SECONDS = 24 * 3600
# The only Revisions that are ever thinned: what the editor's save command
# records. Other author edits share the kind (Plan, Story Memory, Style, a new
# scene) but are single deliberate actions and are kept.
EDITOR_SAVE_KIND = "author_edit"
EDITOR_SAVE_MESSAGE = "Scene update"
# How long one invocation keeps thinning before it reports ``complete: false``.
DEFAULT_MAX_SECONDS = 30.0
# One hold of the project lock aims for this much work, so a save that arrives
# meanwhile waits for about that long plus the fixed re-check below.
_HOLD_TARGET_SECONDS = 0.15
_HOLD_UNITS_MIN, _HOLD_UNITS_START, _HOLD_UNITS_MAX = 24, 160, 4000
# A relink writes and syncs a record; a removal is one unlink.
_RELINK_UNITS = 12
# The most Revisions one step detaches, so a long run is thinned in pieces.
_STEP_REVISIONS = 256
# Waiters poll for the lock at up to 50 ms intervals and are not queued, so
# the lock is left free for longer than that between holds.
_YIELD_SECONDS = 0.06
_MAX_REPLANS = 3
_MAX_DAYS = 36_500
_STATE_FILE = "retention.json"
_JOURNAL_FILE = "retention-journal.json"
_RUN_LOCK_FILE = "retention.lock"
_RECORD_NAME = re.compile(r"([0-9a-f]{64})\.json")
_ID_TEXT = re.compile(r"(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])")
_ID_BYTES = re.compile(rb"(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])")
_SETTLED_AFTER_NS = 2_000_000_000
_SCAN_BLOCK = 4 * 1024 * 1024


# Every change this module makes to the disk goes through these three
# functions, in the order described above.
def _publish(path: Path, content: bytes) -> None:
  atomic_write_bytes(path, content)


def _remove(path: Path) -> None:
  try:
    os.unlink(path)
  except FileNotFoundError:
    pass


def _sync(directory: Path) -> None:
  try:
    descriptor = os.open(directory, os.O_RDONLY)
  except FileNotFoundError:
    return
  try:
    os.fsync(descriptor)
  finally:
    os.close(descriptor)


def _yield_lock() -> None:
  """Leave the project lock free long enough for a waiting save to take it."""
  time.sleep(_YIELD_SECONDS)


def _allocated(status: os.stat_result) -> int:
  blocks = getattr(status, "st_blocks", None)
  return blocks * 512 if isinstance(blocks, int) else status.st_size


def _timestamp(value: Any) -> float | None:
  """Seconds since the epoch, or None for a time that cannot be trusted."""
  if not isinstance(value, str):
    return None
  try:
    parsed = datetime.fromisoformat(value)
  except ValueError:
    return None
  if parsed.tzinfo is None:
    return None
  try:
    return parsed.timestamp()
  except (OverflowError, OSError, ValueError):
    return None


def _moment(now: datetime | None) -> datetime:
  if now is None:
    return datetime.now(UTC)
  if now.tzinfo is None:
    raise OpenAuthorError("Retention needs a timezone-aware current time.")
  return now


# Policy --------------------------------------------------------------------


def policy_path(paths: ProjectPaths) -> Path:
  return paths.project_dir / POLICY_FILE_NAME


def _checked_policy(enabled: Any, keep_all_days: Any, daily_after_days: Any) -> dict[str, Any]:
  if not isinstance(enabled, bool):
    raise OpenAuthorError("Retention 'enabled' must be true or false.")
  for name, value in (("keep_all_days", keep_all_days), ("daily_after_days", daily_after_days)):
    if not isinstance(value, int) or isinstance(value, bool):
      raise OpenAuthorError(f"Retention '{name}' must be a whole number of days.")
  if keep_all_days < 1:
    raise OpenAuthorError("keep_all_days must be at least 1, so recent work is never thinned.")
  if daily_after_days <= keep_all_days:
    raise OpenAuthorError("daily_after_days must be greater than keep_all_days.")
  if daily_after_days > _MAX_DAYS:
    raise OpenAuthorError(f"daily_after_days cannot exceed {_MAX_DAYS}.")
  return {"enabled": enabled, "keep_all_days": keep_all_days, "daily_after_days": daily_after_days}


def load_policy(paths: ProjectPaths) -> dict[str, Any]:
  """This book's policy; the default when none was ever saved.

  A policy file that cannot be understood stops thinning rather than falling
  back to the default, because it may have said "disabled".
  """
  path = policy_path(paths)
  try:
    raw = path.read_text(encoding="utf-8")
  except FileNotFoundError:
    return dict(DEFAULT_POLICY)
  except (OSError, UnicodeDecodeError) as error:
    raise OpenAuthorError(f"The retention policy {path} cannot be read ({error}). Nothing is thinned until it is corrected.") from error
  try:
    payload = json.loads(raw)
    if not isinstance(payload, dict):
      raise ValueError("it is not an object")
    return _checked_policy(payload.get("enabled"), payload.get("keep_all_days"), payload.get("daily_after_days"))
  except (ValueError, OpenAuthorError) as error:
    raise OpenAuthorError(f"The retention policy {path} is not valid ({error}) Nothing is thinned until it is corrected.") from error


def update_policy(
  paths: ProjectPaths,
  *,
  enabled: bool | None = None,
  keep_all_days: int | None = None,
  daily_after_days: int | None = None,
  now: datetime | None = None,
) -> dict[str, Any]:
  with project_lock(paths):
    try:
      current = load_policy(paths)
    except OpenAuthorError:
      # A damaged policy can be replaced, but only by a complete one.
      if enabled is None or keep_all_days is None or daily_after_days is None:
        raise
      current = dict(DEFAULT_POLICY)
    policy = _checked_policy(
      current["enabled"] if enabled is None else enabled,
      current["keep_all_days"] if keep_all_days is None else keep_all_days,
      current["daily_after_days"] if daily_after_days is None else daily_after_days,
    )
    _publish(policy_path(paths), (json.dumps({"schema_version": 1, **policy}, indent=2) + "\n").encode("utf-8"))
  return retention_status(paths, now=now)


def _read_state(paths: ProjectPaths) -> dict[str, Any]:
  empty = {"last_run": None, "pending": {"removed_revisions": 0, "freed_bytes": 0}}
  try:
    payload = json.loads((paths.revisions_dir / _STATE_FILE).read_text(encoding="utf-8"))
  except (OSError, ValueError):
    return empty
  if not isinstance(payload, dict):
    return empty
  last = payload.get("last_run")
  pending = payload.get("pending")
  count = lambda row, name: row[name] if isinstance(row.get(name), int) and not isinstance(row.get(name), bool) else 0
  return {
    "last_run": {"at": last.get("at") if isinstance(last.get("at"), str) else None, "removed_revisions": count(last, "removed_revisions"), "freed_bytes": count(last, "freed_bytes")} if isinstance(last, dict) else None,
    "pending": {"removed_revisions": count(pending, "removed_revisions"), "freed_bytes": count(pending, "freed_bytes")} if isinstance(pending, dict) else empty["pending"],
  }


def _due(policy: dict[str, Any], state: dict[str, Any], now: datetime) -> bool:
  if not policy["enabled"]:
    return False
  last = _timestamp((state["last_run"] or {}).get("at"))
  # A completion time in the future came from a wrong clock; do not wait on it.
  return last is None or last > now.timestamp() or now.timestamp() - last >= DUE_AFTER_SECONDS


def _usage(paths: ProjectPaths) -> dict[str, int]:
  revisions = size = allocated = 0
  pending = [paths.revisions_dir]
  while pending:
    directory = pending.pop()
    try:
      entries = list(os.scandir(directory))
    except FileNotFoundError:
      continue
    for entry in entries:
      try:
        if entry.is_dir(follow_symlinks=False):
          pending.append(Path(entry.path))
          continue
        status = entry.stat(follow_symlinks=False)
      except FileNotFoundError:
        continue
      size += status.st_size
      allocated += _allocated(status)
      if Path(directory) == paths.revision_records_dir and _RECORD_NAME.fullmatch(entry.name):
        revisions += 1
  return {"revisions": revisions, "bytes": size, "allocated_bytes": allocated}


def _record_count(paths: ProjectPaths) -> int:
  try:
    return sum(1 for name in os.listdir(paths.revision_records_dir) if _RECORD_NAME.fullmatch(name))
  except FileNotFoundError:
    return 0


def retention_status(paths: ProjectPaths, *, now: datetime | None = None) -> dict[str, Any]:
  policy = load_policy(paths)
  state = _read_state(paths)
  last = state["last_run"] or {"at": None, "removed_revisions": 0, "freed_bytes": 0}
  return {
    "policy": policy,
    "store": _usage(paths),
    "last_run": {"at": last["at"], "removed_revisions": last["removed_revisions"], "freed_bytes": last["freed_bytes"]},
    "due": _due(policy, state, _moment(now)),
  }


# Survey --------------------------------------------------------------------


@dataclass(slots=True)
class _Row:
  """What planning needs to know about one stored record."""

  link: str
  thinnable: bool
  at: float | None
  # Digests a difference record names; None for a complete manifest, which is
  # read again when needed instead of being held for every record.
  named: tuple[str, ...] | None
  # Revision ids its metadata or message mention.
  mentions: tuple[str, ...]
  thinned: int
  size: int
  allocated: int


@dataclass(slots=True)
class _Step:
  """Detach ``remove`` (oldest first) so that ``survivor`` follows ``ancestor``.

  A step with no survivor finishes an interrupted run: its records were
  detached earlier and only need removing.
  """

  survivor: str
  ancestor: str
  remove: list[str]
  thinned: int
  objects: set[str] = field(default_factory=set)


@dataclass(slots=True)
class _Totals:
  removed_revisions: int = 0
  removed_objects: int = 0
  freed_bytes: int = 0
  freed_allocated_bytes: int = 0


def is_editor_save(kind: Any, message: Any) -> bool:
  return kind == EDITOR_SAVE_KIND and isinstance(message, str) and message.startswith(EDITOR_SAVE_MESSAGE)


def _record_path(paths: ProjectPaths, revision_id: str) -> Path:
  return paths.revision_records_dir / f"{revision_id}.json"


def _row(paths: ProjectPaths, revision_id: str) -> _Row:
  record = store._load_record(paths, revision_id)
  status = os.stat(_record_path(paths, revision_id))
  text = json.dumps(record.get("metadata", {}), sort_keys=True) + " " + str(record.get("message", ""))
  return _Row(
    link=store._link(record),
    thinnable=is_editor_save(record.get("kind"), record.get("message")),
    at=_timestamp(record.get("created_at")),
    named=None if "manifest" in record else tuple(sorted(store._named_digests(record))),
    mentions=tuple(sorted(set(_ID_TEXT.findall(text)) - {revision_id})),
    thinned=record["thinned"] if record["schema_version"] == store.RELINKED_SCHEMA_VERSION else 0,
    size=status.st_size,
    allocated=_allocated(status),
  )


class _References:
  """Revision ids mentioned by project files outside the Revision store.

  Anything that holds a Revision id holds it as text, so every file under the
  project's own folders is searched for id-shaped strings instead of trusting
  a list of known fields. Results are remembered by file identity; a later
  pass only reads files that changed.
  """

  def __init__(self, paths: ProjectPaths) -> None:
    self._paths = paths
    self._seen: dict[str, tuple[tuple[int, int, int, int], frozenset[str]]] = {}

  def _roots(self) -> list[Path]:
    return [self._paths.project_dir, self._paths.root / "codex", self._paths.root / "manuscript"]

  def _mentions(self, path: str, known: Any) -> frozenset[str]:
    found: set[str] = set()
    carry = b""
    with open(path, "rb") as handle:
      while True:
        block = handle.read(_SCAN_BLOCK)
        if not block:
          break
        data = carry + block
        for token in _ID_BYTES.findall(data):
          text = token.decode("ascii")
          if text in known:
            found.add(text)
        carry = data[-128:]
    return frozenset(found)

  def scan(self, known: Any) -> set[str]:
    excluded = {os.path.realpath(self._paths.revisions_dir)}
    current: dict[str, tuple[tuple[int, int, int, int], frozenset[str]]] = {}
    pending = [str(root) for root in self._roots()]
    now_ns = time.time_ns()
    while pending:
      directory = pending.pop()
      try:
        entries = list(os.scandir(directory))
      except FileNotFoundError:
        continue
      except OSError as error:
        raise OpenAuthorError(f"Cannot check {directory} for references to saved versions ({error}). Nothing was removed.") from error
      for entry in entries:
        try:
          if entry.is_symlink():
            continue
          if entry.is_dir(follow_symlinks=False):
            if os.path.realpath(entry.path) not in excluded:
              pending.append(entry.path)
            continue
          status = entry.stat(follow_symlinks=False)
          signature = (status.st_ino, status.st_size, status.st_mtime_ns, status.st_ctime_ns)
          remembered = self._seen.get(entry.path)
          if remembered is not None and remembered[0] == signature and now_ns - status.st_mtime_ns > _SETTLED_AFTER_NS:
            current[entry.path] = remembered
            continue
          current[entry.path] = (signature, self._mentions(entry.path, known))
        except FileNotFoundError:
          continue
        except OSError as error:
          raise OpenAuthorError(f"Cannot check {entry.path} for references to saved versions ({error}). Nothing was removed.") from error
    self._seen = current
    mentioned: set[str] = set()
    for _, found in current.values():
      mentioned.update(found)
    return mentioned

  def holders(self, revision_id: str) -> list[str]:
    return sorted(path for path, (_, found) in self._seen.items() if revision_id in found)


def _read_journal(paths: ProjectPaths) -> dict[str, Any] | None:
  path = paths.revisions_dir / _JOURNAL_FILE
  try:
    payload = json.loads(path.read_text(encoding="utf-8"))
  except FileNotFoundError:
    return None
  except (OSError, ValueError) as error:
    raise OpenAuthorError(f"The record of an interrupted thinning run, {path}, cannot be read ({error}). Nothing was removed.") from error
  steps = payload.get("steps") if isinstance(payload, dict) else None
  objects = payload.get("objects") if isinstance(payload, dict) else None
  valid = (
    isinstance(steps, list) and isinstance(objects, list)
    and all(isinstance(digest, str) and store._DIGEST.fullmatch(digest) for digest in objects)
    and all(
      isinstance(step, dict) and isinstance(step.get("remove"), list)
      and all(isinstance(item, str) and store._DIGEST.fullmatch(item) for item in step["remove"])
      for step in steps
    )
  )
  if not valid:
    raise OpenAuthorError(f"The record of an interrupted thinning run, {path}, is not valid. Nothing was removed.")
  return {"steps": [list(step["remove"]) for step in steps], "objects": list(objects)}


class _Run:
  """One thinning run over one book."""

  def __init__(self, paths: ProjectPaths, policy: dict[str, Any], now: datetime) -> None:
    self.paths = paths
    self.policy = policy
    self.now = now.timestamp()
    self.rows: dict[str, _Row] = {}
    self.references = _References(paths)
    self.head = ""
    self.pinned: set[str] = set()
    self.queue: deque[_Step] = deque()
    self.skipped = False
    self.stale_journal = False
    self.planned = _Totals()
    self.done = _Totals()
    # Objects read back intact during this run, and what remains in use.
    self.verified: set[str] = set()
    self.referenced: set[str] = set()
    # Objects that may go once the steps naming them are complete.
    self.candidates: set[str] = set()
    self.namers: dict[str, int] = {}
    self.base_of: dict[str, str] = {}
    self.blocked: dict[str, set[str]] = {}
    self.longest_hold = 0.0
    self.holds = 0
    self._units = _HOLD_UNITS_START

  # Reading ------------------------------------------------------------------

  def _ids_on_disk(self) -> set[str]:
    try:
      names = os.listdir(self.paths.revision_records_dir)
    except FileNotFoundError:
      return set()
    return {match.group(1) for match in map(_RECORD_NAME.fullmatch, names) if match}

  def _take_in_records(self) -> list[str]:
    present = self._ids_on_disk()
    if any(revision_id not in present for revision_id in self.rows):
      raise OpenAuthorError("Revision history changed while it was being thinned. Nothing further was removed; run it again.")
    added = sorted(present - self.rows.keys())
    for revision_id in added:
      try:
        self.rows[revision_id] = _row(self.paths, revision_id)
      except OpenAuthorError as error:
        raise OpenAuthorError(f"Revision history cannot be thinned while a record is unreadable ({error}) Nothing was removed.") from error
    return added

  def survey(self) -> None:
    """Read everything that never changes; needs no lock."""
    self._take_in_records()
    self.references.scan(self.rows)

  def refresh(self) -> None:
    """Bring the survey up to date. Call with the project lock held."""
    if (self.paths.workspace_dir / "book-transaction.json").exists():
      raise OpenAuthorError("An interrupted edit is waiting to be recovered. Nothing was thinned.")
    self.head = store.revision_head(self.paths)
    added = self._take_in_records()
    external = self.references.scan(self.rows)
    self.pinned.update(external)
    if self.head:
      self.pinned.add(self.head)
    for revision_id in added:
      row = self.rows[revision_id]
      if row.link:
        self.pinned.add(row.link)
      self.pinned.update(row.mentions)
      # A new save can return to text an old save had: that object is in use again.
      named = row.named if row.named is not None else store._named_digests(store._load_record(self.paths, revision_id))
      self.referenced.update(named)
      self.candidates.difference_update(named)

  def _chain(self) -> list[str]:
    """Revision ids from the oldest to the head."""
    chain: list[str] = []
    seen: set[str] = set()
    current = self.head
    while current:
      if current in seen:
        raise OpenAuthorError(f"Revision parent cycle detected at '{current}'. Nothing was removed.")
      if current not in self.rows:
        raise OpenAuthorError(f"Revision history is damaged: '{current}' is missing. Nothing was removed.")
      seen.add(current)
      chain.append(current)
      current = self.rows[current].link
    chain.reverse()
    return chain

  # Planning -----------------------------------------------------------------

  def _reference_time(self, chain: list[str]) -> float:
    """Ages are measured back from the book's latest save, never from later.

    A clock that jumped forward therefore cannot make last week's work look
    old, and a book left alone for a month still has its last week intact.
    """
    latest = max((self.rows[revision_id].at or 0.0 for revision_id in chain if (self.rows[revision_id].at or 0.0) <= self.now), default=0.0)
    return min(self.now, latest) if latest else self.now

  def plan(self) -> None:
    """Decide what goes, and prove that everything else still reads."""
    rows = self.rows
    chain = self._chain()
    on_chain = set(chain)
    journal = _read_journal(self.paths)
    journaled = {revision_id for step in (journal or {"steps": []})["steps"] for revision_id in step if revision_id in rows and revision_id not in on_chain}

    pinned = self.pinned
    if self.head:
      pinned.add(self.head)
    for revision_id, row in rows.items():
      detached = revision_id not in on_chain and revision_id not in journaled
      # A record outside the listed history still reads through the one it follows.
      if detached and row.link:
        pinned.add(row.link)
      if detached or (revision_id in on_chain and not row.thinnable):
        pinned.update(row.mentions)

    steps: list[_Step] = []
    for listed in (journal or {"steps": []})["steps"]:
      present = [revision_id for revision_id in listed if revision_id in journaled]
      keep = max((index + 1 for index, revision_id in enumerate(present) if revision_id in pinned), default=0)
      for revision_id in present[:keep]:
        # Something points at it now, so it stays, with what it reads through.
        if rows[revision_id].link:
          pinned.add(rows[revision_id].link)
        pinned.update(rows[revision_id].mentions)
      if present[keep:]:
        steps.append(_Step("", "", present[keep:], 0))
    if journal is not None and journal["objects"]:
      if not steps:
        steps.append(_Step("", "", [], 0))
      steps[0].objects.update(journal["objects"])
    self.stale_journal = journal is not None

    reference = self._reference_time(chain)
    keep_all = self.policy["keep_all_days"] * 86400
    daily_after = self.policy["daily_after_days"] * 86400

    def candidate(revision_id: str) -> bool:
      row = rows[revision_id]
      return (
        row.thinnable and revision_id not in pinned
        and row.at is not None and row.at <= self.now and reference - row.at > keep_all
      )

    def bucket(revision_id: str) -> tuple[str, int]:
      at = rows[revision_id].at or 0.0
      return ("day", int(at // 86400)) if reference - at > daily_after else ("hour", int(at // 3600))

    index = 0
    while index < len(chain):
      if not candidate(chain[index]):
        index += 1
        continue
      end = index
      while end < len(chain) and candidate(chain[end]):
        end += 1
      # Within one uninterrupted run, the newest save of each hour (or day)
      # stays. The run's last save is always one of those, so the state just
      # before whatever interrupted the run is still there.
      last = {bucket(revision_id): position for position, revision_id in enumerate(chain[index:end])}
      keep = set(last.values())
      run: list[str] = []
      for position, revision_id in enumerate(chain[index:end]):
        if position not in keep:
          run.append(revision_id)
          continue
        if run:
          before = index + position - len(run) - 1
          steps.extend(self._steps_for(run, chain[before] if before >= 0 else "", revision_id))
          run = []
      index = end

    self.queue = deque(steps)
    self.skipped = False
    self.planned = _Totals()
    self.candidates, self.namers, self.base_of, self.blocked = set(), {}, {}, {}
    if not steps:
      return
    self._account(chain, on_chain, steps)

  def _steps_for(self, run: list[str], ancestor: str, survivor: str) -> list[_Step]:
    """Detach a run in pieces, newest piece first, so each piece is small."""
    steps: list[_Step] = []
    remaining = list(run)
    thinned = self.rows[survivor].thinned
    while remaining:
      piece = remaining[-_STEP_REVISIONS:]
      remaining = remaining[:-_STEP_REVISIONS]
      # A removed record may itself stand for saves thinned earlier.
      thinned += len(piece) + sum(self.rows[revision_id].thinned for revision_id in piece)
      steps.append(_Step(survivor, remaining[-1] if remaining else ancestor, piece, thinned))
    return steps

  def _relinked_bytes(self, record: dict[str, Any], manifest: dict[str, str], ancestor: str, thinned: int) -> bytes:
    """The record ``record`` becomes, proven to describe the same Revision."""
    relinked = store._relinked_record(record, manifest, ancestor, thinned)
    content = (json.dumps(relinked, separators=(",", ":")) + "\n").encode("utf-8")
    again = store._checked_record(json.loads(content), record["id"])
    same_identity = all(again[name] == record.get(name, "") for name in ("parent", "created_at", "message", "kind")) and again["nonce"] == record.get("nonce", "")
    if (
      not same_identity or again["metadata"] != record.get("metadata", {})
      or store._link(again) != ancestor or store._full_manifest(self.paths, again) != manifest
    ):
      raise OpenAuthorError(f"Revision '{record['id']}' could not be relinked without changing it. Nothing was removed.")
    return content

  def _verify_object(self, digest: str) -> None:
    if digest not in self.verified:
      store._read_object(self.paths, digest)
      self.verified.add(digest)

  def _names(self, revision_id: str) -> set[str]:
    named = self.rows[revision_id].named
    return set(named) if named is not None else store._named_digests(store._load_record(self.paths, revision_id))

  def _object_files(self, digest: str) -> list[tuple[Path, os.stat_result]]:
    found = []
    for location in store._object_paths(self.paths, digest):
      try:
        found.append((location, os.stat(location)))
      except FileNotFoundError:
        pass
    return found

  def _account(self, chain: list[str], on_chain: set[str], steps: list[_Step]) -> None:
    paths, rows = self.paths, self.rows
    removed = {revision_id for step in steps for revision_id in step.remove}
    final = {step.survivor: step for step in steps if step.survivor}
    planned = _Totals(removed_revisions=len(removed))
    try:
      block = os.statvfs(paths.revision_records_dir).f_frsize or 4096
    except (AttributeError, OSError):
      block = 4096

    # Everything that stays must rebuild its manifest, and every object it
    # uses must read back intact, before anything is removed.
    referenced: set[str] = set()
    memo = store._ManifestMemo()
    try:
      for revision_id in [*chain, *sorted(rows.keys() - on_chain)]:
        if revision_id in removed:
          continue
        record = store._load_record(paths, revision_id)
        manifest = store._full_manifest(paths, record, memo)
        step = final.get(revision_id)
        if step is None:
          referenced.update(store._named_digests(record))
          continue
        referenced.update(manifest.values())
        size = len(self._relinked_bytes(record, manifest, step.ancestor, step.thinned))
        planned.freed_bytes -= size - rows[revision_id].size
        planned.freed_allocated_bytes -= -(-size // block) * block - rows[revision_id].allocated
      for digest in sorted(referenced):
        self._verify_object(digest)
    except OpenAuthorError as error:
      raise OpenAuthorError(f"Revision history did not pass verification, so nothing was removed: {error}") from error
    self.referenced = referenced

    namers: dict[str, int] = {}
    for step in steps:
      for revision_id in step.remove:
        step.objects.update(self._names(revision_id))
        planned.freed_bytes += rows[revision_id].size
        planned.freed_allocated_bytes += rows[revision_id].allocated
      step.objects.difference_update(referenced)
      for digest in step.objects:
        namers[digest] = namers.get(digest, 0) + 1

    # An object another stored object was packed against must outlast it.
    pairs: list[tuple[str, str]] = []
    if namers:
      for folder in sorted(os.scandir(paths.revision_objects_dir), key=lambda entry: entry.name) if paths.revision_objects_dir.is_dir() else []:
        if not folder.is_dir(follow_symlinks=False):
          continue
        for entry in os.scandir(folder.path):
          digest = folder.name + entry.name.removesuffix(store._PACKED_SUFFIX)
          if entry.name.endswith(store._PACKED_SUFFIX) and store._DIGEST.fullmatch(digest):
            try:
              base = store._object_base(paths, digest)
            except OpenAuthorError:
              # Unreadable and unused by anything that stays; it protects nothing.
              continue
            if base:
              pairs.append((digest, base))
    candidates = set(namers)
    # A base that no record names goes with the last object packed against it.
    candidates.update(base for digest, base in pairs if digest in candidates and base not in referenced)
    self.base_of = {digest: base for digest, base in pairs if digest in candidates}
    self.blocked = {}
    for digest, base in pairs:
      if base in candidates:
        self.blocked.setdefault(base, set()).add(digest)
    self.candidates, self.namers = candidates, namers

    removable = set(candidates)
    changed = True
    while changed:
      changed = False
      for digest in list(removable):
        if not self.blocked.get(digest, set()) <= removable:
          removable.discard(digest)
          changed = True
    for digest in removable:
      files = self._object_files(digest)
      if files:
        planned.removed_objects += 1
        planned.freed_bytes += sum(status.st_size for _, status in files)
        planned.freed_allocated_bytes += sum(_allocated(status) for _, status in files)
    self.planned = planned

  # Removing -----------------------------------------------------------------

  def _prepare(self, step: _Step) -> tuple[bytes, bytes] | None:
    """Check a step against the disk as it is now; None means leave it alone.

    Returns the survivor's current bytes and the bytes that relink it.
    """
    if any(revision_id in self.pinned for revision_id in step.remove) or step.survivor in self.pinned:
      return None
    if not step.survivor:
      return b"", b""
    survivor = store._load_record(self.paths, step.survivor)
    cursor = store._link(survivor)
    for revision_id in reversed(step.remove):
      if cursor != revision_id:
        return None
      cursor = store._link(store._load_record(self.paths, revision_id))
    if cursor != step.ancestor:
      return None
    if step.ancestor:
      store._load_record(self.paths, step.ancestor)
    manifest = store._full_manifest(self.paths, survivor)
    for digest in manifest.values():
      self._verify_object(digest)
    original = _record_path(self.paths, step.survivor).read_bytes()
    return original, self._relinked_bytes(survivor, manifest, step.ancestor, step.thinned)

  def _objects_ready(self, completed: list[_Step]) -> list[str]:
    """Objects no remaining record uses, packed objects before their bases."""
    for step in completed:
      for digest in step.objects:
        self.namers[digest] = self.namers.get(digest, 1) - 1
    waiting = {digest for digest in self.candidates if self.namers.get(digest, 0) <= 0}
    order: list[str] = []
    progressed = True
    while progressed:
      progressed = False
      for digest in sorted(waiting):
        if self.blocked.get(digest):
          continue
        order.append(digest)
        waiting.discard(digest)
        progressed = True
        base = self.base_of.get(digest)
        if base in self.blocked:
          self.blocked[base].discard(digest)
    return order

  def hold(self) -> None:
    """One bounded piece of work under the project lock."""
    paths = self.paths
    with project_lock(paths):
      started = time.monotonic()
      self.refresh()
      # Pieces of one run are joined, so a survivor is written once per hold.
      # What an interrupted run left behind is always finished in one hold,
      # because the journal written below replaces the one that listed it.
      groups: list[list[_Step]] = []
      units = 0
      while self.queue:
        step = self.queue[0]
        cost = len(step.remove) + (_RELINK_UNITS if step.survivor else 0)
        if groups and step.survivor and units + cost > self._units:
          break
        self.queue.popleft()
        units += cost
        if groups and step.survivor and groups[-1][0].survivor == step.survivor:
          groups[-1].append(step)
        else:
          groups.append([step])
      ready: list[tuple[_Step, bytes, bytes]] = []
      completed: list[_Step] = []
      for group in groups:
        joined = _Step(group[0].survivor, group[-1].ancestor, [revision_id for step in reversed(group) for revision_id in step.remove], group[-1].thinned)
        prepared = self._prepare(joined)
        if prepared is None:
          self.skipped = True
          continue
        ready.append((joined, *prepared))
        completed.extend(group)
      steps = [step for step, _, _ in ready]
      objects = self._objects_ready(completed)
      journal = paths.revisions_dir / _JOURNAL_FILE
      if steps or objects:
        # Intent first: a run that stops anywhere below is finished by the next.
        _publish(journal, (json.dumps({"schema_version": 1, "steps": [{"survivor": step.survivor, "ancestor": step.ancestor, "remove": step.remove} for step in steps], "objects": objects}, separators=(",", ":")) + "\n").encode("utf-8"))
        # Everything new is written and synced before anything is removed.
        for step, original, content in ready:
          if not step.survivor:
            continue
          target = _record_path(paths, step.survivor)
          _publish(target, content)
          if target.read_bytes() != content:
            _publish(target, original)
            raise OpenAuthorError(f"Revision '{step.survivor}' did not read back as written. Nothing was removed in this step.")
          row = self.rows[step.survivor]
          status = os.stat(target)
          self.done.freed_bytes += row.size - status.st_size
          self.done.freed_allocated_bytes += row.allocated - _allocated(status)
          row.link, row.named, row.thinned, row.size, row.allocated = step.ancestor, None, step.thinned, status.st_size, _allocated(status)
        # Newest first, so a record still on disk always has what it reads through.
        for step in steps:
          for revision_id in reversed(step.remove):
            _remove(_record_path(paths, revision_id))
            row = self.rows.pop(revision_id)
            self.done.removed_revisions += 1
            self.done.freed_bytes += row.size
            self.done.freed_allocated_bytes += row.allocated
        _sync(paths.revision_records_dir)
        # Only now is nothing left that names these objects.
        touched: set[Path] = set()
        for digest in objects:
          files = self._object_files(digest)
          for location, status in files:
            _remove(location)
            touched.add(location.parent)
            self.done.freed_bytes += status.st_size
            self.done.freed_allocated_bytes += _allocated(status)
          self.done.removed_objects += 1 if files else 0
          self.candidates.discard(digest)
        for directory in sorted(touched):
          _sync(directory)
      if steps or objects or self.stale_journal:
        _remove(journal)
        _sync(paths.revisions_dir)
        self.stale_journal = False
      elapsed = time.monotonic() - started
    self.holds += 1
    self.longest_hold = max(self.longest_hold, elapsed)
    self._units = int(min(_HOLD_UNITS_MAX, max(_HOLD_UNITS_MIN, self._units * _HOLD_TARGET_SECONDS / max(elapsed, 0.001))))


# Entry point ----------------------------------------------------------------


@contextmanager
def _single_run(paths: ProjectPaths) -> Iterator[bool]:
  """Hold the one-run-at-a-time lock; yields False when another run has it."""
  if fcntl is None:
    raise OpenAuthorError("Thinning Revision history requires POSIX file locking on this host.")
  paths.revisions_dir.mkdir(parents=True, exist_ok=True)
  descriptor = os.open(paths.revisions_dir / _RUN_LOCK_FILE, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
  try:
    try:
      fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
      yield False
      return
    try:
      yield True
    finally:
      fcntl.flock(descriptor, fcntl.LOCK_UN)
  finally:
    os.close(descriptor)


def _result(ran: bool, reason: str, totals: _Totals, kept: int, complete: bool) -> dict[str, Any]:
  return {
    "ran": ran,
    "reason": reason,
    "removed_revisions": totals.removed_revisions,
    "kept_revisions": kept,
    "removed_objects": totals.removed_objects,
    "freed_bytes": totals.freed_bytes,
    "freed_allocated_bytes": totals.freed_allocated_bytes,
    "complete": complete,
  }


def compact_revisions(
  paths: ProjectPaths,
  *,
  dry_run: bool = False,
  if_due: bool = False,
  now: datetime | None = None,
  max_seconds: float = DEFAULT_MAX_SECONDS,
  report: dict[str, Any] | None = None,
) -> dict[str, Any]:
  """Thin this book's old editor saves according to its policy.

  ``report``, when given, receives timings (``holds``, ``longest_hold``).
  Nothing calls this implicitly; the desktop asks for it with ``if_due``.
  """
  moment = _moment(now)
  kept = _record_count(paths)
  try:
    policy = load_policy(paths)
  except OpenAuthorError as error:
    if if_due:
      return _result(False, f"policy_unreadable: {error}", _Totals(), kept, True)
    raise
  if if_due and not policy["enabled"]:
    return _result(False, "disabled", _Totals(), kept, True)
  if if_due and not _due(policy, _read_state(paths), moment):
    return _result(False, "not_due", _Totals(), kept, True)
  if not policy["enabled"] and not dry_run:
    raise OpenAuthorError(
      "Thinning is turned off for this book, so nothing was removed. "
      "Turn it on with `revision retention --enabled true`, or use --dry-run to see what it would remove."
    )

  if dry_run:
    run = _Run(paths, policy, moment)
    run.survey()
    with project_lock(paths):
      run.refresh()
    run.plan()
    return _result(False, "dry_run", run.planned, len(run.rows) - run.planned.removed_revisions, True)

  with _single_run(paths) as mine:
    if not mine:
      return _result(False, "already_running", _Totals(), kept, True)
    deadline = time.monotonic() + max(0.0, max_seconds)
    run = _Run(paths, policy, moment)
    run.survey()
    with project_lock(paths):
      run.refresh()
    run.plan()
    replans = 0
    out_of_time = False
    while True:
      while run.queue or run.stale_journal:
        run.hold()
        if run.queue:
          if time.monotonic() >= deadline:
            out_of_time = True
            break
          _yield_lock()
      if out_of_time or not run.skipped or replans >= _MAX_REPLANS or time.monotonic() >= deadline:
        break
      # Something new points into what was planned; plan again around it.
      replans += 1
      with project_lock(paths):
        run.refresh()
      run.plan()
    complete = not run.queue and not run.skipped
    state = _read_state(paths)
    pending = {
      "removed_revisions": state["pending"]["removed_revisions"] + run.done.removed_revisions,
      "freed_bytes": state["pending"]["freed_bytes"] + run.done.freed_bytes,
    }
    if complete:
      state = {"last_run": {"at": moment.isoformat(), **pending}, "pending": {"removed_revisions": 0, "freed_bytes": 0}}
    else:
      state = {"last_run": state["last_run"], "pending": pending}
    _publish(paths.revisions_dir / _STATE_FILE, (json.dumps({"schema_version": 1, **state}, indent=2) + "\n").encode("utf-8"))
    if report is not None:
      report.update({"holds": run.holds, "longest_hold": run.longest_hold})
    reason = "work_bound" if out_of_time else ("history_changed" if not complete else ("thinned" if run.done.removed_revisions or run.done.removed_objects else "nothing_to_thin"))
    return _result(True, reason, run.done, len(run.rows), complete)
