from __future__ import annotations

import tempfile
import unittest
import json
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

from openauthor.ai import ProviderExecutionError, generate_proposal, generate_proposal_draft, regenerate_change_hunk
from openauthor.project import OpenAuthorError, atomic_write_json, get_project_paths, initialize_project
from openauthor.proposals import edit_change_hunk, get_proposal, list_proposals, update_proposal_status
from openauthor.backups import create_backup, restore_backup
from openauthor.scenes import add_scene, get_scene, update_scene


class ProposalDeliveryTests(unittest.TestCase):
  def test_hunk_auth_failure_is_logged_and_can_retry_without_changing_the_review(self) -> None:
    with tempfile.TemporaryDirectory() as temporary:
      paths = initialize_project(Path(temporary), name="Hunk auth recovery")
      add_scene(paths, title="Gate", body="Mara began to count the lanterns.")
      proposal = generate_proposal(paths, scene_id="scene-0001", instruction="Tighten prose.")
      proposal = generate_proposal_draft(paths, proposal_id=proposal["id"])
      args = {"proposal_id": proposal["id"], "hunk_id": proposal["change_set"]["hunks"][0]["id"], "request_id": "expired-session"}
      error = ProviderExecutionError("Sign in again", category="auth", retriable=False, provider="local", http_status=401)
      with patch("openauthor.ai._call_provider", side_effect=error):
        with self.assertRaisesRegex(OpenAuthorError, "auth.*Sign in again"):
          regenerate_change_hunk(paths, **args)
      self.assertEqual(get_proposal(paths, proposal["id"]), proposal)
      logs = [json.loads(path.read_text()) for path in paths.generations_dir.glob("*.json")]
      failures = [row for row in logs if row.get("status") == "failed"]
      self.assertEqual(len(failures), 1)
      self.assertEqual(failures[0]["error"]["http_status"], 401)
      result = regenerate_change_hunk(paths, **args)
      self.assertEqual(regenerate_change_hunk(paths, **args), result)
      self.assertEqual(len(list(paths.generations_dir.glob("*.json"))), 4)

  def test_hunk_response_loss_recovers_one_completed_provider_attempt(self) -> None:
    with tempfile.TemporaryDirectory() as temporary:
      paths = initialize_project(Path(temporary), name="Hunk delivery")
      add_scene(paths, title="Gate", body="Mara began to count the lanterns.")
      proposal = generate_proposal(paths, scene_id="scene-0001", instruction="Tighten prose.")
      proposal = generate_proposal_draft(paths, proposal_id=proposal["id"])
      args = {"proposal_id": proposal["id"], "hunk_id": proposal["change_set"]["hunks"][0]["id"], "feedback": "Keep the voice.", "request_id": "hunk-request"}
      def fail_final_receipt(path, payload):
        if payload.get("completed"):
          raise OSError("Lost receipt after saving the hunk")
        atomic_write_json(path, payload)
      with patch("openauthor.proposal_delivery.atomic_write_json", side_effect=fail_final_receipt):
        with self.assertRaisesRegex(OSError, "Lost receipt"):
          regenerate_change_hunk(paths, **args)
      result = regenerate_change_hunk(paths, **args)
      self.assertEqual(regenerate_change_hunk(paths, **args), result)
      self.assertEqual(len(list(paths.generations_dir.glob("*.json"))), 3)
      with self.assertRaisesRegex(OpenAuthorError, "different inputs"):
        regenerate_change_hunk(paths, **{**args, "feedback": "A new request needs a new identity."})

  def test_hunk_generation_does_not_replace_an_intervening_author_edit(self) -> None:
    with tempfile.TemporaryDirectory() as temporary:
      paths = initialize_project(Path(temporary), name="Hunk concurrency")
      add_scene(paths, title="Gate", body="Mara began to count the lanterns.")
      proposal = generate_proposal(paths, scene_id="scene-0001", instruction="Tighten prose.")
      proposal = generate_proposal_draft(paths, proposal_id=proposal["id"])
      hunk_id = proposal["change_set"]["hunks"][0]["id"]
      from openauthor.ai import _call_provider
      def edit_while_generating(**kwargs):
        result = _call_provider(**kwargs)
        edit_change_hunk(paths, proposal_id=proposal["id"], hunk_id=hunk_id, after_text="My newer replacement.")
        return result
      with patch("openauthor.ai._call_provider", side_effect=edit_while_generating):
        with self.assertRaisesRegex(OpenAuthorError, "changed while"):
          regenerate_change_hunk(paths, proposal_id=proposal["id"], hunk_id=hunk_id)
      current = get_proposal(paths, proposal["id"])
      self.assertEqual(current["change_set"]["hunks"][0]["after_text"], "My newer replacement.")

  def test_cli_recovers_repeated_generate_and_draft_commands(self) -> None:
    with tempfile.TemporaryDirectory() as temporary:
      paths = initialize_project(Path(temporary), name="CLI delivery")
      add_scene(paths, title="Gate", body="Mara began to count the lanterns.")
      def run(*args):
        completed = subprocess.run(
          [sys.executable, "-m", "openauthor", "proposal", *args, "--json"],
          cwd=paths.root, env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])},
          capture_output=True, text=True, check=True,
        )
        return json.loads(completed.stdout)
      args = ("generate", "--scene", "scene-0001", "--instruction", "Tighten prose.", "--provider", "local", "--request-id", "cli-plan")
      proposal = run(*args)
      self.assertEqual(run(*args)["id"], proposal["id"])
      args = ("draft", "--id", proposal["id"], "--provider", "local", "--request-id", "cli-draft")
      drafted = run(*args)
      self.assertEqual(drafted, run(*args))
      args = ("hunk-regenerate", "--id", proposal["id"], "--hunk", drafted["change_set"]["hunks"][0]["id"], "--provider", "local", "--request-id", "cli-hunk")
      self.assertEqual(run(*args), run(*args))
      self.assertEqual(len(list(paths.generations_dir.glob("*.json"))), 3)

  def test_replayed_generate_and_draft_recover_the_same_artifact_and_usage(self) -> None:
    with tempfile.TemporaryDirectory() as temporary:
      paths = initialize_project(Path(temporary), name="Synthetic proposal recovery")
      add_scene(paths, title="Gate", body="Mara began to count the lanterns.")
      args = {"scene_id": "scene-0001", "instruction": "Tighten the prose.", "provider": "local", "request_id": "plan-1"}
      planned = generate_proposal(paths, **args)
      self.assertEqual(generate_proposal(paths, **args)["id"], planned["id"])
      drafted = generate_proposal_draft(paths, proposal_id=planned["id"], provider="local", request_id="draft-1")
      self.assertEqual(generate_proposal_draft(paths, proposal_id=planned["id"], provider="local", request_id="draft-1"), drafted)
      self.assertEqual(len(list_proposals(paths)), 1)
      self.assertEqual(len(list(paths.generations_dir.glob("*.json"))), 2)
      with self.assertRaisesRegex(OpenAuthorError, "different"):
        generate_proposal(paths, **{**args, "instruction": "A different plan"})

  def test_scene_changed_during_provider_call_is_not_reanchored_as_a_fresh_draft(self) -> None:
    with tempfile.TemporaryDirectory() as temporary:
      paths = initialize_project(Path(temporary), name="Concurrent writing")
      add_scene(paths, title="Gate", body="Mara began to count the lanterns.")
      proposal = generate_proposal(paths, scene_id="scene-0001", instruction="Tighten the prose.")
      from openauthor.ai import _call_provider
      def edit_while_generating(**kwargs):
        result = _call_provider(**kwargs)
        update_scene(paths, scene_identifier="scene-0001", body="Newer writing must survive.")
        return result
      with patch("openauthor.ai._call_provider", side_effect=edit_while_generating):
        with self.assertRaisesRegex(OpenAuthorError, "changed while"):
          generate_proposal_draft(paths, proposal_id=proposal["id"])
      self.assertEqual(get_scene(paths, "scene-0001")["body"].strip(), "Newer writing must survive.")
      self.assertFalse(get_proposal(paths, proposal["id"]).get("proposed_body"))

  def test_recovery_after_artifact_publication_before_final_receipt(self) -> None:
    with tempfile.TemporaryDirectory() as temporary:
      paths = initialize_project(Path(temporary) / "book", name="Interrupted delivery")
      add_scene(paths, title="Gate", body="Mara began to count the lanterns.")
      def fail_final_receipt(path, payload):
        if payload.get("completed"):
          raise OSError("Process lost after artifact publication")
        atomic_write_json(path, payload)
      args = {"scene_id": "scene-0001", "instruction": "Tighten prose.", "request_id": "plan"}
      with patch("openauthor.proposal_delivery.atomic_write_json", side_effect=fail_final_receipt):
        with self.assertRaisesRegex(OSError, "publication"):
          generate_proposal(paths, **args)
      proposal = generate_proposal(paths, **args)
      draft_args = {"proposal_id": proposal["id"], "request_id": "draft"}
      with patch("openauthor.proposal_delivery.atomic_write_json", side_effect=fail_final_receipt):
        with self.assertRaisesRegex(OSError, "publication"):
          generate_proposal_draft(paths, **draft_args)
      drafted = generate_proposal_draft(paths, **draft_args)
      self.assertTrue(drafted["proposed_body"])
      self.assertEqual(len(list(paths.generations_dir.glob("*.json"))), 2)
      backup = Path(temporary) / "book.zip"
      create_backup(paths, backup)
      restored = Path(temporary) / "restored"
      restore_backup(backup, restored)
      recovered = get_project_paths(restored)
      self.assertEqual(generate_proposal(recovered, **args)["id"], proposal["id"])
      self.assertEqual(generate_proposal_draft(recovered, **draft_args)["proposed_body"], drafted["proposed_body"])
      self.assertEqual(len(list(recovered.generations_dir.glob("*.json"))), 2)

  def test_review_changed_during_provider_call_is_preserved(self) -> None:
    with tempfile.TemporaryDirectory() as temporary:
      paths = initialize_project(Path(temporary), name="Concurrent review")
      add_scene(paths, title="Gate", body="Mara began to count the lanterns.")
      proposal = generate_proposal(paths, scene_id="scene-0001", instruction="Tighten the prose.")
      from openauthor.ai import _call_provider
      def reject_while_generating(**kwargs):
        result = _call_provider(**kwargs)
        update_proposal_status(paths, proposal_id=proposal["id"], status="rejected")
        return result
      with patch("openauthor.ai._call_provider", side_effect=reject_while_generating):
        with self.assertRaisesRegex(OpenAuthorError, "changed while"):
          generate_proposal_draft(paths, proposal_id=proposal["id"])
      self.assertEqual(get_proposal(paths, proposal["id"])["status"], "rejected")
      self.assertFalse(get_proposal(paths, proposal["id"]).get("proposed_body"))

  def test_failed_request_does_not_replay_over_a_later_review(self) -> None:
    with tempfile.TemporaryDirectory() as temporary:
      paths = initialize_project(Path(temporary), name="Later review")
      add_scene(paths, title="Gate", body="Mara began to count the lanterns.")
      proposal = generate_proposal(paths, scene_id="scene-0001", instruction="Tighten the prose.")
      args = {"proposal_id": proposal["id"], "request_id": "interrupted"}
      with patch("openauthor.ai._call_provider", side_effect=OpenAuthorError("Connection lost")):
        with self.assertRaisesRegex(OpenAuthorError, "Connection lost"):
          generate_proposal_draft(paths, **args)
      update_proposal_status(paths, proposal_id=proposal["id"], status="pending", notes="Keep my new review")
      with self.assertRaisesRegex(OpenAuthorError, "changed since"):
        generate_proposal_draft(paths, **args)
      self.assertEqual(get_proposal(paths, proposal["id"])["notes"], "Keep my new review")
