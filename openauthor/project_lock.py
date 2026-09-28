from __future__ import annotations

import threading
from contextlib import contextmanager

from .project import ProjectPaths

_guard = threading.Lock()
_locks: dict[str, threading.RLock] = {}
_local = threading.local()


@contextmanager
def project_write_lock(paths: ProjectPaths):
  """Serialize book edits across desktop command processes and sidecar threads."""
  key = str(paths.root.resolve())
  with _guard:
    lock = _locks.setdefault(key, threading.RLock())
  with lock:
    held = getattr(_local, "held", set())
    if key in held:
      yield
      return
    lock_path = paths.workspace_dir / "book-write.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+b") as handle:
      import os
      if os.name == "nt":
        import msvcrt
        if handle.seek(0, 2) == 0:
          handle.write(b"\0")
          handle.flush()
        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
      else:
        import fcntl
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
      _local.held = held | {key}
      try:
        yield
      finally:
        _local.held = held
        if os.name == "nt":
          handle.seek(0)
          msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
          fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
