from __future__ import annotations

import json
import math
import tempfile
import unittest
from pathlib import Path

from openauthor.codex import add_entity, get_entity, list_entities, replace_runtime_codex_from_snapshot, update_entity
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.scenes import add_scene


class MemoryDetailValuesTests(unittest.TestCase):
  def setUp(self):
    temporary = tempfile.TemporaryDirectory()
    self.addCleanup(temporary.cleanup)
    self.paths = initialize_project(Path(temporary.name), name="Typed Memory values")
    add_scene(self.paths, title="Opening", body="Mara enters.")
    self.reference = add_entity(self.paths, kind="location", name="Archive", ai_visibility="exclude")
    self.entity_id = add_entity(self.paths, kind="character", name="Mara", notes="Private author notes",
      details=[{"key": "Age", "type": "number", "value": 31, "ai_visibility": "ask"}])

  def test_invalid_typed_values_fail_before_creation_or_update(self):
    invalid = [
      ("number", "31"), ("number", True), ("number", math.nan), ("number", math.inf), ("number", 9007199254740993),
      ("boolean", "true"), ("boolean", 1), ("boolean", None),
      ("date", "2026-02-30"), ("date", "2026-1-01"), ("date", "tomorrow"), ("date", 20260101),
      ("text", 31), ("text", None),
      ("list", "a,b"), ("list", {}), ("list", [math.nan]), ("list", [(1, 2)]), ("list", [{1: "bad key"}]),
      ("scene", "scene-missing"), ("scene", None), ("entity", "entity-missing"), ("entity", 31),
    ]
    before = get_entity(self.paths, self.entity_id)
    snapshot = (self.paths.root / "codex/codex.json").read_bytes()
    for number, (kind, value) in enumerate(invalid):
      detail = {"key": "Invalid detail", "type": kind, "value": value}
      with self.subTest(kind=kind, value=value, operation="add"):
        with self.assertRaisesRegex(OpenAuthorError, "Invalid detail"):
          add_entity(self.paths, kind="item", name=f"Rejected {number}", details=[detail])
        self.assertEqual(len(list_entities(self.paths)), 2)
        self.assertEqual((self.paths.root / "codex/codex.json").read_bytes(), snapshot)
      with self.subTest(kind=kind, value=value, operation="update"):
        with self.assertRaisesRegex(OpenAuthorError, "Invalid detail"):
          update_entity(self.paths, entity_id=self.entity_id, description="Do not save this", details=[detail])
        self.assertEqual(get_entity(self.paths, self.entity_id), before)
        self.assertEqual((self.paths.root / "codex/codex.json").read_bytes(), snapshot)

  def test_all_supported_values_round_trip_without_coercion_or_visibility_changes(self):
    details = [
      {"key": "Age", "type": "number", "value": 31, "ai_visibility": "ask"},
      {"key": "Distance", "type": "number", "value": -2.5, "ai_visibility": "include"},
      {"key": "Ready", "type": "boolean", "value": False, "ai_visibility": "exclude"},
      {"key": "Birthday", "type": "date", "value": "2024-02-29", "ai_visibility": "include"},
      {"key": "First seen", "type": "scene", "value": "scene-0001", "ai_visibility": "include"},
      {"key": "Home", "type": "entity", "value": self.reference, "ai_visibility": "ask"},
      {"key": "Inventory", "type": "list", "value": ["key", 2, False, None, {"color": "blue"}, [1]], "ai_visibility": "exclude"},
      {"key": "Description", "type": "text", "value": "🌙 e\u0301lan", "ai_visibility": "include"},
    ]
    updated = update_entity(self.paths, entity_id=self.entity_id, details=details)
    self.assertEqual(updated["details"], details)
    self.assertIs(type(updated["details"][0]["value"]), int)
    self.assertIs(type(updated["details"][2]["value"]), bool)
    self.assertEqual(updated["notes"], "Private author notes")
    replace_runtime_codex_from_snapshot(self.paths)
    self.assertEqual(get_entity(self.paths, self.entity_id)["details"], details)

  def test_malformed_or_duplicate_detail_rows_cannot_silently_erase_values(self):
    invalid = [
      {"Age": 31}, [31], [{"key": "", "type": "number", "value": 31}],
      [{"key": 31, "type": "text", "value": "age"}],
      [{"key": "Age", "type": "number", "value": 31}, {"key": "age", "type": "number", "value": "bad"}],
    ]
    before = get_entity(self.paths, self.entity_id)
    for values in invalid:
      with self.subTest(values=values):
        with self.assertRaisesRegex(OpenAuthorError, "Invalid detail"):
          update_entity(self.paths, entity_id=self.entity_id, details=values)
        self.assertEqual(get_entity(self.paths, self.entity_id), before)

  def test_legacy_values_survive_restore_unrelated_and_privacy_edits_without_coercion(self):
    snapshot_path = self.paths.root / "codex/codex.json"
    payload = json.loads(snapshot_path.read_text())
    legacy = [
      {"key": "Age", "type": "number", "value": "thirty one", "ai_visibility": "ask"},
      {"key": "Ready", "type": "boolean", "value": "sometimes", "ai_visibility": "exclude"},
      {"key": "Date", "type": "date", "value": "winter", "ai_visibility": "include"},
      {"key": "Home", "type": "entity", "value": "removed-entity", "ai_visibility": "include"},
      {"key": "Scene", "type": "scene", "value": "removed-scene", "ai_visibility": "include"},
      {"key": "Inventory", "type": "list", "value": "key, coat", "ai_visibility": "include"},
    ]
    for row in payload["entities"]:
      if row["id"] == self.entity_id:
        row["details"] = legacy
    snapshot_path.write_text(json.dumps(payload))
    replace_runtime_codex_from_snapshot(self.paths)
    self.assertEqual(get_entity(self.paths, self.entity_id)["details"], legacy)
    changed = [{**row, "ai_visibility": "exclude"} for row in legacy]
    updated = update_entity(self.paths, entity_id=self.entity_id, description="Author correction", details=changed)
    self.assertEqual([row["value"] for row in updated["details"]], [row["value"] for row in legacy])
    self.assertTrue(all(row["ai_visibility"] == "exclude" for row in updated["details"]))
    with self.assertRaisesRegex(OpenAuthorError, "Invalid detail"):
      update_entity(self.paths, entity_id=self.entity_id, details=[{**changed[0], "value": "still not a number"}, *changed[1:]])
    self.assertEqual(get_entity(self.paths, self.entity_id), updated)
    corrected = update_entity(self.paths, entity_id=self.entity_id, details=[{**changed[0], "value": 31}, *changed[1:]])
    self.assertEqual(corrected["details"][0]["value"], 31)
    self.assertEqual(corrected["details"][1:], changed[1:])
