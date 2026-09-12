from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from openauthor.ai import build_generation_context, generate_proposal, generate_proposal_draft, regenerate_change_hunk
from openauthor.assistant.context import ContextPolicy, ContextRequest, build_context_pack
from openauthor.assistant.runtime import AssistantRuntime
from openauthor.chat import create_chat_thread, send_chat_message
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.proposals import apply_proposal, get_proposal, list_proposals, undo_proposal
from openauthor.scenes import add_scene, get_scene, update_scene
from openauthor.style_profile import PRESETS, get_style_profile, save_style_profile, validate_profile, voice_context
from openauthor.writing_voice import preview_voice, review_voice_preview, stage_voice_preview, suggest_voice, voice_workspace


class WritingVoiceTests(unittest.TestCase):
  def setUp(self):
    directory = tempfile.TemporaryDirectory()
    self.addCleanup(directory.cleanup)
    self.paths = initialize_project(Path(directory.name), name="Writing Voice")
    self.source = 'Mara began to count the boats. "Seven," she said. The tide pressed against the gate.'
    add_scene(self.paths, title="The gate", body=self.source + "\n\nIvo kept the key in his pocket.")
    add_scene(self.paths, title="Private rough draft", body="UNSELECTED-MATERIAL")

  def save(self, profile=None):
    current = voice_workspace(self.paths)
    return save_style_profile(self.paths, profile=profile or PRESETS[0], expected_version=current["profile"]["version"] if current["profile"] else "", expected_scope=current["scope"])

  def provider_result(self, data):
    return {"text": json.dumps(data), "input_tokens": 100, "output_tokens": 100, "latency_ms": 1, "attempts": 1, "tool_calls": []}

  def preview_request(self, **changes):
    return {"scene_id": "scene-0001", "source_text": self.source, "directions": PRESETS[:2], "provider": "local", **changes}

  def creative_preview(self):
    replies = [self.provider_result({"text": self.source.replace("began to count", "counted"), "observations": [
      {"criterion": "readability", "observation": "The opening uses a direct verb.", "excerpt": "Mara counted the boats."}]}),
      self.provider_result({"text": self.source.replace("began to count", "started counting"), "observations": []})]
    with patch("openauthor.ai._call_provider", side_effect=replies) as provider:
      result = preview_voice(self.paths, request=self.preview_request(provider="openai"))
    return result, provider

  def test_manual_profile_persists_traits_and_never_changes_manuscript(self):
    before = get_scene(self.paths, "scene-0001")
    profile = self.save({**PRESETS[1], "name": "The Coast", "avoid": ["Repeated metaphors"]})
    self.assertEqual(profile["name"], "The Coast")
    self.assertEqual(get_style_profile(self.paths), profile)
    self.assertEqual(get_scene(self.paths, "scene-0001"), before)
    self.assertEqual(list_proposals(self.paths), [])
    self.assertEqual(profile["traits"]["pacing"], "propulsive")

  def test_stale_profile_and_changed_workspace_never_overwrite_approved_voice(self):
    old = self.save()
    current = self.save(PRESETS[1])
    with self.assertRaisesRegex(OpenAuthorError, "changed elsewhere"):
      save_style_profile(self.paths, profile=old, expected_version=old["version"])
    with self.assertRaisesRegex(OpenAuthorError, "workspace changed"):
      save_style_profile(self.paths, profile=old, expected_version=current["version"], expected_scope="other-scope")
    self.assertEqual(get_style_profile(self.paths), current)

  def test_legacy_profile_is_read_without_rewriting_the_file(self):
    legacy = {"schema_version": 1, "exemplar_scene_ids": ["scene-0001"], "guidance": ["Keep dialogue restrained."], "metrics": {"word_count": 40}, "created_at": "then"}
    path = self.paths.project_dir / "style_profile.json"
    path.write_text(json.dumps(legacy))
    original = path.read_text()
    profile = get_style_profile(self.paths)
    self.assertEqual(profile["schema_version"], 2)
    self.assertEqual(profile["guidance"], legacy["guidance"])
    self.assertEqual(path.read_text(), original)
    self.save(profile)
    self.assertEqual(json.loads(path.read_text())["schema_version"], 2)

  def test_invalid_traits_and_oversized_preferences_fail_closed(self):
    before = self.save()
    for profile in ({"traits": {"pacing": "warp"}}, {"traits": {"invented": "value"}}, {"description": "x" * 2401}, {"guidance": ["x" * 401]}, {"observations": [{}]}):
      with self.subTest(profile=profile), self.assertRaises(OpenAuthorError):
        self.save(profile)
      self.assertEqual(get_style_profile(self.paths), before)

  def test_local_analysis_is_measurement_only_and_needs_explicit_approval(self):
    before = self.save()
    suggestion = suggest_voice(self.paths, request={"profile": before, "brief": "Close perspective and dry humor.", "scene_ids": ["scene-0001"], "provider": "local"})
    self.assertIn("measures rhythm and dialogue only", suggestion["message"])
    self.assertEqual(get_style_profile(self.paths), before)
    self.assertEqual(suggestion["profile"]["exemplar_scene_ids"], ["scene-0001"])
    self.assertNotIn("UNSELECTED-MATERIAL", json.dumps(suggestion))
    approved = self.save(suggestion["profile"])
    self.assertEqual(approved["description"], "Close perspective and dry humor.")

  def test_model_analysis_is_evidence_linked_bounded_and_not_automatically_saved(self):
    response = self.provider_result({"profile": PRESETS[2], "observations": [{"scene_id": "scene-0001", "aspect": "Emotional restraint", "observation": "The count is spoken without an emotional explanation.", "excerpt": '"Seven," she said.'}]})
    with patch("openauthor.ai._call_provider", return_value=response) as provider:
      result = suggest_voice(self.paths, request={"brief": "Restrained feeling and atmospheric imagery.", "scene_ids": ["scene-0001"], "provider": "openai"})
    self.assertIsNone(get_style_profile(self.paths))
    prompt = provider.call_args.kwargs["user_prompt"]
    self.assertNotIn("UNSELECTED-MATERIAL", prompt)
    self.assertIn("Restrained feeling", prompt)
    self.assertIn("not instructions", provider.call_args.kwargs["system_prompt"])
    self.assertTrue(result["generation_id"])
    self.save(result["profile"])

  def test_unverifiable_analysis_and_changed_exemplars_cannot_be_approved(self):
    with patch("openauthor.ai._call_provider", return_value=self.provider_result({"profile": PRESETS[0], "observations": [{"scene_id": "scene-0001", "aspect": "Humor", "observation": "A joke.", "excerpt": "A fabricated quotation."}]})):
      with self.assertRaisesRegex(OpenAuthorError, "unverifiable"):
        suggest_voice(self.paths, request={"scene_ids": ["scene-0001"], "provider": "openai"})
    result = suggest_voice(self.paths, request={"scene_ids": ["scene-0001"]})
    update_scene(self.paths, scene_identifier="scene-0001", body="New author writing")
    with self.assertRaisesRegex(OpenAuthorError, "exemplar changed"):
      self.save(result["profile"])
    self.assertIsNone(get_style_profile(self.paths))

  def test_creative_previews_receive_distinct_traits_and_are_not_manuscript_changes(self):
    before = get_scene(self.paths, "scene-0001")
    approved = self.save()
    record, provider = self.creative_preview()
    self.assertEqual(len(record["directions"]), 2)
    self.assertNotEqual(record["directions"][0]["text"], record["directions"][1]["text"])
    payloads = [json.loads(call.kwargs["user_prompt"]) for call in provider.call_args_list]
    self.assertEqual(payloads[0]["writing_voice"], voice_context(PRESETS[0]))
    self.assertEqual(payloads[1]["writing_voice"], voice_context(PRESETS[1]))
    self.assertNotIn("body", payloads[0]["context"]["scene"])
    self.assertNotIn("UNSELECTED-MATERIAL", json.dumps(payloads))
    self.assertEqual(get_scene(self.paths, "scene-0001"), before)
    self.assertEqual(get_style_profile(self.paths), approved)
    self.assertEqual(list_proposals(self.paths), [])
    self.assertEqual(voice_workspace(self.paths)["previews"][0]["id"], record["id"])

  def test_selected_preview_queues_exact_passage_change_with_review_apply_and_undo(self):
    record, _ = self.creative_preview()
    before = get_scene(self.paths, "scene-0001")
    proposal = stage_voice_preview(self.paths, preview_id=record["id"], direction_id="direction-1")
    self.assertEqual(proposal["status"], "pending")
    self.assertEqual(get_scene(self.paths, "scene-0001"), before)
    self.assertIn("Ivo kept the key in his pocket.", proposal["proposed_body"])
    self.assertEqual(stage_voice_preview(self.paths, preview_id=record["id"], direction_id="direction-1")["id"], proposal["id"])
    self.assertEqual(len(list_proposals(self.paths)), 1)
    apply_proposal(self.paths, proposal_id=proposal["id"])
    self.assertIn("Mara counted", get_scene(self.paths, "scene-0001")["body"])
    undo_proposal(self.paths, proposal_id=proposal["id"])
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"], before["body"])
    self.assertIsNone(get_style_profile(self.paths))

  def test_changed_scene_or_storyline_blocks_preview_handoff(self):
    record, _ = self.creative_preview()
    update_scene(self.paths, scene_identifier="scene-0001", body="Newer prose")
    with self.assertRaisesRegex(OpenAuthorError, "newer work was preserved"):
      stage_voice_preview(self.paths, preview_id=record["id"], direction_id="direction-1")
    self.assertEqual(list_proposals(self.paths), [])

  def test_same_prose_on_another_storyline_cannot_stage_old_preview(self):
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=self.paths.root, check=True)
    record, _ = self.creative_preview()
    subprocess.run(["git", "symbolic-ref", "HEAD", "refs/heads/alternate"], cwd=self.paths.root, check=True)
    with self.assertRaisesRegex(OpenAuthorError, "Storyline changed"):
      stage_voice_preview(self.paths, preview_id=record["id"], direction_id="direction-1")
    self.assertEqual(list_proposals(self.paths), [])
    self.assertEqual(voice_workspace(self.paths)["previews"], [])

  def test_preview_handoff_retry_recovers_failed_draft_and_link_writes(self):
    before = get_scene(self.paths, "scene-0001")
    for seam in ("openauthor.proposals.set_proposal_draft", "openauthor.writing_voice.atomic_write_json"):
      record, _ = self.creative_preview()
      with self.subTest(seam=seam), patch(seam, side_effect=OSError("disk unavailable")):
        with self.assertRaises(OSError):
          stage_voice_preview(self.paths, preview_id=record["id"], direction_id="direction-1")
      initial = [row for row in list_proposals(self.paths) if row["generation"]["preview_id"] == record["id"]]
      self.assertEqual(len(initial), 1)
      retried = stage_voice_preview(self.paths, preview_id=record["id"], direction_id="direction-1")
      self.assertEqual(retried["id"], initial[0]["id"])
      self.assertTrue(retried["change_set"]["hunks"])
      self.assertEqual(len([row for row in list_proposals(self.paths) if row["generation"]["preview_id"] == record["id"]]), 1)
    self.assertEqual(get_scene(self.paths, "scene-0001"), before)

  def test_local_preview_is_honest_baseline_and_cannot_queue_noop(self):
    result = preview_voice(self.paths, request=self.preview_request())
    self.assertTrue(all(row["text"] == self.source for row in result["directions"]))
    self.assertIn("does not generate creative prose", result["directions"][0]["warnings"][0])
    with self.assertRaisesRegex(OpenAuthorError, "no prose change"):
      stage_voice_preview(self.paths, preview_id=result["id"], direction_id="direction-1")

  def test_preview_limits_and_nonmatching_source_block_before_provider(self):
    for changes in ({"directions": [PRESETS[0]]}, {"directions": [PRESETS[0], PRESETS[0]]}, {"directions": [PRESETS[0], {**PRESETS[0], "name": "Same traits, new label"}]}, {"source_text": "Not in the scene"}, {"source_text": "word " * 401}):
      with self.subTest(changes=changes), patch("openauthor.ai._call_provider") as provider:
        with self.assertRaises(OpenAuthorError):
          preview_voice(self.paths, request=self.preview_request(provider="openai", **changes))
        provider.assert_not_called()

  def test_invalid_model_output_does_not_create_previews(self):
    for data in ({"text": "word " * 501}, {"text": "A sample.", "observations": [{"criterion": "voice_fit", "observation": "Good", "excerpt": "Absent."}]}):
      with self.subTest(data=data), patch("openauthor.ai._call_provider", return_value=self.provider_result(data)):
        with self.assertRaises(OpenAuthorError):
          preview_voice(self.paths, request=self.preview_request(provider="openai"))
    self.assertEqual(voice_workspace(self.paths)["previews"], [])

  def test_author_quality_review_persists_without_learning_or_numerical_score(self):
    record, _ = self.creative_preview()
    result = review_voice_preview(self.paths, preview_id=record["id"], direction_id="direction-1", review={"ratings": {"voice_fit": "works", "consistency": "needs_revision"}, "notes": "Check the tide chronology."})
    self.assertEqual(result["directions"][0]["author_review"]["ratings"]["consistency"], "needs_revision")
    self.assertEqual(voice_workspace(self.paths)["previews"][0], result)
    self.assertIsNone(get_style_profile(self.paths))
    self.assertNotIn("score", result["directions"][0])

  def test_provider_call_does_not_hold_manuscript_lock(self):
    errors = []
    def reply(**kwargs):
      def read():
        try:
          get_scene(self.paths, "scene-0001")
        except BaseException as error:
          errors.append(error)
      thread = threading.Thread(target=read, daemon=True)
      thread.start(); thread.join(2)
      self.assertFalse(thread.is_alive())
      return self.provider_result({"text": self.source, "observations": []})
    with patch("openauthor.ai._call_provider", side_effect=reply):
      preview_voice(self.paths, request=self.preview_request(provider="openai"))
    self.assertEqual(errors, [])

  def test_approved_profile_reaches_chat_voice_draft_and_hunk_but_not_assistant_personality(self):
    profile = self.save({**PRESETS[1], "name": "Coast Voice", "avoid": ["Violet spirals"]})
    for channel in ("text", "desktop_voice"):
      pack = build_context_pack(self.paths, ContextRequest(thread_id="voice", channel=channel, utterance="Make the action more immediate.", current_scene_id="scene-0001"), ContextPolicy(retrieval_mode="off"))
      self.assertEqual(pack.provider_context["writing_voice"], voice_context(profile))
      self.assertIn("not your conversational personality", json.dumps(pack.model_input))
      self.assertTrue(any(item.kind == "writing_voice" for item in pack.items))
    context = build_generation_context(self.paths, scene_id="scene-0001", context_scene_radius=0, codex_limit=1)
    self.assertEqual(context["writing_voice"]["avoid"], ["Violet spirals"])
    generated = generate_proposal(self.paths, instruction="Tighten the opening", scene_id="scene-0001", provider="local")
    with patch("openauthor.ai._call_provider", return_value={**self.provider_result({}), "text": self.source.replace("began to count", "counted")}) as provider:
      draft = generate_proposal_draft(self.paths, proposal_id=generated["id"], provider="local")
      self.assertIn("Violet spirals", provider.call_args.kwargs["user_prompt"])
      regenerate_change_hunk(self.paths, proposal_id=draft["id"], hunk_id=draft["change_set"]["hunks"][0]["id"], provider="local")
      self.assertIn("Violet spirals", provider.call_args.kwargs["system_prompt"])

  def test_copilot_receipt_identifies_profile_and_voice_connection_rechecks_it(self):
    self.save()
    thread = create_chat_thread(self.paths, title="Voice", provider="local")
    result = send_chat_message(self.paths, thread_id=thread["id"], message="Discuss the scene.", context_overrides={"retrieval_mode": "off"})
    self.assertEqual(result["assistant_message"]["context_used"]["review"]["writing_voice_name"], PRESETS[0]["name"])
    runtime = AssistantRuntime(self.paths)
    prepared = runtime.prepare(thread_id=thread["id"], channel="desktop_voice", utterance="Discuss the prose")
    self.save(PRESETS[1])
    with patch("openauthor.assistant.runtime.RealtimeSessionBroker.negotiate") as broker:
      with self.assertRaisesRegex(OpenAuthorError, "Writing Voice changed"):
        runtime.start_realtime_session(offer_sdp="offline", context_pack_id=prepared["context_pack"]["pack_id"])
      broker.assert_not_called()

  def test_approved_voice_is_required_budgeted_context_not_silently_clipped(self):
    self.save({**PRESETS[0], "description": "detailed voice " * 150, "guidance": ["specific rhythm " * 20 for _ in range(16)]})
    with self.assertRaisesRegex(RuntimeError, "Required Assistant input"):
      build_context_pack(self.paths, ContextRequest(thread_id="voice", channel="text", utterance="Help."), ContextPolicy(input_token_ceiling=2000, retrieval_mode="off"))

  def test_cli_workspace_save_and_suggest_preserve_approval(self):
    env = {**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])}
    def command(args):
      result = subprocess.run([sys.executable, "-m", "openauthor", "style", *args, "--json"], cwd=self.paths.root, env=env, capture_output=True, text=True)
      self.assertEqual(result.returncode, 0, result.stderr)
      return json.loads(result.stdout)
    workspace = command(["workspace"])
    suggested = command(["suggest", "--request-json", json.dumps({"brief": "Dry humor and clear action.", "provider": "local"})])
    self.assertIsNone(get_style_profile(self.paths))
    saved = command(["save", "--request-json", json.dumps({"profile": suggested["profile"], "expected_version": "", "scope": workspace["scope"]})])
    self.assertEqual(saved["description"], "Dry humor and clear action.")
