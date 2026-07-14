from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from openauthor.ai import generate_proposal_draft
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.proposals import (
  apply_proposal,
  create_proposal,
  get_proposal,
  list_proposals,
  update_proposal_status,
)
from openauthor.scenes import add_scene, get_scene, update_scene


class ProposalModuleTests(unittest.TestCase):
  def test_proposal_lifecycle(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Proposal Lifecycle")
      add_scene(
        paths,
        title="Scene One",
        summary="seed",
        pov="narrator",
        status="draft",
        body="Initial text.",
      )

      proposal_id = create_proposal(
        paths,
        title="Tighten chapter",
        instruction="Reduce exposition in opening scene.",
        scene_id="scene-0001",
      )
      created = get_proposal(paths, proposal_id)
      self.assertEqual(created["status"], "pending")
      self.assertEqual(created["source"], "manual")
      self.assertFalse(created["stale"])
      self.assertEqual(created["vcs_branch"], "")
      self.assertEqual(created["vcs_base_commit"], "")
      self.assertNotEqual(created["scene_digest"], "")

      update_scene(paths, scene_identifier="scene-0001", body="Changed text.")
      stale = get_proposal(paths, proposal_id)
      self.assertTrue(stale["stale"])

      applied = update_proposal_status(
        paths,
        proposal_id=proposal_id,
        status="applied",
        notes="Reviewed and merged.",
      )
      self.assertEqual(applied["status"], "applied")
      self.assertEqual(applied["notes"], "Reviewed and merged.")

      applied_rows = list_proposals(paths, status="applied")
      self.assertEqual(len(applied_rows), 1)
      self.assertEqual(applied_rows[0]["id"], proposal_id)

  def test_unknown_proposal_errors(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Unknown Proposal")

      with self.assertRaises(OpenAuthorError):
        get_proposal(paths, "proposal-missing")

      with self.assertRaises(OpenAuthorError):
        update_proposal_status(
          paths,
          proposal_id="proposal-missing",
          status="applied",
        )

  def test_legacy_proposals_are_migrated_to_workspace(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Proposal Migration")
      add_scene(
        paths,
        title="Scene One",
        summary="seed",
        pov="narrator",
        status="draft",
        body="Initial text.",
      )
      legacy_dir = root / ".openauthor" / "proposals"
      legacy_dir.mkdir(parents=True, exist_ok=True)
      legacy_file = legacy_dir / "proposal-legacy1234.json"
      legacy_file.write_text(
        '{"id":"proposal-legacy1234","title":"Legacy","instruction":"x",'
        '"scene_id":"scene-0001","status":"pending","created_at":"t","updated_at":"t",'
        '"notes":"","source":"manual"}\n',
        encoding="utf-8",
      )

      # Re-resolve project to trigger lazy migration path.
      from openauthor.project import resolve_project

      resolve_project(root)
      migrated = root / ".openauthor" / "workspace" / "proposals" / legacy_file.name
      self.assertTrue(migrated.exists())

  def test_draft_and_apply_writes_scene_body(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Draft Apply")
      add_scene(
        paths,
        title="Scene One",
        summary="seed",
        pov="narrator",
        status="draft",
        body="Initial text.",
      )

      proposal_id = create_proposal(
        paths,
        title="Tighten chapter",
        instruction="Reduce exposition in opening scene.",
        scene_id="scene-0001",
      )

      drafted = generate_proposal_draft(
        paths,
        proposal_id=proposal_id,
        provider="local",
      )
      self.assertTrue(str(drafted.get("proposed_body", "")).strip())
      self.assertEqual(drafted["draft"]["provider"], "local")
      self.assertFalse(drafted["stale"])

      applied = apply_proposal(paths, proposal_id=proposal_id, notes="ship it")
      self.assertEqual(applied["status"], "applied")
      self.assertTrue(applied["applied_changes"])

      scene = get_scene(paths, "scene-0001")
      self.assertEqual(scene["body"].rstrip("\n"), applied["proposed_body"].rstrip("\n"))
      # Applied proposal should not report stale against the body it wrote.
      self.assertFalse(get_proposal(paths, proposal_id)["stale"])

  def test_apply_blocks_on_stale_draft_unless_forced(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Stale Draft")
      add_scene(
        paths,
        title="Scene One",
        summary="seed",
        pov="narrator",
        status="draft",
        body="Initial text.",
      )
      proposal_id = create_proposal(
        paths,
        title="Edit",
        instruction="Add tension.",
        scene_id="scene-0001",
      )
      generate_proposal_draft(paths, proposal_id=proposal_id, provider="local")
      update_scene(paths, scene_identifier="scene-0001", body="Externally changed.")

      with self.assertRaises(OpenAuthorError):
        apply_proposal(paths, proposal_id=proposal_id)

      applied = apply_proposal(paths, proposal_id=proposal_id, force=True)
      self.assertTrue(applied["applied_changes"])
      self.assertEqual(
        get_scene(paths, "scene-0001")["body"].rstrip("\n"),
        applied["proposed_body"].rstrip("\n"),
      )

  def test_apply_without_draft_is_status_only(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="No Draft")
      add_scene(
        paths,
        title="Scene One",
        summary="seed",
        pov="narrator",
        status="draft",
        body="Initial text.",
      )
      proposal_id = create_proposal(
        paths,
        title="Edit",
        instruction="Add tension.",
        scene_id="scene-0001",
      )
      applied = apply_proposal(paths, proposal_id=proposal_id)
      self.assertEqual(applied["status"], "applied")
      self.assertFalse(applied["applied_changes"])
      self.assertIn("Initial text.", get_scene(paths, "scene-0001")["body"])


if __name__ == "__main__":
  unittest.main()
