from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from openauthor.ai import generate_proposal_draft
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.proposals import (
  apply_proposal,
  apply_proposal_batch,
  create_proposal,
  get_proposal,
  list_proposals,
  rebase_proposal_change_set,
  set_proposal_draft,
  undo_proposal,
  update_change_hunk,
  update_proposal_status,
)
from openauthor.scenes import add_scene, get_scene, update_scene


class ProposalModuleTests(unittest.TestCase):
  def test_coordinated_change_set_applies_multiple_scenes_in_one_revision(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Coordinated Revision")
      add_scene(paths, title="Approach", body="Mara approaches the gate.")
      add_scene(paths, title="Crossing", body="Mara crosses alone.")
      proposal_ids = []
      for scene_id, body in [
        ("scene-0001", "Mara runs toward the burning gate."),
        ("scene-0002", "Mara and Iven cross together."),
      ]:
        proposal_id = create_proposal(
          paths,
          title="Alternate ending",
          instruction="Coordinate the ending.",
          scene_id=scene_id,
          change_group_id="ending-group",
        )
        set_proposal_draft(paths, proposal_id=proposal_id, proposed_body=body)
        proposal_ids.append(proposal_id)

      result = apply_proposal_batch(paths, proposal_ids=proposal_ids)
      self.assertEqual(result["change_group_id"], "ending-group")
      self.assertEqual(len({row["applied_revision"] for row in result["proposals"]}), 1)
      self.assertIn("burning gate", get_scene(paths, "scene-0001")["body"])
      self.assertIn("Iven", get_scene(paths, "scene-0002")["body"])

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
        body="The signal began to drift.",
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
        body="The signal began to drift.",
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
      self.assertIn("The signal drifted.", drafted["proposed_body"])
      self.assertEqual(drafted["draft"]["provider"], "local")
      self.assertFalse(drafted["stale"])

      applied = apply_proposal(paths, proposal_id=proposal_id, notes="ship it")
      self.assertEqual(applied["status"], "applied")
      self.assertTrue(applied["applied_changes"])
      self.assertFalse((root / ".git").exists())

      scene = get_scene(paths, "scene-0001")
      self.assertEqual(scene["body"].rstrip("\n"), applied["proposed_body"].rstrip("\n"))
      # Applied proposal should not report stale against the body it wrote.
      self.assertFalse(get_proposal(paths, proposal_id)["stale"])

      undone = undo_proposal(paths, proposal_id=proposal_id)
      self.assertTrue(undone["undone_at"])
      self.assertTrue(undone["undo_revision"])
      self.assertIn("The signal began to drift.", get_scene(paths, "scene-0001")["body"])

      with self.assertRaisesRegex(OpenAuthorError, "already been undone"):
        undo_proposal(paths, proposal_id=proposal_id)

  def test_local_draft_targets_ominous_final_paragraph_without_format_only_hunks(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Targeted Local Draft")
      add_scene(
        paths,
        title="The Map",
        body=(
          "The map remembered roads that had never existed.\n\n"
          "Ilyra held it beneath the lantern.\n\n"
          "At midnight, the line reached her own door."
        ),
      )
      proposal_id = create_proposal(
        paths,
        title="Darken the ending",
        instruction=(
          "Tighten the final paragraph so the arrival feels more ominous "
          "without changing the facts."
        ),
        scene_id="scene-0001",
      )

      drafted = generate_proposal_draft(paths, proposal_id=proposal_id, provider="local")

      self.assertIn("At midnight, the line found her own door.", drafted["proposed_body"])
      self.assertEqual(len(drafted["change_set"]["hunks"]), 1)
      self.assertIn("reached", drafted["change_set"]["hunks"][0]["before_text"])
      self.assertIn("found", drafted["change_set"]["hunks"][0]["after_text"])

  def test_local_draft_rejects_format_only_or_unchanged_output(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="No Fake Draft")
      add_scene(paths, title="Stillness", body="Nothing changed.")
      proposal_id = create_proposal(
        paths,
        title="Vague request",
        instruction="Improve this.",
        scene_id="scene-0001",
      )

      with self.assertRaisesRegex(OpenAuthorError, "did not produce a prose change"):
        generate_proposal_draft(paths, proposal_id=proposal_id, provider="local")

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
        body="The signal began to pulse.",
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

      update_scene(paths, scene_identifier="scene-0001", body="New work after apply.")
      with self.assertRaisesRegex(OpenAuthorError, "protect newer work"):
        undo_proposal(paths, proposal_id=proposal_id)

  def test_apply_without_draft_is_rejected(self) -> None:
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
      with self.assertRaisesRegex(OpenAuthorError, "Draft it before applying"):
        apply_proposal(paths, proposal_id=proposal_id)
      self.assertIn("Initial text.", get_scene(paths, "scene-0001")["body"])

  def test_apply_identical_draft_is_not_recorded_as_a_change(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="No-op Draft")
      add_scene(paths, title="Scene One", body="Keep this exact prose.")
      proposal_id = create_proposal(
        paths,
        title="No-op",
        instruction="Do not change anything.",
        scene_id="scene-0001",
      )
      set_proposal_draft(
        paths,
        proposal_id=proposal_id,
        proposed_body=get_scene(paths, "scene-0001")["body"],
      )

      with self.assertRaisesRegex(OpenAuthorError, "identical"):
        apply_proposal(paths, proposal_id=proposal_id)
      self.assertEqual(get_proposal(paths, proposal_id)["status"], "pending")
      self.assertFalse(paths.revision_head_file.exists())

  def test_partial_hunk_acceptance_applies_only_selected_prose(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Partial Change Set")
      add_scene(
        paths,
        title="Scene One",
        body="Mara reached the gate. She waited. The bells rang.",
      )
      proposal_id = create_proposal(
        paths,
        title="Increase urgency",
        instruction="Sharpen the arrival and ending.",
        scene_id="scene-0001",
      )
      before = get_scene(paths, "scene-0001")["body"]
      proposed = before.replace("Mara reached the gate.", "Mara sprinted to the iron gate.")
      proposed = proposed.replace("The bells rang.", "The bells shattered the silence.")
      drafted = set_proposal_draft(paths, proposal_id=proposal_id, proposed_body=proposed)
      self.assertEqual(drafted["change_set"]["schema_version"], 1)
      self.assertEqual(len(drafted["change_set"]["hunks"]), 2)

      first_hunk = drafted["change_set"]["hunks"][0]["id"]
      update_change_hunk(
        paths,
        proposal_id=proposal_id,
        hunk_id=first_hunk,
        decision="rejected",
      )
      applied = apply_proposal(paths, proposal_id=proposal_id)
      body = get_scene(paths, "scene-0001")["body"]
      self.assertIn("Mara reached the gate.", body)
      self.assertIn("The bells shattered the silence.", body)
      self.assertEqual(applied["rejected_hunk_ids"], [first_hunk])
      self.assertEqual(len(applied["accepted_hunk_ids"]), 1)

  def test_apply_blocks_selected_hunks_that_remove_protected_text(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Protected Text")
      add_scene(paths, title="Oath", body='Mara said, "I will return."')
      proposal_id = create_proposal(
        paths,
        title="Rewrite oath",
        instruction="Shorten the oath.",
        scene_id="scene-0001",
        revision_intent={
          "goal": "Shorten the oath.",
          "scope": "scene",
          "constraints": [],
          "protected_elements": ['"I will return."'],
        },
      )
      before = get_scene(paths, "scene-0001")["body"]
      drafted = set_proposal_draft(
        paths,
        proposal_id=proposal_id,
        proposed_body=before.replace('"I will return."', "she would return."),
      )
      self.assertEqual(drafted["change_set"]["impact_report"]["risk"], "high")
      with self.assertRaisesRegex(OpenAuthorError, "protected text"):
        apply_proposal(paths, proposal_id=proposal_id)

  def test_stale_change_set_rebases_only_when_source_passage_is_unchanged(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Safe Rebase")
      add_scene(paths, title="Gate", body="Mara reached the gate. She waited.")
      proposal_id = create_proposal(
        paths,
        title="Sharpen arrival",
        instruction="Increase urgency.",
        scene_id="scene-0001",
      )
      before = get_scene(paths, "scene-0001")["body"]
      set_proposal_draft(
        paths,
        proposal_id=proposal_id,
        proposed_body=before.replace("Mara reached the gate.", "Mara sprinted to the gate."),
      )
      update_scene(
        paths,
        scene_identifier="scene-0001",
        body="A bell rang. " + before,
      )
      rebased = rebase_proposal_change_set(paths, proposal_id=proposal_id)
      self.assertEqual(rebased["rebase_report"]["status"], "rebased")
      self.assertFalse(rebased["stale"])
      apply_proposal(paths, proposal_id=proposal_id)
      self.assertIn("A bell rang.", get_scene(paths, "scene-0001")["body"])
      self.assertIn("Mara sprinted to the gate.", get_scene(paths, "scene-0001")["body"])


if __name__ == "__main__":
  unittest.main()
