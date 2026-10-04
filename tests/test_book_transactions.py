from __future__ import annotations

import json
import os
import select
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from openauthor.book_transactions import transaction_recovery_status, resolve_transaction_recovery
from openauthor.codex import add_entity, get_entity, update_entity
from openauthor.project import OpenAuthorError, atomic_write_json, initialize_project, read_project_config
from openauthor.proposals import apply_proposal_batch, create_proposal, get_proposal, set_proposal_draft, undo_proposal_batch, apply_proposal, undo_proposal
from openauthor.revisions import create_revision, revision_head, restore_revision, verify_revision_store
from openauthor.scenes import add_scene, get_scene, update_scene


_CHILD = r'''
import json, sys
from pathlib import Path
from openauthor.project import resolve_project
from openauthor.proposals import apply_proposal_batch, undo_proposal_batch, apply_proposal, undo_proposal
from openauthor.revisions import restore_revision, checkpointed_edit
from openauthor.scenes import add_scene, get_scene
import openauthor.book_transactions as transactions

root, operation, stage, argument = sys.argv[1:]
paths = resolve_project(Path(root))
real_replace = transactions._replace_bytes
real_retire = transactions._retire
paused = False
def pause():
  global paused
  if not paused:
    paused = True
    print('paused', flush=True)
    sys.stdin.readline()
def replace(path, content, **kwargs):
  if stage == 'before_commit' and path.name == 'book-transaction.json' and json.loads(content)['phase'] == 'committed':
    pause()
  real_replace(path, content, **kwargs)
  if path.name == 'book-transaction.json' and stage == 'before_scene':
    journal = json.loads(content)
    if any(name.startswith('manuscript/scenes/') for name in journal['files']):
      pause()
  if stage == 'scene' and path.parent == paths.scenes_dir:
    pause()
  if stage == 'head' and path == paths.revision_head_file:
    record = json.loads((paths.revision_records_dir / (content.decode().strip() + '.json')).read_text())
    if record['kind'] in {'change_set_apply', 'change_set_undo', 'change_group_apply', 'change_group_undo', 'restore'}:
      pause()
  if stage == 'proposal' and path.parent == paths.proposals_dir:
    pause()
def retire(project):
  if stage == 'committed':
    pause()
  real_retire(project)
transactions._replace_bytes = replace
transactions._retire = retire
if operation == 'apply':
  apply_proposal_batch(paths, proposal_ids=json.loads(argument))
elif operation == 'undo':
  undo_proposal_batch(paths, applied_revision=argument)
elif operation == 'restore':
  restore_revision(paths, argument)
elif operation == 'create':
  with checkpointed_edit(paths, 'New scene'):
    add_scene(paths, title='New scene', body='New incomplete writing')
elif operation == 'apply_one':
  apply_proposal(paths, proposal_id=argument)
elif operation == 'undo_one':
  undo_proposal(paths, proposal_id=argument)
elif operation == 'recover':
  get_scene(paths, 'scene-0001')
'''


