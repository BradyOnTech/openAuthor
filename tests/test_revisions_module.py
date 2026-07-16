from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from openauthor.project import OpenAuthorError, initialize_project
from openauthor.revisions import (
  compare_revisions,
  create_revision,
  get_revision,
  read_file_at_revision,
  revision_head,
  restore_revision,
  revision_retrospective,
  verify_revision_store,
)
from openauthor.scenes import add_scene, get_scene, update_scene


class RevisionModuleTests(unittest.TestCase):
  def test_content_addressed_revision_restores_exact_scene(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Revision Store")
      add_scene(paths, title="Opening", body="Original prose.")
      before = create_revision(paths, "Before experiment", kind="change_set_before")

      update_scene(paths, scene_identifier="scene-0001", body="Experimental prose.")
      after = create_revision(paths, "After experiment", kind="change_set_apply")

      scene_path = get_scene(paths, "scene-0001")["path"]
      restored = read_file_at_revision(paths, before, scene_path)
      self.assertIn("Original prose.", restored)
      self.assertNotIn("Experimental prose.", restored)
      self.assertEqual(revision_head(paths), after)
      self.assertEqual(verify_revision_store(paths)["revision_count"], 2)

  def test_tampered_revision_object_fails_integrity_check(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Revision Integrity")
      add_scene(paths, title="Opening", body="Original prose.")
      revision_id = create_revision(paths, "Baseline")
      scene_path = get_scene(paths, "scene-0001")["path"]
      record = get_revision(paths, revision_id)
      digest = record["manifest"][scene_path]
      object_path = paths.revision_objects_dir / digest[:2] / digest[2:]
      object_path.write_text("tampered", encoding="utf-8")

      with self.assertRaisesRegex(OpenAuthorError, "integrity"):
        read_file_at_revision(paths, revision_id, scene_path)

  def test_compare_and_restore_create_a_new_revision(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Revision Restore")
      add_scene(paths, title="Opening", body="Original prose.")
      original = create_revision(paths, "Original")
      update_scene(paths, scene_identifier="scene-0001", body="Later prose.")
      later = create_revision(paths, "Later")

      comparison = compare_revisions(paths, original, later)
      self.assertEqual(comparison["changed_file_count"], 1)
      self.assertIn("Later prose.", comparison["files"][0]["after"])

      restored = restore_revision(paths, original, relative_paths=[get_scene(paths, "scene-0001")["path"]])
      self.assertEqual(restored["kind"], "restore")
      self.assertEqual(restored["restored_from"], original)
      self.assertNotEqual(restored["id"], original)
      self.assertIn("Original prose.", get_scene(paths, "scene-0001")["body"])

  def test_revision_retrospective_summarizes_creative_outcomes(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Retrospective")
      add_scene(paths, title="Choice", body="Mara waits.")
      before = create_revision(paths, "Before")
      update_scene(paths, scene_identifier="scene-0001", body="Mara chooses the dangerous road and keeps walking.")
      after = create_revision(paths, "After", kind="change_set_apply")
      report = revision_retrospective(paths, before, after)
      self.assertEqual(report["changed_scenes"][0]["title"], "Choice")
      self.assertGreater(report["word_count_delta"], 0)
      self.assertIn("1 scene changed", report["summary"])


if __name__ == "__main__":
  unittest.main()
