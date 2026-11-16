"""Shared helpers for tests that age a book's history and then thin it.

A Revision id includes its timestamp, so history cannot be aged afterwards:
these helpers record Revisions under a clock the test controls instead.
"""

from __future__ import annotations

import hashlib
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Iterator
from unittest.mock import patch

from openauthor import revisions
from openauthor.project import ProjectPaths
from openauthor.revision_retention import compact_revisions
from openauthor.revisions import checkpointed_edit, get_revision, list_revisions, revision_head
from openauthor.scenes import get_scene, update_scene


class HistoryClock:
  """The time Revisions are stamped with while a test builds history."""

  def __init__(self, start: datetime, step: timedelta = timedelta(seconds=1)) -> None:
    self.at = start
    self.step = step
    self.fixed: str | None = None

  def __call__(self) -> str:
    if self.fixed is not None:
      return self.fixed
    stamp = self.at
    self.at += self.step
    return stamp.isoformat()

  def move_to(self, when: datetime) -> None:
    self.at = when


@contextmanager
def recorded_from(start: datetime, step: timedelta = timedelta(seconds=1)) -> Iterator[HistoryClock]:
  clock = HistoryClock(start, step)
  with patch.object(revisions, "utc_now", clock):
    yield clock


def days_ago(days: float, now: datetime | None = None) -> datetime:
  return (now or datetime.now(UTC)) - timedelta(days=days)


def editor_save(paths: ProjectPaths, scene_id: str, sentence: str) -> str:
  """Record what one autosave from the prose editor records."""
  body = get_scene(paths, scene_id)["body"].rstrip("\n") + " " + sentence
  with checkpointed_edit(paths, f"Scene update: {scene_id}"):
    update_scene(paths, scene_identifier=scene_id, body=body)
  return revision_head(paths)


def editor_saves(paths: ProjectPaths, scene_id: str, count: int, label: str = "save") -> list[str]:
  return [editor_save(paths, scene_id, f"{label.capitalize()} {index}.") for index in range(count)]


def history(paths: ProjectPaths) -> list[dict]:
  return list_revisions(paths, limit=1_000_000)


def manifests(paths: ProjectPaths) -> dict[str, dict[str, str]]:
  return {row["id"]: get_revision(paths, row["id"])["manifest"] for row in history(paths)}


def thin(paths: ProjectPaths, *, now: datetime | None = None) -> dict:
  result = compact_revisions(paths, now=now)
  assert result["ran"] and result["complete"], result
  return result


def tree_digest(root: Path, *, exclude: tuple[str, ...] = ()) -> dict[str, str]:
  """Every file under ``root`` by content, except the named relative folders."""
  found: dict[str, str] = {}
  for path in sorted(root.rglob("*")):
    relative = path.relative_to(root).as_posix()
    if not path.is_file() or any(relative == skipped or relative.startswith(skipped + "/") for skipped in exclude):
      continue
    found[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
  return found


@contextmanager
def old_history(days: float = 40) -> Iterator[HistoryClock]:
  """Record everything done inside as if it happened ``days`` ago."""
  with recorded_from(days_ago(days)) as clock:
    yield clock


def thin_today(paths: ProjectPaths) -> dict:
  """Thin a history built under ``old_history``; it must lose something.

  Ages are measured from the book's latest Revision, so a version is named
  today first. That changes no book file.
  """
  revisions.create_revision(paths, "Today")
  result = thin(paths)
  assert result["removed_revisions"] > 0, result
  return result
