from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from openauthor.codex import add_entity
from openauthor.planning import update_brief
from openauthor.project import initialize_project
from openauthor.scenes import add_scene
from openauthor.search import search_project


class ProjectSearchTests(unittest.TestCase):
  def test_searches_prose_planning_and_structured_memory(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Searchable")
      add_scene(paths, title="The Archive", body="Mara hides the amber key under the seventh stair.")
      add_entity(
        paths,
        kind="item",
        name="Gate Key",
        details=[{"key": "material", "type": "text", "value": "amber"}],
        notes="The key remembers previous bearers.",
      )
      update_brief(paths, themes=["memory", "chosen identity"])

      amber = search_project(paths, "amber")
      self.assertEqual({row["source_kind"] for row in amber}, {"scene", "memory"})
      memory = search_project(paths, "chosen identity")
      self.assertEqual(memory[0]["source_kind"], "plan")
      self.assertIn("chosen identity", memory[0]["excerpt"])


if __name__ == "__main__":
  unittest.main()
