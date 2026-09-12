from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from openauthor.project import OpenAuthorError, atomic_write_json, atomic_write_text, initialize_project
from openauthor.proposals import apply_proposal_batch, create_proposal, get_proposal, set_proposal_draft, undo_proposal, undo_proposal_batch
from openauthor.revisions import create_revision, get_revision, list_revisions, revision_head, verify_revision_store
from openauthor.scenes import add_scene, get_scene, update_scene


class CoordinatedUndoTests(unittest.TestCase):
  def setUp(self) -> None:
    directory = tempfile.TemporaryDirectory()
    self.addCleanup(directory.cleanup)
    self.paths = initialize_project(Path(directory.name), name="Coordinated undo")
    self.ids = []
    self.scene_paths = []
    self.originals = []
    for index in range(1, 4):
      scene_path = add_scene(self.paths, title=f"Scene {index}", body=f"Original {index}")
      self.scene_paths.append(scene_path)
      self.originals.append(scene_path.read_text())
      if index == 3:
        continue
      proposal = create_proposal(self.paths, title=f"Revise {index}", instruction="Tighten", scene_id=f"scene-{index:04d}", change_group_id="shared-label")
      set_proposal_draft(self.paths, proposal_id=proposal, proposed_body=f"Revised {index}")
      self.ids.append(proposal)
    self.applied = apply_proposal_batch(self.paths, proposal_ids=self.ids)

  def undo(self):
    return undo_proposal_batch(self.paths, applied_revision=self.applied["applied_revision"])

  def state(self):
    return {
      "scenes": [path.read_text() for path in self.scene_paths],
      "proposals": [path.read_text() for path in sorted(self.paths.proposals_dir.glob("*.json"))],
      "head": revision_head(self.paths),
    }

  def test_restores_exact_group_in_one_revision_and_preserves_unrelated_work(self) -> None:
    update_scene(self.paths, scene_identifier="scene-0003", body="New unrelated writing")
    extra = create_proposal(self.paths, title="Later group", instruction="Revise", scene_id="scene-0003", change_group_id="shared-label")
    create_revision(self.paths, "Unrelated work")
    count = len(list_revisions(self.paths))
    result = self.undo()
    self.assertEqual(result["proposal_ids"], self.ids)
    self.assertEqual([path.read_text() for path in self.scene_paths[:2]], self.originals[:2])
    self.assertEqual(get_scene(self.paths, "scene-0003")["body"].strip(), "New unrelated writing")
    self.assertEqual(get_proposal(self.paths, extra)["status"], "pending")
    self.assertEqual(len(list_revisions(self.paths)), count + 1)
    self.assertEqual(revision_head(self.paths), result["undo_revision"])
    self.assertEqual(get_revision(self.paths, result["undo_revision"])["kind"], "change_group_undo")
    self.assertTrue(verify_revision_store(self.paths)["ready"])
    for proposal in result["proposals"]:
      self.assertEqual(proposal["undo_revision"], result["undo_revision"])
      self.assertTrue(proposal["undone_at"])
      self.assertEqual(proposal["restored_revision"], self.applied["pre_apply_snapshot"])
    self.assertEqual([scene["body"].strip() for scene in result["scenes"]], ["Original 1", "Original 2"])
    before_retry = self.state()
    with self.assertRaises(OpenAuthorError):
      self.undo()
    self.assertEqual(self.state(), before_retry)

  def test_newer_prose_or_metadata_blocks_every_scene(self) -> None:
    for changes in ({"body": "New author prose"}, {"summary": "New summary"}, {"title": "New title"}, {"pov": "Ivo"}):
      with self.subTest(changes=changes):
        original = self.scene_paths[1].read_text()
        update_scene(self.paths, scene_identifier="scene-0002", **changes)
        before = self.state()
        with self.assertRaisesRegex(OpenAuthorError, "protect newer work"):
          self.undo()
        self.assertEqual(self.state(), before)
        self.scene_paths[1].write_text(original)

  def test_external_frontmatter_edit_is_not_discarded(self) -> None:
    path = self.scene_paths[1]
    path.write_text(path.read_text().replace("---\n", "---\nauthor_note: retain me\n", 1))
    before = self.state()
    with self.assertRaisesRegex(OpenAuthorError, "protect newer work"):
      self.undo()
    self.assertEqual(self.state(), before)

  def test_missing_or_altered_proposal_refuses_without_restoring_other_members(self) -> None:
    path = self.paths.proposals_dir / f"{self.ids[1]}.json"
    original = path.read_text()
    for replacement in (None, "{", "[]", json.dumps({**json.loads(original), "scene_id": "scene-0003"}), json.dumps({**json.loads(original), "undone_at": "already"})):
      with self.subTest(replacement=replacement):
        if replacement is None:
          path.unlink()
        else:
          path.write_text(replacement)
        before = self.state()
        with self.assertRaises(OpenAuthorError):
          self.undo()
        self.assertEqual(self.state(), before)
        path.write_text(original)

  def test_individual_undo_prevents_partial_group_retry(self) -> None:
    undo_proposal(self.paths, proposal_id=self.ids[0])
    before = self.state()
    with self.assertRaises(OpenAuthorError):
      self.undo()
    self.assertEqual(self.state(), before)

  def test_storyline_change_blocks_even_identical_prose(self) -> None:
    # A different Git HEAD supplies a different guarded-edit workspace scope.
    git_dir = self.paths.root / ".git"
    git_dir.mkdir()
    (git_dir / "HEAD").write_text("ref: refs/heads/alternate\n")
    before = self.state()
    with self.assertRaisesRegex(OpenAuthorError, "Storyline"):
      self.undo()
    self.assertEqual(self.state(), before)

  def test_nonancestor_or_legacy_revision_fails_closed(self) -> None:
    original_head = self.paths.revision_head_file.read_text()
    self.paths.revision_head_file.write_text(self.applied["pre_apply_snapshot"] + "\n")
    before = self.state()
    with self.assertRaisesRegex(OpenAuthorError, "current manuscript history"):
      self.undo()
    self.assertEqual(self.state(), before)
    self.paths.revision_head_file.write_text(original_head)
    old = create_revision(self.paths, "Legacy group", kind="change_group_apply", metadata={"proposal_ids": self.ids})
    before = self.state()
    with self.assertRaisesRegex(OpenAuthorError, "no coordinated undo record"):
      undo_proposal_batch(self.paths, applied_revision=old)
    self.assertEqual(self.state(), before)

  def test_invalid_or_incomplete_recipe_is_rejected_without_writes(self) -> None:
    record_path = self.paths.revision_records_dir / f"{self.applied['applied_revision']}.json"
    original = record_path.read_text()
    record = json.loads(original)
    for change in ({"proposal_ids": [self.ids[0], self.ids[0]]}, {"proposal_scenes": {}}, {"change_group_id": None}, {"workspace": ""}, {"scene_ids": None}):
      with self.subTest(change=change):
        record_path.write_text(json.dumps({**record, "metadata": {**record["metadata"], **change}}))
        before = self.state()
        with self.assertRaisesRegex(OpenAuthorError, "membership is incomplete"):
          self.undo()
        self.assertEqual(self.state(), before)
    record_path.write_text(original)
    for revision in ("../../project", "", self.applied["pre_apply_snapshot"]):
      with self.subTest(revision=revision):
        before = self.state()
        with self.assertRaises(OpenAuthorError):
          undo_proposal_batch(self.paths, applied_revision=revision)
        self.assertEqual(self.state(), before)

  def test_missing_snapshot_object_blocks_before_any_write(self) -> None:
    record = get_revision(self.paths, self.applied["pre_apply_snapshot"])
    digest = record["manifest"][self.scene_paths[1].relative_to(self.paths.root).as_posix()]
    (self.paths.revision_objects_dir / digest[:2] / digest[2:]).write_text("Damaged snapshot")
    before = self.state()
    with self.assertRaisesRegex(OpenAuthorError, "integrity check"):
      self.undo()
    self.assertEqual(self.state(), before)

  def test_failed_scene_metadata_or_head_write_rolls_back_whole_group(self) -> None:
    targets = [self.scene_paths[1], self.paths.proposals_dir / f"{self.ids[1]}.json", self.paths.revision_head_file]
    for target in targets:
      with self.subTest(target=target):
        before = self.state()
        failed = False

        def write(path, value):
          nonlocal failed
          if path == target and not failed:
            failed = True
            raise OSError("Disk write failed")
          return atomic_write_text(path, value)

        def write_json(path, value):
          nonlocal failed
          if path == target:
            failed = True
            raise OSError("Proposal record write failed")
          return atomic_write_json(path, value)

        with patch("openauthor.proposals.atomic_write_text", side_effect=write), patch("openauthor.revisions.atomic_write_text", side_effect=write), patch("openauthor.proposals.atomic_write_json", side_effect=write_json):
          with self.assertRaisesRegex(OpenAuthorError, "rolled back"):
            self.undo()
        self.assertEqual(self.state(), before)
        self.assertTrue(verify_revision_store(self.paths)["ready"])
    self.undo()

  def test_activity_signal_failure_does_not_report_successful_undo_as_failed(self) -> None:
    with patch("openauthor.product_signals.record_product_event", side_effect=OSError("Activity log unavailable")):
      result = self.undo()
    self.assertEqual(len(result["warnings"]), 1)
    self.assertEqual([path.read_text() for path in self.scene_paths[:2]], self.originals[:2])

  def test_competing_reader_waits_for_complete_group_undo(self) -> None:
    started = threading.Event()
    finished = threading.Event()
    read = []
    errors = []

    def reader():
      started.set()
      try:
        read.extend(get_scene(self.paths, f"scene-{index:04d}")["body"].strip() for index in (1, 2))
      except BaseException as error:
        errors.append(error)
      finally:
        finished.set()

    thread = threading.Thread(target=reader, daemon=True)

    def pause(path, value):
      atomic_write_text(path, value)
      if path == self.scene_paths[0]:
        thread.start()
        self.assertTrue(started.wait(2))
        self.assertFalse(finished.wait(0.15))

    try:
      with patch("openauthor.proposals.atomic_write_text", side_effect=pause):
        self.undo()
    finally:
      if thread.ident is not None:
        thread.join(3)
    self.assertFalse(thread.is_alive())
    self.assertEqual(errors, [])
    self.assertEqual(read, ["Original 1", "Original 2"])

  def test_cli_resolves_group_from_applied_revision(self) -> None:
    result = subprocess.run([sys.executable, "-m", "openauthor", "proposal", "undo-batch", "--revision", self.applied["applied_revision"], "--json"], cwd=self.paths.root, env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])}, capture_output=True, text=True)
    self.assertEqual(result.returncode, 0, result.stderr)
    self.assertEqual(json.loads(result.stdout)["scene_ids"], ["scene-0001", "scene-0002"])
