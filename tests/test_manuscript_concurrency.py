from __future__ import annotations

import tempfile
import threading
import subprocess
import sys
import os
import unittest
from pathlib import Path
from unittest.mock import patch

from openauthor.assistant.snapshots import project_mobile_snapshot
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.proposals import apply_proposal, apply_proposal_batch, create_proposal, set_proposal_draft, undo_proposal
from openauthor.revisions import create_revision, read_file_at_revision, restore_revision, revision_head
from openauthor.scenes import add_scene, get_scene, list_scene_details, update_scene


class ManuscriptConcurrencyTests(unittest.TestCase):
  def test_mobile_projection_keeps_its_revision_and_prose_together(self) -> None:
    with tempfile.TemporaryDirectory() as directory:
      paths = initialize_project(Path(directory), name="Mobile consistency", project_id="project-mobile-consistency")
      add_scene(paths, title="Letter", body="Original prose")
      baseline = create_revision(paths, "Original")
      proposal = create_proposal(paths, title="Revise", instruction="Revise", scene_id="scene-0001")
      set_proposal_draft(paths, proposal_id=proposal, proposed_body="Revised prose")
      started = threading.Event()
      done = threading.Event()
      errors = []

      def apply() -> None:
        started.set()
        try:
          apply_proposal(paths, proposal_id=proposal)
        except BaseException as error:
          errors.append(error)
        finally:
          done.set()

      writer = threading.Thread(target=apply, daemon=True)

      def read_head_then_allow_edit(project):
        head = revision_head(project)
        writer.start()
        self.assertTrue(started.wait(2))
        done.wait(0.15)
        return head

      try:
        with patch("openauthor.assistant.snapshots.revision_head", side_effect=read_head_then_allow_edit):
          artifact = project_mobile_snapshot(paths, selected_project_id="project-mobile-consistency")
      finally:
        if writer.ident is not None:
          writer.join(3)
      self.assertFalse(writer.is_alive())
      self.assertEqual(errors, [])
      self.assertEqual(artifact.manifest["revision"], baseline)
      self.assertEqual(artifact.snapshot["scenes"][0]["body"].strip(), "Original prose")
      self.assertEqual(get_scene(paths, "scene-0001")["body"].strip(), "Revised prose")

  def test_simultaneous_different_titles_receive_distinct_scene_ids(self) -> None:
    with tempfile.TemporaryDirectory() as directory:
      paths = initialize_project(Path(directory), name="Concurrent scene creation")
      first_at_create = threading.Event()
      release_first = threading.Event()
      second_started = threading.Event()
      second_finished = threading.Event()
      errors = []
      real_open = os.open

      def pause_first(path, flags, *args, **kwargs):
        if str(path).endswith("0001-first.md") and flags & os.O_EXCL:
          first_at_create.set()
          if not release_first.wait(3):
            raise RuntimeError("Scene creation was not released")
        return real_open(path, flags, *args, **kwargs)

      def add(title):
        if title == "Second":
          second_started.set()
        try:
          add_scene(paths, title=title, body=f"{title} prose")
        except BaseException as error:
          errors.append(error)
        finally:
          if title == "Second":
            second_finished.set()

      first = threading.Thread(target=add, args=("First",), daemon=True)
      second = threading.Thread(target=add, args=("Second",), daemon=True)
      with patch("openauthor.scenes.os.open", side_effect=pause_first):
        try:
          first.start()
          self.assertTrue(first_at_create.wait(2))
          second.start()
          self.assertTrue(second_started.wait(2))
          second_finished.wait(0.15)
        finally:
          release_first.set()
          first.join(3)
          if second.ident is not None:
            second.join(3)
      self.assertFalse(first.is_alive() or second.is_alive())
      self.assertEqual(errors, [])
      scenes = list_scene_details(paths)
      self.assertEqual({scene["id"] for scene in scenes}, {"scene-0001", "scene-0002"})
      self.assertEqual({scene["body"].strip() for scene in scenes}, {"First prose", "Second prose"})

  def test_reader_never_sees_provisional_prose_from_a_failed_apply(self) -> None:
    with tempfile.TemporaryDirectory() as directory:
      paths = initialize_project(Path(directory), name="Committed reads")
      add_scene(paths, title="Letter", body="Original prose")
      proposal = create_proposal(paths, title="Revise", instruction="Revise", scene_id="scene-0001")
      set_proposal_draft(paths, proposal_id=proposal, proposed_body="Provisional prose")
      started = threading.Event()
      done = threading.Event()
      read_bodies = []
      errors = []

      def read() -> None:
        started.set()
        try:
          read_bodies.append(get_scene(paths, "scene-0001")["body"].strip())
          read_bodies.extend(scene["body"].strip() for scene in list_scene_details(paths))
        except BaseException as error:
          errors.append(error)
        finally:
          done.set()

      reader = threading.Thread(target=read, daemon=True)

      def fail_revision(*args, **kwargs):
        if kwargs.get("kind") != "change_set_apply":
          return create_revision(*args, **kwargs)
        reader.start()
        self.assertTrue(started.wait(2))
        done.wait(0.15)
        raise OpenAuthorError("Revision storage is full")

      try:
        with patch("openauthor.proposals.create_revision", side_effect=fail_revision):
          with self.assertRaisesRegex(OpenAuthorError, "rolled back"):
            apply_proposal(paths, proposal_id=proposal)
      finally:
        if reader.ident is not None:
          reader.join(3)
      self.assertFalse(reader.is_alive())
      self.assertEqual(errors, [])
      self.assertEqual(read_bodies, ["Original prose", "Original prose"])

  def test_revision_cannot_capture_half_of_a_coordinated_apply(self) -> None:
    with tempfile.TemporaryDirectory() as directory:
      paths = initialize_project(Path(directory), name="Consistent revision")
      proposals = []
      scene_paths = []
      for index in range(1, 3):
        scene_paths.append(add_scene(paths, title=f"Scene {index}", body=f"Original {index}").relative_to(paths.root).as_posix())
        proposal = create_proposal(paths, title="Revise", instruction="Revise", scene_id=f"scene-{index:04d}")
        set_proposal_draft(paths, proposal_id=proposal, proposed_body=f"Revised {index}")
        proposals.append(proposal)
      started = threading.Event()
      done = threading.Event()
      revisions = []
      errors = []

      def snapshot() -> None:
        started.set()
        try:
          revisions.append(create_revision(paths, "Competing snapshot"))
        except BaseException as error:
          errors.append(error)
        finally:
          done.set()

      reader = threading.Thread(target=snapshot, daemon=True)

      def pause_between_scenes(*args, **kwargs):
        result = update_scene(*args, **kwargs)
        if kwargs.get("scene_identifier") == "scene-0001":
          reader.start()
          self.assertTrue(started.wait(2))
          done.wait(0.15)
        return result

      try:
        with patch("openauthor.proposals.update_scene", side_effect=pause_between_scenes):
          apply_proposal_batch(paths, proposal_ids=proposals)
      finally:
        if reader.ident is not None:
          reader.join(3)
      self.assertFalse(reader.is_alive())
      self.assertEqual(errors, [])
      self.assertEqual(len(revisions), 1)
      for index, relative in enumerate(scene_paths, 1):
        self.assertIn(f"Revised {index}", read_file_at_revision(paths, revisions[0], relative))

  def _assert_rollback_preserves_competing_save(self, operation_name: str, *, separate_process: bool = False) -> None:
    with tempfile.TemporaryDirectory() as directory:
      paths = initialize_project(Path(directory), name="Concurrent rollback")
      scene_path = add_scene(paths, title="The letter", body="The original sentence.")
      proposal = create_proposal(paths, title="Revise", instruction="Revise the letter.", scene_id="scene-0001")
      set_proposal_draft(paths, proposal_id=proposal, proposed_body="The proposed sentence.")
      module = "proposals"
      if operation_name == "apply":
        kind = "change_set_apply"
        operation = lambda: apply_proposal(paths, proposal_id=proposal)
      elif operation_name == "batch":
        add_scene(paths, title="The answer", body="The original answer.")
        other = create_proposal(paths, title="Revise answer", instruction="Revise.", scene_id="scene-0002")
        set_proposal_draft(paths, proposal_id=other, proposed_body="The proposed answer.")
        kind = "change_group_apply"
        operation = lambda: apply_proposal_batch(paths, proposal_ids=[proposal, other])
      elif operation_name == "undo":
        apply_proposal(paths, proposal_id=proposal)
        kind = "change_set_undo"
        operation = lambda: undo_proposal(paths, proposal_id=proposal)
      else:
        saved = create_revision(paths, "Original")
        update_scene(paths, scene_identifier="scene-0001", body="The scene before restore.")
        module = "revisions"
        kind = "restore"
        operation = lambda: restore_revision(paths, saved, relative_paths=[scene_path.relative_to(paths.root).as_posix()])

      started = threading.Event()
      finished = threading.Event()
      errors: list[BaseException] = []
      process = None

      def save() -> None:
        started.set()
        try:
          update_scene(paths, scene_identifier="scene-0001", body="The author's newer saved sentence.")
        except BaseException as error:
          errors.append(error)
        finally:
          finished.set()

      writer = threading.Thread(target=save, daemon=True)

      def fail_revision(*args, **kwargs):
        nonlocal process
        if kwargs.get("kind") != kind:
          return create_revision(*args, **kwargs)
        if separate_process:
          process = subprocess.Popen([
            sys.executable, "-u", "-c",
            "from pathlib import Path; import sys; "
            "from openauthor.project import get_project_paths; "
            "from openauthor.scenes import update_scene; "
            "print('saving', flush=True); "
            "update_scene(get_project_paths(Path(sys.argv[1])), scene_identifier='scene-0001', "
            "body=\"The author's newer saved sentence.\"); print('saved', flush=True)",
            str(paths.root),
          ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
          self.assertEqual(process.stdout.readline().strip(), "saving")
          try:
            process.wait(timeout=0.2)
          except subprocess.TimeoutExpired:
            pass
        else:
          writer.start()
          self.assertTrue(started.wait(2))
          finished.wait(0.2)
        raise OpenAuthorError("Revision storage is full")

      try:
        with patch(f"openauthor.{module}.create_revision", side_effect=fail_revision):
          with self.assertRaisesRegex(OpenAuthorError, "rolled back"):
            operation()
      finally:
        if process is not None:
          try:
            stdout, stderr = process.communicate(timeout=5)
          except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()
            self.fail("Competing process did not resume after rollback")
          self.assertEqual(process.returncode, 0, stderr)
          self.assertEqual(stdout.strip(), "saved")
        if writer.ident is not None:
          writer.join(timeout=3)
      self.assertFalse(writer.is_alive(), "Competing save did not resume after rollback")
      self.assertEqual(errors, [])
      self.assertEqual(get_scene(paths, "scene-0001")["body"].strip(), "The author's newer saved sentence.")
      if operation_name == "batch":
        self.assertEqual(get_scene(paths, "scene-0002")["body"].strip(), "The original answer.")

  def test_failed_apply_does_not_erase_a_save_from_another_process(self) -> None:
    self._assert_rollback_preserves_competing_save("apply", separate_process=True)

  def test_failed_batch_does_not_erase_a_competing_save(self) -> None:
    self._assert_rollback_preserves_competing_save("batch")

  def test_failed_undo_does_not_erase_a_competing_save(self) -> None:
    self._assert_rollback_preserves_competing_save("undo")

  def test_failed_restore_does_not_erase_a_competing_save(self) -> None:
    self._assert_rollback_preserves_competing_save("restore")

  def test_failed_ai_apply_does_not_roll_back_another_writers_saved_prose(self) -> None:
    with tempfile.TemporaryDirectory() as directory:
      paths = initialize_project(Path(directory), name="Concurrent writing")
      add_scene(paths, title="The letter", body="The original sentence.")
      proposal = create_proposal(paths, title="Revise the letter", instruction="Make the letter ominous.", scene_id="scene-0001")
      set_proposal_draft(paths, proposal_id=proposal, proposed_body="The proposed sentence.")
      write_started = threading.Event()
      write_finished = threading.Event()
      writer_errors: list[BaseException] = []

      def write_new_prose() -> None:
        write_started.set()
        try:
          update_scene(paths, scene_identifier="scene-0001", body="The author's newer saved sentence.")
        except BaseException as error:
          writer_errors.append(error)
        finally:
          write_finished.set()

      writer = threading.Thread(target=write_new_prose, daemon=True)

      def failing_revision(*args, **kwargs):
        if kwargs.get("kind") != "change_set_apply":
          return create_revision(*args, **kwargs)
        writer.start()
        self.assertTrue(write_started.wait(1))
        # A protected transaction holds the competing writer until rollback.
        # Without protection the new save completes here and is then erased.
        write_finished.wait(0.2)
        raise OpenAuthorError("Revision storage is full")

      try:
        with patch("openauthor.proposals.create_revision", side_effect=failing_revision):
          with self.assertRaisesRegex(OpenAuthorError, "rolled back"):
            apply_proposal(paths, proposal_id=proposal)
      finally:
        if writer.ident is not None:
          writer.join(timeout=3)
      self.assertFalse(writer.is_alive(), "Competing save did not resume after rollback")
      self.assertEqual(writer_errors, [])
      self.assertEqual(get_scene(paths, "scene-0001")["body"].strip(), "The author's newer saved sentence.")
