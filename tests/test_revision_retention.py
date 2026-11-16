from __future__ import annotations

import fcntl
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import UTC, datetime, timedelta
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from openauthor import revision_retention as retention
from openauthor import revisions
from openauthor.cli import main
from openauthor.planning import update_brief
from openauthor.project import OpenAuthorError, ProjectPaths, atomic_write_json, get_project_paths, initialize_project
from openauthor.proposals import apply_proposal, create_proposal, get_proposal, set_proposal_draft
from openauthor.retrieval import build_retrieval_index
from openauthor.revision_retention import compact_revisions, load_policy, retention_status, update_policy
from openauthor.revisions import (
  checkpointed_edit,
  compare_revisions,
  create_revision,
  get_revision,
  read_file_at_revision,
  restore_revision,
  revision_head,
  revision_retrospective,
  verify_revision_store,
)
from openauthor.scenes import add_scene, find_scene_file, get_scene, update_scene
from openauthor.storylines import create_storyline, switch_storyline

try:
  from retention_support import editor_save, editor_saves, history, manifests, recorded_from, thin, tree_digest
  from test_revision_store_format import legacy_create_revision, prose
except ImportError:
  from tests.retention_support import editor_save, editor_saves, history, manifests, recorded_from, thin, tree_digest
  from tests.test_revision_store_format import legacy_create_revision, prose

NOW = datetime(2026, 11, 16, 12, 0, tzinfo=UTC)
SCENE = "scene-0001"


def at(days_back: int, hour: int, minute: int = 0) -> datetime:
  """A moment ``days_back`` days before NOW's date, at the given UTC time."""
  return datetime(2026, 11, 16, hour, minute, tzinfo=UTC) - timedelta(days=days_back)


def record_ids(paths: ProjectPaths) -> set[str]:
  return {path.stem for path in paths.revision_records_dir.glob("*.json")}


def object_files(paths: ProjectPaths) -> set[str]:
  return {path.relative_to(paths.revision_objects_dir).as_posix() for path in paths.revision_objects_dir.rglob("*") if path.is_file()}


def raw_record(paths: ProjectPaths, revision_id: str) -> dict:
  return json.loads((paths.revision_records_dir / f"{revision_id}.json").read_text(encoding="utf-8"))


class RetentionCase(unittest.TestCase):
  def setUp(self) -> None:
    directory = tempfile.TemporaryDirectory()
    self.addCleanup(directory.cleanup)
    self.root = Path(directory.name).resolve() / "book"
    self.paths = initialize_project(self.root, name="Thinned book")

  def start(self, clock, scenes: int = 2) -> str:
    """A book with a named first version, recorded long ago."""
    clock.move_to(at(200, 8))
    for index in range(1, scenes + 1):
      add_scene(self.paths, title=f"Chapter {index}", body=prose(index, 120))
    return create_revision(self.paths, "First version")

  def recent_head(self, clock) -> str:
    """A save from just before NOW, so ages are measured from NOW."""
    clock.move_to(NOW - timedelta(minutes=5))
    return editor_save(self.paths, SCENE, "Today's sentence.")

  def saves_at(self, clock, moments: list[datetime], label: str) -> list[str]:
    ids = []
    for index, moment in enumerate(moments):
      clock.move_to(moment)
      ids.append(editor_save(self.paths, SCENE, f"{label} {index}."))
    return ids

  def assert_store_sound(self, paths: ProjectPaths | None = None, expected: dict[str, dict[str, str]] | None = None) -> None:
    """Every record on disk rebuilds its manifest and every object reads."""
    paths = paths or self.paths
    self.assertEqual(verify_revision_store(paths)["errors"], [])
    for revision_id in record_ids(paths):
      record = get_revision(paths, revision_id)
      if expected is not None and revision_id in expected:
        self.assertEqual(record["manifest"], expected[revision_id], revision_id)
      for relative, digest in record["manifest"].items():
        revisions._read_object(paths, digest, relative)


