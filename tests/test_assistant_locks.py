from __future__ import annotations

import tempfile
import threading
import time
import unittest
from pathlib import Path

from openauthor.assistant.locks import AssistantThreadLocks
from openauthor.project import initialize_project


class AssistantThreadLockTests(unittest.TestCase):
  def test_same_thread_serializes_while_different_threads_remain_independent(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Assistant Thread Locks")
      locks = AssistantThreadLocks(paths)
      first_entered = threading.Event()
      release_first = threading.Event()
      same_entered = threading.Event()
      other_entered = threading.Event()

      def hold_first() -> None:
        with locks.acquire("chat-one"):
          first_entered.set()
          release_first.wait(timeout=2)

      def enter_same() -> None:
        first_entered.wait(timeout=2)
        with locks.acquire("chat-one"):
          same_entered.set()

      def enter_other() -> None:
        first_entered.wait(timeout=2)
        with locks.acquire("chat-two"):
          other_entered.set()

      first = threading.Thread(target=hold_first)
      same = threading.Thread(target=enter_same)
      other = threading.Thread(target=enter_other)
      first.start()
      same.start()
      other.start()

      self.assertTrue(first_entered.wait(timeout=1))
      self.assertTrue(other_entered.wait(timeout=1))
      time.sleep(0.02)
      self.assertFalse(same_entered.is_set())

      release_first.set()
      first.join(timeout=2)
      same.join(timeout=2)
      other.join(timeout=2)
      self.assertTrue(same_entered.is_set())


if __name__ == "__main__":
  unittest.main()
