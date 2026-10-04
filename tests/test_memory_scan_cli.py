from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from openauthor.codex import list_entities
from openauthor.project import initialize_project
from openauthor.scenes import add_scene, get_scene, update_scene
from openauthor.story_memory import list_memory_suggestions


class MemoryScanCliTests(unittest.TestCase):
  def setUp(self):
    directory = tempfile.TemporaryDirectory()
    self.addCleanup(directory.cleanup)
    self.paths = initialize_project(Path(directory.name), name="Reviewed Memory CLI")
    add_scene(self.paths, title="The gate", body="Mara waits. Mara keeps the key. 小林来了。")
    add_scene(self.paths, title="Unselected draft", body="UNREVIEWED-SCENE")
    self.request = {"scene_ids": ["scene-0001"], "provider": "local", "model": ""}

  def command(self, action, request):
    return subprocess.run([sys.executable, "-m", "openauthor", "memory", action,
      "--request-json", json.dumps(request), "--json"], cwd=self.paths.root,
      env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])},
      capture_output=True, text=True, timeout=15)

  def preview(self):
    result = self.command("scan-preview", self.request)
    self.assertEqual(result.returncode, 0, result.stderr)
    return json.loads(result.stdout)

  def test_preview_exports_the_exact_chosen_source_without_queuing_or_editing(self):
    scene = get_scene(self.paths, "scene-0001")
    preview = self.preview()
    self.assertEqual(preview["scenes"], [{"scene_id": scene["id"], "title": scene["title"], "body": scene["body"]}])
    self.assertNotIn("UNREVIEWED-SCENE", json.dumps(preview))
    self.assertTrue(preview["fingerprint"])
    self.assertEqual(preview["provider"], "local")
    self.assertEqual(list_memory_suggestions(self.paths), [])
    self.assertEqual(list_entities(self.paths), [])
    self.assertEqual(get_scene(self.paths, "scene-0001"), scene)

  def test_local_send_requires_review_and_keeps_candidates_unconfirmed(self):
    preview = self.preview()
    before = get_scene(self.paths, "scene-0001")
    result = self.command("scan-ai", {**self.request, "expected_fingerprint": preview["fingerprint"]})
    self.assertEqual(result.returncode, 0, result.stderr)
    report = json.loads(result.stdout)
    self.assertEqual(report["scanned_scenes"], 1)
    self.assertTrue(report["suggestions"])
    self.assertTrue(all(row["status"] == "pending" for row in report["suggestions"]))
    self.assertTrue(report["warnings"])
    self.assertEqual(list_entities(self.paths), [])
    self.assertEqual(get_scene(self.paths, "scene-0001"), before)

  def test_stale_source_refuses_the_reviewed_cli_send(self):
    preview = self.preview()
    update_scene(self.paths, scene_identifier="scene-0001", body="New saved writing.")
    result = self.command("scan-ai", {**self.request, "expected_fingerprint": preview["fingerprint"]})
    self.assertEqual(result.returncode, 2)
    self.assertRegex(result.stderr, "changed|stale|review")
    self.assertEqual(list_memory_suggestions(self.paths), [])
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"].strip(), "New saved writing.")

  def test_malformed_json_and_non_object_requests_are_recoverable_cli_errors(self):
    for value in ("{bad", "[]", "null"):
      with self.subTest(request=value):
        result = subprocess.run([sys.executable, "-m", "openauthor", "memory", "scan-preview",
          "--request-json", value, "--json"], cwd=self.paths.root,
          env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])},
          capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 2)
        self.assertRegex(result.stderr, "Memory scan request must be (valid JSON|an object)")
        self.assertNotIn("Traceback", result.stderr)

