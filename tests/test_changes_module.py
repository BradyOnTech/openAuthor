from __future__ import annotations

import unittest

from openauthor.changes import build_change_set, edit_hunk_after_text, rebase_change_set, render_change_set, set_hunk_decision


class ChangeSetTests(unittest.TestCase):
  def test_terminal_newline_does_not_become_a_fake_change_hunk(self) -> None:
    change_set = build_change_set(
      proposal_id="proposal-newline",
      scene_id="scene-0001",
      intent="Tighten pacing",
      before_body="First sentence.\n",
      after_body="Sharper first sentence.",
    )

    self.assertEqual(len(change_set["hunks"]), 1)
    self.assertEqual(change_set["hunks"][0]["kind"], "replace")
    self.assertEqual(change_set["proposed_body"], "Sharper first sentence.\n")

  def test_partial_acceptance_is_deterministic(self) -> None:
    before = "Mara reached the gate. She waited. The bells rang."
    after = "Mara reached the iron gate. She waited. The bells shattered the silence."
    change_set = build_change_set(
      proposal_id="proposal-demo",
      scene_id="scene-0001",
      intent="Increase urgency.",
      before_body=before,
      after_body=after,
    )
    self.assertEqual(change_set["schema_version"], 1)
    self.assertGreaterEqual(len(change_set["hunks"]), 2)
    first = change_set["hunks"][0]["id"]
    set_hunk_decision(change_set, first, "rejected")

    rendered = render_change_set(change_set)
    self.assertIn("Mara reached the gate.", rendered)
    self.assertIn("The bells shattered the silence.", rendered)
    self.assertEqual(rendered, render_change_set(change_set))

  def test_no_op_change_set_has_no_hunks(self) -> None:
    change_set = build_change_set(
      proposal_id="proposal-noop",
      scene_id="scene-0001",
      intent="Preserve prose.",
      before_body="Same prose.",
      after_body="Same prose.",
    )
    self.assertEqual(change_set["hunks"], [])
    self.assertTrue(change_set["impact_report"]["warnings"])

  def test_protected_text_violation_is_high_risk(self) -> None:
    change_set = build_change_set(
      proposal_id="proposal-protected",
      scene_id="scene-0001",
      intent="Tighten prose.",
      before_body='Mara said, "I will return."',
      after_body="Mara promised to come back.",
      protected_elements=['"I will return."'],
    )
    self.assertEqual(change_set["impact_report"]["risk"], "high")
    self.assertTrue(change_set["impact_report"]["warnings"])

  def test_direct_hunk_edit_updates_rendered_change_set(self) -> None:
    change_set = build_change_set(
      proposal_id="proposal-edit",
      scene_id="scene-0001",
      intent="Sharpen the verb.",
      before_body="Mara walked home.",
      after_body="Mara hurried home.",
    )
    hunk_id = change_set["hunks"][0]["id"]
    edit_hunk_after_text(change_set, hunk_id, "Mara sprinted home.")
    self.assertEqual(render_change_set(change_set), "Mara sprinted home.")
    self.assertEqual(change_set["hunks"][0]["edited_by"], "author")

  def test_rebase_carries_unchanged_passages_and_explains_conflicts(self) -> None:
    change_set = build_change_set(
      proposal_id="proposal-rebase",
      scene_id="scene-0001",
      intent="Sharpen arrival.",
      before_body="Mara reached the gate. She waited.",
      after_body="Mara sprinted to the gate. She waited.",
    )
    rebased, report = rebase_change_set(change_set, "A bell rang. Mara reached the gate. She waited.")
    self.assertEqual(report["status"], "rebased")
    self.assertIn("A bell rang. Mara sprinted to the gate.", render_change_set(rebased))

    unchanged, conflict = rebase_change_set(change_set, "Mara was already inside. She waited.")
    self.assertEqual(conflict["status"], "conflicted")
    self.assertEqual(unchanged["id"], change_set["id"])
    self.assertEqual(conflict["conflicts"][0]["reason"], "source_passage_changed")


if __name__ == "__main__":
  unittest.main()
