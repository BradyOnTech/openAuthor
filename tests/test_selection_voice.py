from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from openauthor.project import OpenAuthorError, atomic_write_json, initialize_project
from openauthor.scenes import add_scene, get_scene, update_scene
from openauthor.selection_editing import generate_selection, preview_selection
from openauthor.style_profile import PRESETS, get_style_profile, save_style_profile, set_style_profile_reference, voice_context


class SelectionVoiceTests(unittest.TestCase):
  def setUp(self):
    temporary = tempfile.TemporaryDirectory()
    self.addCleanup(temporary.cleanup)
    self.paths = initialize_project(Path(temporary.name), name="Selection Writing Voice")
    add_scene(self.paths, title="Gate", body="Mara waited at the gate. Nobody answered.\n")
    self.text = get_scene(self.paths, "scene-0001")["body"]
    self.args = dict(scene_id="scene-0001", start=0, end=len(self.text), selected_text=self.text,
      action="critique", provider="local", review_focus="voice")

  def save_profile(self, **changes):
    current = get_style_profile(self.paths)
    return save_style_profile(self.paths, profile={**PRESETS[0], **changes}, expected_version=current["version"] if current else "")

  def test_approved_voice_is_in_exact_context_and_changes_invalidate_review(self):
    profile = self.save_profile(guidance=["Preserve this book's quiet hesitation."])
    preview = preview_selection(self.paths, **self.args)
    self.assertEqual(preview["context"]["writing_voice"], voice_context(profile))
    self.assertTrue(preview["context"]["style_profile_status"]["included"])
    self.assertIn("quiet hesitation", preview["user_prompt"])
    self.save_profile(guidance=["Preserve crisp, direct diction."])
    self.assertNotEqual(preview["fingerprint"], preview_selection(self.paths, **self.args)["fingerprint"])
    with patch("openauthor.selection_editing.complete_chat") as provider:
      with self.assertRaisesRegex(OpenAuthorError, "context changed"):
        generate_selection(self.paths, **self.args, expected_fingerprint=preview["fingerprint"], request_id="old-voice")
      provider.assert_not_called()

  def test_midflight_voice_change_keeps_prose_and_withholds_outdated_review(self):
    self.save_profile()
    preview = preview_selection(self.paths, **self.args)
    def response(*unused, **kwargs):
      self.save_profile(guidance=["The author changed the voice while the request ran."])
      return {"text": '{"schema_version":1,"findings":[]}'}
    with patch("openauthor.selection_editing.complete_chat", side_effect=response):
      with self.assertRaisesRegex(OpenAuthorError, "changed while generating"):
        generate_selection(self.paths, **self.args, expected_fingerprint=preview["fingerprint"], request_id="midflight-voice")
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"], self.text)
    self.assertEqual(list(self.paths.proposals_dir.glob("*.json")), [])

  def test_stale_unapproved_exemplar_is_omitted_and_frozen_reference_contains_no_sample(self):
    import hashlib
    sample = "PRIVATE_EXEMPLAR_ONLY: the needle lay beside the blue lantern.\n"
    add_scene(self.paths, title="Voice sample", body=sample)
    digest = hashlib.sha256(sample.encode()).hexdigest()
    self.save_profile(exemplar_scene_ids=["scene-0002"], exemplar_digests={"scene-0002": digest},
      observations=[{"scene_id": "scene-0002", "aspect": "restraint", "observation": "UNAPPROVED_OBSERVATION", "excerpt": "the blue lantern"}])
    update_scene(self.paths, scene_identifier="scene-0002", body="Changed sample.\n")
    stale = preview_selection(self.paths, **self.args)
    self.assertEqual(stale["context"]["style_profile_status"]["freshness"], "stale")
    self.assertFalse(stale["context"]["style_profile_status"]["included"])
    self.assertNotIn("writing_voice", stale["context"])
    profile = get_style_profile(self.paths)
    set_style_profile_reference(self.paths, mode="frozen", expected_fingerprint=profile["fingerprint"])
    frozen = preview_selection(self.paths, **self.args)
    self.assertTrue(frozen["context"]["style_profile_status"]["included"])
    self.assertEqual(frozen["context"]["writing_voice"], voice_context(profile))
    for omitted in ("PRIVATE_EXEMPLAR_ONLY", "UNAPPROVED_OBSERVATION", "the blue lantern", "Changed sample."):
      self.assertNotIn(omitted, frozen["system_prompt"] + frozen["user_prompt"])
    # Writing Voice drafts live outside the approved profile and are never sent.
    atomic_write_json(self.paths.project_dir / "voice_drafts.json", {"description": "UNAPPROVED_DRAFT"})
    self.assertNotIn("UNAPPROVED_DRAFT", preview_selection(self.paths, **self.args)["user_prompt"])

  def test_rewrite_uses_the_same_approved_craft_projection(self):
    profile = self.save_profile()
    preview = preview_selection(self.paths, **{**self.args, "action": "rewrite", "review_focus": "general"})
    self.assertEqual(preview["context"]["writing_voice"], voice_context(profile))
    self.assertNotIn("exemplar_scene_ids", json.dumps(preview["context"]["writing_voice"]))


if __name__ == "__main__":
  unittest.main()
