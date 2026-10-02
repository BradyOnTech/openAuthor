from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from openauthor.project import initialize_project
from openauthor.scenes import add_scene, update_scene
from openauthor.ai import generate_proposal, preview_proposal_revision
from openauthor.generations import get_generation_run
from openauthor.style_profile import build_style_profile, get_style_profile


class StyleProfileTests(unittest.TestCase):
  def test_corrupt_profile_is_a_recoverable_error_not_an_ai_context(self) -> None:
    from openauthor.project import OpenAuthorError
    from openauthor.style_profile import style_profile_for_ai
    with tempfile.TemporaryDirectory() as folder:
      paths = initialize_project(Path(folder), name="Invalid style")
      (paths.project_dir / "style_profile.json").write_text(json.dumps({"schema_version": 2, "exemplar_scene_ids": None}))
      with self.assertRaises(OpenAuthorError):
        style_profile_for_ai(paths)

  def test_legacy_profiles_require_rebuild_and_unicode_words_are_not_ascii_fragments(self) -> None:
    from openauthor.style_profile import style_profile_for_ai, set_style_profile_reference
    from openauthor.project import OpenAuthorError
    with tempfile.TemporaryDirectory() as folder:
      paths = initialize_project(Path(folder), name="Legacy style upgrade")
      add_scene(paths, title="Exemplar", body="Élodie attend. Анна ждёт. سلمى تنتظر.")
      profile = build_style_profile(paths, scene_ids=["scene-0001"])
      self.assertEqual(profile["metrics"]["word_count"], 6)
      legacy = {key: profile[key] for key in ("exemplar_scene_ids", "metrics", "guidance", "created_at")}
      legacy["schema_version"] = 1
      (paths.project_dir / "style_profile.json").write_text(json.dumps(legacy))
      self.assertEqual(get_style_profile(paths)["freshness"], "unknown")
      self.assertIsNone(style_profile_for_ai(paths))
      with self.assertRaisesRegex(OpenAuthorError, "Rebuild"):
        set_style_profile_reference(paths, mode="frozen", expected_fingerprint=get_style_profile(paths)["fingerprint"])
      self.assertTrue(build_style_profile(paths, scene_ids=["scene-0001"])["usable_for_ai"])

  def test_author_can_freeze_inspected_measurements_and_return_to_current_sources(self) -> None:
    from openauthor.style_profile import set_style_profile_reference, style_profile_for_ai
    from openauthor.project import OpenAuthorError
    with tempfile.TemporaryDirectory() as folder:
      paths = initialize_project(Path(folder), name="Author owned style reference")
      add_scene(paths, title="Exemplar", body="Silver rain fell. Mara waited.")
      original = build_style_profile(paths, scene_ids=["scene-0001"])
      update_scene(paths, scene_identifier="scene-0001", body="Mara now speaks with a different cadence.")
      stale = get_style_profile(paths)
      with self.assertRaisesRegex(OpenAuthorError, "changed"):
        set_style_profile_reference(paths, mode="frozen", expected_fingerprint=original["fingerprint"])
      frozen = set_style_profile_reference(paths, mode="frozen", expected_fingerprint=stale["fingerprint"])
      self.assertEqual(frozen["freshness"], "stale")
      self.assertEqual(frozen["metrics"], original["metrics"])
      self.assertEqual(style_profile_for_ai(paths)["reference_mode"], "frozen")
      current = set_style_profile_reference(paths, mode="current", expected_fingerprint=frozen["fingerprint"])
      self.assertFalse(current["usable_for_ai"])
      self.assertIsNone(style_profile_for_ai(paths))
      rebuilt = build_style_profile(paths, scene_ids=["scene-0001"])
      self.assertEqual(rebuilt["freshness"], "current")
      self.assertTrue(rebuilt["usable_for_ai"])

  def test_changed_exemplars_are_visible_and_excluded_from_generation(self) -> None:
    with tempfile.TemporaryDirectory() as folder:
      paths = initialize_project(Path(folder), name="Current style sources")
      add_scene(paths, title="Exemplar", body="Silver rain fell. Mara waited.")
      build_style_profile(paths, scene_ids=["scene-0001"])
      update_scene(paths, scene_identifier="scene-0001", body="Now a completely different rhythm fills this long and flowing sentence.")
      profile = get_style_profile(paths)
      self.assertEqual(profile["freshness"], "stale")
      self.assertEqual(profile["changed_scene_ids"], ["scene-0001"])
      self.assertFalse(profile["usable_for_ai"])
      proposal = generate_proposal(paths, scene_id="scene-0001", instruction="Preserve my style", provider="local")
      run = get_generation_run(paths, proposal["generation"]["id"])
      self.assertNotIn("author_selected_style_profile", run["context"])
      preview = preview_proposal_revision(paths, proposal_id=proposal["id"])
      self.assertNotIn("author_selected_style_profile", preview["context"])
      self.assertEqual(preview["style_profile_status"]["freshness"], "stale")
      self.assertFalse(preview["style_profile_status"]["included"])

  def test_unsegmented_prose_never_becomes_zero_word_writing_advice(self) -> None:
    with tempfile.TemporaryDirectory() as folder:
      paths = initialize_project(Path(folder), name="Style limitations")
      add_scene(paths, title="Exemplar", body="夜雨落在长街。小林看见蓝色的灯。她没有回头。")
      profile = build_style_profile(paths, scene_ids=["scene-0001"])
      self.assertIsNone(profile["metrics"]["word_count"])
      self.assertTrue(profile["measurement"]["limitations"])
      self.assertNotIn("0.0 words", " ".join(profile["guidance"]))
      self.assertNotIn("Aim near", " ".join(profile["guidance"]))

  def test_profile_is_derived_only_from_selected_exemplars(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Style")
      add_scene(paths, title="Exemplar", body='"Stay," Mara said. The rain-silver city listened; nobody answered.')
      add_scene(paths, title="Rough", body="PLACEHOLDER PLAIN TEXT")
      profile = build_style_profile(paths, scene_ids=["scene-0001"])
      self.assertEqual(profile["exemplar_scene_ids"], ["scene-0001"])
      self.assertGreater(profile["metrics"]["dialogue_word_ratio"], 0)
      self.assertNotIn("placeholder", profile["metrics"]["signature_words"])
      self.assertEqual(get_style_profile(paths), profile)


if __name__ == "__main__":
  unittest.main()
