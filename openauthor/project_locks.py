"""Serialize cooperating book operations across threads and sidecar processes.

Hold the project lock from the first read/precondition through commit or rollback,
not just around individual file writes. Nested operations are reentrant. The lock
file lives outside versioned book state and must never be unlinked on release.
These advisory locks do not coordinate external editors or provide crash recovery.
"""

from __future__ import annotations

import inspect
import os
import stat
import threading
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
  with local_lock:
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
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        acquired = True
      except OSError as error:
        raise OpenAuthorError(f"Could not acquire safe project access: {error}") from error
      _HELD.keys = {*held, key}
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
