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


class SearchExcerptTests(unittest.TestCase):
  def setUp(self) -> None:
    import tempfile
    from openauthor.codex import add_entity, ensure_codex
    from openauthor.project import initialize_project
    from openauthor.scenes import add_scene
    self._tmp = tempfile.TemporaryDirectory()
    self.paths = initialize_project(Path(self._tmp.name) / "book", name="Excerpts")
    ensure_codex(self.paths)
    add_scene(self.paths, title="The Early Tide", pov="Wren", summary="Wren learns the tide is early.",
      body="She did not run it back. At this hour the water should have stood at the nineteenth step. The tide had come early.")
    add_entity(self.paths, kind="location", name="Saltmere", description="A harbour town built below the tide steps.")

  def tearDown(self) -> None:
    self._tmp.cleanup()

  def test_excerpts_quote_prose_around_the_match_not_titles_and_labels(self) -> None:
    from openauthor.search import search_project
    rows = {row["title"]: row["excerpt"] for row in search_project(self.paths, "tide")}
    self.assertIn("The tide had come early.", rows["The Early Tide"])
    self.assertFalse(rows["The Early Tide"].startswith("The Early Tide"))
    self.assertNotIn("draft", rows["The Early Tide"])
    self.assertEqual(rows["Saltmere"], "A harbour town built below the tide steps.")

  def test_a_title_only_match_shows_the_opening_of_the_prose(self) -> None:
    from openauthor.search import search_project
    [row] = [row for row in search_project(self.paths, "Saltmere") if row["source_kind"] == "memory"]
    self.assertTrue(row["excerpt"].startswith("A harbour town"))
