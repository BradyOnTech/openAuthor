from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from openauthor.editorial_review import parse_review
from openauthor.planning import add_act, add_chapter, assign_scene
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.proposals import apply_proposal, get_proposal
from openauthor.scenes import add_scene, get_scene, update_scene
from openauthor.selection_editing import generate_selection, preview_selection

FIXTURES = Path(__file__).parent / "fixtures"


def finding(scene_id: str, text: str, quote: str) -> dict:
  start = text.index(quote)
  return {"category": "character-knowledge", "title": "Who read the note?",
    "observation": "The later knowledge may not have a supplied source.",
    "uncertainty": "An omitted scene or deliberate unreliable narration could explain it.",
    "suggestion": "Check the intended viewpoint; retain the sealed-note ambiguity.",
    "evidence": [{"scene_id": scene_id, "start": start, "end": start + len(quote), "quote": quote}]}


class EditorialReviewTests(unittest.TestCase):
  def setUp(self):
    temporary = tempfile.TemporaryDirectory()
    self.addCleanup(temporary.cleanup)
    self.paths = initialize_project(Path(temporary.name), name="Connected editorial review")
    self.first = "🌙 Élodie sealed the note. Mara had not read it.\n"
    self.second = 'Mara said, "The note names the missing keeper."\n'
    add_scene(self.paths, title="The sealed note", body=self.first)
    add_scene(self.paths, title="The departure", body=self.second)
    act = add_act(self.paths, title="Departure")
    chapter = add_chapter(self.paths, act_id=act["id"], title="A private message")
    assign_scene(self.paths, scene_id="scene-0001", chapter_id=chapter["id"])
    assign_scene(self.paths, scene_id="scene-0002", chapter_id=chapter["id"])
    self.args = dict(scene_id="scene-0002", start=0, end=len(self.second), selected_text=self.second,
      action="critique", provider="local", review_focus="character-knowledge", review_scope="chapter")

  def test_exact_unicode_evidence_retained_but_invented_and_out_of_scope_quotes_withheld(self):
    good = finding("scene-0001", self.first, "Élodie sealed the note.")
    invented = {**good, "evidence": [{"scene_id": "scene-0001", "start": 2, "end": 10, "quote": "Invented"}]}
    private = {**good, "evidence": [{"scene_id": "private-scene", "start": 0, "end": 4, "quote": "Note"}]}
    boolean = {**good, "evidence": [{"scene_id": "scene-0001", "start": True, "end": 20, "quote": self.first[1:20]}]}
    result = parse_review(json.dumps({"schema_version": 1, "summary": "Check the viewpoint.", "findings": [good, invented, private, boolean]}),
      [{"scene_id": "scene-0001", "title": "Opening", "start": 0, "text": self.first}], focus="character-knowledge", scope="chapter")
    self.assertEqual(len(result["findings"]), 1)
    self.assertEqual(len(result["warnings"]), 3)
    evidence = result["findings"][0]["evidence"][0]
    self.assertEqual(self.first[evidence["start"]:evidence["end"]], evidence["excerpt"])
    self.assertIn("Interpretations", result["limitations"][-1])

  def test_passage_offsets_are_absolute_and_missing_uncertainty_is_not_a_verified_finding(self):
    source = {"scene_id": "scene-0001", "title": "Middle", "start": 8, "text": self.first[8:]}
    good = finding("scene-0001", self.first, "Mara had not read it.")
    missing = {key: value for key, value in good.items() if key != "uncertainty"}
    result = parse_review(json.dumps({"schema_version": 1, "findings": [good, missing]}), [source], focus="continuity", scope="passage")
    self.assertEqual(len(result["findings"]), 1)
    self.assertEqual(len(result["warnings"]), 1)

  def test_unstructured_and_empty_reviews_do_not_claim_a_clean_bill_of_health(self):
    source = [{"scene_id": "scene-0001", "title": "Opening", "start": 0, "text": self.first}]
    for text in ("Everything is excellent.", "[]", '{"schema_version":2}', '{"schema_version":true}', '{"schema_version":1,"findings":"bad"}'):
      with self.subTest(text=text):
        result = parse_review(text, source, focus="voice", scope="passage")
        self.assertEqual(result["findings"], [])
        self.assertTrue(result["warnings"])
    result = parse_review('{"schema_version":1,"findings":[]}', source, focus="voice", scope="passage")
    self.assertEqual(result["findings"], [])
    self.assertIn("author judgment", result["limitations"][-1])

  def test_invalid_category_shapes_are_withheld_without_losing_valid_feedback(self):
    source = [{"scene_id": "scene-0001", "title": "Opening", "start": 0, "text": self.first}]
    good = finding("scene-0001", self.first, "Élodie sealed the note.")
    rows = [good, {**good, "category": []}, {**good, "category": {"name": "voice"}}]
    result = parse_review(json.dumps({"schema_version": 1, "findings": rows}), source, focus="voice", scope="passage")
    self.assertEqual(len(result["findings"]), 1)
    self.assertEqual(len(result["warnings"]), 2)

  def test_chapter_review_fingerprints_all_plan_ordered_sources_and_remains_read_only(self):
    preview = preview_selection(self.paths, **self.args)
    self.assertEqual([row["scene_id"] for row in preview["context"]["review_sources"]], ["scene-0001", "scene-0002"])
    self.assertIn(self.first, preview["context"]["review_sources"][0]["text"])
    before = {identifier: get_scene(self.paths, identifier) for identifier in ("scene-0001", "scene-0002")}
    proposal = generate_selection(self.paths, **self.args, expected_fingerprint=preview["fingerprint"], request_id="chapter-once")
    self.assertEqual(proposal["selection"]["review"]["kind"], "mechanical")
    self.assertEqual(len(proposal["selection"]["review"]["sources"]), 2)
    with self.assertRaisesRegex(OpenAuthorError, "feedback only"):
      apply_proposal(self.paths, proposal_id=proposal["id"])
    self.assertEqual({identifier: get_scene(self.paths, identifier) for identifier in before}, before)
    update_scene(self.paths, scene_identifier="scene-0001", body=self.first + "Later writing.\n")
    self.assertNotEqual(preview_selection(self.paths, **self.args)["fingerprint"], preview["fingerprint"])
    self.assertTrue(get_proposal(self.paths, proposal["id"])["stale"])
    with patch("openauthor.selection_editing.complete_chat") as provider:
      with self.assertRaisesRegex(OpenAuthorError, "context changed"):
        generate_selection(self.paths, **self.args, expected_fingerprint=preview["fingerprint"], request_id="new-attempt")
      provider.assert_not_called()

  def test_source_change_during_review_preserves_response_without_publishing_stale_findings(self):
    preview = preview_selection(self.paths, **self.args)
    def response(*unused, **kwargs):
      update_scene(self.paths, scene_identifier="scene-0001", body="The note was open.\n")
      return {"text": '{"schema_version":1,"findings":[]}'}
    with patch("openauthor.selection_editing.complete_chat", side_effect=response):
      with self.assertRaisesRegex(OpenAuthorError, "changed while generating"):
        generate_selection(self.paths, **self.args, expected_fingerprint=preview["fingerprint"], request_id="mid-flight")
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"], "The note was open.\n")
    self.assertEqual(list(self.paths.proposals_dir.glob("*.json")), [])

  def test_chapter_scope_requires_membership_and_never_silently_clips_source(self):
    add_scene(self.paths, title="Unassigned", body="Outside the chapter.\n")
    with self.assertRaisesRegex(OpenAuthorError, "Plan chapter"):
      preview_selection(self.paths, **{**self.args, "scene_id": "scene-0003", "selected_text": "Outside", "end": 7})
    update_scene(self.paths, scene_identifier="scene-0001", body="Long source " * 3000)
    with patch("openauthor.selection_editing.complete_chat") as provider:
      with self.assertRaisesRegex(OpenAuthorError, "source limit"):
        preview_selection(self.paths, **self.args)
      provider.assert_not_called()
    with self.assertRaisesRegex(OpenAuthorError, "read-only Critique"):
      preview_selection(self.paths, **{**self.args, "action": "rewrite"})

  def test_recovered_live_packet_retains_raw_feedback_and_cannot_change_prose(self):
    fixture = json.loads((FIXTURES / "ferry_ledger_chapter.json").read_text())
    raw = (FIXTURES / "editorial_offset_provider_response.txt").read_text()
    paths = initialize_project(self.paths.root / "live-packet", name=fixture["title"])
    act = add_act(paths, title="Departure")
    chapter = add_chapter(paths, act_id=act["id"], title=fixture["chapter"])
    for number, scene in enumerate(fixture["scenes"], 1):
      add_scene(paths, title=scene["title"], pov=scene["pov"], body=scene["body"])
      assign_scene(paths, scene_id=f"scene-{number:04d}", chapter_id=chapter["id"])
    selected = fixture["scenes"][2]["body"]
    args = {**self.args, "scene_id": "scene-0003", "selected_text": selected, "end": len(selected), "provider": "openai-codex"}
    preview = preview_selection(paths, **args)
    with patch("openauthor.selection_editing.complete_chat", return_value={"text": raw}):
      proposal = generate_selection(paths, **args, expected_fingerprint=preview["fingerprint"], request_id="live-offset-recovery")
    self.assertEqual(proposal["selection"]["feedback"], raw)
    self.assertEqual(len(proposal["selection"]["review"]["findings"]), 1)
    self.assertEqual(get_proposal(paths, proposal["id"])["selection"]["feedback"], raw)
    with self.assertRaisesRegex(OpenAuthorError, "feedback only"):
      apply_proposal(paths, proposal_id=proposal["id"])
    self.assertEqual([get_scene(paths, f"scene-{number:04d}")["body"] for number in range(1, 4)],
      [scene["body"] for scene in fixture["scenes"]])


