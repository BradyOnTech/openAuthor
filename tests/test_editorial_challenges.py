from __future__ import annotations

import unittest
from pathlib import Path

from openauthor.story_observations import prose_trait_diagnostics
from scripts.evaluate_canon_diagnostics import evaluate


class EditorialChallengeTests(unittest.TestCase):
  def test_original_product_challenges(self):
    report = evaluate(Path(__file__).resolve().parents[1] / "docs" / "product-review-challenges.json")
    self.assertEqual((report["false_positive"], report["false_negative"]), (0, 0), report["cases"])

  def test_fresh_paraphrases_and_changes_preserve_exact_evidence(self):
    cases = [
      (["Nia had lost the ring finger on her right hand in childhood.", "Five fingers on Nia’s right hand closed around the wheel."], 1),
      (["Los ojos de Nia eran marrones.", "Los ojos de Nia eran verdes."], 1),
      (["Nia's eyes were green; she never locked the door.", "Nia's eyes were blue."], 1),
      (["Nia's hair was black.", "Nia coloured her hair silver.", "Nia's hair was silver."], 0),
      (["Nia's hair was black.", "Nia dyed her hair red.", "Nia's hair was black."], 1),
      (["Nia's hair was black.", "Nia imagined she dyed her hair red.", "Nia's hair was red."], 1),
      (["Nia's eyes were green.", '“Nia’s eyes were blue,” the witness lied.'], 0),
      (["Nia's eyes were green.", "Los ojos de Nia no eran azules."], 0),
      (["Nia's hair was black.", "Sol dyed her hair red.", "Nia's hair was red."], 1),
      (["Nia's eyes were green.", "Nia and Sol waited. Her eyes were blue."], 0),
      (["🌙 Nia’s left hand had four fingers.", "Five fingers of Nia’s left hand caught the light."], 1),
    ]
    for bodies, expected in cases:
      with self.subTest(bodies=bodies):
        scenes = [{"id": f"s{i}", "body": body} for i, body in enumerate(bodies)]
        rows = prose_trait_diagnostics(scenes, [{"type": "character", "name": "Nia"}, {"type": "character", "name": "Sol"}])
        self.assertEqual(len(rows), expected)
        for finding in rows:
          values = {scene["id"]: scene["body"] for scene in scenes}
          for item in finding["evidence"]:
            self.assertEqual(values[item["scene_id"]][item["start"]:item["end"]], item["excerpt"])

  def test_later_explicit_changes_do_not_erase_earlier_mismatches(self):
    bodies = [
      "Nia's hair was black.",
      "Nia's hair was white.",
      "Nia dyed her hair red.",
      "Nia's hair was red.",
      "Nia's hair was silver.",
      "Nia dyed her hair brown.",
      "Nia's hair was brown.",
    ]
    scenes = [{"id": f"s{i}", "body": body} for i, body in enumerate(bodies)]
    rows = prose_trait_diagnostics(scenes, [{"type": "character", "name": "Nia"}])
    self.assertEqual(len(rows), 2)
    self.assertEqual(rows[0]["scene_ids"], ["s0", "s1"])
    self.assertEqual(rows[1]["scene_ids"], ["s2", "s3", "s4"])
    self.assertNotEqual(rows[0]["id"], rows[1]["id"])
    for finding in rows:
      for item in finding["evidence"]:
        body = scenes[int(item["scene_id"][1:])]["body"]
        self.assertEqual(body[item["start"]:item["end"]], item["excerpt"])
