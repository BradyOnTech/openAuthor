"""Cross-process keyed locks for Assistant thread mutations."""

from __future__ import annotations

import hashlib
import inspect
import os
import threading
from contextlib import contextmanager
from functools import wraps
from pathlib import Path
from typing import Any, Callable, Iterator, ParamSpec, TypeVar, cast

from ..project import OpenAuthorError, ProjectPaths

try:
  import fcntl
except ImportError:  # pragma: no cover - only non-POSIX hosts
  fcntl = None  # type: ignore[assignment]


_PROCESS_LOCKS: dict[str, threading.RLock] = {}
_PROCESS_LOCKS_GUARD = threading.Lock()
_HELD_LOCKS = threading.local()
P = ParamSpec("P")
R = TypeVar("R")


def _process_lock(key: str) -> threading.RLock:
  with _PROCESS_LOCKS_GUARD:
    return _PROCESS_LOCKS.setdefault(key, threading.RLock())


class AssistantThreadLocks:
  """Serialize mutations per chat thread without blocking unrelated threads."""

  def __init__(self, paths: ProjectPaths) -> None:
    self._locks_dir = paths.chats_dir / "locks" / "threads"

  def _lock_path(self, thread_id: str) -> Path:
    normalized = thread_id.strip()
    if normalized == "":
      raise OpenAuthorError("thread_id cannot be empty.")
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    return self._locks_dir / f"{digest}.lock"

  @contextmanager
  def acquire(self, thread_id: str) -> Iterator[None]:
    lock_path = self._lock_path(thread_id)
    lock_key = str(lock_path.resolve())
    process_lock = _process_lock(lock_key)
    with process_lock:
      held = getattr(_HELD_LOCKS, "keys", set())
      if lock_key in held:
        yield
        return

      lock_path.parent.mkdir(parents=True, exist_ok=True)
      descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
      try:
        if fcntl is not None:
          fcntl.flock(descriptor, fcntl.LOCK_EX)
        _HELD_LOCKS.keys = {*held, lock_key}
        yield
      finally:
        _HELD_LOCKS.keys = held
        if fcntl is not None:
          fcntl.flock(descriptor, fcntl.LOCK_UN)
        os.close(descriptor)


def serialize_assistant_thread_mutation(
  operation: Callable[P, R],
) -> Callable[P, R]:
  """Run a function holding the lock named by its paths and thread_id arguments."""

  signature = inspect.signature(operation)

  @wraps(operation)
  def locked(*args: P.args, **kwargs: P.kwargs) -> R:
    bound = signature.bind(*args, **kwargs)
    paths = bound.arguments.get("paths")
    thread_id = str(bound.arguments.get("thread_id", ""))
    if not isinstance(paths, ProjectPaths):
      raise OpenAuthorError("Assistant thread mutation requires ProjectPaths.")
    with AssistantThreadLocks(paths).acquire(thread_id):
      return operation(*args, **kwargs)

  return cast(Callable[P, R], locked)