class RetentionPolicyTests(RetentionCase):
  def test_recent_work_is_untouched_and_older_saves_thin_to_hourly_then_daily(self) -> None:
    with recorded_from(at(200, 8)) as clock:
      first = self.start(clock)
      ancient = self.saves_at(clock, [at(120, 9, 5), at(120, 9, 25), at(120, 9, 50), at(120, 10, 10), at(120, 14, 0)], "Ancient")
      old = self.saves_at(clock, [at(30, 9, 5), at(30, 9, 25), at(30, 9, 50), at(30, 10, 10), at(30, 10, 40)], "Old")
      recent = self.saves_at(clock, [at(3, 9, 5), at(3, 9, 6), at(3, 9, 7), at(3, 9, 8)], "Recent")
      head = self.recent_head(clock)
    before = manifests(self.paths)
    result = thin(self.paths, now=NOW)

    # Beyond 90 days: the last save of the day. Beyond 7: the last of each hour.
    expected = [first, ancient[4], old[2], old[4], *recent, head]
    self.assertEqual([row["id"] for row in reversed(history(self.paths))], expected)
    self.assertEqual(record_ids(self.paths), set(expected))
    self.assertEqual(result["removed_revisions"], 7)
    self.assertEqual(result["kept_revisions"], len(expected))
    self.assertGreater(result["removed_objects"], 0)
    self.assertGreater(result["freed_allocated_bytes"], 0)
    self.assert_store_sound(expected=before)

  def test_survivors_keep_their_ids_manifests_order_and_a_working_previous_version(self) -> None:
    with recorded_from(at(200, 8)) as clock:
      first = self.start(clock)
      old = self.saves_at(clock, [at(30, 9, minute) for minute in (1, 9, 17, 25, 33)], "Old")
      head = self.recent_head(clock)
    before = manifests(self.paths)
    texts = {revision_id: read_file_at_revision(self.paths, revision_id, self.scene_path()) for revision_id in before}
    survivor = old[-1]
    original = raw_record(self.paths, survivor)
    thin(self.paths, now=NOW)

    after = history(self.paths)
    self.assertEqual([row["id"] for row in after], [head, survivor, first])
    for row in after:
      self.assertEqual(get_revision(self.paths, row["id"])["manifest"], before[row["id"]])
      self.assertEqual(read_file_at_revision(self.paths, row["id"], self.scene_path()), texts[row["id"]])

    # The id is still the hash of what it always was: the recorded parent is
    # kept as written, and history continues at a separate ancestor.
    stored = raw_record(self.paths, survivor)
    self.assertEqual(stored["schema_version"], 3)
    self.assertEqual(stored["parent"], original["parent"])
    self.assertEqual(stored["parent"], old[-2])
    self.assertEqual(stored["ancestor"], first)
    self.assertEqual(stored["thinned"], 4)
    self.assertEqual(stored["metadata"], original["metadata"])
    self.assertEqual(revisions._identity(stored, stored["manifest"]), survivor)
    self.assertEqual(revisions._identity(stored, before[survivor]), survivor)

    # Callers see the nearest version that still exists as the previous one.
    row = get_revision(self.paths, survivor)
    self.assertEqual((row["parent"], row["recorded_parent"], row["thinned"]), (first, old[-2], 4))
    self.assertEqual(after[1]["parent"], first)
    comparison = compare_revisions(self.paths, row["parent"], survivor)
    self.assertEqual([file["path"] for file in comparison["files"]], [self.scene_path()])
    self.assertIn("Old 4.", comparison["files"][0]["after"])
    self.assertNotIn("Old 0.", comparison["files"][0]["before"])
    retrospective = revision_retrospective(self.paths, row["parent"], survivor)
    self.assertEqual(len(retrospective["changed_scenes"]), 1)
    self.assertGreater(retrospective["word_count_delta"], 0)
    # A save recorded after a relinked version reads through it normally.
    self.assertEqual(get_revision(self.paths, head)["parent"], survivor)
    later = editor_save(self.paths, SCENE, "Written after thinning.")
    self.assertEqual(get_revision(self.paths, later)["parent"], head)
    self.assert_store_sound(expected=before)

  def scene_path(self) -> str:
    return find_scene_file(self.paths, SCENE).relative_to(self.paths.root).as_posix()

  def test_a_thinned_run_never_crosses_a_kept_revision(self) -> None:
    with recorded_from(at(200, 8)) as clock:
      self.start(clock)
      proposal = create_proposal(self.paths, title="Tighten", instruction="Tighten", scene_id="scene-0002")
      set_proposal_draft(self.paths, proposal_id=proposal, proposed_body="A rewritten second chapter.")
      clock.move_to(at(30, 9, 1))
      early = editor_saves(self.paths, SCENE, 3, "early")
      applied = apply_proposal(self.paths, proposal_id=proposal)
      middle = editor_saves(self.paths, SCENE, 3, "middle")
      named = create_revision(self.paths, "Before the rewrite")
      late = editor_saves(self.paths, SCENE, 3, "late")
      self.recent_head(clock)
    before = manifests(self.paths)
    thin(self.paths, now=NOW)

    # All nine saves fall in one clock hour, but each run between kept
    # Revisions keeps its own last save.
    kept = record_ids(self.paths)
    self.assertTrue({early[2], middle[2], late[2], named, applied["pre_apply_snapshot"], applied["applied_revision"]} <= kept)
    self.assertFalse({early[0], early[1], middle[0], middle[1], late[0], late[1]} & kept)
    # The state immediately before each kept Revision is its untouched parent.
    self.assertEqual(get_revision(self.paths, applied["pre_apply_snapshot"])["parent"], early[2])
    self.assertEqual(raw_record(self.paths, applied["pre_apply_snapshot"])["schema_version"], 2)
    self.assertEqual(get_revision(self.paths, named)["parent"], middle[2])
    # The save after a kept Revision now follows it directly. Applying left
    # Story Memory refreshed, which the next save recorded first; that
    # snapshot of a change made outside the editor is kept as well.
    snapshot = get_revision(self.paths, middle[2])
    self.assertEqual(get_revision(self.paths, snapshot["parent"])["kind"], "author_edit_before")
    self.assertEqual(get_revision(self.paths, snapshot["parent"])["parent"], applied["applied_revision"])
    self.assertEqual((snapshot["recorded_parent"], snapshot["thinned"]), (middle[1], 2))
    self.assertEqual(get_revision(self.paths, late[2])["parent"], named)
    self.assert_store_sound(expected=before)

  def test_only_editor_saves_are_ever_removed(self) -> None:
    kinds = [
      ("manual", "A named version"), ("change_set_before", "Before applying"), ("change_set_apply", "Apply"),
      ("change_set_undo", "Undo"), ("change_group_before", "Before group"), ("change_group_apply", "Apply group"),
      ("change_group_undo", "Undo group"), ("restore_before", "Before Restore"), ("restore", "Restore"),
      ("manuscript_import_before", "Before Import"), ("manuscript_import", "Import novel.docx"), ("backup", "Portable backup"),
      ("author_edit_before", "Before Scene update: scene-0001"), ("author_edit", "Plan brief"), ("author_edit", "Memory fact-add"),
      ("author_edit", "Scene add: New chapter"), ("a_kind_from_the_future", "Scene update: scene-0001"),
    ]
    kept: list[str] = []
    saves: list[list[str]] = []
    with recorded_from(at(200, 8)) as clock:
      kept.append(self.start(clock))
      clock.move_to(at(120, 9, 1))
      for index, (kind, message) in enumerate(kinds):
        saves.append(editor_saves(self.paths, SCENE, 2, f"before {index}"))
        update_scene(self.paths, scene_identifier="scene-0002", body=prose(50 + index, 60))
        kept.append(create_revision(self.paths, message, kind=kind))
      saves.append(editor_saves(self.paths, SCENE, 2, "after"))
      kept.append(self.recent_head(clock))
    before = manifests(self.paths)
    untouched = {revision_id: (self.paths.revision_records_dir / f"{revision_id}.json").read_bytes() for revision_id in kept}
    result = thin(self.paths, now=NOW)

    remaining = record_ids(self.paths)
    self.assertTrue(set(kept) <= remaining)
    # Every run of saves lost its first save and kept its last, even beyond 90 days.
    self.assertEqual(remaining - set(kept), {pair[1] for pair in saves})
    self.assertEqual(result["removed_revisions"], len(saves))
    # Nothing but an editor save is rewritten either.
    for revision_id, content in untouched.items():
      self.assertEqual((self.paths.revision_records_dir / f"{revision_id}.json").read_bytes(), content, revision_id)
    self.assert_store_sound(expected=before)

  def test_a_storyline_switch_keeps_the_state_on_both_sides(self) -> None:
    with recorded_from(at(200, 8)) as clock:
      self.start(clock)
      clock.move_to(at(30, 9, 1))
      editor_saves(self.paths, SCENE, 3, "primary")
      storyline = create_storyline(self.paths, name="Darker ending", hypothesis="The ending lands harder.")
      on_branch = editor_saves(self.paths, SCENE, 3, "branch")
      switch_storyline(self.paths, primary=True)
      back = editor_saves(self.paths, SCENE, 3, "back")
      self.recent_head(clock)
    rows = {row["id"]: row for row in history(self.paths)}
    # The switch itself records nothing; the next save snapshots what it found.
    arrived = get_revision(self.paths, back[0])["metadata"]["before_revision"]
    self.assertEqual(rows[arrived]["kind"], "author_edit_before")
    self.assertEqual(rows[arrived]["parent"], on_branch[2])
    self.assertTrue(storyline["base_revision"])
    before = manifests(self.paths)
    thin(self.paths, now=NOW)

    kept = record_ids(self.paths)
    self.assertTrue({on_branch[2], arrived, storyline["base_revision"], back[2]} <= kept)
    self.assertEqual(get_revision(self.paths, arrived)["parent"], on_branch[2])
    self.assertFalse({on_branch[0], on_branch[1], back[0], back[1]} & kept)
    self.assert_store_sound(expected=before)

  def test_a_revision_something_else_points_at_is_kept(self) -> None:
    pins: dict[str, str] = {}
    with recorded_from(at(200, 8)) as clock:
      self.start(clock)
      clock.move_to(at(30, 9, 1))
      saves = editor_saves(self.paths, SCENE, 3, "a")
      # A Change Set remembers the version it was written against.
      proposal = create_proposal(self.paths, title="Later", instruction="Revise", scene_id="scene-0002")
      pins["proposal"] = saves[-1]
      self.assertEqual(get_proposal(self.paths, proposal)["vcs_base_commit"], saves[-1])
      saves += editor_saves(self.paths, SCENE, 3, "b")
      saves += editor_saves(self.paths, SCENE, 3, "c")
      build_retrieval_index(self.paths)
      pins["retrieval index"] = saves[-1]
      saves += editor_saves(self.paths, SCENE, 3, "d")
      # A phone's queued change names the version it was based on.
      atomic_write_json(self.paths.workspace_dir / "mobile-outbox" / "imports" / "op-1.json", {"base_revision": saves[-3], "imported_revision": saves[-2]})
      pins["mobile base"], pins["mobile import"] = saves[-3], saves[-2]
      saves += editor_saves(self.paths, SCENE, 3, "e")
      # Anything else under the project's own folders counts too.
      (self.paths.project_dir / "notes-for-a-later-feature.txt").write_text(f"compare against {saves[-3]}\n", encoding="utf-8")
      pins["unknown file"] = saves[-3]
      saves += editor_saves(self.paths, SCENE, 3, "f")
      restored_from = saves[-3]
      restore_revision(self.paths, restored_from, relative_paths=[find_scene_file(self.paths, SCENE).relative_to(self.paths.root).as_posix()])
      pins["restored_from in Revision metadata"] = restored_from
      tail = editor_saves(self.paths, SCENE, 3, "g")
      self.recent_head(clock)
    before = manifests(self.paths)
    self.assertEqual(len(set(pins.values())), len(pins))
    thin(self.paths, now=NOW)

    kept = record_ids(self.paths)
    for holder, revision_id in pins.items():
      self.assertIn(revision_id, kept, holder)
    # Without those references the same saves go: only the hour's last stays.
    self.assertNotIn(tail[0], kept)
    self.assertNotIn(saves[0], kept)
    self.assertEqual(get_proposal(self.paths, proposal)["vcs_base_commit"], pins["proposal"])
    restore_revision(self.paths, restored_from, relative_paths=[find_scene_file(self.paths, SCENE).relative_to(self.paths.root).as_posix()])
    self.assert_store_sound(expected=before)

  def test_a_record_outside_the_listed_history_keeps_what_it_reads_through(self) -> None:
    with recorded_from(at(200, 8)) as clock:
      self.start(clock)
      clock.move_to(at(30, 9, 1))
      saves = editor_saves(self.paths, SCENE, 3, "a")
      # A rolled-back operation leaves its record behind, off the history.
      # Nothing names saves[2] except that record, which reads through it.
      head = self.paths.revision_head_file.read_text(encoding="utf-8")
      orphan = create_revision(self.paths, "Apply that was rolled back", kind="change_set_apply")
      self.paths.revision_head_file.write_text(head, encoding="utf-8")
      saves += editor_saves(self.paths, SCENE, 3, "b")
      self.recent_head(clock)
    self.assertEqual(raw_record(self.paths, orphan)["manifest_delta"]["changed"], {})
    self.assertNotIn(orphan, {row["id"] for row in history(self.paths)})
    self.assertEqual({row["kind"] for row in history(self.paths)}, {"manual", "author_edit"})
    before = get_revision(self.paths, orphan)["manifest"]
    thin(self.paths, now=NOW)
    kept = record_ids(self.paths)
    # saves[2] therefore stays, and so does the save just before it, as
    # before any kept Revision.
    self.assertTrue({orphan, saves[1], saves[2], saves[5]} <= kept)
    self.assertFalse({saves[0], saves[3], saves[4]} & kept)
    self.assertEqual(get_revision(self.paths, orphan)["manifest"], before)
    self.assertEqual(get_revision(self.paths, orphan)["parent"], saves[2])
    self.assert_store_sound()

  def test_untrustworthy_timestamps_are_kept(self) -> None:
    with recorded_from(at(200, 8)) as clock:
      self.start(clock)
      clock.move_to(at(30, 9, 1))
      a = editor_saves(self.paths, SCENE, 2, "a")
      clock.fixed = ""
      missing = editor_save(self.paths, SCENE, "No time.")
      clock.fixed = None
      b = editor_saves(self.paths, SCENE, 2, "b")
      clock.fixed = "sometime last spring"
      unparseable = editor_save(self.paths, SCENE, "Odd time.")
      clock.fixed = "2026-10-17T09:30:00"
      no_zone = editor_save(self.paths, SCENE, "No zone.")
      clock.fixed = None
      c = editor_saves(self.paths, SCENE, 2, "c")
      clock.fixed = (NOW + timedelta(days=400)).isoformat()
      future = editor_save(self.paths, SCENE, "From a wrong clock.")
      clock.fixed = None
      d = editor_saves(self.paths, SCENE, 2, "d")
      self.recent_head(clock)
    thin(self.paths, now=NOW)
    kept = record_ids(self.paths)
    self.assertTrue({missing, unparseable, no_zone, future} <= kept)
    # They also end the run of saves on either side.
    self.assertTrue({a[1], b[1], c[1], d[1]} <= kept)
    self.assertFalse({a[0], b[0], c[0], d[0]} & kept)
    self.assert_store_sound()

  def test_ages_are_measured_from_the_latest_save_not_a_clock_that_ran_ahead(self) -> None:
    with recorded_from(at(200, 8)) as clock:
      self.start(clock)
      clock.move_to(at(3, 9, 1))
      editor_saves(self.paths, SCENE, 6, "recent")
    before = record_ids(self.paths)
    # A computer whose clock says next year must not thin last week's work.
    result = thin(self.paths, now=NOW + timedelta(days=365))
    self.assertEqual(result["removed_revisions"], 0)
    self.assertEqual(record_ids(self.paths), before)

  def test_objects_go_only_when_nothing_that_stays_needs_them(self) -> None:
    with recorded_from(at(200, 8)) as clock:
      self.start(clock)
      clock.move_to(at(30, 9, 1))
      with checkpointed_edit(self.paths, f"Scene update: {SCENE}"):
        update_scene(self.paths, scene_identifier=SCENE, body=prose(7, 900))
      whole = revision_head(self.paths)
      small = editor_saves(self.paths, SCENE, 4, "small")
      self.recent_head(clock)
    relative = find_scene_file(self.paths, SCENE).relative_to(self.paths.root).as_posix()
    base = get_revision(self.paths, whole)["manifest"][relative]
    kept_digest = get_revision(self.paths, small[-1])["manifest"][relative]
    gone_digest = get_revision(self.paths, small[0])["manifest"][relative]
    # The surviving save is stored against the removed save's object.
    self.assertEqual(revisions._object_base(self.paths, kept_digest), base)
    self.assertEqual(revisions._object_base(self.paths, gone_digest), base)
    text = read_file_at_revision(self.paths, small[-1], relative)
    thin(self.paths, now=NOW)

    self.assertNotIn(whole, record_ids(self.paths))
    stored = object_files(self.paths)
    self.assertIn(f"{base[:2]}/{base[2:]}.z", stored)
    self.assertIn(f"{kept_digest[:2]}/{kept_digest[2:]}.z", stored)
    self.assertNotIn(f"{gone_digest[:2]}/{gone_digest[2:]}.z", stored)
    self.assertEqual(read_file_at_revision(self.paths, small[-1], relative), text)
    # Every object left is used by a Revision that is left, or is such a base.
    used = {digest for revision_id in record_ids(self.paths) for digest in get_revision(self.paths, revision_id)["manifest"].values()}
    bases = {revisions._object_base(self.paths, digest) for digest in used}
    for name in stored:
      self.assertIn(name.replace("/", "").removesuffix(".z"), used | bases)
    self.assert_store_sound()

  def test_format_1_history_in_a_thinned_run(self) -> None:
    def legacy_save(sentence: str) -> str:
      body = get_scene(self.paths, SCENE)["body"].rstrip("\n") + " " + sentence
      update_scene(self.paths, scene_identifier=SCENE, body=body)
      return legacy_create_revision(self.paths, f"Scene update: {SCENE}", kind="author_edit", metadata={"edit_transaction_id": "x"})

    module = sys.modules[legacy_create_revision.__module__]
    with recorded_from(at(200, 8)) as clock, patch.object(module, "utc_now", clock):
      first = self.start(clock)
      clock.move_to(at(30, 9, 1))
      legacy = [legacy_save(f"Legacy {index}.") for index in range(4)]
      named = legacy_create_revision(self.paths, "Old named version")
      mixed = [legacy_save("Legacy tail."), *editor_saves(self.paths, SCENE, 2, "modern")]
      self.recent_head(clock)
    before = manifests(self.paths)
    named_bytes = (self.paths.revision_records_dir / f"{named}.json").read_bytes()
    plain = {name for name in object_files(self.paths) if not name.endswith(".z")}
    self.assertTrue(plain)
    thin(self.paths, now=NOW)

    kept = record_ids(self.paths)
    # Old-format saves are thinned like any other; the one that stays is
    # relinked with its manifest unchanged. Its id never could be recomputed.
    self.assertFalse(set(legacy[:3]) & kept)
    survivor = raw_record(self.paths, legacy[3])
    self.assertEqual((survivor["schema_version"], survivor["ancestor"], survivor["nonce"], survivor["thinned"]), (3, first, "", 3))
    self.assertEqual(survivor["manifest"], before[legacy[3]])
    # An old-format Revision that is not an editor save is byte-for-byte as it was.
    self.assertEqual((self.paths.revision_records_dir / f"{named}.json").read_bytes(), named_bytes)
    self.assertNotIn(mixed[0], kept)
    self.assertEqual(get_revision(self.paths, mixed[2])["parent"], named)
    # Plain objects nothing uses any more are removed too.
    self.assertLess(len({name for name in object_files(self.paths) if not name.endswith(".z")}), len(plain))
    self.assert_store_sound(expected=before)

  def test_hourly_survivors_thin_again_to_daily_once_they_are_old_enough(self) -> None:
    with recorded_from(at(200, 8)) as clock:
      first = self.start(clock)
      old = self.saves_at(clock, [at(80, 9, 5), at(80, 9, 50), at(80, 10, 10), at(80, 10, 40), at(80, 11, 20)], "Old")
      head = self.recent_head(clock)
    before = manifests(self.paths)
    thin(self.paths, now=NOW)
    self.assertEqual(record_ids(self.paths), {first, old[1], old[3], old[4], head})
    self.assertEqual(thin(self.paths, now=NOW)["removed_revisions"], 0)

    with recorded_from(NOW + timedelta(days=20)) as clock:
      later = editor_save(self.paths, SCENE, "Three weeks on.")
    result = thin(self.paths, now=NOW + timedelta(days=20, minutes=5))
    self.assertEqual(result["removed_revisions"], 2)
    self.assertEqual(record_ids(self.paths), {first, old[4], head, later})
    survivor = raw_record(self.paths, old[4])
    self.assertEqual((survivor["ancestor"], survivor["thinned"], survivor["parent"]), (first, 4, old[3]))
    self.assertEqual(get_revision(self.paths, old[4])["manifest"], before[old[4]])
    self.assert_store_sound(expected=before)


