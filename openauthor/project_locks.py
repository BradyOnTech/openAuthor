"""Serialize cooperating book operations across threads and sidecar processes.

Hold the project lock from the first read/precondition through commit or rollback,
not just around individual file writes. Nested operations are reentrant. The lock
file lives outside versioned book state and must never be unlinked on release.
These advisory locks do not coordinate external editors or provide crash recovery.

Waiting is bounded: a caller that cannot obtain the lock within the timeout
(30 seconds, or ``OPENAUTHOR_LOCK_TIMEOUT_MS``) fails before its operation runs
instead of hanging behind a stuck holder. A caller that obtains the lock within
that time proceeds exactly as an unbounded wait would have.
"""

from __future__ import annotations

import inspect
import os
import stat
import threading
import time
from contextlib import contextmanager
from functools import wraps
from typing import TYPE_CHECKING, Callable, Iterator, ParamSpec, TypeVar
from weakref import WeakValueDictionary

if TYPE_CHECKING:
  from .project import ProjectPaths

try:
  import fcntl
except ImportError:  # pragma: no cover - unsupported non-POSIX host
  fcntl = None  # type: ignore[assignment]


_LOCKS: WeakValueDictionary = WeakValueDictionary()
_GUARD = threading.Lock()
_HELD = threading.local()
_DESCRIPTORS: set[int] = set()
P = ParamSpec("P")
R = TypeVar("R")
DEFAULT_LOCK_TIMEOUT_MS = 30_000
LOCK_BUSY_MESSAGE = (
  "Another openAuthor operation on this book is still running, so this one did not start. "
  "Wait for it to finish and retry; if nothing else is running, close other openAuthor windows first. Nothing was changed."
)


def _lock_timeout_seconds() -> float:
  raw = os.environ.get("OPENAUTHOR_LOCK_TIMEOUT_MS", "").strip()
  try:
    milliseconds = int(raw)
  except ValueError:
    milliseconds = DEFAULT_LOCK_TIMEOUT_MS
  if milliseconds < 0:
    milliseconds = DEFAULT_LOCK_TIMEOUT_MS
  return milliseconds / 1000


def _flock_until(descriptor: int, deadline: float) -> bool:
  """Take the exclusive file lock, giving up once ``deadline`` has passed.

  A free lock is taken on the first attempt. A held one is retried at short,
  growing intervals, because flock has no timed form.
  """
  delay = 0.002
  while True:
    try:
      fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
      return True
    except BlockingIOError:
      remaining = deadline - time.monotonic()
      if remaining <= 0:
        return False
      time.sleep(min(delay, remaining))
      delay = min(delay * 2, 0.05)


def _after_fork() -> None:
  # A child must not inherit thread ownership or keep the parent's flock alive.
  # Close inherited descriptors without LOCK_UN (the open-file description is
  # shared with the parent until exec/close).
  global _LOCKS, _GUARD, _HELD, _DESCRIPTORS
  for descriptor in _DESCRIPTORS:
    os.close(descriptor)
  _LOCKS = WeakValueDictionary()
  _GUARD = threading.Lock()
  _HELD = threading.local()
  _DESCRIPTORS = set()


if hasattr(os, "register_at_fork"):
  os.register_at_fork(after_in_child=_after_fork)


@contextmanager
def project_lock(paths: ProjectPaths) -> Iterator[None]:
  from .project import OpenAuthorError

  lock_path = paths.workspace_dir / "locks" / "project.lock"
  key = str(lock_path.resolve())
  with _GUARD:
    local_lock = _LOCKS.get(key)
    if local_lock is None:
      local_lock = threading.RLock()
      _LOCKS[key] = local_lock
  deadline = time.monotonic() + _lock_timeout_seconds()
  # Another thread of this process (the sidecar runs several) may hold the
  # book; the same deadline covers that wait and the cross-process one.
  if not local_lock.acquire(timeout=max(0.0, deadline - time.monotonic())):
    raise OpenAuthorError(LOCK_BUSY_MESSAGE)
  try:
    held = getattr(_HELD, "keys", set())
    if key in held:
      yield
      return
    if fcntl is None:
      raise OpenAuthorError("Safe project access requires POSIX file locking on this host.")
    descriptor = None
    acquired = False
    try:
      try:
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
        _DESCRIPTORS.add(descriptor)
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
          raise OpenAuthorError("Project lock must be a regular file.")
        acquired = _flock_until(descriptor, deadline)
      except OSError as error:
        raise OpenAuthorError(f"Could not acquire safe project access: {error}") from error
      if not acquired:
        raise OpenAuthorError(LOCK_BUSY_MESSAGE)
      _HELD.keys = {*held, key}
      from .book_transactions import recover_book_transaction
      recover_book_transaction(paths)
      yield
    finally:
      _HELD.keys = held
      if descriptor is not None:
        try:
          if acquired:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
        finally:
          _DESCRIPTORS.discard(descriptor)
          os.close(descriptor)
  finally:
    local_lock.release()


def serialized_project_access(operation: Callable[P, R]) -> Callable[P, R]:
  """Protect an engine operation whose project argument is named ``paths``.

  Readers that must not observe provisional prose use the same lock. Do not hold
  it across provider/network calls, or acquire Assistant thread locks inside it.
  """
  signature = inspect.signature(operation)

  @wraps(operation)
  def locked(*args: P.args, **kwargs: P.kwargs) -> R:
    from .project import OpenAuthorError, ProjectPaths

    paths = signature.bind(*args, **kwargs).arguments.get("paths")
    if not isinstance(paths, ProjectPaths):
      raise OpenAuthorError("Safe project access requires ProjectPaths.")
    with project_lock(paths):
      return operation(*args, **kwargs)

  return locked
