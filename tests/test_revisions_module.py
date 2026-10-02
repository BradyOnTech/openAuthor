from __future__ import annotations

import tempfile
import unittest
import os
import subprocess
import sys
from unittest.mock import patch
from pathlib import Path

from openauthor.project import OpenAuthorError, initialize_project
from openauthor.codex import add_entity, get_entity, update_entity
from openauthor.planning import get_plan, update_brief
from openauthor.canon import add_canon_fact, list_canon_facts
from openauthor.revisions import (
  compare_revisions,
  create_revision,
  get_revision,
  read_file_at_revision,
  revision_head,
  restore_revision,
  revision_retrospective,
  verify_revision_store,
  recover_interrupted_edit,
)
from openauthor.scenes import add_scene, get_scene, update_scene


class RevisionModuleTests(unittest.TestCase):
  def test_process_termination_during_edit_recovers_previous_committed_book(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Interrupted Save")
      add_scene(paths, title="Opening", body="Last committed prose")
      script = """
import os, sys
from pathlib import Path
from openauthor.project import resolve_project
from openauthor.revisions import checkpointed_edit
from openauthor.scenes import update_scene
paths = resolve_project(Path(sys.argv[1]))
with checkpointed_edit(paths, 'Interrupted change'):
  update_scene(paths, scene_identifier='scene-0001', body='Partial uncommitted prose')
  os._exit(71)
"""
      result = subprocess.run([sys.executable, "-c", script, tmp], capture_output=True, text=True)
      self.assertEqual(result.returncode, 71, result.stderr)
      self.assertIn("Partial uncommitted", get_scene(paths, "scene-0001")["body"])
      self.assertTrue(recover_interrupted_edit(paths))
      self.assertEqual(get_scene(paths, "scene-0001")["body"].strip(), "Last committed prose")
      self.assertFalse(recover_interrupted_edit(paths))
      self.assertTrue(verify_revision_store(paths)["ready"])

  def test_restore_prose_plan_and_canon_from_one_version(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Book Restore")
      add_scene(paths, title="Opening", body="Mara carries a key.")
      entity = add_entity(paths, kind="character", name="Mara")
      update_brief(paths, synopsis="Original premise")
      add_canon_fact(paths, subject_entity_id=entity, predicate="carries", value="key", evidence=[{"scene_id": "scene-0001", "excerpt": "Mara carries a key."}])
      original = create_revision(paths, "Original")
      update_scene(paths, scene_identifier="scene-0001", body="Mara carries a lantern.")
      update_brief(paths, synopsis="Different premise")
      add_canon_fact(paths, subject_entity_id=entity, predicate="carries", value="lantern", evidence=[{"scene_id": "scene-0001", "excerpt": "Mara carries a lantern."}])
      later = create_revision(paths, "Later")
      restore_revision(paths, original)
      self.assertEqual(get_plan(paths)["brief"]["synopsis"], "Original premise")
      self.assertEqual([fact["value"] for fact in list_canon_facts(paths)], ["key"])
      self.assertEqual(get_scene(paths, "scene-0001")["body"].strip(), "Mara carries a key.")
      self.assertEqual(get_revision(paths, later)["message"], "Later")

  def test_failed_restore_rolls_back_files_and_runtime_memory(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Restore Failure")
      entity = add_entity(paths, kind="character", name="Mara", description="Original")
      add_scene(paths, title="Opening", body="Original prose")
      original = create_revision(paths, "Original")
      update_entity(paths, entity_id=entity, description="Later")
      update_scene(paths, scene_identifier="scene-0001", body="Later prose")
      real_replace = os.replace
      head_writes = 0

      def disk_failure(source, destination):
        nonlocal head_writes
        if Path(destination) == paths.revision_head_file:
          head_writes += 1
          if head_writes == 2:
            raise OSError("Disk full at restored revision publication")
        return real_replace(source, destination)

      with patch("os.replace", side_effect=disk_failure):
        with self.assertRaisesRegex(OpenAuthorError, "rolled back"):
          restore_revision(paths, original)
      self.assertEqual(get_entity(paths, entity)["description"], "Later")
      self.assertEqual(get_scene(paths, "scene-0001")["body"].strip(), "Later prose")
      self.assertTrue(verify_revision_store(paths)["ready"])

  def test_restore_character_snapshot_restores_runtime_memory(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Memory Restore")
      entity = add_entity(paths, kind="character", name="Mara", description="Original motivation")
      original = create_revision(paths, "Original")
      update_entity(paths, entity_id=entity, description="Changed motivation")
      later = create_revision(paths, "Later")
      restored = restore_revision(paths, original, relative_paths=["codex/codex.json"])
      self.assertEqual(get_entity(paths, entity)["description"], "Original motivation")
      self.assertEqual(restored["manifest"]["codex/codex.json"], get_revision(paths, original)["manifest"]["codex/codex.json"])
      self.assertIn("Changed motivation", read_file_at_revision(paths, later, "codex/codex.json"))

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
      self.assertFalse(verify_revision_store(paths)["ready"])

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