class RetentionSafetyTests(RetentionCase):
  def build(self, saves: int = 9) -> dict[str, dict[str, str]]:
    """Old saves across three hours around a named version and a Change Set."""
    with recorded_from(at(200, 8)) as clock:
      self.start(clock)
      for hour in (9, 10, 11):
        clock.move_to(at(30, hour, 1))
        editor_saves(self.paths, SCENE, saves // 3, f"hour {hour}")
        if hour == 9:
          create_revision(self.paths, "Named in the middle")
        if hour == 10:
          proposal = create_proposal(self.paths, title="Tighten", instruction="Tighten", scene_id="scene-0002")
          set_proposal_draft(self.paths, proposal_id=proposal, proposed_body="A rewritten second chapter.")
          apply_proposal(self.paths, proposal_id=proposal)
        editor_saves(self.paths, SCENE, saves // 3, f"hour {hour} later")
      self.recent_head(clock)
    return manifests(self.paths)

  def test_dry_run_changes_nothing_and_reports_exactly_what_a_run_removes(self) -> None:
    self.build()
    update_policy(self.paths, enabled=True)
    before = tree_digest(self.root)
    stamps = {path: path.stat().st_mtime_ns for path in self.root.rglob("*") if path.is_file()}
    dry = compact_revisions(self.paths, dry_run=True, now=NOW)
    self.assertEqual(tree_digest(self.root), before)
    self.assertEqual({path: path.stat().st_mtime_ns for path in self.root.rglob("*") if path.is_file()}, stamps)
    self.assertEqual((dry["ran"], dry["reason"], dry["complete"]), (False, "dry_run", True))
    self.assertGreater(dry["removed_revisions"], 0)

    records, objects = record_ids(self.paths), object_files(self.paths)
    real = compact_revisions(self.paths, now=NOW)
    self.assertTrue(real["ran"])
    for name in ("removed_revisions", "kept_revisions", "removed_objects", "freed_bytes", "freed_allocated_bytes", "complete"):
      self.assertEqual(real[name], dry[name], name)
    self.assertEqual(len(records - record_ids(self.paths)), dry["removed_revisions"])
    self.assertEqual(len({name.removesuffix(".z") for name in objects - object_files(self.paths)}), dry["removed_objects"])
    self.assertEqual(compact_revisions(self.paths, dry_run=True, now=NOW)["removed_revisions"], 0)

  def test_a_second_run_removes_nothing(self) -> None:
    expected = self.build()
    first = thin(self.paths, now=NOW)
    self.assertGreater(first["removed_revisions"], 0)
    store = tree_digest(self.paths.revisions_dir, exclude=("retention.json",))
    second = thin(self.paths, now=NOW)
    self.assertEqual((second["removed_revisions"], second["removed_objects"], second["freed_bytes"], second["reason"]), (0, 0, 0, "nothing_to_thin"))
    self.assertEqual(tree_digest(self.paths.revisions_dir, exclude=("retention.json",)), store)
    self.assert_store_sound(expected=expected)

  def test_nothing_outside_the_revision_store_is_written_or_removed(self) -> None:
    self.build()
    update_brief(self.paths, synopsis="A premise that must survive.")
    outside = tree_digest(self.root, exclude=(".openauthor/revisions",))
    stamps = {path: path.stat().st_mtime_ns for path in self.root.rglob("*") if path.is_file() and self.paths.revisions_dir not in path.parents}
    result = thin(self.paths, now=NOW)
    self.assertGreater(result["removed_revisions"], 0)
    self.assertEqual(tree_digest(self.root, exclude=(".openauthor/revisions",)), outside)
    self.assertEqual({path: path.stat().st_mtime_ns for path in self.root.rglob("*") if path.is_file() and self.paths.revisions_dir not in path.parents}, stamps)

  def test_a_damaged_survivor_stops_the_run_before_anything_is_removed(self) -> None:
    self.build()
    relative = find_scene_file(self.paths, "scene-0002").relative_to(self.paths.root).as_posix()
    named = next(row["id"] for row in history(self.paths) if row["message"] == "Named in the middle")
    digest = get_revision(self.paths, named)["manifest"][relative]
    damaged = self.paths.revision_objects_dir / digest[:2] / f"{digest[2:]}.z"
    content = damaged.read_bytes()
    clean = tree_digest(self.paths.revisions_dir)
    damaged.write_bytes(content[:-4] + b"oops")
    store = tree_digest(self.paths.revisions_dir)
    with self.assertRaisesRegex(OpenAuthorError, rf"did not pass verification, so nothing was removed: .*{digest}"):
      compact_revisions(self.paths, now=NOW)
    self.assertEqual(tree_digest(self.paths.revisions_dir, exclude=("retention.lock",)), store)

    damaged.write_bytes(content)
    record = self.paths.revision_records_dir / f"{named}.json"
    original = record.read_text(encoding="utf-8")
    altered = json.loads(original)
    altered["message"] = "Renamed behind our back"
    record.write_text(json.dumps(altered), encoding="utf-8")
    with self.assertRaisesRegex(OpenAuthorError, "did not pass verification, so nothing was removed"):
      compact_revisions(self.paths, now=NOW)
    record.write_text(original, encoding="utf-8")
    self.assertEqual(tree_digest(self.paths.revisions_dir, exclude=("retention.lock",)), clean)
    self.assertGreater(thin(self.paths, now=NOW)["removed_revisions"], 0)

  def test_an_interruption_at_any_step_leaves_a_sound_store_and_the_next_run_finishes(self) -> None:
    expected = self.build(saves=12)
    outside = tree_digest(self.root, exclude=(".openauthor/revisions",))
    template = self.root.parent / "template"
    shutil.copytree(self.root, template)

    class Interrupted(BaseException):
      pass

    small = {"_HOLD_UNITS_MIN": 1, "_HOLD_UNITS_START": 1, "_HOLD_UNITS_MAX": 1, "_STEP_REVISIONS": 2, "_YIELD_SECONDS": 0}  # one step per hold, runs detached in pieces

    def run(root: Path, stop_at: int | None) -> int:
      """Thin a copy of the book, stopping just before the given disk change.

      Stopping after change N leaves the disk as stopping before N + 1 does,
      so every state a real interruption can leave is visited.
      """
      paths = get_project_paths(root)
      calls = 0
      originals = {name: getattr(retention, name) for name in ("_publish", "_remove", "_sync")}

      def wrapped(name):
        def step(*args):
          nonlocal calls
          calls += 1
          if calls == stop_at:
            raise Interrupted()
          originals[name](*args)
        return step

      with patch.multiple(retention, **small, **{name: wrapped(name) for name in originals}):
        compact_revisions(paths, now=NOW)
      return calls

    reference = self.root.parent / "reference"
    shutil.copytree(template, reference)
    steps = run(reference, None)
    done = get_project_paths(reference)
    self.assertGreater(steps, 40)
    survivors, objects = record_ids(done), object_files(done)
    self.assertLess(len(survivors), len(expected))

    for stop_at in range(1, steps + 1):
      with self.subTest(stop_at=stop_at):
        copy = self.root.parent / f"copy-{stop_at}"
        shutil.copytree(template, copy)
        paths = get_project_paths(copy)
        with self.assertRaises(Interrupted):
          run(copy, stop_at)
        # Whatever is on disk reads: survivors and not-yet-removed alike.
        self.assertTrue(survivors <= record_ids(paths))
        self.assert_store_sound(paths, expected)
        self.assertEqual([row["id"] for row in history(paths) if row["id"] in survivors], [row["id"] for row in history(done)])
        self.assertEqual(tree_digest(copy, exclude=(".openauthor/revisions",)), outside)
        # The author can keep writing on the interrupted store.
        newest = editor_save(paths, SCENE, "Written before the next run.")
        # Running again finishes the job: exactly what an uninterrupted run
        # leaves, plus the new save and its one new object.
        result = compact_revisions(paths, now=NOW)
        self.assertTrue(result["complete"], result)
        self.assertEqual(record_ids(paths), survivors | {newest})
        self.assertEqual(objects - object_files(paths), set())
        self.assertEqual(len(object_files(paths) - objects), 1)
        self.assertFalse((paths.revisions_dir / "retention-journal.json").exists())
        self.assert_store_sound(paths, expected)
        shutil.rmtree(copy)

  def test_a_killed_process_is_finished_by_the_next_run(self) -> None:
    expected = self.build(saves=12)
    script = """
import os, sys
from datetime import datetime
from pathlib import Path
from openauthor import revision_retention as retention
from openauthor.project import get_project_paths
calls = 0
remove = retention._remove
def dying(path):
  global calls
  calls += 1
  if calls == int(sys.argv[3]):
    os.kill(os.getpid(), 9)
  remove(path)
retention._remove = dying
retention._HOLD_UNITS_MIN = retention._HOLD_UNITS_START = retention._HOLD_UNITS_MAX = 4
retention.compact_revisions(get_project_paths(Path(sys.argv[1])), now=datetime.fromisoformat(sys.argv[2]))
"""
    environment = {**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])}
    killed = subprocess.run([sys.executable, "-c", script, str(self.root), NOW.isoformat(), "5"], capture_output=True, text=True, env=environment)
    self.assertEqual(killed.returncode, -9, killed.stderr)
    self.assertTrue((self.paths.revisions_dir / "retention-journal.json").exists())
    self.assert_store_sound(expected=expected)
    result = compact_revisions(self.paths, now=NOW)
    self.assertTrue(result["complete"])
    self.assertFalse((self.paths.revisions_dir / "retention-journal.json").exists())
    self.assert_store_sound(expected=expected)
    self.assertEqual(compact_revisions(self.paths, dry_run=True, now=NOW)["removed_revisions"], 0)
    self.assertEqual(thin(self.paths, now=NOW)["removed_objects"], 0)

  def test_the_lock_is_held_in_short_pieces_and_saves_get_in_between(self) -> None:
    self.build(saves=30)
    saved: list[str] = []

    def save_between_holds() -> None:
      # The lock is free here: an editor save from another thread goes through.
      worker = threading.Thread(target=lambda: saved.append(editor_save(self.paths, "scene-0002", f"Typed during thinning {len(saved)}.")))
      worker.start()
      worker.join(timeout=10)
      self.assertFalse(worker.is_alive())

    report: dict = {}
    with patch.multiple(retention, _HOLD_UNITS_MIN=6, _HOLD_UNITS_START=6, _HOLD_UNITS_MAX=6, _yield_lock=save_between_holds):
      result = compact_revisions(self.paths, now=NOW, report=report)
    self.assertTrue(result["complete"])
    self.assertGreater(report["holds"], 3)
    self.assertGreaterEqual(len(saved), report["holds"] - 1)
    self.assertLess(report["longest_hold"], 1.0)
    self.assertEqual(revision_head(self.paths), saved[-1])
    self.assertTrue(set(saved) <= record_ids(self.paths))
    self.assert_store_sound()

  def test_a_run_that_reaches_its_work_bound_reports_incomplete_and_resumes(self) -> None:
    self.build(saves=30)
    planned = compact_revisions(self.paths, dry_run=True, now=NOW)
    with patch.multiple(retention, _HOLD_UNITS_MIN=6, _HOLD_UNITS_START=6, _HOLD_UNITS_MAX=6):
      first = compact_revisions(self.paths, now=NOW, max_seconds=0)
    self.assertEqual((first["ran"], first["complete"], first["reason"]), (True, False, "work_bound"))
    self.assertGreater(first["removed_revisions"], 0)
    self.assertLess(first["removed_revisions"], planned["removed_revisions"])
    self.assert_store_sound()
    status = retention_status(self.paths, now=NOW)
    self.assertTrue(status["due"])
    self.assertIsNone(status["last_run"]["at"])

    second = compact_revisions(self.paths, now=NOW)
    self.assertTrue(second["complete"])
    self.assertEqual(first["removed_revisions"] + second["removed_revisions"], planned["removed_revisions"])
    self.assertEqual(first["removed_objects"] + second["removed_objects"], planned["removed_objects"])
    status = retention_status(self.paths, now=NOW)
    self.assertFalse(status["due"])
    self.assertEqual(status["last_run"], {"at": NOW.isoformat(), "removed_revisions": planned["removed_revisions"], "freed_bytes": planned["freed_bytes"]})
    self.assert_store_sound()

  def test_a_reference_or_a_reused_text_appearing_mid_run_is_respected(self) -> None:
    self.build(saves=30)
    relative = find_scene_file(self.paths, SCENE).relative_to(self.paths.root).as_posix()
    doomed = [row["id"] for row in history(self.paths)]
    survivors = record_ids_after_a_run_on_a_copy(self.paths)
    planned = set(doomed) - survivors
    kept_digests = {get_revision(self.paths, revision_id)["manifest"][relative] for revision_id in survivors}
    events: list[str] = []

    def between_holds() -> None:
      remaining = [revision_id for revision_id in doomed if revision_id in planned and revision_id in record_ids(self.paths)]
      # An old save whose text nothing else uses and no other object needs.
      alone = [
        revision_id for revision_id in remaining
        if revisions._object_base(self.paths, get_revision(self.paths, revision_id)["manifest"][relative])
        and get_revision(self.paths, revision_id)["manifest"][relative] not in kept_digests
      ]
      if not events and len(alone) > 2:
        # The author returns to exactly the text of that save, and a new
        # feature writes down the id of another.
        # (not neighbours: the save just before a newly kept one stays too)
        reused, bookmarked = alone[-1], alone[0]
        digest = get_revision(self.paths, reused)["manifest"][relative]
        find_scene_file(self.paths, SCENE).write_text(read_file_at_revision(self.paths, reused, relative), encoding="utf-8")
        with checkpointed_edit(self.paths, f"Scene update: {SCENE}"):
          pass
        self.assertEqual(get_revision(self.paths, revision_head(self.paths))["manifest"][relative], digest)
        (self.paths.workspace_dir / "bookmark.json").write_text(json.dumps({"revision": bookmarked}), encoding="utf-8")
        events.extend([reused, bookmarked, digest])

    with patch.multiple(retention, _HOLD_UNITS_MIN=6, _HOLD_UNITS_START=6, _HOLD_UNITS_MAX=6, _yield_lock=between_holds):
      result = compact_revisions(self.paths, now=NOW)
    self.assertEqual(len(events), 3)
    self.assertTrue(result["complete"], result)
    reused, bookmarked, digest = events
    self.assertIn(bookmarked, record_ids(self.paths))
    # The old save itself went, but its text is the newest Revision's now.
    self.assertNotIn(reused, record_ids(self.paths))
    self.assertIn(f"{digest[:2]}/{digest[2:]}.z", object_files(self.paths))
    head = get_revision(self.paths, revision_head(self.paths))
    self.assertEqual(read_file_at_revision(self.paths, head["id"], relative), (self.paths.root / relative).read_text(encoding="utf-8"))
    self.assert_store_sound()
    self.assertEqual(thin(self.paths, now=NOW)["removed_revisions"], 0)

  def test_only_one_run_at_a_time(self) -> None:
    self.build()
    self.paths.revisions_dir.mkdir(parents=True, exist_ok=True)
    with (self.paths.revisions_dir / "retention.lock").open("a+b") as handle:
      fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
      result = compact_revisions(self.paths, now=NOW)
      self.assertEqual((result["ran"], result["reason"], result["removed_revisions"]), (False, "already_running", 0))
    self.assertGreater(thin(self.paths, now=NOW)["removed_revisions"], 0)

  def test_no_other_command_thins_history(self) -> None:
    self.build()
    before = record_ids(self.paths)
    previous = Path.cwd()
    os.chdir(self.root)
    self.addCleanup(os.chdir, previous)
    loaded = get_scene(self.paths, SCENE)
    commands = [
      ["scene", "update", "--id", SCENE, "--expected-version", json.dumps(loaded["edit_version"]), "--body", loaded["body"] + " More.", "--json"],
      ["revision", "list", "--json"], ["revision", "save", "--message", "Named", "--json"], ["check", "startup", "--repair", "--json"],
      ["revision", "retention", "--json"], ["revision", "compact", "--dry-run", "--json"],
    ]
    for command in commands:
      with redirect_stdout(StringIO()):
        self.assertEqual(main(command), 0, command)
    self.assertTrue(before <= record_ids(self.paths))
    self.assertFalse((self.paths.revisions_dir / "retention.json").exists())


