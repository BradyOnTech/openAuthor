import json
import os
import subprocess
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from openauthor.ai import build_generation_context
from openauthor.canon import add_canon_fact, list_canon_facts, update_canon_fact, run_canon_diagnostics, add_open_question, list_open_questions
from openauthor.project import initialize_project, OpenAuthorError
from openauthor.scenes import add_scene, get_scene, update_scene


class CanonFactEditingTests(unittest.TestCase):
  def setUp(self):
    directory = tempfile.TemporaryDirectory()
    self.addCleanup(directory.cleanup)
    self.paths = initialize_project(Path(directory.name), name="Correctable Memory")
    add_scene(self.paths, title="Gate", body="The gate was blue. Later it was painted red.")
    self.fact = add_canon_fact(self.paths, subject_entity_id="", predicate="gate color", value="blue", evidence=[{"scene_id": "scene-0001", "excerpt": "The gate was blue."}])

  def editable(self):
    return list_canon_facts(self.paths, for_editing=True)[0]

  def save(self, fact, changes):
    return update_canon_fact(self.paths, fact["id"], expected_version=fact["edit_version"], changes=changes)

  def test_withdrawal_and_restoration_change_context_and_diagnostics_not_prose(self):
    add_canon_fact(self.paths, subject_entity_id="", predicate="gate color", value="red", evidence=[{"scene_id": "scene-0001", "excerpt": "painted red"}])
    before = get_scene(self.paths, "scene-0001")["body"]
    self.assertTrue(run_canon_diagnostics(self.paths)["diagnostics"])
    withdrawn = self.save(self.editable(), {"status": "rejected"})
    self.assertEqual(run_canon_diagnostics(self.paths)["diagnostics"], [])
    context = build_generation_context(self.paths, scene_id="scene-0001", context_scene_radius=0, codex_limit=8)
    self.assertNotIn(self.fact["id"], [fact["id"] for fact in context["accepted_canon"]])
    restored = self.save(withdrawn, {"status": "accepted"})
    self.assertEqual(restored["id"], self.fact["id"])
    self.assertEqual(restored["evidence"], self.fact["evidence"])
    self.assertTrue(run_canon_diagnostics(self.paths)["diagnostics"])
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"], before)

  def test_corrects_fact_and_source_without_losing_unedited_metadata(self):
    edited = self.save(self.editable(), {"value": "red", "evidence": [{"scene_id": "scene-0001", "excerpt": "painted red"}]})
    self.assertEqual(edited["value"], "red")
    for field in ("id", "created_at", "subject_entity_id", "confidence", "scope", "knowledge"):
      self.assertEqual(edited[field], self.fact[field])
    self.assertNotIn("edit_version", (self.paths.root / "codex/memory.json").read_text())
    self.assertNotIn("edit_version", list_canon_facts(self.paths)[0])

  def test_rejects_stale_fact_or_storyline_without_overwrite(self):
    stale = self.editable()
    self.save(stale, {"value": "blue paint"})
    before = (self.paths.root / "codex/memory.json").read_bytes()
    with self.assertRaisesRegex(OpenAuthorError, "changed since"):
      self.save(stale, {"status": "rejected"})
    fresh = self.editable()
    with patch("openauthor.canon.workspace_edit_scope", return_value=("another-storyline", "Other")):
      with self.assertRaisesRegex(OpenAuthorError, "changed since"):
        self.save(fresh, {"status": "rejected"})
    self.assertEqual((self.paths.root / "codex/memory.json").read_bytes(), before)

  def test_missing_evidence_can_be_withdrawn_but_not_accepted_until_corrected(self):
    update_scene(self.paths, scene_identifier="scene-0001", body="The gate was green.")
    withdrawn = self.save(self.editable(), {"status": "rejected"})
    with self.assertRaisesRegex(OpenAuthorError, "supporting passage"):
      self.save(withdrawn, {"status": "accepted"})
    restored = self.save(withdrawn, {"status": "accepted", "value": "green", "evidence": [{"scene_id": "scene-0001", "excerpt": "The gate was green."}]})
    self.assertEqual(restored["status"], "accepted")

  def test_rejects_invalid_changes_before_writing(self):
    before = (self.paths.root / "codex/memory.json").read_bytes()
    for changes in ({"value": " "}, {"status": "deleted"}, {"id": "another"}, {"evidence": []}, {"evidence": "wrong"}, {"validity": {"from_scene_id": "missing", "to_scene_id": ""}}):
      with self.subTest(changes=changes), self.assertRaises(OpenAuthorError):
        self.save(self.editable(), changes)
      self.assertEqual((self.paths.root / "codex/memory.json").read_bytes(), before)

  def test_corrections_and_other_memory_writers_preserve_each_others_records(self):
    fact = self.editable()
    with ThreadPoolExecutor(max_workers=4) as executor:
      tasks = [executor.submit(add_open_question, self.paths, question=f"Question {index}") for index in range(8)]
      tasks.append(executor.submit(self.save, fact, {"value": "blue paint"}))
      for task in tasks:
        task.result()
    self.assertEqual(len(list_open_questions(self.paths)), 8)
    self.assertEqual(self.editable()["value"], "blue paint")

  def test_cli_requires_the_loaded_version_and_forwards_correction(self):
    def command(args):
      return subprocess.run([sys.executable, "-m", "openauthor", *args, "--json"], cwd=self.paths.root, env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])}, capture_output=True, text=True)
    listed = command(["memory", "fact-list", "--for-editing"])
    self.assertEqual(listed.returncode, 0, listed.stderr)
    fact = json.loads(listed.stdout)[0]
    args = ["memory", "fact-update", "--id", fact["id"], "--expected-version", fact["edit_version"], "--changes-json", json.dumps({"value": "blue paint"})]
    result = command(args)
    self.assertEqual(result.returncode, 0, result.stderr)
    self.assertEqual(json.loads(result.stdout)["value"], "blue paint")
    self.assertNotEqual(command(args).returncode, 0)