class EditorialEvidenceRecoveryTests(unittest.TestCase):
  @staticmethod
  def response(scene_id, quote, start, end):
    return json.dumps({"schema_version": 1, "findings": [{
      "category": "clarity", "title": "Check this passage", "observation": "The quoted wording may matter.",
      "uncertainty": "An omitted scene could change the interpretation.", "suggestion": "Review the intended meaning.",
      "evidence": [{"scene_id": scene_id, "quote": quote, "start": start, "end": end}],
    }]})

  def test_live_packet_recovers_unique_off_by_one_quote_without_changing_provider_response(self):
    raw = (FIXTURES / "editorial_offset_provider_response.txt").read_text()
    fixture = json.loads((FIXTURES / "ferry_ledger_chapter.json").read_text())
    sources = [{"scene_id": f"scene-{number:04d}", "title": scene["title"], "start": 0, "text": scene["body"]}
      for number, scene in enumerate(fixture["scenes"], 1)]
    result = parse_review(raw, sources, focus="character-knowledge", scope="chapter")
    self.assertEqual(len(result["findings"]), 1)
    self.assertEqual([(e["scene_id"], e["start"], e["end"]) for e in result["findings"][0]["evidence"]],
      [("scene-0002", 134, 238), ("scene-0003", 527, 707)])
    self.assertEqual(len(result["warnings"]), 1)
    self.assertIn("526", result["warnings"][0])
    self.assertIn("706", result["warnings"][0])
    self.assertIn("527", result["warnings"][0])
    self.assertIn("707", result["warnings"][0])
    self.assertIn("corrected", result["warnings"][0])
    self.assertIn("original", result["warnings"][0].lower())
    self.assertEqual(json.loads(raw)["findings"][0]["evidence"][1]["start"], 526)
    self.assertIn("author judgment", result["limitations"][-1])

  def test_unicode_recovery_uses_codepoints_and_absolute_reviewed_window_offsets(self):
    sources = [{"scene_id": "scene-0001", "title": "Window", "start": 100, "text": "🌙 e\u0301lan ends."}]
    result = parse_review(self.response("scene-0001", "e\u0301lan", 103, 108), sources, focus="voice", scope="passage")
    self.assertEqual(len(result["findings"]), 1)
    evidence = result["findings"][0]["evidence"][0]
    self.assertEqual((evidence["start"], evidence["end"], evidence["excerpt"]), (102, 107, "e\u0301lan"))
    normalized = parse_review(self.response("scene-0001", "élan", 102, 106), sources, focus="voice", scope="passage")
    self.assertEqual(normalized["findings"], [])

  def test_repeated_and_self_overlapping_quotes_with_wrong_offsets_stay_withheld(self):
    for text, quote in (("key key", "key"), ("ababa", "aba")):
      with self.subTest(text=text):
        result = parse_review(self.response("scene-0001", quote, 99, 102),
          [{"scene_id": "scene-0001", "title": "Repeated", "start": 0, "text": text}], focus="clarity", scope="passage")
        self.assertEqual(result["findings"], [])
        self.assertEqual(len(result["warnings"]), 1)

  def test_overlapping_source_windows_deduplicate_the_same_absolute_quote_only(self):
    sources = [{"scene_id": "scene-0001", "title": "Window", "start": 100, "text": "x key y"},
      {"scene_id": "scene-0001", "title": "Overlapping", "start": 102, "text": "key y"}]
    result = parse_review(self.response("scene-0001", "key", 0, 3), sources, focus="clarity", scope="passage")
    self.assertEqual(len(result["findings"]), 1)
    evidence = result["findings"][0]["evidence"][0]
    self.assertEqual((evidence["start"], evidence["end"]), (102, 105))
    sources.append({"scene_id": "scene-0001", "title": "Another location", "start": 200, "text": "key"})
    ambiguous = parse_review(self.response("scene-0001", "key", 0, 3), sources, focus="clarity", scope="passage")
    self.assertEqual(ambiguous["findings"], [])

  def test_recovery_does_not_search_other_scenes_missing_text_or_join_source_windows(self):
    cases = [
      ("scene-0001", "secret", [{"scene_id": "scene-0002", "title": "Other scene", "start": 0, "text": "secret"}]),
      ("scene-0001", "secret", [{"scene_id": "scene-0001", "title": "Reviewed window", "start": 40, "text": "public"}]),
      ("scene-0001", "copper", [{"scene_id": "scene-0001", "title": "First window", "start": 10, "text": "cop"},
        {"scene_id": "scene-0001", "title": "Second window", "start": 13, "text": "per"}]),
      ("scene-0001", "She knows.", [{"scene_id": "scene-0001", "title": "Paraphrase", "start": 0, "text": "She knew."}]),
    ]
    for scene_id, quote, sources in cases:
      with self.subTest(quote=quote, sources=sources):
        result = parse_review(self.response(scene_id, quote, 0, len(quote)), sources, focus="clarity", scope="passage")
        self.assertEqual(result["findings"], [])

  def test_unique_quote_recovers_integer_bounds_but_malformed_offsets_remain_withheld(self):
    sources = [{"scene_id": "scene-0001", "title": "Boundary", "start": 10, "text": "key"}]
    for start, end in ((-1, 999), (14, 13), (10, 10)):
      with self.subTest(start=start, end=end):
        result = parse_review(self.response("scene-0001", "key", start, end), sources, focus="clarity", scope="passage")
        self.assertEqual(len(result["findings"]), 1)
        evidence = result["findings"][0]["evidence"][0]
        self.assertEqual((evidence["start"], evidence["end"]), (10, 13))
    for start, end in ((True, 13), (10, False), (10.0, 13), ("10", 13), (None, 13)):
      with self.subTest(start=start, end=end):
        result = parse_review(self.response("scene-0001", "key", start, end), sources, focus="clarity", scope="passage")
        self.assertEqual(result["findings"], [])

  def test_verified_offsets_can_identify_one_repeated_quote_without_recovery(self):
    result = parse_review(self.response("scene-0001", "key", 4, 7),
      [{"scene_id": "scene-0001", "title": "Repeated", "start": 0, "text": "key key"}], focus="clarity", scope="passage")
    self.assertEqual(len(result["findings"]), 1)
    self.assertEqual(result["warnings"], [])
    evidence = result["findings"][0]["evidence"][0]
    self.assertEqual((evidence["start"], evidence["end"]), (4, 7))
