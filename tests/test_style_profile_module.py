from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from openauthor.project import initialize_project
from openauthor.scenes import add_scene
from openauthor.style_profile import build_style_profile, get_style_profile


class StyleProfileTests(unittest.TestCase):
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
