from __future__ import annotations

import tempfile
import unittest
import io
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from openauthor.project import OpenAuthorError, atomic_write_json, resolve_project
from openauthor.proposals import list_proposals, set_proposal_draft
from openauthor.scenes import get_scene, update_scene
from scripts.evaluate_author_workflow import digest, finish, generate, prepare, read_json, smoke


def approved_case(root: Path, *, provider: str = "local", model: str = "heuristic-v1") -> Path:
  source = root / "approved-excerpt.md"
  source.write_text("# Opening\n\nMara began to search for Ivo. Mara waits.\n", encoding="utf-8")
  manifest = root / "case.json"
  atomic_write_json(manifest, {
    "case_id": "test-consent", "source": source.name, "source_sha256": digest(source.read_bytes()),
    "provider": provider, "model": model, "instruction": "Tighten the prose.",
    "consent": {"status": "approved", "authority_ref": "synthetic-test-authority", "evidence_ref": "synthetic-test-record",
      "participant_code": "synthetic-test-only", "local_analysis": True, "retain_artifacts": True,
      "retain_until": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
      "provider_transmission": [{"provider": provider, "model": model}]},
  })
  return manifest


def completed_decisions(output: Path, *, accept: bool = True) -> Path:
  path = output / "review.json"
  review = read_json(path)
  review["reviewer_code"] = "synthetic-test"
  review["hunks"] = {key: "accepted" if accept else "rejected" for key in review["hunks"]}
  review["extraction_labels"] = {key: "uncertain" for key in review["extraction_labels"]}
  atomic_write_json(path, review)
  return path


