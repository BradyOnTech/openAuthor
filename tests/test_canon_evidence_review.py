import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from openauthor.canon import add_canon_fact, list_canon_facts, review_canon_fact, update_canon_fact
from openauthor.git_ops import create_snapshot, initialize_git
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.scenes import add_scene, get_scene
from openauthor.storylines import create_storyline


class CanonEvidenceReviewTests(unittest.TestCase):
  def setUp(self):
    self.directory = tempfile.TemporaryDirectory()
    self.addCleanup(self.directory.cleanup)
    self.paths = initialize_project(Path(self.directory.name), name="Evidence review")
    add_scene(self.paths, title="The loom", body="Neri set a blue token beside the loom.")
    add_scene(self.paths, title="At dawn", body="Neri returned the blue token to the cabinet.")
    self.fact = add_canon_fact(self.paths, subject_entity_id="", predicate="token color", value="blue",
      evidence=[{"scene_id": "scene-0001", "excerpt": "Neri set a blue token beside the loom."}])
    self.prose = {identifier: get_scene(self.paths, identifier)["body"] for identifier in ["scene-0001", "scene-0002"]}

  def editable(self):
    return list_canon_facts(self.paths, for_editing=True)[0]

  def review(self, fact, disposition="accepted", evidence=None):
    return review_canon_fact(self.paths, fact["id"], disposition=disposition,
      evidence=evidence, expected_version=fact["edit_version"])

  def test_evidence_review_refuses_the_original_version_after_a_real_storyline_switch(self):
    initialize_git(self.paths)
    create_snapshot(self.paths, "Save original evidence")
    loaded = self.editable()
    create_storyline(self.paths, name="Cabinet alternative", hypothesis="Test another ending")
    current = self.editable()
    self.assertEqual(current["updated_at"], loaded["updated_at"])
    self.assertNotEqual(current["edit_version"], loaded["edit_version"])
    before = (self.paths.root / "codex/memory.json").read_bytes()
    for disposition in ["accepted", "rejected"]:
      with self.subTest(disposition=disposition), self.assertRaisesRegex(OpenAuthorError, "Storyline changed"):
        self.review(loaded, disposition)
      self.assertEqual((self.paths.root / "codex/memory.json").read_bytes(), before)

  def test_legacy_review_cannot_restore_an_inverted_validity_range(self):
    loaded = self.editable()
    withdrawn = update_canon_fact(self.paths, loaded["id"], expected_version=loaded["edit_version"], changes={
      "status": "rejected", "validity": {"from_scene_id": "scene-0002", "to_scene_id": "scene-0001"}})
    before = (self.paths.root / "codex/memory.json").read_bytes()
    with self.assertRaisesRegex(OpenAuthorError, "before it begins"):
      review_canon_fact(self.paths, withdrawn["id"], disposition="accepted", evidence=withdrawn["evidence"], expected_updated_at=withdrawn["updated_at"])
    self.assertEqual((self.paths.root / "codex/memory.json").read_bytes(), before)

  def test_new_accepted_fact_requires_valid_reading_order_boundaries(self):
    before = (self.paths.root / "codex/memory.json").read_bytes()
    with self.assertRaisesRegex(OpenAuthorError, "before it begins"):
      add_canon_fact(self.paths, subject_entity_id="", predicate="token location", value="cabinet",
        evidence=[{"scene_id": "scene-0002", "excerpt": "Neri returned the blue token to the cabinet."}],
        valid_from_scene_id="scene-0002", valid_to_scene_id="scene-0001")
    self.assertEqual((self.paths.root / "codex/memory.json").read_bytes(), before)
    suggested = add_canon_fact(self.paths, subject_entity_id="", predicate="token location", value="cabinet", status="suggested",
      evidence=[{"scene_id": "scene-0002", "excerpt": "Neri returned the blue token to the cabinet."}],
      valid_from_scene_id="scene-0002", valid_to_scene_id="scene-0001")
    self.assertEqual(suggested["status"], "suggested")

  def test_guarded_review_relinks_exact_evidence_and_returns_the_new_version(self):
    loaded = self.editable()
    updated = self.review(loaded, evidence=[{"scene_id": "scene-0002", "excerpt": "Neri returned the blue token to the cabinet."}])
    self.assertEqual(updated["evidence"][0]["scene_id"], "scene-0002")
    self.assertNotEqual(updated["edit_version"], loaded["edit_version"])
    self.assertEqual(updated["edit_version"], self.editable()["edit_version"])
    for identifier, body in self.prose.items():
      self.assertEqual(get_scene(self.paths, identifier)["body"], body)
    before = (self.paths.root / "codex/memory.json").read_bytes()
    with self.assertRaisesRegex(OpenAuthorError, "changed since"):
      self.review(loaded, "rejected")
    self.assertEqual((self.paths.root / "codex/memory.json").read_bytes(), before)

  def test_failed_evidence_check_keeps_status_sources_and_prose_unchanged(self):
    loaded = self.editable()
    before = (self.paths.root / "codex/memory.json").read_bytes()
    with self.assertRaisesRegex(OpenAuthorError, "exact passage"):
      self.review(loaded, evidence=[{"scene_id": "scene-0002", "excerpt": "Neri left an invented red token."}])
    self.assertEqual((self.paths.root / "codex/memory.json").read_bytes(), before)
    for identifier, body in self.prose.items():
      self.assertEqual(get_scene(self.paths, identifier)["body"], body)

  def test_cli_forwards_the_original_version_and_refuses_reuse(self):
    root = str(Path(__file__).resolve().parents[1])
    def command(args):
      return subprocess.run([sys.executable, "-m", "openauthor", *args, "--json"], cwd=self.paths.root,
        env={**os.environ, "PYTHONPATH": root}, capture_output=True, text=True)
    loaded = self.editable()
    args = ["memory", "fact-review", "--id", loaded["id"], "--disposition", "rejected", "--expected-version", loaded["edit_version"]]
    result = command(args)
    self.assertEqual(result.returncode, 0, result.stderr)
    self.assertEqual(json.loads(result.stdout)["status"], "rejected")
    self.assertEqual(json.loads(result.stdout)["edit_version"], self.editable()["edit_version"])
    self.assertNotEqual(command(args).returncode, 0)
