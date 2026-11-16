from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from openauthor import ai
from openauthor.chat import create_chat_thread, preview_chat_context, send_chat_message
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.project_locks import project_lock
from openauthor.retrieval import build_retrieval_index, get_retrieval_index_status, refresh_retrieval_index_for_auto
from openauthor.scenes import add_scene, update_scene


class AutoRetrievalCase(unittest.TestCase):
  def setUp(self) -> None:
    self.directory = tempfile.TemporaryDirectory()
    self.addCleanup(self.directory.cleanup)
    self.paths = initialize_project(Path(self.directory.name), name="Auto retrieval")
    add_scene(self.paths, title="The Gate", body="Mara kept the winter key hidden under the harbor lantern.")
    add_scene(self.paths, title="The Ledger", body="Idris counted the smugglers' debts in a ledger bound with red thread.")
    self.args = dict(scene_id="scene-0001", instruction="Tighten the winter key and lantern passage.", provider="local")

  def index(self) -> dict:
    return json.loads(self.paths.retrieval_index_file.read_text(encoding="utf-8"))

  def generate(self, mode: str, **overrides) -> dict:
    return ai.generate_proposal(self.paths, **{**self.args, **overrides}, retrieval_mode=mode)


class ProposalAutoRetrievalTests(AutoRetrievalCase):
  def test_auto_builds_a_missing_index_and_cites_passages(self) -> None:
    self.assertFalse(self.paths.retrieval_index_file.exists())
    proposal = self.generate("auto")
    retrieval = proposal["generation"]["retrieval"]
    self.assertEqual(retrieval["mode"], "auto")
    self.assertTrue(retrieval["used"])
    self.assertFalse(retrieval["degraded"])
    self.assertGreater(retrieval["result_count"], 0)
    self.assertIn("winter key", " ".join(row["excerpt"] for row in retrieval["citations"]))
    self.assertTrue(self.paths.retrieval_index_file.exists())

  def test_run_provenance_records_that_the_index_was_built_for_the_call(self) -> None:
    proposal = self.generate("auto")
    log = json.loads((self.paths.root / proposal["generation"]["log_path"]).read_text(encoding="utf-8"))
    build = log["retrieval"]["index"]["build"]
    self.assertEqual((build["trigger"], build["action"], build["reasons"]), ("auto", "built", ["index_missing"]))
    self.assertEqual(build["created_at"], self.index()["created_at"])
    self.assertFalse(log["retrieval"]["index"]["stale"])

  def test_auto_refreshes_a_stale_index_and_records_why(self) -> None:
    build_retrieval_index(self.paths, chunk_words=40, overlap_words=5)
    update_scene(self.paths, scene_identifier="scene-0002", body="Idris burned the ledger and kept only the obsidian compass.")
    self.assertTrue(get_retrieval_index_status(self.paths)["stale"])
    proposal = self.generate("auto", instruction="Describe the obsidian compass Idris kept.")
    retrieval = proposal["generation"]["retrieval"]
    self.assertIn("obsidian compass", " ".join(row["excerpt"] for row in retrieval["citations"]))
    build = retrieval["index"]["build"]
    self.assertEqual((build["trigger"], build["action"]), ("auto", "refreshed"))
    self.assertIn("source_digest_changed", build["reasons"])
    self.assertFalse(retrieval["index"]["stale"])
    # A refresh keeps the chunking chosen when the index was built by hand.
    self.assertEqual((self.index()["chunk_words"], self.index()["overlap_words"]), (40, 5))

  def test_a_fresh_index_is_reused_without_rebuilding(self) -> None:
    build_retrieval_index(self.paths)
    created = self.index()["created_at"]
    with patch("openauthor.retrieval.build_retrieval_index") as rebuild:
      proposal = self.generate("auto")
    rebuild.assert_not_called()
    build = proposal["generation"]["retrieval"]["index"]["build"]
    self.assertEqual((build["trigger"], build["action"], build["created_at"]), ("manual", "built", created))
    self.assertEqual(refresh_retrieval_index_for_auto(self.paths), {"action": "none", "reasons": [], "error": ""})

  def test_failed_build_degrades_exactly_as_a_missing_index_did(self) -> None:
    with patch("openauthor.retrieval.build_retrieval_index", side_effect=OSError("disk full")):
      proposal = self.generate("auto")
    retrieval = proposal["generation"]["retrieval"]
    self.assertEqual(
      {key: retrieval[key] for key in ("mode", "used", "degraded", "result_count", "citations")},
      {"mode": "auto", "used": False, "degraded": True, "result_count": 0, "citations": []},
    )
    self.assertIn("Retrieval index not found", retrieval["error"])
    self.assertEqual(retrieval["index"]["chunk_count"], 0)
    self.assertNotIn("build", retrieval["index"])
    self.assertFalse(self.paths.retrieval_index_file.exists())

  def test_required_and_off_never_build_an_index(self) -> None:
    with self.assertRaisesRegex(OpenAuthorError, "Retrieval index not found"):
      self.generate("required")
    self.assertFalse(self.paths.retrieval_index_file.exists())
    proposal = self.generate("off")
    self.assertFalse(proposal["generation"]["retrieval"]["used"])
    self.assertFalse(self.paths.retrieval_index_file.exists())

  def test_required_still_refuses_a_stale_index_when_freshness_is_demanded(self) -> None:
    build_retrieval_index(self.paths)
    created = self.index()["created_at"]
    update_scene(self.paths, scene_identifier="scene-0002", body="Idris burned the ledger.")
    with self.assertRaisesRegex(OpenAuthorError, "stale"):
      self.generate("required", retrieval_require_fresh=True)
    self.assertEqual(self.index()["created_at"], created)

  def test_reviewed_preview_and_the_send_that_follows_share_one_fingerprint(self) -> None:
    preview = ai.preview_proposal_generation(self.paths, **self.args, retrieval_mode="auto")
    self.assertTrue(preview["retrieval"]["used"])
    proposal = self.generate("auto", expected_context_fingerprint=preview["fingerprint"])
    self.assertEqual(proposal["generation"]["retrieval"], preview["retrieval"])

  def test_project_lock_is_free_while_the_provider_is_called(self) -> None:
    observed: list[bool] = []
    real_call = ai._call_provider

    def provider(**kwargs):
      def probe() -> None:
        try:
          with patch.dict(os.environ, {"OPENAUTHOR_LOCK_TIMEOUT_MS": "200"}), project_lock(self.paths):
            observed.append(True)
        except OpenAuthorError:
          observed.append(False)

      thread = threading.Thread(target=probe)
      thread.start()
      thread.join(5)
      return real_call(**kwargs)

    with patch("openauthor.ai._call_provider", side_effect=provider):
      self.generate("auto")
    self.assertEqual(observed, [True])
    self.assertTrue(self.paths.retrieval_index_file.exists())

  def test_a_busy_book_does_not_fail_the_request(self) -> None:
    with patch("openauthor.project_locks.project_lock", side_effect=OpenAuthorError("Another openAuthor operation on this book is still running.")):
      outcome = refresh_retrieval_index_for_auto(self.paths)
    self.assertEqual(outcome["action"], "failed")
    self.assertIn("still running", outcome["error"])


