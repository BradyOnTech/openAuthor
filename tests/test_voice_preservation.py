from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from openauthor.project import OpenAuthorError, atomic_write_json, initialize_project
from openauthor.proposals import get_proposal, list_proposals
from openauthor.scenes import add_scene, get_scene
from openauthor.style_profile import PRESETS
from openauthor.revision_preservation import preservation_fingerprint
from openauthor.writing_voice import preview_voice, refine_voice_preview, stage_voice_preview, voice_workspace


class VoicePreservationTests(unittest.TestCase):
  def setUp(self):
    directory = tempfile.TemporaryDirectory()
    self.addCleanup(directory.cleanup)
    self.paths = initialize_project(Path(directory.name), name="Original preservation example")
    self.source = ('Mara began to count the ferry berths. The ferry\'s sailing remained undecided.\n\n'
      '"The red line?" she asked.\n\n"Only a proposed berth," Ivo said.\n\n'
      'The letter\'s green seal was whole. Mara had not read it. Ivo reached toward the envelope. '
      'Mara said, "Wait." He left his hand on the table.')
    add_scene(self.paths, title="The berths", pov="Mara", body=self.source)
    self.original = get_scene(self.paths, "scene-0001")["body"]
    add_scene(self.paths, title="Private unused draft", body="PRIVATE-UNSELECTED-SOURCE")
    self.preservation = [
      {"kind": "fact", "text": "  The red line denotes a proposed berth, not a water level.  "},
      {"kind": "knowledge", "text": "Mara has not read the sealed letter; do not give her its contents."},
      {"kind": "uncertainty", "text": "Only the ferry's sailing remains undecided; introduce no personal-departure question."},
      {"kind": "protected_text", "text": '"Only a proposed berth," Ivo said.'},
      {"kind": "end_beat", "text": "Ivo's hand remains on the table after Mara's Wait; no resolution or added event."},
    ]

  def request(self, **changes):
    return {"scene_id": "scene-0001", "source_text": self.source, "instruction": "Make the existing hesitation more particular.",
      "directions": PRESETS[:2], "provider": "local", "preservation": self.preservation, **changes}

  def provider_reply(self, **changes):
    text = self.source.replace("began to count", "started to count")
    return {"text": json.dumps({"text": text, "observations": [{"criterion": "consistency", "observation": "The attempted count stays unfinished.",
      "source_excerpt": "Mara began to count the ferry berths.", "excerpt": "Mara started to count the ferry berths."}], **changes}),
      "input_tokens": 100, "output_tokens": 100, "latency_ms": 1, "attempts": 1, "tool_calls": []}

  def preview(self, **changes):
    with patch("openauthor.ai._call_provider", return_value=self.provider_reply()) as provider:
      result = preview_voice(self.paths, request=self.request(provider="openai", **changes))
    return result, provider

  def test_exact_author_contract_reaches_both_real_prompt_calls_and_is_retained_without_widening_source(self):
    result, provider = self.preview()
    self.assertEqual(result["preservation"], self.preservation)
    self.assertRegex(result["preservation_fingerprint"], r"^[a-f0-9]{64}$")
    for call in provider.call_args_list:
      payload = json.loads(call.kwargs["user_prompt"])
      self.assertEqual(payload["preservation"], self.preservation)
      self.assertNotIn("PRIVATE-UNSELECTED-SOURCE", call.kwargs["user_prompt"])
      self.assertEqual(payload["context"]["nearby_scenes"], [])
    self.assertEqual(voice_workspace(self.paths)["previews"][0]["preservation"], self.preservation)
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"], self.original)

  def test_malformed_oversized_and_nonliteral_protection_refuse_before_any_provider_call(self):
    cases = [None, "text", {}, ["text"], [{"kind": "unknown", "text": "Keep this"}], [{"kind": "fact", "text": " "}],
      [{"kind": "fact", "text": "x" * 401}], [{"kind": "fact", "text": "x" * 400}] * 8,
      [{"kind": "fact", "text": "Keep this"}] * 13, [{"kind": "fact", "text": "Keep this", "unexpected": True}],
      [{"kind": "protected_text", "text": "A phrase absent from the original."}]]
    with patch("openauthor.ai._call_provider", side_effect=AssertionError("Provider must not be reached for invalid preservation")) as provider:
      for contract in cases:
        with self.subTest(contract=contract), self.assertRaises(OpenAuthorError):
          preview_voice(self.paths, request=self.request(provider="openai", preservation=contract))
      provider.assert_not_called()

  def test_refinement_inherits_exact_original_contract_and_fingerprint_across_successive_attempts(self):
    initial, _ = self.preview()
    for _ in range(2):
      with patch("openauthor.ai._call_provider", return_value=self.provider_reply()) as provider:
        refined = refine_voice_preview(self.paths, request={"preview_id": initial["id"], "direction_id": "direction-1", "feedback": "Keep the attempt unfinished.",
          "provider": "openai", "expected_preservation_fingerprint": initial["preservation_fingerprint"]})
      self.assertEqual(refined["preservation"], self.preservation)
      self.assertEqual(refined["preservation_fingerprint"], initial["preservation_fingerprint"])
      self.assertEqual(json.loads(provider.call_args.kwargs["user_prompt"])["preservation"], self.preservation)
      initial = refined

  def test_refinement_refuses_a_forged_or_replaced_contract_instead_of_silently_rebasing(self):
    initial = preview_voice(self.paths, request=self.request())
    with patch("openauthor.ai._call_provider", side_effect=AssertionError("Provider must not be reached for replaced preservation")) as provider:
      for changes in ({"preservation": []}, {"preservation": [{"kind": "fact", "text": "A different constraint."}]}, {"expected_preservation_fingerprint": "0" * 64}):
        with self.subTest(changes=changes), self.assertRaises(OpenAuthorError):
          refine_voice_preview(self.paths, request={"preview_id": initial["id"], "direction_id": "direction-1", "feedback": "A focused repair.", "provider": "openai", **changes})
      provider.assert_not_called()

  def test_stage_rechecks_reviewed_fingerprint_and_records_the_exact_contract_in_proposal_provenance(self):
    initial, _ = self.preview()
    with self.assertRaises(OpenAuthorError):
      stage_voice_preview(self.paths, preview_id=initial["id"], direction_id="direction-1", expected_preservation_fingerprint="0" * 64)
    self.assertEqual(list_proposals(self.paths), [])
    proposal = stage_voice_preview(self.paths, preview_id=initial["id"], direction_id="direction-1", expected_preservation_fingerprint=initial["preservation_fingerprint"])
    self.assertEqual(proposal["generation"]["preservation"], self.preservation)
    self.assertEqual(proposal["generation"]["preservation_fingerprint"], initial["preservation_fingerprint"])
    self.assertIn(self.preservation[2]["text"], proposal["instruction"])
    self.assertEqual(get_proposal(self.paths, proposal["id"])["generation"]["preservation"], self.preservation)
    self.assertEqual(proposal["generation"]["source_scene_version"], initial["scene_version"])
    self.assertEqual(proposal["generation"]["source_text"], self.source)
    self.assertEqual(proposal["generation"]["voice_observations"], initial["directions"][0]["observations"])

  def test_saved_contract_field_loss_or_tampering_refuses_refine_and_stage(self):
    initial, _ = self.preview()
    path = self.paths.workspace_dir / "voice-previews" / f"{initial['id']}.json"
    for field in ("preservation", "source_text", "instruction", "preservation_fingerprint"):
      changed = json.loads(json.dumps(initial))
      if field == "preservation": changed.pop(field)
      elif field == "preservation_fingerprint": changed[field] = "0" * 64
      else: changed[field] += " changed"
      path.write_text(json.dumps(changed))
      with self.subTest(field=field), patch("openauthor.ai._call_provider") as provider:
        with self.assertRaises(OpenAuthorError): refine_voice_preview(self.paths, request={"preview_id": initial["id"], "direction_id": "direction-1", "feedback": "A repair.", "provider": "openai"})
        with self.assertRaises(OpenAuthorError): stage_voice_preview(self.paths, preview_id=initial["id"], direction_id="direction-1")
        provider.assert_not_called()
      path.write_text(json.dumps(initial))

  def test_paired_literal_observation_links_original_and_candidate_without_claiming_semantic_validation(self):
    initial, _ = self.preview()
    for direction in initial["directions"]:
      self.assertEqual(direction["observations"][0]["source_excerpt"], "Mara began to count the ferry berths.")
      self.assertEqual(direction["observations"][0]["excerpt"], "Mara started to count the ferry berths.")
      self.assertTrue(any("semantic" in warning.lower() for warning in direction["warnings"]))

  def test_fabricated_source_quote_omits_only_the_bad_observation_and_keeps_prose_with_warning(self):
    reply = self.provider_reply(observations=[{"criterion": "consistency", "observation": "A claimed preservation.", "source_excerpt": "The source never said this.", "excerpt": "Mara started to count the ferry berths."}])
    with patch("openauthor.ai._call_provider", return_value=reply):
      initial = preview_voice(self.paths, request=self.request(provider="openai"))
    self.assertNotEqual(initial["directions"][0]["text"], self.source)
    self.assertEqual(initial["directions"][0]["observations"], [])
    self.assertTrue(any("unverifiable" in warning for warning in initial["directions"][0]["warnings"]))

  def test_paired_literal_membership_does_not_certify_preserved_uncertainty(self):
    original = "The ferry's sailing remained undecided."
    changed = "Ivo's personal departure remained undecided."
    candidate = self.source.replace(original, changed)
    reply = self.provider_reply(text=candidate, observations=[{"criterion": "consistency", "observation": "A provider's unsupported claim of preserved uncertainty.",
      "source_excerpt": original, "excerpt": changed}])
    with patch("openauthor.ai._call_provider", return_value=reply):
      initial = preview_voice(self.paths, request=self.request(provider="openai"))
    observation = initial["directions"][0]["observations"][0]
    self.assertEqual(observation["source_excerpt"], original)
    self.assertEqual(observation["excerpt"], changed)
    self.assertTrue(any("not independent semantic validation" in warning for warning in initial["directions"][0]["warnings"]))
    self.assertEqual(initial["preservation"], self.preservation)
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"], self.original)

  def test_missing_original_citation_warns_and_strict_review_refuses_without_losing_prior_preview(self):
    prior, _ = self.preview()
    reply = self.provider_reply(observations=[{"criterion": "consistency", "observation": "The attempted count stays unfinished.", "excerpt": "Mara started to count the ferry berths."}])
    with patch("openauthor.ai._call_provider", return_value=reply):
      best_effort = preview_voice(self.paths, request=self.request(provider="openai"))
      with self.assertRaisesRegex(OpenAuthorError, "absent from its source"):
        preview_voice(self.paths, request=self.request(provider="openai", strict_review=True))
    self.assertEqual(best_effort["directions"][0]["observations"], [])
    self.assertEqual(len(voice_workspace(self.paths)["previews"]), 2)
    self.assertIn(prior, voice_workspace(self.paths)["previews"])

  def test_literal_protected_wording_cannot_be_staged_when_omitted_from_the_candidate(self):
    reply = self.provider_reply(text=self.source.replace('"Only a proposed berth," Ivo said.', '"A berth," Ivo said.'), observations=[])
    with patch("openauthor.ai._call_provider", return_value=reply):
      initial = preview_voice(self.paths, request=self.request(provider="openai"))
    self.assertTrue(any("protected wording" in warning.lower() for warning in initial["directions"][0]["warnings"]))
    with self.assertRaises(OpenAuthorError): stage_voice_preview(self.paths, preview_id=initial["id"], direction_id="direction-1")
    self.assertEqual(list_proposals(self.paths), [])

  def test_legacy_optional_contract_preview_remains_readable_and_stageable(self):
    initial, _ = self.preview(preservation=[])
    path = self.paths.workspace_dir / "voice-previews" / f"{initial['id']}.json"
    for key in ("preservation", "preservation_fingerprint", "preservation_schema_version"):
      initial.pop(key, None)
    path.write_text(json.dumps(initial))
    # A genuine pre-upgrade artifact has neither a contract nor a binding.
    (self.paths.workspace_dir / "voice-preservation" / f"{initial['id']}.json").unlink()
    self.assertEqual(voice_workspace(self.paths)["previews"][0]["source_text"], self.source)
    stage_voice_preview(self.paths, preview_id=initial["id"], direction_id="direction-1")

  def test_all_contract_fields_removed_or_rehashed_do_not_downgrade_a_bound_preview_to_legacy(self):
    initial, _ = self.preview()
    path = self.paths.workspace_dir / "voice-previews" / f"{initial['id']}.json"
    variants = [json.loads(json.dumps(initial)) for _ in range(2)]
    for key in ("preservation", "preservation_fingerprint", "preservation_schema_version"):
      variants[0].pop(key)
    variants[1]["preservation"][0]["text"] = "A silently changed constraint."
    variants[1]["preservation_fingerprint"] = preservation_fingerprint(variants[1], variants[1]["preservation"])
    for changed in variants:
      path.write_text(json.dumps(changed))
      with self.assertRaisesRegex(OpenAuthorError, "metadata changed or is incomplete"):
        stage_voice_preview(self.paths, preview_id=initial["id"], direction_id="direction-1")
      self.assertEqual(list_proposals(self.paths), [])

  def test_missing_or_malformed_binding_refuses_before_provider_or_handoff(self):
    initial, _ = self.preview()
    binding = self.paths.workspace_dir / "voice-preservation" / f"{initial['id']}.json"
    valid = json.loads(binding.read_text())
    variants = [{**valid, "schema_version": True}, {**valid, "unexpected": "value"}, {**valid, "preview_id": "other"}, None]
    for changed in variants:
      if changed is None:
        binding.unlink()
      else:
        binding.write_text(json.dumps(changed))
      with patch("openauthor.ai._call_provider", side_effect=AssertionError("Provider must not be reached for incomplete binding")) as provider:
        with self.assertRaises(OpenAuthorError):
          refine_voice_preview(self.paths, request={"preview_id": initial["id"], "direction_id": "direction-1", "feedback": "A repair.", "provider": "openai"})
        with self.assertRaises(OpenAuthorError):
          stage_voice_preview(self.paths, preview_id=initial["id"], direction_id="direction-1")
        provider.assert_not_called()

  def test_interrupted_preview_save_leaves_only_binding_and_cannot_reuse_identity(self):
    existing, _ = self.preview()
    fixed_id = "voice-preview-123456789abc"
    class FixedIdentity:
      hex = "123456789abcdef0123456789abcdef0"
    def interrupted(path, payload):
      if path.parent.name == "voice-previews":
        raise OSError("Synthetic disk interruption")
      atomic_write_json(path, payload)
    with patch("openauthor.writing_voice.uuid.uuid4", return_value=FixedIdentity()), patch("openauthor.writing_voice.atomic_write_json", side_effect=interrupted):
      with self.assertRaisesRegex(OSError, "disk interruption"):
        preview_voice(self.paths, request=self.request())
    self.assertFalse((self.paths.workspace_dir / "voice-previews" / f"{fixed_id}.json").exists())
    binding = self.paths.workspace_dir / "voice-preservation" / f"{fixed_id}.json"
    self.assertTrue(binding.exists())
    first_binding = binding.read_bytes()
    self.assertEqual(voice_workspace(self.paths)["previews"], [existing])
    with patch("openauthor.writing_voice.uuid.uuid4", return_value=FixedIdentity()):
      with self.assertRaisesRegex(OpenAuthorError, "identity already exists"):
        preview_voice(self.paths, request=self.request(preservation=[]))
    self.assertEqual(binding.read_bytes(), first_binding)

  def test_duplicate_preview_identity_does_not_overwrite_original_candidate_or_contract(self):
    initial, _ = self.preview()
    class ExistingIdentity:
      hex = initial["id"].removeprefix("voice-preview-") + "0" * 20
    with patch("openauthor.writing_voice.uuid.uuid4", return_value=ExistingIdentity()):
      with self.assertRaisesRegex(OpenAuthorError, "identity already exists"):
        preview_voice(self.paths, request=self.request(preservation=[]))
    self.assertEqual(voice_workspace(self.paths)["previews"], [initial])

  def test_existing_handoff_cannot_bypass_expected_contract_or_lost_provenance_checks(self):
    initial, _ = self.preview()
    proposal = stage_voice_preview(self.paths, preview_id=initial["id"], direction_id="direction-1")
    with self.assertRaises(OpenAuthorError):
      stage_voice_preview(self.paths, preview_id=initial["id"], direction_id="direction-1", expected_preservation_fingerprint="0" * 64)
    proposal["generation"].pop("preservation")
    path = self.paths.proposals_dir / f"{proposal['id']}.json"
    path.write_text(json.dumps(proposal))
    with self.assertRaisesRegex(OpenAuthorError, "provenance changed or is incomplete"):
      stage_voice_preview(self.paths, preview_id=initial["id"], direction_id="direction-1")
    self.assertEqual(get_proposal(self.paths, proposal["id"]), proposal)

  def test_cli_stage_rechecks_fingerprint_and_refuses_replacement_contract(self):
    initial, _ = self.preview()
    baseline = {"preview_id": initial["id"], "direction_id": "direction-1"}
    env = {**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])}
    for extra in ({"expected_preservation_fingerprint": "0" * 64}, {"preservation": []}, {"expected_preservation_fingerprint": None}):
      result = subprocess.run([sys.executable, "-m", "openauthor", "style", "stage", "--request-json", json.dumps({**baseline, **extra}), "--json"], cwd=self.paths.root, env=env, capture_output=True, text=True)
      self.assertNotEqual(result.returncode, 0, result.stdout)
      self.assertEqual(list_proposals(self.paths), [])
    result = subprocess.run([sys.executable, "-m", "openauthor", "style", "stage", "--request-json", json.dumps({**baseline, "expected_preservation_fingerprint": initial["preservation_fingerprint"]}), "--json"], cwd=self.paths.root, env=env, capture_output=True, text=True)
    self.assertEqual(result.returncode, 0, result.stderr)
    self.assertEqual(json.loads(result.stdout)["generation"]["preservation"], self.preservation)

  def test_evaluation_harness_forwards_exact_reviewed_constraints_through_public_operations(self):
    from scripts.evaluate_connected_voice import prepare, run
    output = self.paths.root / "evaluation"
    prepare(output, "local", "")
    request = json.loads((output / "request.json").read_text())
    context = json.loads((output / "preview-context.json").read_text())
    expected = [{"kind": "fact", "text": fact} for fact in request["protected_facts"]]
    self.assertEqual(request["preservation"], expected)
    self.assertEqual(context["preservation"], expected)
    with patch("openauthor.ai._call_provider", side_effect=AssertionError("Local evaluation must not use a provider")) as provider:
      run(output, "analyze", False)
      run(output, "compare", False)
      run(output, "refine", False)
      provider.assert_not_called()
    comparison = json.loads((output / "comparison.json").read_text())
    refined = json.loads((output / "refined.json").read_text())
    self.assertEqual(comparison["preservation"], expected)
    self.assertEqual(refined["preservation"], expected)
    self.assertEqual(refined["preservation_fingerprint"], comparison["preservation_fingerprint"])


if __name__ == "__main__":
  unittest.main()
