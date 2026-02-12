from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from openauthor.codex import (
  add_entity,
  get_entity,
  list_entities,
  replace_runtime_codex_from_snapshot,
  update_entity,
)
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
      codex_snapshot = root / "codex" / "codex.json"
      self.assertTrue(codex_snapshot.exists())
      payload = json.loads(codex_snapshot.read_text(encoding="utf-8"))
      self.assertEqual(len(payload.get("entities", [])), 1)

  def test_runtime_replace_from_snapshot(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Codex Replace")

      main_id = add_entity(
        paths,
        kind="character",
        name="Mainline",
        description="Main branch entity.",
      )
      self.assertTrue(main_id.startswith("entity-"))
      snapshot_path = root / "codex" / "codex.json"
      payload = json.loads(snapshot_path.read_text(encoding="utf-8"))
      payload["entities"] = [
        {
          "id": "entity-alt000000",
          "type": "item",
          "name": "Branch Relic",
          "description": "Alternate branch entity.",
          "created_at": "2026-01-01T00:00:00+00:00",
          "updated_at": "2026-01-01T00:00:00+00:00",
        }
      ]
      payload["relationships"] = []
      snapshot_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

      replaced = replace_runtime_codex_from_snapshot(paths)
      self.assertTrue(replaced["imported"])
      self.assertEqual(replaced["source"], "snapshot")
      rows = list_entities(paths)
      self.assertEqual(len(rows), 1)
      self.assertEqual(rows[0]["name"], "Branch Relic")

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
