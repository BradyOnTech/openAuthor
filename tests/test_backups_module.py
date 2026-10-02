from __future__ import annotations

import tempfile
import unittest
import json
import zipfile
import hashlib
from pathlib import Path

from openauthor.backups import create_backup, restore_backup, verify_backup
from openauthor.codex import add_entity, get_entity, update_entity
from openauthor.planning import get_plan, update_brief
from openauthor.project import OpenAuthorError, initialize_project, resolve_project
from openauthor.storylines import create_storyline, list_storylines, switch_storyline
from openauthor.hardening import collect_startup_health
from openauthor.revisions import create_revision, get_revision, restore_revision
from openauthor.scenes import add_scene, get_scene, update_scene


class BackupModuleTests(unittest.TestCase):
  def test_backup_rebuilds_a_missing_memory_database_without_erasing_its_snapshot(self) -> None:
    with tempfile.TemporaryDirectory() as temporary:
      root = Path(temporary)
      paths = initialize_project(root / "book", name="Missing database")
      entity = add_entity(paths, kind="character", name="Mara", description="Gatekeeper")
      create_revision(paths, "Memory checkpoint")
      paths.codex_db.unlink()
      create_backup(paths, root / "book.zip")
      restore_backup(root / "book.zip", root / "recovered")
      self.assertEqual(get_entity(resolve_project(root / "recovered"), entity)["description"], "Gatekeeper")

  def test_backup_keeps_storyline_branches_and_unsaved_branch_progress(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root / "original", name="Branching Novel")
      add_scene(paths, title="Opening", body="Primary prose")
      experiment = create_storyline(paths, name="Alternate", hypothesis="Change the ending")
      update_scene(paths, scene_identifier="scene-0001", body="Alternate prose")
      archive = root / "novel.zip"
      create_backup(paths, archive)
      restore_backup(archive, root / "recovered")
      recovered = resolve_project(root / "recovered")
      self.assertTrue(list_storylines(recovered)["storylines"][0]["branch_available"])
      self.assertEqual(get_scene(recovered, "scene-0001")["body"].strip(), "Alternate prose")
      switch_storyline(recovered, primary=True)
      self.assertEqual(get_scene(recovered, "scene-0001")["body"].strip(), "Primary prose")
      switch_storyline(recovered, experiment["id"])
      self.assertEqual(get_scene(recovered, "scene-0001")["body"].strip(), "Alternate prose")

  def test_restore_rejects_traversal_corruption_and_existing_books(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root / "original", name="Protected Novel")
      add_scene(paths, title="Opening", body="Keep this prose")
      archive = root / "novel.zip"
      create_backup(paths, archive)
      with self.assertRaises(OpenAuthorError):
        restore_backup(archive, paths.root)
      self.assertEqual(get_scene(paths, "scene-0001")["body"].strip(), "Keep this prose")
      for index, unsafe in enumerate(("manuscript/../../escaped", "manuscript/./scene.md", "codex\\evil")):
        bad = root / f"unsafe-{index}.zip"
        contents = {".openauthor/project.json": b"{}", unsafe: b"escape"}
        with zipfile.ZipFile(bad, "w") as writer:
          for name, content in contents.items():
            writer.writestr(name, content)
          writer.writestr("openauthor-backup.json", json.dumps({"schema_version": 1, "files": {name: hashlib.sha256(content).hexdigest() for name, content in contents.items()}}))
        with self.assertRaises(OpenAuthorError):
          restore_backup(bad, root / "destination")
        self.assertFalse((root / "destination").exists())
      corrupted = root / "corrupt.zip"
      with zipfile.ZipFile(archive) as reader, zipfile.ZipFile(corrupted, "w") as writer:
        for info in reader.infolist():
          writer.writestr(info, b"tampered" if info.filename.endswith("project.json") else reader.read(info))
      with self.assertRaises(OpenAuthorError):
        restore_backup(corrupted, root / "destination")
      self.assertFalse((root / "destination").exists())

  def test_portable_backup_restores_book_memory_and_older_versions(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root / "original", name="Portable Novel")
      add_scene(paths, title="Opening", body="Original prose")
      entity = add_entity(paths, kind="character", name="Mara", description="Gatekeeper")
      update_brief(paths, synopsis="The original premise")
      first = create_revision(paths, "First version")
      update_scene(paths, scene_identifier="scene-0001", body="Revised prose")
      update_entity(paths, entity_id=entity, description="Former gatekeeper")
      archive = root / "novel.openauthor.zip"
      created = create_backup(paths, archive)
      self.assertTrue(created["verified"])
      self.assertTrue(verify_backup(archive)["verified"])
      destination = root / "recovered"
      restore_backup(archive, destination)
      recovered = resolve_project(destination)
      self.assertTrue(collect_startup_health(recovered)["ready"])
      self.assertEqual(get_scene(recovered, "scene-0001")["body"].strip(), "Revised prose")
      self.assertEqual(get_entity(recovered, entity)["description"], "Former gatekeeper")
      self.assertEqual(get_plan(recovered)["brief"]["synopsis"], "The original premise")
      self.assertEqual(get_revision(recovered, first)["message"], "First version")
      restore_revision(recovered, first)
      self.assertEqual(get_scene(recovered, "scene-0001")["body"].strip(), "Original prose")
      self.assertEqual(get_entity(recovered, entity)["description"], "Gatekeeper")