def record_ids_after_a_run_on_a_copy(paths: ProjectPaths) -> set[str]:
  """The records a run would leave, found by running one on a copy."""
  with tempfile.TemporaryDirectory() as directory:
    copy = Path(directory) / "copy"
    shutil.copytree(paths.root, copy)
    compact_revisions(get_project_paths(copy), now=NOW)
    return record_ids(get_project_paths(copy))


class RetentionCommandTests(RetentionCase):
  def setUp(self) -> None:
    super().setUp()
    previous = Path.cwd()
    os.chdir(self.root)
    self.addCleanup(os.chdir, previous)

  def run_cli(self, *arguments: str) -> tuple[int, str, str]:
    output, errors = StringIO(), StringIO()
    with redirect_stdout(output), redirect_stderr(errors):
      code = main(list(arguments))
    return code, output.getvalue(), errors.getvalue()

  def json_cli(self, *arguments: str) -> dict:
    code, output, errors = self.run_cli(*arguments, "--json")
    self.assertEqual(code, 0, errors)
    return json.loads(output)

  def old_history(self) -> None:
    with recorded_from(at(200, 8)) as clock:
      self.start(clock)
      clock.move_to(at(30, 9, 1))
      editor_saves(self.paths, SCENE, 6, "old")
      clock.move_to(datetime.now(UTC) - timedelta(minutes=5))
      editor_save(self.paths, SCENE, "Today.")

  def test_retention_reports_policy_store_last_run_and_due(self) -> None:
    self.old_history()
    status = self.json_cli("revision", "retention")
    self.assertEqual(set(status), {"policy", "store", "last_run", "due"})
    self.assertEqual(status["policy"], {"enabled": True, "keep_all_days": 7, "daily_after_days": 90})
    self.assertEqual(status["last_run"], {"at": None, "removed_revisions": 0, "freed_bytes": 0})
    self.assertIs(status["due"], True)
    files = [path for path in self.paths.revisions_dir.rglob("*") if path.is_file()]
    self.assertEqual(status["store"]["revisions"], len(record_ids(self.paths)))
    self.assertEqual(status["store"]["bytes"], sum(path.stat().st_size for path in files))
    self.assertEqual(status["store"]["allocated_bytes"], sum(path.stat().st_blocks * 512 for path in files))
    self.assertFalse(retention.policy_path(self.paths).exists())

    result = self.json_cli("revision", "compact", "--if-due")
    self.assertEqual(set(result), {"ran", "reason", "removed_revisions", "kept_revisions", "removed_objects", "freed_bytes", "freed_allocated_bytes", "complete"})
    self.assertEqual((result["ran"], result["complete"], result["removed_revisions"]), (True, True, 5))
    after = self.json_cli("revision", "retention")
    self.assertIs(after["due"], False)
    self.assertEqual((after["last_run"]["removed_revisions"], after["last_run"]["freed_bytes"]), (5, result["freed_bytes"]))
    self.assertLessEqual(abs((datetime.now(UTC) - datetime.fromisoformat(after["last_run"]["at"])).total_seconds()), 60)
    self.assertLess(after["store"]["allocated_bytes"], status["store"]["allocated_bytes"])
    self.assertEqual(after["store"]["revisions"], result["kept_revisions"])

    again = self.json_cli("revision", "compact", "--if-due")
    self.assertEqual((again["ran"], again["reason"], again["removed_revisions"]), (False, "not_due", 0))
    # A day later it is due again.
    self.assertTrue(retention_status(self.paths, now=datetime.now(UTC) + timedelta(hours=25))["due"])
    self.assertFalse(retention_status(self.paths, now=datetime.now(UTC) + timedelta(hours=23))["due"])

  def test_policy_is_stored_per_book_and_rejects_settings_that_thin_recent_work(self) -> None:
    updated = self.json_cli("revision", "retention", "--enabled", "true", "--keep-all-days", "14", "--daily-after-days", "60")
    self.assertEqual(updated["policy"], {"enabled": True, "keep_all_days": 14, "daily_after_days": 60})
    self.assertEqual(json.loads(retention.policy_path(self.paths).read_text(encoding="utf-8")), {"schema_version": 1, "enabled": True, "keep_all_days": 14, "daily_after_days": 60})
    self.assertEqual(retention.policy_path(self.paths), self.paths.project_dir / "revision_retention.json")
    self.assertEqual(self.json_cli("revision", "retention")["policy"], updated["policy"])

    for arguments, message in [
      (["--enabled", "true", "--keep-all-days", "0"], "keep_all_days must be at least 1"),
      (["--enabled", "true", "--keep-all-days", "-3"], "keep_all_days must be at least 1"),
      (["--enabled", "true", "--daily-after-days", "14"], "daily_after_days must be greater than keep_all_days"),
      (["--enabled", "true", "--keep-all-days", "60"], "daily_after_days must be greater than keep_all_days"),
      (["--enabled", "true", "--keep-all-days", "30", "--daily-after-days", "7"], "daily_after_days must be greater than keep_all_days"),
    ]:
      code, output, errors = self.run_cli("revision", "retention", *arguments, "--json")
      self.assertEqual((code, output), (2, ""), arguments)
      self.assertIn(message, errors)
    self.assertEqual(load_policy(self.paths), updated["policy"])

  def test_a_disabled_book_is_never_thinned(self) -> None:
    self.old_history()
    disabled = self.json_cli("revision", "retention", "--enabled", "false")
    self.assertEqual(disabled["policy"], {"enabled": False, "keep_all_days": 7, "daily_after_days": 90})
    self.assertIs(disabled["due"], False)
    before = tree_digest(self.paths.revisions_dir)

    skipped = self.json_cli("revision", "compact", "--if-due")
    self.assertEqual((skipped["ran"], skipped["reason"], skipped["removed_revisions"]), (False, "disabled", 0))
    code, output, errors = self.run_cli("revision", "compact", "--json")
    self.assertEqual((code, output), (2, ""))
    self.assertIn("Thinning is turned off for this book, so nothing was removed", errors)
    # A dry run still answers what would go.
    dry = self.json_cli("revision", "compact", "--dry-run")
    self.assertEqual((dry["ran"], dry["removed_revisions"]), (False, 5))
    self.assertEqual(tree_digest(self.paths.revisions_dir), before)

    self.json_cli("revision", "retention", "--enabled", "true")
    self.assertEqual(self.json_cli("revision", "compact")["removed_revisions"], 5)

  def test_an_unreadable_policy_stops_thinning_instead_of_assuming_the_default(self) -> None:
    self.old_history()
    retention.policy_path(self.paths).write_text('{"enabled": "no"}', encoding="utf-8")
    before = tree_digest(self.paths.revisions_dir)
    skipped = self.json_cli("revision", "compact", "--if-due")
    self.assertFalse(skipped["ran"])
    self.assertIn("policy_unreadable", skipped["reason"])
    for arguments in (["revision", "compact", "--json"], ["revision", "compact", "--dry-run", "--json"], ["revision", "retention", "--json"], ["revision", "retention", "--enabled", "true", "--json"]):
      code, _, errors = self.run_cli(*arguments)
      self.assertEqual(code, 2, arguments)
      self.assertIn("is not valid", errors)
    self.assertEqual(tree_digest(self.paths.revisions_dir), before)
    # Stating the whole policy replaces the damaged file.
    fixed = self.json_cli("revision", "retention", "--enabled", "false", "--keep-all-days", "7", "--daily-after-days", "90")
    self.assertIs(fixed["policy"]["enabled"], False)

  def test_plain_output_is_readable(self) -> None:
    self.old_history()
    code, output, _ = self.run_cli("revision", "retention")
    self.assertEqual(code, 0)
    self.assertIn("every save is kept for 7 days", output)
    code, output, _ = self.run_cli("revision", "compact", "--dry-run")
    self.assertIn("Would remove 5 automatic saves", output)
    self.assertIn("Nothing was changed", output)
    code, output, _ = self.run_cli("revision", "compact")
    self.assertIn("Removed 5 automatic saves", output)


if __name__ == "__main__":
  unittest.main()