class ChatAutoRetrievalTests(AutoRetrievalCase):
  def test_default_chat_turn_builds_the_index_and_cites_passages(self) -> None:
    thread = create_chat_thread(self.paths, title="Ask", provider="local", mode="chat")
    self.assertFalse(self.paths.retrieval_index_file.exists())
    result = send_chat_message(self.paths, thread_id=thread["id"], message="Where is the winter key hidden?", current_scene_id="scene-0001")
    review = result["assistant_message"]["context_used"]["review"]
    self.assertGreater(review["retrieval_result_count"], 0)
    self.assertEqual(self.index()["build"], {"trigger": "auto", "action": "built", "reasons": ["index_missing"]})

  def test_chat_preview_and_send_agree_after_the_preview_built_the_index(self) -> None:
    thread = create_chat_thread(self.paths, title="Ask", provider="local", mode="chat")
    request = dict(thread_id=thread["id"], message="Where is the winter key hidden?", current_scene_id="scene-0001")
    preview = preview_chat_context(self.paths, **request)
    self.assertTrue(self.paths.retrieval_index_file.exists())
    created = self.index()["created_at"]
    result = send_chat_message(self.paths, **request, expected_context_fingerprint=preview["fingerprint"])
    self.assertEqual(result["turn"]["status"], "completed")
    self.assertEqual(self.index()["created_at"], created)

  def test_chat_with_retrieval_off_builds_nothing(self) -> None:
    thread = create_chat_thread(self.paths, title="Ask", provider="local", mode="chat")
    send_chat_message(self.paths, thread_id=thread["id"], message="Where is the winter key hidden?", current_scene_id="scene-0001", context_overrides={"retrieval_mode": "off"})
    self.assertFalse(self.paths.retrieval_index_file.exists())

  def test_chat_degrades_as_before_when_the_index_cannot_be_built(self) -> None:
    thread = create_chat_thread(self.paths, title="Ask", provider="local", mode="chat")
    with patch("openauthor.retrieval.build_retrieval_index", side_effect=OSError("disk full")):
      result = send_chat_message(self.paths, thread_id=thread["id"], message="Where is the winter key hidden?", current_scene_id="scene-0001")
    self.assertEqual(result["turn"]["status"], "completed")
    self.assertEqual(result["assistant_message"]["context_used"]["review"]["retrieval_result_count"], 0)


if __name__ == "__main__":
  unittest.main()
