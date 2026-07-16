from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from openauthor.product_signals import (
  get_local_product_dashboard,
  record_product_event,
  update_product_signal_settings,
)
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.scenes import add_scene


class ProductSignalTests(unittest.TestCase):
  def test_dashboard_is_local_content_free_and_tracks_golden_loop(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Private Metrics")
      add_scene(paths, title="The Vault", body="Mara turns the key.")
      record_product_event(paths, "change_hunk_decided", decision="accepted")
      record_product_event(
        paths,
        "change_set_applied",
        accepted_hunks=1,
        total_hunks=1,
        partial=False,
        changed=True,
      )
      record_product_event(paths, "change_set_undone")

      report = get_local_product_dashboard(paths)

      self.assertTrue(report["privacy"]["content_free"])
      self.assertTrue(report["privacy"]["local_only"])
      self.assertFalse(report["privacy"]["external_telemetry_enabled"])
      self.assertTrue(report["activation"]["golden_loop_completed"])
      self.assertEqual(report["trust"]["hunk_acceptance_rate"], 1.0)
      raw = (paths.project_dir / "product_events.jsonl").read_text(encoding="utf-8")
      self.assertNotIn("Mara", raw)
      self.assertNotIn("Vault", raw)
      for line in raw.splitlines():
        json.loads(line)

  def test_signal_schema_rejects_content_and_collection_can_be_disabled(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Signal Controls")
      with self.assertRaises(OpenAuthorError):
        record_product_event(paths, "scene_created", manuscript_text="secret")
      before = get_local_product_dashboard(paths)["event_count"]
      update_product_signal_settings(paths, local_signals_enabled=False)
      self.assertFalse(record_product_event(paths, "scene_created", word_count=10))
      self.assertEqual(get_local_product_dashboard(paths)["event_count"], before)


if __name__ == "__main__":
  unittest.main()
