from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from openauthor.project import OpenAuthorError, initialize_project
from openauthor.scenes import add_scene, update_scene
from openauthor.style_profile import get_style_profile, save_style_profile, set_style_profile_reference, style_profile_for_ai
from openauthor.writing_voice import suggest_voice


class StyleProfileSourceMetadataTests(unittest.TestCase):
  def setUp(self):
    temporary = tempfile.TemporaryDirectory()
    self.addCleanup(temporary.cleanup)
    self.paths = initialize_project(Path(temporary.name), name="Voice metadata validation")
    add_scene(self.paths, title="Opening", body="Mara waited by the unopened door.")
    add_scene(self.paths, title="Departure", body="Leah left the ledger closed.")
    self.suggestion = suggest_voice(self.paths, request={"scene_ids": ["scene-0001", "scene-0002"], "provider": "local"})
    self.saved = save_style_profile(self.paths, profile=self.suggestion["profile"], expected_version=self.suggestion["base_version"], expected_scope=self.suggestion["scope"])
    self.path = self.paths.project_dir / "style_profile.json"

  def test_malformed_new_source_maps_cannot_replace_the_approved_profile(self):
    first_digest = self.saved["exemplar_digests"]["scene-0001"]
    invalid = [[], "bad", None, {}, {"scene-0001": first_digest},
      {**self.saved["source_digests"], "unselected-scene": first_digest},
      {**self.saved["source_digests"], "scene-0001": "not-a-sha256"},
      {**self.saved["source_digests"], "scene-0001": "0" * 64},
      {**self.saved["source_digests"], "scene-0001": 31},
    ]
    before = self.path.read_bytes()
    for source_digests in invalid:
      with self.subTest(source_digests=source_digests):
        self.path.write_bytes(before)
        with self.assertRaisesRegex(OpenAuthorError, "source|exemplar"):
          save_style_profile(self.paths, profile={**self.saved, "source_digests": source_digests},
            expected_version=self.saved["version"], expected_scope=self.suggestion["scope"])
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(get_style_profile(self.paths), self.saved)

  def test_new_saves_require_complete_matching_exemplar_versions(self):
    before = self.path.read_bytes()
    for digests in ({}, {"scene-0001": self.saved["exemplar_digests"]["scene-0001"]}):
      with self.subTest(exemplar_digests=digests):
        self.path.write_bytes(before)
        with self.assertRaisesRegex(OpenAuthorError, "source|exemplar"):
          save_style_profile(self.paths, profile={**self.saved, "exemplar_digests": digests},
            expected_version=self.saved["version"], expected_scope=self.suggestion["scope"])
        self.assertEqual(self.path.read_bytes(), before)

  def test_matching_maps_still_refuse_an_exemplar_changed_after_analysis(self):
    suggestion = suggest_voice(self.paths, request={"scene_ids": ["scene-0001", "scene-0002"], "provider": "local"})
    before = self.path.read_bytes()
    update_scene(self.paths, scene_identifier="scene-0001", body="Mara opened the door.")
    with self.assertRaisesRegex(OpenAuthorError, "changed after analysis"):
      save_style_profile(self.paths, profile=suggestion["profile"], expected_version=get_style_profile(self.paths)["version"], expected_scope=suggestion["scope"])
    self.assertEqual(self.path.read_bytes(), before)
    self.assertEqual(get_style_profile(self.paths)["freshness"], "stale")

  def test_missing_source_map_uses_verified_exemplar_versions_and_manual_profiles_remain_valid(self):
    profile = {key: value for key, value in self.saved.items() if key != "source_digests"}
    saved = save_style_profile(self.paths, profile=profile, expected_version=self.saved["version"], expected_scope=self.suggestion["scope"])
    self.assertEqual(saved["freshness"], "current")
    self.assertEqual(saved["source_digests"], saved["exemplar_digests"])
    manual = {**saved, "exemplar_scene_ids": [], "exemplar_digests": {}, "source_digests": {}, "observations": []}
    approved = save_style_profile(self.paths, profile=manual, expected_version=saved["version"], expected_scope=self.suggestion["scope"])
    self.assertTrue(approved["usable_for_ai"])

  def test_older_unverified_schema_reads_remain_available_without_rewriting(self):
    legacy = {"schema_version": 1, "exemplar_scene_ids": ["scene-0001"], "metrics": {"word_count": 6}, "guidance": ["Read aloud."]}
    for metadata in ({}, {"source_digests": {}}, {"source_digests": []}):
      with self.subTest(metadata=metadata):
        self.path.write_text(json.dumps({**legacy, **metadata}))
        before = self.path.read_bytes()
        profile = get_style_profile(self.paths)
        self.assertEqual(profile["freshness"], "unknown")
        self.assertFalse(profile["usable_for_ai"])
        self.assertEqual(self.path.read_bytes(), before)

  def test_existing_unverified_profile_can_be_resaved_without_promoting_provenance(self):
    legacy = {"schema_version": 1, "exemplar_scene_ids": ["scene-0001"], "guidance": ["Read aloud."]}
    self.path.write_text(json.dumps(legacy))
    profile = get_style_profile(self.paths)
    saved = save_style_profile(self.paths, profile=profile, expected_version=profile["version"], expected_scope=self.suggestion["scope"])
    self.assertEqual(saved["freshness"], "unknown")
    self.assertFalse(saved["usable_for_ai"])
    self.assertEqual(saved["source_digests"], {})

  def test_non_object_save_cannot_replace_an_existing_unverified_profile(self):
    self.path.write_text(json.dumps({"schema_version": 1, "exemplar_scene_ids": ["scene-0001"]}))
    profile = get_style_profile(self.paths)
    before = self.path.read_bytes()
    for invalid in (None, [], "bad"):
      with self.subTest(profile=invalid):
        with self.assertRaisesRegex(OpenAuthorError, "profile object"):
          save_style_profile(self.paths, profile=invalid, expected_version=profile["version"], expected_scope=self.suggestion["scope"])
        self.assertEqual(self.path.read_bytes(), before)

  def test_malformed_frozen_source_metadata_does_not_become_verified(self):
    malformed = [[], None, {"scene-0001": self.saved["source_digests"]["scene-0001"]}]
    malformed.extend({"scene-0001": digest, "scene-0002": digest} for digest in ("not-a-sha256", 31, {"fake": "digest"}))
    for source_digests in malformed:
      with self.subTest(source_digests=source_digests):
        self.path.write_text(json.dumps({**self.saved, "source_digests": source_digests, "reference_mode": "frozen"}))
        before = self.path.read_bytes()
        profile = get_style_profile(self.paths)
        self.assertEqual(profile["freshness"], "unknown")
        self.assertFalse(profile["usable_for_ai"])
        self.assertIsNone(style_profile_for_ai(self.paths))
        self.assertEqual(self.path.read_bytes(), before)

  def test_frozen_source_versions_must_match_the_selected_exemplar_versions(self):
    recorded = self.saved["source_digests"]
    for digests in ({**recorded, "unselected-scene": recorded["scene-0001"]},
        {**recorded, "scene-0001": "0" * 64}):
      with self.subTest(source_digests=digests):
        self.path.write_text(json.dumps({**self.saved, "source_digests": digests, "reference_mode": "frozen"}))
        before = self.path.read_bytes()
        profile = get_style_profile(self.paths)
        self.assertEqual(profile["freshness"], "unknown")
        self.assertFalse(profile["usable_for_ai"])
        self.assertIsNone(style_profile_for_ai(self.paths))
        self.assertEqual(self.path.read_bytes(), before)

  def test_valid_stored_frozen_versions_remain_usable_after_source_changes(self):
    update_scene(self.paths, scene_identifier="scene-0001", body="Mara opened the door.")
    for profile in (self.saved, {key: value for key, value in self.saved.items() if key != "exemplar_digests"}):
      with self.subTest(exemplar_map_present="exemplar_digests" in profile):
        self.path.write_text(json.dumps({**profile, "reference_mode": "frozen"}))
        before = self.path.read_bytes()
        loaded = get_style_profile(self.paths)
        self.assertEqual(loaded["freshness"], "stale")
        self.assertEqual(loaded["changed_scene_ids"], ["scene-0001"])
        self.assertTrue(loaded["usable_for_ai"])
        self.assertEqual(style_profile_for_ai(self.paths)["source_digests"], self.saved["source_digests"])
        self.assertEqual(self.path.read_bytes(), before)

  def test_old_source_only_profile_can_switch_reference_modes_without_losing_provenance(self):
    profile = {key: value for key, value in self.saved.items() if key != "exemplar_digests"}
    self.path.write_text(json.dumps({**profile, "reference_mode": "frozen"}))
    update_scene(self.paths, scene_identifier="scene-0001", body="Mara opened the door.")
    frozen = get_style_profile(self.paths)
    current = set_style_profile_reference(self.paths, mode="current", expected_fingerprint=frozen["fingerprint"])
    self.assertEqual(current["freshness"], "stale")
    self.assertFalse(current["usable_for_ai"])
    frozen = set_style_profile_reference(self.paths, mode="frozen", expected_fingerprint=current["fingerprint"])
    self.assertEqual(frozen["freshness"], "stale")
    self.assertTrue(frozen["usable_for_ai"])
    self.assertEqual(frozen["source_digests"], self.saved["source_digests"])
