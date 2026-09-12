from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from openauthor.project import OpenAuthorError, get_project_paths, initialize_project
from openauthor.project_locks import project_lock, serialized_project_access
from openauthor.scenes import add_scene, get_scene, update_scene


class ProjectLockTests(unittest.TestCase):
  def test_nested_access_and_path_aliases_release_after_an_exception(self) -> None:
    with tempfile.TemporaryDirectory() as directory:
      paths = initialize_project(Path(directory) / "book", name="Book")
      alias = Path(directory) / "alias"
      alias.symlink_to(paths.root, target_is_directory=True)
      other_paths = get_project_paths(alias)
      with self.assertRaisesRegex(RuntimeError, "transaction failed"):
        with project_lock(paths):
          with project_lock(other_paths):
            add_scene(paths=paths, title="Letter", body="Original")
            raise RuntimeError("transaction failed")
      finished = threading.Event()
      errors = []

      def save() -> None:
        try:
          update_scene(other_paths, scene_identifier="scene-0001", body="Saved after exception")
        except BaseException as error:
          errors.append(error)
        finally:
          finished.set()

      writer = threading.Thread(target=save, daemon=True)
      writer.start()
      self.assertTrue(finished.wait(3))
      writer.join(1)
      self.assertEqual(errors, [])
      self.assertEqual(get_scene(paths, "scene-0001")["body"].strip(), "Saved after exception")
      self.assertTrue((paths.workspace_dir / "locks/project.lock").is_file())

  def test_other_projects_can_be_written_while_one_project_is_locked(self) -> None:
    with tempfile.TemporaryDirectory() as directory:
      first = initialize_project(Path(directory) / "first", name="First")
      second = initialize_project(Path(directory) / "second", name="Second")
      done = threading.Event()
      errors = []

      def write_other() -> None:
        try:
          add_scene(second, title="Independent scene", body="Other book")
        except BaseException as error:
          errors.append(error)
        finally:
          done.set()

      writer = threading.Thread(target=write_other, daemon=True)
      with project_lock(first):
        writer.start()
        self.assertTrue(done.wait(3), "Unrelated book was blocked")
      writer.join(1)
      self.assertEqual(errors, [])

  def test_unsupported_host_or_lock_failure_never_runs_the_operation(self) -> None:
    with tempfile.TemporaryDirectory() as directory:
      paths = initialize_project(Path(directory), name="Fail closed")
      for target, value in [
        ("openauthor.project_locks.fcntl", None),
        ("openauthor.project_locks.os.open", PermissionError("Denied")),
      ]:
        with self.subTest(target=target):
          configuration = {"side_effect": value} if isinstance(value, Exception) else {"new": value}
          with patch(target, **configuration):
            with self.assertRaises(OpenAuthorError):
              add_scene(paths, title="Must not be written")
          self.assertEqual(list(paths.scenes_dir.glob("*.md")), [])
      add_scene(paths, title="Lock can be retried")

  def test_decorator_rejects_missing_project_paths(self) -> None:
    @serialized_project_access
    def operation(paths):
      self.fail("Invalid operation ran")

    with self.assertRaisesRegex(OpenAuthorError, "ProjectPaths"):
      operation(paths=Path("not-a-project"))

  def test_process_exit_releases_the_os_lock_without_deleting_its_file(self) -> None:
    with tempfile.TemporaryDirectory() as directory:
      paths = initialize_project(Path(directory), name="Process exit")
      holder = subprocess.Popen([
        sys.executable, "-u", "-c",
        "from pathlib import Path; import sys; "
        "from openauthor.project import get_project_paths; "
        "from openauthor.project_locks import project_lock; "
        "lock = project_lock(get_project_paths(Path(sys.argv[1]))); lock.__enter__(); "
        "print('locked', flush=True); sys.stdin.read()",
        str(paths.root),
      ], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
      writer = None
      try:
        self.assertEqual(holder.stdout.readline().strip(), "locked")
        writer = subprocess.Popen([
          sys.executable, "-u", "-c",
          "from pathlib import Path; import sys; "
          "from openauthor.project import get_project_paths; "
          "from openauthor.scenes import add_scene; print('waiting', flush=True); "
          "add_scene(get_project_paths(Path(sys.argv[1])), title='After crash'); print('saved')",
          str(paths.root),
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.assertEqual(writer.stdout.readline().strip(), "waiting")
        with self.assertRaises(subprocess.TimeoutExpired):
          writer.wait(timeout=0.15)
        holder.kill()
        holder.communicate(timeout=3)
        stdout, stderr = writer.communicate(timeout=3)
        self.assertEqual(writer.returncode, 0, stderr)
        self.assertEqual(stdout.strip(), "saved")
        self.assertTrue((paths.workspace_dir / "locks/project.lock").is_file())
      finally:
        for process in [holder, writer]:
          if process is not None:
            if process.poll() is None:
              process.kill()
            process.communicate(timeout=3)

  @unittest.skipUnless(hasattr(os, "fork"), "Fork ownership applies to POSIX")
  def test_fork_child_does_not_inherit_reentrant_ownership(self) -> None:
    # Run fork in an isolated process so this test runner never inherits a lock
    # or file descriptor from its own active threads.
    result = subprocess.run([
      sys.executable, "-c", "\n".join([
        "import os, select, tempfile",
        "from pathlib import Path",
        "from openauthor.project import initialize_project",
        "from openauthor.project_locks import project_lock",
        "with tempfile.TemporaryDirectory() as directory:",
        "  paths = initialize_project(Path(directory), name='Fork lock')",
        "  read_fd, write_fd = os.pipe()",
        "  with project_lock(paths):",
        "    pid = os.fork()",
        "    if pid == 0:",
        "      os.close(read_fd)",
        "      os.write(write_fd, b'waiting')",
        "      with project_lock(paths):",
        "        os.write(write_fd, b'acquired')",
        "      os._exit(0)",
        "    os.close(write_fd)",
        "    assert os.read(read_fd, 7) == b'waiting'",
        "    assert not select.select([read_fd], [], [], 0.15)[0], 'Child bypassed parent lock'",
        "  assert select.select([read_fd], [], [], 2)[0], 'Child did not resume'",
        "  assert os.read(read_fd, 8) == b'acquired'",
        "  assert os.waitpid(pid, 0)[1] == 0",
        "  os.close(read_fd)",
      ]),
    ], capture_output=True, text=True, timeout=6)
    self.assertEqual(result.returncode, 0, result.stderr)
