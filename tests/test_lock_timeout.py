from __future__ import annotations

import io
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

from openauthor.cli import main
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.project_locks import DEFAULT_LOCK_TIMEOUT_MS, _lock_timeout_seconds, project_lock
from openauthor.scenes import add_scene, list_scenes

HOLDER = (
  "from pathlib import Path; import sys; "
  "from openauthor.project import get_project_paths; "
  "from openauthor.project_locks import project_lock; "
  "lock = project_lock(get_project_paths(Path(sys.argv[1]))); lock.__enter__(); "
  "print('locked', flush=True); sys.stdin.read()"
)


class LockTimeoutTests(unittest.TestCase):
  def setUp(self) -> None:
    self.directory = tempfile.TemporaryDirectory()
    self.addCleanup(self.directory.cleanup)
    self.paths = initialize_project(Path(self.directory.name), name="Bounded wait")
    add_scene(self.paths, title="Opening", body="Mara waits.")

  def _hold_in_another_process(self) -> subprocess.Popen:
    holder = subprocess.Popen(
      [sys.executable, "-u", "-c", HOLDER, str(self.paths.root)],
      stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
      env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])},
    )
    self.addCleanup(self._stop, holder)
    self.assertEqual(holder.stdout.readline().strip(), "locked")
    return holder

  @staticmethod
  def _stop(process: subprocess.Popen) -> None:
    if process.poll() is None:
      process.kill()
    process.wait(timeout=3)
    for stream in (process.stdin, process.stdout, process.stderr):
      if stream is not None and not stream.closed:
        stream.close()

  def test_waiter_gives_up_with_a_clear_error_and_never_runs_its_operation(self) -> None:
    self._hold_in_another_process()
    started = time.monotonic()
    with patch.dict(os.environ, {"OPENAUTHOR_LOCK_TIMEOUT_MS": "250"}):
      with self.assertRaisesRegex(OpenAuthorError, "Another openAuthor operation on this book is still running"):
        add_scene(self.paths, title="Must not be written")
    waited = time.monotonic() - started
    self.assertGreaterEqual(waited, 0.25)
    self.assertLess(waited, 3)
    self.assertEqual([path.name for path in self.paths.scenes_dir.glob("*.md")], ["0001-opening.md"])

  def test_waiter_that_gets_the_lock_within_the_timeout_succeeds(self) -> None:
    holder = self._hold_in_another_process()
    releaser = threading.Timer(0.3, lambda: holder.stdin.close())
    releaser.start()
    self.addCleanup(releaser.cancel)
    started = time.monotonic()
    with patch.dict(os.environ, {"OPENAUTHOR_LOCK_TIMEOUT_MS": "10000"}):
      add_scene(self.paths, title="Written after the wait")
    self.assertLess(time.monotonic() - started, 5)
    self.assertEqual([row["title"] for row in list_scenes(self.paths)], ["Opening", "Written after the wait"])

  def test_lock_can_be_taken_again_after_a_timeout(self) -> None:
    holder = self._hold_in_another_process()
    with patch.dict(os.environ, {"OPENAUTHOR_LOCK_TIMEOUT_MS": "50"}):
      with self.assertRaises(OpenAuthorError):
        list_scenes(self.paths)
      self._stop(holder)
      self.assertEqual(len(list_scenes(self.paths)), 1)

  def test_thread_in_the_same_process_is_bounded_too(self) -> None:
    entered, release = threading.Event(), threading.Event()

    def hold() -> None:
      with project_lock(self.paths):
        entered.set()
        release.wait(5)

    holder = threading.Thread(target=hold, daemon=True)
    holder.start()
    self.assertTrue(entered.wait(3))
    try:
      with patch.dict(os.environ, {"OPENAUTHOR_LOCK_TIMEOUT_MS": "150"}):
        with self.assertRaisesRegex(OpenAuthorError, "still running"):
          list_scenes(self.paths)
    finally:
      release.set()
      holder.join(3)
    self.assertEqual(len(list_scenes(self.paths)), 1)

  def test_reentrant_and_uncontended_access_never_wait(self) -> None:
    with patch.dict(os.environ, {"OPENAUTHOR_LOCK_TIMEOUT_MS": "0"}):
      started = time.monotonic()
      with project_lock(self.paths):
        with project_lock(self.paths):
          add_scene(self.paths, title="Nested")
      self.assertLess(time.monotonic() - started, 1)
    self.assertEqual(len(list_scenes(self.paths)), 2)

  def test_timeout_setting_defaults_to_thirty_seconds_and_ignores_bad_values(self) -> None:
    self.assertEqual(DEFAULT_LOCK_TIMEOUT_MS, 30_000)
    for value, expected in (("", 30.0), ("soon", 30.0), ("-5", 30.0), ("1500", 1.5), ("0", 0.0)):
      with self.subTest(value=value), patch.dict(os.environ, {"OPENAUTHOR_LOCK_TIMEOUT_MS": value}):
        self.assertEqual(_lock_timeout_seconds(), expected)
    with patch.dict(os.environ, {}, clear=True):
      self.assertEqual(_lock_timeout_seconds(), 30.0)

  def test_cli_reports_a_busy_book_as_one_error_line(self) -> None:
    self._hold_in_another_process()
    previous = Path.cwd()
    os.chdir(self.paths.root)
    self.addCleanup(os.chdir, previous)
    stdout, stderr = io.StringIO(), io.StringIO()
    with patch.dict(os.environ, {"OPENAUTHOR_LOCK_TIMEOUT_MS": "100"}), redirect_stdout(stdout), redirect_stderr(stderr):
      code = main(["scene", "list", "--json"])
    self.assertEqual(code, 2)
    self.assertEqual(stdout.getvalue(), "")
    self.assertEqual(len(stderr.getvalue().strip().splitlines()), 1)
    self.assertIn("error: Another openAuthor operation on this book is still running", stderr.getvalue())


if __name__ == "__main__":
  unittest.main()