class AuthorWorkflowEvaluationTests(unittest.TestCase):
  def test_remote_evaluation_requires_the_exact_reviewed_context_even_with_consent(self) -> None:
    from scripts.evaluate_author_workflow import preview_draft
    with tempfile.TemporaryDirectory() as temporary:
      root = Path(temporary)
      output = root / "run"
      prepare(output, manifest=approved_case(root, provider="openai", model="explicit-test-model"))
      with patch("urllib.request.urlopen") as transport:
        with self.assertRaisesRegex(OpenAuthorError, "[Rr]eview"):
          generate(output, allow_provider=True)
        context = preview_draft(output)
        transport.assert_not_called()
      reviewed = read_json(output / "draft-context.json")
      sent = []
      def response(request, **_kwargs):
        sent.append(json.loads(request.data))
        return io.BytesIO(json.dumps({"choices": [{"message": {"content": "Mara searched for Ivo. Mara waits."}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 100, "completion_tokens": 9}}).encode())
      with patch.dict("os.environ", {"OPENAI_API_KEY": "synthetic-test-key"}), patch("urllib.request.urlopen", side_effect=response):
        result = generate(output, allow_provider=True, expected_context_fingerprint=context["fingerprint"])
      self.assertEqual(result["status"], "awaiting_review")
      self.assertEqual(sent[0]["messages"][1]["content"], reviewed["user_prompt"])

  def test_synthetic_import_review_apply_undo_and_backup_use_the_real_core(self) -> None:
    report = smoke()
    self.assertEqual(report["evidence_kind"], "synthetic_workflow")
    self.assertIsNone(report["human_observations"])
    self.assertIsNone(report["pilot_outcomes"])
    self.assertIsNone(report["extraction"]["precision"])
    self.assertIsNone(report["extraction"]["recall"])
    self.assertTrue(report["import_fidelity"]["automated_exact_bodies"])
    self.assertTrue(report["applied_matches_review"])
    self.assertTrue(report["undo_byte_exact"])
    self.assertTrue(report["backup_book_exact"])
    self.assertTrue(report["backup_history_exact"])
    self.assertEqual(report["failed_generations"], 0)
    self.assertEqual(len(report["generation_attempts"]), 1)
    self.assertGreater(report["accepted_hunks"], 0)
    self.assertGreater(report["rejected_hunks"], 0)

  def test_unknown_consent_blocks_before_source_is_read(self) -> None:
    with tempfile.TemporaryDirectory() as temporary:
      root = Path(temporary)
      manifest = root / "case.json"
      atomic_write_json(manifest, {"provider": "local", "model": "heuristic-v1", "instruction": "Tighten.", "source": "unapproved-and-absent.md"})
      with self.assertRaisesRegex(OpenAuthorError, "consent.*before reading"):
        prepare(root / "run", manifest=manifest)
      self.assertFalse((root / "run").exists())

  def test_changed_source_is_rejected_without_creating_a_run(self) -> None:
    with tempfile.TemporaryDirectory() as temporary:
      root = Path(temporary)
      manifest = approved_case(root)
      (root / "approved-excerpt.md").write_text("Different content", encoding="utf-8")
      with self.assertRaisesRegex(OpenAuthorError, "SHA-256"):
        prepare(root / "run", manifest=manifest)
      self.assertFalse((root / "run").exists())

  def test_provider_needs_exact_consent_and_explicit_opt_in(self) -> None:
    with tempfile.TemporaryDirectory() as temporary:
      root = Path(temporary)
      output = root / "run"
      prepare(output, manifest=approved_case(root, provider="openai", model="explicit-test-model"))
      with self.assertRaisesRegex(OpenAuthorError, "allow-provider"):
        generate(output)
      state = read_json(output / "run.json")
      state["provider_settings"]["model"] = "different-model"
      atomic_write_json(output / "run.json", state)
      with self.assertRaisesRegex(OpenAuthorError, "exact provider and model"):
        generate(output, allow_provider=True)
      paths = resolve_project(output / "book")
      self.assertEqual(list_proposals(paths), [])
      self.assertEqual(list(paths.generations_dir.glob("*.json")), [])

  def test_consent_expiry_and_revocation_are_rechecked(self) -> None:
    for change in ({"status": "revoked"}, {"retain_until": "2000-01-01T00:00:00Z"}):
      with self.subTest(change=change), tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        output = root / "run"
        prepare(output, manifest=approved_case(root))
        state = read_json(output / "run.json")
        state["case"]["consent"].update(change)
        atomic_write_json(output / "run.json", state)
        with self.assertRaises(OpenAuthorError):
          generate(output)
        self.assertEqual(list_proposals(resolve_project(output / "book")), [])

  def test_revoking_the_original_consent_record_blocks_an_existing_run(self) -> None:
    with tempfile.TemporaryDirectory() as temporary:
      root = Path(temporary)
      output = root / "run"
      manifest = approved_case(root)
      prepare(output, manifest=manifest)
      case = read_json(manifest)
      case["consent"]["status"] = "revoked"
      atomic_write_json(manifest, case)
      with self.assertRaisesRegex(OpenAuthorError, "consent"):
        generate(output)
      pilot = read_json(output / "pilot-record.json")
      self.assertEqual(pilot["returned_to_own_revision"], "not_observed")
      self.assertFalse(pilot["outreach_authorized"])
      self.assertFalse(pilot["follow_up_authorized"])

  def test_generation_response_loss_reuses_the_existing_draft(self) -> None:
    with tempfile.TemporaryDirectory() as temporary:
      output = Path(temporary) / "run"
      prepare(output)
      state = generate(output)
      paths = resolve_project(output / "book")
      generations = sorted(path.name for path in paths.generations_dir.glob("*.json"))
      state["status"] = "generating"
      atomic_write_json(output / "run.json", state)
      with self.assertRaisesRegex(OpenAuthorError, "Explicit --retry"):
        generate(output)
      recovered = generate(output, retry=True)
      self.assertEqual(recovered["proposal_id"], state["proposal_id"])
      self.assertEqual(sorted(path.name for path in paths.generations_dir.glob("*.json")), generations)
      self.assertEqual(len(list_proposals(paths)), 1)

  def test_revocation_before_review_prevents_apply_and_backup(self) -> None:
    with tempfile.TemporaryDirectory() as temporary:
      root = Path(temporary)
      manifest = approved_case(root)
      output = root / "run"
      prepare(output, manifest=manifest)
      state = generate(output)
      paths = resolve_project(output / "book")
      before = get_scene(paths, state["target_scene_id"])["body"]
      case = read_json(manifest)
      case["consent"]["status"] = "revoked"
      atomic_write_json(manifest, case)
      with self.assertRaisesRegex(OpenAuthorError, "consent"):
        finish(output, completed_decisions(output))
      self.assertEqual(get_scene(paths, state["target_scene_id"])["body"], before)
      self.assertFalse((output / "recovery.openauthor.zip").exists())

  def test_no_apply_without_all_hunk_decisions_and_matching_draft(self) -> None:
    with tempfile.TemporaryDirectory() as temporary:
      output = Path(temporary) / "run"
      prepare(output)
      state = generate(output)
      paths = resolve_project(output / "book")
      before = get_scene(paths, state["target_scene_id"])["body"]
      with self.assertRaisesRegex(OpenAuthorError, "reviewer code"):
        finish(output, output / "review.json")
      decisions = completed_decisions(output)
      set_proposal_draft(paths, proposal_id=state["proposal_id"], proposed_body="A different draft.")
      with self.assertRaisesRegex(OpenAuthorError, "draft changed"):
        finish(output, decisions)
      self.assertEqual(get_scene(paths, state["target_scene_id"])["body"], before)

  def test_modified_book_cannot_expand_the_approved_provider_context(self) -> None:
    with tempfile.TemporaryDirectory() as temporary:
      output = Path(temporary) / "run"
      state = prepare(output)
      update_scene(resolve_project(output / "book"), scene_identifier=state["target_scene_id"], body="Unapproved additional passage")
      with self.assertRaisesRegex(OpenAuthorError, "changed after intake"):
        generate(output)

  def test_rejected_only_review_does_not_count_as_successful_undo(self) -> None:
    with tempfile.TemporaryDirectory() as temporary:
      output = Path(temporary) / "run"
      prepare(output)
      generate(output)
      report = finish(output, completed_decisions(output, accept=False))
      self.assertFalse(report["applied"])
      self.assertIsNone(report["undo_byte_exact"])
      self.assertIsNone(report["human_observations"])
      self.assertEqual(finish(output, output / "review.json"), report)

  def test_missing_facts_are_counted_separately_from_detected_names(self) -> None:
    with tempfile.TemporaryDirectory() as temporary:
      output = Path(temporary) / "run"
      prepare(output)
      generate(output)
      review_path = completed_decisions(output)
      review = read_json(review_path)
      review["extraction_complete"] = True
      review["extraction_labels"] = {key: "correct" for key in review["extraction_labels"]}
      review["missed_items"] = [{"kind": "canon_fact", "description": "Ivo is the keeper."}]
      atomic_write_json(review_path, review)
      report = finish(output, review_path)
      facts = report["extraction"]["by_kind"]["canon_fact"]
      self.assertEqual(facts["missed"], 1)
      self.assertEqual(facts["recall"], 0.0)
      self.assertIsNone(facts["precision"])
      self.assertIsNone(report["extraction"]["by_kind"]["relationship_create"]["recall"])
      self.assertIsNone(report["human_observations"])
