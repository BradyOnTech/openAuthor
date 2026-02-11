from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from openauthor.codex import add_entity, get_entity, list_entities, update_entity
from openauthor.project import OpenAuthorError, initialize_project


class CodexModuleTests(unittest.TestCase):
  def test_entity_lifecycle(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Codex Lifecycle")

      entity_id = add_entity(
        paths,
        kind="character",
        name="Elara",
        description="Original description.",
      )
      created = get_entity(paths, entity_id)
      self.assertEqual(created["name"], "Elara")
      self.assertEqual(created["type"], "character")

      updated = update_entity(
        paths,
        entity_id=entity_id,
        description="Updated description.",
      )
      self.assertEqual(updated["description"], "Updated description.")

      rows = list_entities(paths)
      self.assertEqual(len(rows), 1)
      self.assertEqual(rows[0]["id"], entity_id)

  def test_unknown_entity_errors(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Unknown Codex")

      with self.assertRaises(OpenAuthorError):
        get_entity(paths, "entity-missing")

      with self.assertRaises(OpenAuthorError):
        update_entity(
          paths,
          entity_id="entity-missing",
          description="Nope",
        )


if __name__ == "__main__":
  unittest.main()
