from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from openauthor.editorial import add_editorial_pass, list_editorial_passes
from openauthor.project import initialize_project


class EditorialPassTests(unittest.TestCase):
  def test_built_in_and_custom_passes_are_portable(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Editorial")
      built_ins = list_editorial_passes(paths)
      self.assertGreaterEqual(len(built_ins), 7)
      self.assertIn("Pacing", {row["name"] for row in built_ins})
      custom = add_editorial_pass(
        paths,
        name="Gothic Restraint",
        goal="Keep dread suggestive rather than explicit.",
        instruction="Replace explicit horror with implication and sensory residue.",
        evaluation_criteria=["implication", "voice"],
      )
      self.assertFalse(custom["built_in"])
      self.assertTrue(paths.project_dir.joinpath("editorial_passes.json").exists())


if __name__ == "__main__":
  unittest.main()
