from __future__ import annotations

import json
import shutil
import tempfile
import unittest
import threading
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from openauthor.git_ops import create_branch, create_snapshot, initialize_git
from openauthor.cli import main
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.project_locks import project_lock
from openauthor.scene_edits import SceneEditConflict, save_scene_edit
from openauthor.scenes import add_scene, get_scene, update_scene


class SceneEditTests(unittest.TestCase):
  def setUp(self) -> None:
    self.directory = tempfile.TemporaryDirectory()
    self.addCleanup(self.directory.cleanup)
    self.paths = initialize_project(Path(self.directory.name), name="Guarded edits")
    self.scene_file = add_scene(self.paths, title="Letter", body="Original prose")
    self.loaded = get_scene(self.paths, "scene-0001")

  def save(self, changes, version=None):
    return save_scene_edit(self.paths, scene_identifier="scene-0001", expected_version=version or self.loaded["edit_version"], changes=changes)

  def test_changed_prose_is_not_replaced_and_both_versions_have_a_durable_copy(self) -> None:
    update_scene(self.paths, scene_identifier="scene-0001", body="Other writer")
    with self.assertRaises(SceneEditConflict) as caught:
      self.save({"title": "Letter", "body": "My draft"})
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"].strip(), "Other writer")
    record = json.loads((self.paths.root / caught.exception.details["recovery_path"]).read_text())
    self.assertEqual(record["draft"]["body"], "My draft")
    self.assertEqual(record["current"]["body"].strip(), "Other writer")
    self.assertEqual(record["conflicting_fields"], ["body"])
    # A retry preserves the same conflict copy instead of generating duplicates.
    with self.assertRaises(SceneEditConflict) as repeated:
      self.save({"title": "Letter", "body": "My draft"})
    self.assertEqual(caught.exception.details["recovery_path"], repeated.exception.details["recovery_path"])

  def test_disjoint_inspector_and_prose_edits_merge_without_losing_either(self) -> None:
    self.save({"summary": "Inspector summary", "status": "final"})
    saved = self.save({"title": "Letter", "body": "New prose"})
    self.assertEqual(saved["summary"], "Inspector summary")
    self.assertEqual(saved["status"], "final")
    self.assertEqual(saved["body"].strip(), "New prose")

  def test_same_content_retry_is_idempotent_without_rewriting_the_file(self) -> None:
    first = self.save({"body": "Saved prose"})
    before = self.scene_file.read_bytes()
    repeated = self.save({"body": "Saved prose"})
    self.assertEqual(first, repeated)
    self.assertEqual(self.scene_file.read_bytes(), before)

  def test_external_edit_with_unchanged_timestamp_is_detected(self) -> None:
    self.scene_file.write_text(self.scene_file.read_text().replace("Original prose", "External prose"))
    self.assertEqual(get_scene(self.paths, "scene-0001")["updated_at"], self.loaded["updated_at"])
    with self.assertRaises(SceneEditConflict):
      self.save({"body": "Old editor draft"})
    self.assertIn("External prose", self.scene_file.read_text())

  def test_reviewed_resolution_is_checked_again_before_it_can_write(self) -> None:
    update_scene(self.paths, scene_identifier="scene-0001", body="Other writer")
    reviewed = get_scene(self.paths, "scene-0001")
    update_scene(self.paths, scene_identifier="scene-0001", body="Third writer")
    with self.assertRaises(SceneEditConflict):
      self.save({"body": "Reconciled prose"}, reviewed["edit_version"])
    fresh = get_scene(self.paths, "scene-0001")
    saved = self.save({"body": "Reviewed all three"}, fresh["edit_version"])
    self.assertEqual(saved["body"].strip(), "Reviewed all three")

  def test_waiting_save_checks_its_version_after_acquiring_the_project_lock(self) -> None:
    started = threading.Event()
    done = threading.Event()
    failures = []

    def save_old_draft():
      started.set()
      try:
        self.save({"body": "Waiting stale draft"})
      except BaseException as error:
        failures.append(error)
      finally:
        done.set()

    writer = threading.Thread(target=save_old_draft, daemon=True)
    with project_lock(self.paths):
      writer.start()
      self.assertTrue(started.wait(2))
      self.assertFalse(done.wait(0.1))
      update_scene(self.paths, scene_identifier="scene-0001", body="Saved before lock release")
    writer.join(3)
    self.assertFalse(writer.is_alive())
    self.assertEqual(len(failures), 1)
    self.assertIsInstance(failures[0], SceneEditConflict)
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"].strip(), "Saved before lock release")

  def test_save_response_is_its_own_committed_scene_not_a_later_writers_scene(self) -> None:
    started = threading.Event()
    done = threading.Event()
    failures = []

    def later_write():
      started.set()
      try:
        update_scene(self.paths, scene_identifier="scene-0001", body="Later writer")
      except BaseException as error:
        failures.append(error)
      finally:
        done.set()

    writer = threading.Thread(target=later_write, daemon=True)

    def observed_write(*args, **kwargs):
      result = update_scene(*args, **kwargs)
      writer.start()
      self.assertTrue(started.wait(2))
      done.wait(0.1)
      return result

    try:
      with patch("openauthor.scenes.update_scene", side_effect=observed_write):
        saved = self.save({"body": "My committed draft"})
    finally:
      if writer.ident is not None:
        writer.join(3)
    self.assertFalse(writer.is_alive())
    self.assertEqual(failures, [])
    self.assertEqual(saved["body"].strip(), "My committed draft")
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"].strip(), "Later writer")
    with self.assertRaises(SceneEditConflict):
      self.save({"body": "Next edit from my acknowledgement"}, saved["edit_version"])

  def test_invalid_precondition_and_failed_conflict_archive_do_not_touch_the_scene(self) -> None:
    with self.assertRaises(OpenAuthorError):
      self.save({"body": "Bad version"}, {"schema_version": 1})
    update_scene(self.paths, scene_identifier="scene-0001", body="Other writer")
    with patch("openauthor.scene_edits.atomic_write_json", side_effect=OSError("Storage full")):
      with self.assertRaisesRegex(OpenAuthorError, "manuscript was not changed"):
        self.save({"body": "My draft"})
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"].strip(), "Other writer")

  def test_a_derived_memory_failure_does_not_misreport_a_committed_save(self) -> None:
    output = StringIO()
    with patch("openauthor.cli._paths_from_cwd", return_value=self.paths), patch("openauthor.cli.extract_memory_suggestions", side_effect=RuntimeError("Derived scan failed")), redirect_stdout(output):
      status = main(["scene", "update", "--id", "scene-0001", "--body", "Saved despite scan failure", "--expected-version", json.dumps(self.loaded["edit_version"]), "--json"])
    self.assertEqual(status, 0)
    result = json.loads(output.getvalue())
    self.assertTrue(result["save_warnings"])
    self.assertEqual(result["body"].strip(), "Saved despite scan failure")
    self.assertEqual(result["edit_version"], get_scene(self.paths, "scene-0001")["edit_version"])

  @unittest.skipUnless(shutil.which("git"), "Storyline check requires Git")
  def test_different_storyline_is_rejected_even_when_prose_is_identical(self) -> None:
    initialize_git(self.paths)
    create_snapshot(self.paths, "Baseline")
    loaded = get_scene(self.paths, "scene-0001")
    create_branch(self.paths, name="alternate", switch=True)
    with self.assertRaises(SceneEditConflict) as caught:
      self.save({"body": "Wrong Storyline draft"}, loaded["edit_version"])
    self.assertEqual(caught.exception.details["reason"], "storyline_changed")
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"].strip(), "Original prose")
