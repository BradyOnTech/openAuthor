from __future__ import annotations

import os
import json
import io
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from openauthor.ai import generate_merge_resolution, preview_merge_resolution
from openauthor.planning import update_brief
from openauthor.git_ops import create_branch, create_snapshot, current_branch, initialize_git, switch_branch
from openauthor.project import OpenAuthorError, atomic_write_json, initialize_project
from openauthor.proposals import get_proposal, list_proposals
from openauthor.scenes import add_scene, get_scene, update_scene


class MergeDeliveryTests(unittest.TestCase):
  def setUp(self) -> None:
    temporary = tempfile.TemporaryDirectory()
    self.addCleanup(temporary.cleanup)
    self.paths = initialize_project(Path(temporary.name), name="Synthetic merge delivery")
    initialize_git(self.paths)
    add_scene(self.paths, title="Choice", body="Mara waited at the gate.")
    create_snapshot(self.paths, "Seed")
    self.base = current_branch(self.paths)
    create_branch(self.paths, name="alternate")
    update_scene(self.paths, scene_identifier="scene-0001", body="Mara chose betrayal.")
    create_snapshot(self.paths, "Alternate")
    switch_branch(self.paths, name=self.base)
    update_scene(self.paths, scene_identifier="scene-0001", body="Mara chose loyalty.")
    create_snapshot(self.paths, "Primary")
    self.args = {"base": self.base, "head": "alternate", "scene_path": get_scene(self.paths, "scene-0001")["path"], "provider": "local"}

  def test_reconciliation_reviews_saved_guidance_and_sends_the_exact_payload(self):
    update_brief(self.paths, style_guide="MERGE_STYLE_SENTINEL: terse past tense.")
    preview = preview_merge_resolution(self.paths, **self.args)
    self.assertIn("MERGE_STYLE_SENTINEL", preview["user_prompt"])
    for version in ("Mara waited", "Mara chose betrayal", "Mara chose loyalty"):
      self.assertIn(version, preview["user_prompt"])
    result = generate_merge_resolution(self.paths, **self.args, expected_context_fingerprint=preview["fingerprint"])
    log = json.loads((self.paths.root / result["generation"]["log_path"]).read_text())
    self.assertEqual(log["user_prompt"], preview["user_prompt"])
    self.assertEqual(log["system_prompt"], preview["system_prompt"])

  def test_reconciliation_refuses_unreviewed_or_changed_guidance(self):
    args = {**self.args, "provider": "openai"}
    with patch("urllib.request.urlopen") as transport:
      with self.assertRaisesRegex(OpenAuthorError, "Review reconciliation"):
        generate_merge_resolution(self.paths, **args)
      transport.assert_not_called()
    preview = preview_merge_resolution(self.paths, **args)
    update_brief(self.paths, style_guide="New merge guidance.")
    with patch("urllib.request.urlopen") as transport:
      with self.assertRaisesRegex(OpenAuthorError, "context changed"):
        generate_merge_resolution(self.paths, **args, expected_context_fingerprint=preview["fingerprint"])
      transport.assert_not_called()
    preview = preview_merge_resolution(self.paths, **args)
    def provider_response(*_args, **_kwargs):
      update_brief(self.paths, style_guide="Changed during reconciliation.")
      return io.BytesIO(json.dumps({"choices": [{"message": {"content": "Mara chose silence."}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 100, "completion_tokens": 8}}).encode())
    with patch.dict("os.environ", {"OPENAI_API_KEY": "synthetic-test-key"}), patch("urllib.request.urlopen", side_effect=provider_response):
      with self.assertRaisesRegex(OpenAuthorError, "context changed"):
        generate_merge_resolution(self.paths, **args, expected_context_fingerprint=preview["fingerprint"])
    self.assertEqual(list_proposals(self.paths), [])

  def test_cli_reconciliation_preview_matches_the_recoverable_send(self):
    def run(*args):
      result = subprocess.run([sys.executable, "-m", "openauthor", "branch", *args, "--json"], cwd=self.paths.root,
        env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])}, capture_output=True, text=True, check=True)
      return json.loads(result.stdout)
    preview = run("resolve-preview", "--input-json", json.dumps(self.args))
    args = ("resolve", "--base", self.base, "--head", "alternate", "--path", self.args["scene_path"], "--expected-context-fingerprint", preview["fingerprint"], "--request-id", "reviewed-cli-merge")
    first = run(*args)
    self.assertEqual(run(*args), first)
    log = json.loads((self.paths.root / first["generation"]["log_path"]).read_text())
    self.assertEqual(log["user_prompt"], preview["user_prompt"])

  def test_lost_result_recovers_same_resolution(self) -> None:
    args = {**self.args, "request_id": "merge-request"}
    def fail_final_receipt(path, payload):
      if payload.get("completed"):
        raise OSError("Response lost after publication")
      atomic_write_json(path, payload)
    with patch("openauthor.proposal_delivery.atomic_write_json", side_effect=fail_final_receipt):
      with self.assertRaisesRegex(OSError, "Response lost"):
        generate_merge_resolution(self.paths, **args)
    result = generate_merge_resolution(self.paths, **args)
    self.assertEqual(generate_merge_resolution(self.paths, **args)["id"], result["id"])
    self.assertEqual(len(list_proposals(self.paths)), 1)
    self.assertEqual(len(list(self.paths.generations_dir.glob("*.json"))), 1)

  def test_newer_branch_revision_refuses_an_old_resolution(self) -> None:
    result = generate_merge_resolution(self.paths, **self.args)
    update_scene(self.paths, scene_identifier="scene-0001", body="Mara chose a newer path that must survive.")
    create_snapshot(self.paths, "Newer primary")
    self.assertTrue(get_proposal(self.paths, result["id"])["stale"])
    merged = subprocess.run(
      [sys.executable, "-m", "openauthor", "branch", "merge", "--base", self.base, "--head", "alternate", "--resolution", result["id"], "--json"],
      cwd=self.paths.root, env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])},
      capture_output=True, text=True,
    )
    self.assertNotEqual(merged.returncode, 0)
    self.assertIn("changed", merged.stderr)
    self.assertIn("newer path", get_scene(self.paths, "scene-0001")["body"])

  def test_revision_change_during_generation_refuses_publication_and_retry(self) -> None:
    from openauthor.ai import _call_provider
    def advance_branch(**kwargs):
      result = _call_provider(**kwargs)
      update_scene(self.paths, scene_identifier="scene-0001", body="New writing during generation.")
      create_snapshot(self.paths, "Concurrent author writing")
      return result
    args = {**self.args, "request_id": "concurrent-merge"}
    with patch("openauthor.ai._call_provider", side_effect=advance_branch):
      with self.assertRaisesRegex(OpenAuthorError, "changed while"):
        generate_merge_resolution(self.paths, **args)
    with self.assertRaisesRegex(OpenAuthorError, "changed since"):
      generate_merge_resolution(self.paths, **args)
    self.assertEqual(list_proposals(self.paths), [])
    self.assertIn("New writing", get_scene(self.paths, "scene-0001")["body"])
    self.assertEqual(len(list(self.paths.generations_dir.glob("*.json"))), 1)

  def test_completed_replay_after_branch_change_returns_stale_without_regeneration(self) -> None:
    args = {**self.args, "request_id": "completed-merge"}
    result = generate_merge_resolution(self.paths, **args)
    update_scene(self.paths, scene_identifier="scene-0001", body="New work after reconciliation.")
    create_snapshot(self.paths, "New work")
    replay = generate_merge_resolution(self.paths, **args)
    self.assertEqual(replay["id"], result["id"])
    self.assertTrue(replay["stale"])
    self.assertEqual(len(list(self.paths.generations_dir.glob("*.json"))), 1)