class BookTransactionTests(unittest.TestCase):
  def _book(self, directory):
    paths = initialize_project(Path(directory), name="Crash recovery", project_id="crash-book")
    for title, body in [("Opening", "Mara keeps the key."), ("Ending", "Ivo closes the gate.")]:
      add_scene(paths, title=title, body=body)
    baseline = create_revision(paths, "Original book")
    proposal_ids = []
    for number, body in [(1, "Mara keeps the brass key."), (2, "Ivo closes the eastern gate.")]:
      proposal = create_proposal(paths, title="Focused edit", instruction="Clarify", scene_id=f"scene-{number:04d}")
      set_proposal_draft(paths, proposal_id=proposal, proposed_body=body)
      proposal_ids.append(proposal)
    return paths, baseline, proposal_ids

  def _capture(self, paths):
    candidates = [*paths.scenes_dir.glob("*.md"), *paths.proposals_dir.glob("*.json"), paths.revision_head_file, paths.config_file, paths.root / "codex/codex.json"]
    return {path.relative_to(paths.root).as_posix(): path.read_bytes() for path in candidates if path.exists()}

  def _kill(self, paths, operation, stage, argument):
    child = subprocess.Popen(
      [sys.executable, "-c", _CHILD, str(paths.root), operation, stage, argument],
      stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    try:
      readable, _, _ = select.select([child.stdout], [], [], 10)
      if not readable:
        child.kill()
        stdout, stderr = child.communicate(timeout=5)
        self.fail(f"Child did not reach {operation}/{stage}: {stdout} {stderr}")
      message = child.stdout.readline()
      if message != "paused\n":
        stdout, stderr = child.communicate(timeout=5)
        self.fail(f"Child failed before {operation}/{stage}: {message} {stdout} {stderr}")
      child.kill()
      _, stderr = child.communicate(timeout=5)
      self.assertEqual(child.returncode, -9, stderr)
    finally:
      if child.poll() is None:
        child.kill()
        child.communicate(timeout=5)

  def test_killed_coordinated_apply_never_exposes_partial_book_after_restart(self):
    for stage in ["before_scene", "scene", "head", "proposal", "before_commit"]:
      with self.subTest(stage=stage), tempfile.TemporaryDirectory() as directory:
        paths, baseline, ids = self._book(directory)
        before = self._capture(paths)
        self._kill(paths, "apply", stage, json.dumps(ids))
        self.assertTrue(transaction_recovery_status(paths)["pending"])
        # A normal read is the recovery seam, not a separate repair prerequisite.
        self.assertEqual(get_scene(paths, "scene-0001")["body"].strip(), "Mara keeps the key.")
        self.assertEqual(self._capture(paths), before)
        self.assertFalse(transaction_recovery_status(paths)["pending"])
        self.assertEqual(revision_head(paths), baseline)
        self.assertTrue(verify_revision_store(paths)["ready"])
        applied = apply_proposal_batch(paths, proposal_ids=ids)
        undo_proposal_batch(paths, applied_revision=applied["applied_revision"])
        for relative, content in before.items():
          if relative.startswith("manuscript/scenes/"):
            self.assertEqual((paths.root / relative).read_bytes(), content)

  def test_killed_coordinated_undo_restores_applied_state_then_retries_exactly(self):
    for stage in ["scene", "head", "proposal", "before_commit"]:
      with self.subTest(stage=stage), tempfile.TemporaryDirectory() as directory:
        paths, _, ids = self._book(directory)
        originals = self._capture(paths)
        applied = apply_proposal_batch(paths, proposal_ids=ids)
        before = self._capture(paths)
        self._kill(paths, "undo", stage, applied["applied_revision"])
        get_proposal(paths, proposal_id=ids[0])
        self.assertEqual(self._capture(paths), before)
        undo_proposal_batch(paths, applied_revision=applied["applied_revision"])
        for relative, content in originals.items():
          if relative.startswith("manuscript/scenes/"):
            self.assertEqual((paths.root / relative).read_bytes(), content)

  def test_commit_marker_preserves_completed_operation_after_kill(self):
    with tempfile.TemporaryDirectory() as directory:
      paths, _, ids = self._book(directory)
      self._kill(paths, "apply", "committed", json.dumps(ids))
      state = self._capture(paths)
      self.assertEqual(get_scene(paths, "scene-0001")["body"].strip(), "Mara keeps the brass key.")
      self.assertEqual(self._capture(paths), state)
      self.assertEqual(get_proposal(paths, proposal_id=ids[1])["status"], "applied")
      self.assertFalse(transaction_recovery_status(paths)["pending"])

  def test_explicit_resolution_after_committed_kill_preserves_completed_apply(self):
    with tempfile.TemporaryDirectory() as directory:
      paths, _, ids = self._book(directory)
      originals = self._capture(paths)
      self._kill(paths, "apply", "committed", json.dumps(ids))
      state = self._capture(paths)
      status = transaction_recovery_status(paths)
      self.assertEqual(status["phase"], "committed")
      recovered = resolve_transaction_recovery(paths, fingerprint=status["fingerprint"], decisions={})
      self.assertTrue(recovered["preserved_committed"])
      self.assertEqual(self._capture(paths), state)
      self.assertFalse(transaction_recovery_status(paths)["pending"])
      self.assertEqual(get_proposal(paths, ids[0])["status"], "applied")
      undo_proposal_batch(paths, applied_revision=revision_head(paths))
      for relative, content in originals.items():
        if relative.startswith("manuscript/scenes/"):
          self.assertEqual((paths.root / relative).read_bytes(), content)

  def test_committed_resolution_cannot_restore_newer_external_work(self):
    with tempfile.TemporaryDirectory() as directory:
      paths, _, ids = self._book(directory)
      self._kill(paths, "apply", "committed", json.dumps(ids))
      scene = next(paths.scenes_dir.glob("0001-*.md"))
      scene.write_bytes(b"Newer external writing after committed apply\r\n")
      state = self._capture(paths)
      status = transaction_recovery_status(paths)
      with self.assertRaisesRegex(OpenAuthorError, "committed"):
        resolve_transaction_recovery(paths, fingerprint=status["fingerprint"], decisions={scene.relative_to(paths.root).as_posix(): "restore_before"})
      self.assertEqual(self._capture(paths), state)
      self.assertEqual(transaction_recovery_status(paths)["phase"], "committed")
      resolve_transaction_recovery(paths, fingerprint=status["fingerprint"], decisions={})
      self.assertEqual(self._capture(paths), state)

  def test_restore_identity_change_or_legacy_missing_id_refuses_before_any_write(self):
    for original_id in ["original-id", "", None]:
      with self.subTest(original_id=original_id), tempfile.TemporaryDirectory() as directory:
        paths, _, _ = self._book(directory)
        config = read_project_config(paths)
        if original_id is None:
          config.pop("project_id")
        else:
          config["project_id"] = original_id
        atomic_write_json(paths.config_file, config)
        original = create_revision(paths, "Original identity or legacy metadata")
        config["project_id"] = "reassigned-id"
        atomic_write_json(paths.config_file, config)
        update_scene(paths, scene_identifier="scene-0001", body="Latest author writing remains here.\n")
        create_revision(paths, "Latest identity and writing")
        before = self._capture(paths)
        records = set(paths.revision_records_dir.glob("*.json"))
        script = """
import sys
from pathlib import Path
from openauthor.project import OpenAuthorError, resolve_project
from openauthor.revisions import restore_revision
paths = resolve_project(Path(sys.argv[1]))
try:
  restore_revision(paths, sys.argv[2])
except OpenAuthorError as error:
  print(error)
  sys.exit(3)
"""
        child = subprocess.run([sys.executable, "-c", script, str(paths.root), original], capture_output=True, text=True, timeout=10)
        self.assertEqual(child.returncode, 3, child.stderr)
        self.assertIn("project identity", child.stdout)
        self.assertEqual(self._capture(paths), before)
        self.assertEqual(set(paths.revision_records_dir.glob("*.json")), records)
        self.assertFalse(transaction_recovery_status(paths)["pending"])
        # Legacy/different-identity history is still usable for a selected prose
        # restore; the author must exclude incompatible project metadata.
        scene_path = get_scene(paths, "scene-0001")["path"]
        restore_revision(paths, original, relative_paths=[scene_path])
        self.assertEqual(read_project_config(paths)["project_id"], "reassigned-id")
        self.assertEqual(get_scene(paths, "scene-0001")["body"].strip(), "Mara keeps the key.")

  def test_transaction_identity_change_rolls_back_earlier_scene_writes(self):
    with tempfile.TemporaryDirectory() as directory:
      paths, _, _ = self._book(directory)
      before = self._capture(paths)
      script = """
import sys
from pathlib import Path
from openauthor.project import OpenAuthorError, atomic_write_json, read_project_config, resolve_project
from openauthor.revisions import checkpointed_edit
from openauthor.scenes import update_scene
paths = resolve_project(Path(sys.argv[1]))
try:
  with checkpointed_edit(paths, 'Unsafe identity mutation'):
    update_scene(paths, scene_identifier='scene-0001', body='Partial transaction prose.')
    config = read_project_config(paths)
    config['project_id'] = 'another-project'
    atomic_write_json(paths.config_file, config)
except OpenAuthorError as error:
  print(error)
  sys.exit(3)
"""
      child = subprocess.run([sys.executable, "-c", script, str(paths.root)], capture_output=True, text=True, timeout=10)
      self.assertEqual(child.returncode, 3, child.stderr)
      self.assertIn("project identity", child.stdout)
      self.assertEqual(self._capture(paths), before)
      self.assertFalse(transaction_recovery_status(paths)["pending"])

  def test_single_apply_and_undo_recover_scene_proposal_and_head_together(self):
    for operation in ["apply_one", "undo_one"]:
      for stage in ["scene", "head", "proposal"]:
        with self.subTest(operation=operation, stage=stage), tempfile.TemporaryDirectory() as directory:
          paths, _, ids = self._book(directory)
          if operation == "undo_one":
            apply_proposal(paths, proposal_id=ids[0])
          before = self._capture(paths)
          self._kill(paths, operation, stage, ids[0])
          get_proposal(paths, proposal_id=ids[0])
          self.assertEqual(self._capture(paths), before)
          if operation == "apply_one":
            apply_proposal(paths, proposal_id=ids[0])
          undo_proposal(paths, proposal_id=ids[0])
          self.assertEqual(get_scene(paths, "scene-0001")["body"].strip(), "Mara keeps the key.")

  def test_recovery_itself_can_be_killed_and_safely_repeated(self):
    with tempfile.TemporaryDirectory() as directory:
      paths, _, ids = self._book(directory)
      before = self._capture(paths)
      self._kill(paths, "apply", "proposal", json.dumps(ids))
      self._kill(paths, "recover", "scene", "")
      self.assertTrue(transaction_recovery_status(paths)["pending"])
      get_scene(paths, "scene-0002")
      self.assertEqual(self._capture(paths), before)
      self.assertFalse(transaction_recovery_status(paths)["pending"])

  def test_codex_read_recovers_snapshot_and_runtime_database_after_killed_restore(self):
    with tempfile.TemporaryDirectory() as directory:
      paths, _, _ = self._book(directory)
      identifier = add_entity(paths, kind="character", name="Mara", description="Original description")
      original = create_revision(paths, "Original Memory")
      update_entity(paths, entity_id=identifier, description="Latest author description")
      create_revision(paths, "Later Memory")
      before = self._capture(paths)
      self._kill(paths, "restore", "before_commit", original)
      self.assertEqual(get_entity(paths, identifier)["description"], "Latest author description")
      self.assertEqual(self._capture(paths), before)

  def test_killed_restore_recovers_all_files_and_head(self):
    for stage in ["scene", "head", "before_commit"]:
      with self.subTest(stage=stage), tempfile.TemporaryDirectory() as directory:
        paths, original, _ = self._book(directory)
        update_scene(paths, scene_identifier="scene-0001", body="Later original author writing.")
        update_scene(paths, scene_identifier="scene-0002", body="A different ending.")
        create_revision(paths, "Later book")
        before = self._capture(paths)
        self._kill(paths, "restore", stage, original)
        get_scene(paths, "scene-0001")
        self.assertEqual(self._capture(paths), before)
        restore_revision(paths, original)
        self.assertEqual(get_scene(paths, "scene-0001")["body"].strip(), "Mara keeps the key.")

  def test_new_external_writing_requires_review_and_stale_review_cannot_overwrite_it(self):
    with tempfile.TemporaryDirectory() as directory:
      paths, _, ids = self._book(directory)
      before = self._capture(paths)
      self._kill(paths, "apply", "scene", json.dumps(ids))
      scene = next(paths.scenes_dir.glob("0001-*.md"))
      scene.write_bytes(b"New external author writing\r\n")
      with self.assertRaisesRegex(OpenAuthorError, "newer external"):
        get_scene(paths, "scene-0002")
      status = transaction_recovery_status(paths)
      choice = {scene.relative_to(paths.root).as_posix(): "keep_current"}
      scene.write_bytes(b"Even newer external writing\r\n")
      with self.assertRaisesRegex(OpenAuthorError, "comparison changed"):
        resolve_transaction_recovery(paths, fingerprint=status["fingerprint"], decisions=choice)
      self.assertEqual(scene.read_bytes(), b"Even newer external writing\r\n")
      status = transaction_recovery_status(paths)
      resolve_transaction_recovery(paths, fingerprint=status["fingerprint"], decisions=choice)
      self.assertEqual(scene.read_bytes(), b"Even newer external writing\r\n")
      self.assertFalse(transaction_recovery_status(paths)["pending"])
      for relative, content in before.items():
        if relative != scene.relative_to(paths.root).as_posix():
          self.assertEqual((paths.root / relative).read_bytes(), content)

  def test_storyline_change_refuses_recovery_without_replacing_any_file(self):
    with tempfile.TemporaryDirectory() as directory:
      paths, _, ids = self._book(directory)
      subprocess.run(["git", "init", "-b", "primary", directory], check=True, capture_output=True)
      self._kill(paths, "apply", "scene", json.dumps(ids))
      before = self._capture(paths)
      (paths.root / ".git/HEAD").write_text("ref: refs/heads/alternate\n")
      with self.assertRaisesRegex(OpenAuthorError, "another Storyline"):
        get_scene(paths, "scene-0001")
      status = transaction_recovery_status(paths)
      self.assertFalse(status["scope_matches"])
      with self.assertRaisesRegex(OpenAuthorError, "original Storyline"):
        resolve_transaction_recovery(paths, fingerprint=status["fingerprint"], decisions={})
      self.assertEqual(self._capture(paths), before)
      (paths.root / ".git/HEAD").write_text("ref: refs/heads/primary\n")
      get_scene(paths, "scene-0001")
      self.assertFalse(transaction_recovery_status(paths)["pending"])

  def test_killed_scene_creation_removes_only_uncommitted_new_scene(self):
    with tempfile.TemporaryDirectory() as directory:
      paths, _, _ = self._book(directory)
      before = self._capture(paths)
      self._kill(paths, "create", "scene", "")
      self.assertEqual(len(list(paths.scenes_dir.glob("*.md"))), 3)
      get_scene(paths, "scene-0001")
      self.assertEqual(self._capture(paths), before)

  def test_recovery_commands_inspect_and_resolve_without_normal_read(self):
    with tempfile.TemporaryDirectory() as directory:
      paths, _, ids = self._book(directory)
      self._kill(paths, "apply", "scene", json.dumps(ids))
      scene = next(paths.scenes_dir.glob("0001-*.md"))
      scene.write_text("External prose")
      args = [sys.executable, "-m", "openauthor", "project"]
      inspected = subprocess.run([*args, "recovery-status", "--json"], cwd=directory, capture_output=True, text=True, env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])})
      self.assertEqual(inspected.returncode, 0, inspected.stderr)
      status = json.loads(inspected.stdout)
      resolved = subprocess.run([*args, "recovery-resolve", "--fingerprint", status["fingerprint"], "--decisions", json.dumps({scene.relative_to(paths.root).as_posix(): "restore_before"}), "--json"], cwd=directory, capture_output=True, text=True, env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])})
      self.assertEqual(resolved.returncode, 0, resolved.stderr)
      self.assertEqual(get_scene(paths, "scene-0001")["body"].strip(), "Mara keeps the key.")
