from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from openauthor.project import OpenAuthorError, initialize_project
from openauthor.proposals import (
  create_proposal,
  get_proposal,
  list_proposals,
  update_proposal_status,
)


class ProposalModuleTests(unittest.TestCase):
  def test_proposal_lifecycle(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Proposal Lifecycle")

      proposal_id = create_proposal(
        paths,
        title="Tighten chapter",
        instruction="Reduce exposition in opening scene.",
        scene_id="scene-0001",
      )
      created = get_proposal(paths, proposal_id)
      self.assertEqual(created["status"], "pending")

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


if __name__ == "__main__":
  unittest.main()
