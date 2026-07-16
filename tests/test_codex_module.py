from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from openauthor.codex import (
  add_entity,
  add_relationship,
  delete_relationship,
  get_entity,
  list_entities,
  list_relationships,
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

  def test_structured_story_memory_details_and_relationships_round_trip(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Structured Memory")
      hero_id = add_entity(
        paths,
        kind="character",
        name="Mara Vale",
        description="A courier with a borrowed memory.",
        category="protagonist",
        aliases=["The Courier", "Mara"],
        tags=["POV", "Archive"],
        details=[
          {"key": "age", "type": "number", "value": 31},
          {"key": "secret", "type": "text", "value": "She opened the gate", "ai_visibility": "ask"},
        ],
        notes="Do not resolve her parentage in book one.",
        ai_visibility="include",
        scope="series",
      )
      city_id = add_entity(paths, kind="location", name="Bellweather")
      relationship = add_relationship(
        paths,
        source_entity_id=hero_id,
        target_entity_id=city_id,
        relation="exiled from",
        notes="Since the winter trial.",
        valid_from_scene_id="scene-0001",
      )

      hero = get_entity(paths, hero_id)
      self.assertEqual(hero["aliases"], ["The Courier", "Mara"])
      self.assertEqual(hero["details"][0]["value"], 31)
      self.assertEqual(hero["scope"], "series")
      rows = list_relationships(paths, entity_id=hero_id)
      self.assertEqual(rows[0]["relation"], "exiled from")
      self.assertEqual(rows[0]["target_name"], "Bellweather")
      self.assertEqual(rows[0]["valid_from_scene_id"], "scene-0001")

      payload = json.loads((root / "codex" / "codex.json").read_text(encoding="utf-8"))
      self.assertEqual(payload["entities"][0 if payload["entities"][0]["id"] == hero_id else 1]["category"], "protagonist")
      deleted = delete_relationship(paths, relationship["id"])
      self.assertTrue(deleted["deleted"])
      self.assertEqual(list_relationships(paths), [])


if __name__ == "__main__":
  unittest.main()
