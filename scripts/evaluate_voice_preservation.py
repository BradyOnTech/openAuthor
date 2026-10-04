"""Replay retained synthetic prose without any provider or author-data access."""
from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from openauthor.project import resolve_project
from openauthor.scenes import get_scene
from openauthor.writing_voice import preview_voice
from scripts.evaluate_connected_voice import prepare

ROOT = Path(__file__).resolve().parents[1]
RETAINED = ROOT / "docs/evaluations/connected-voice-2026-10-02"


def replay(output: Path) -> dict:
  output.mkdir(parents=True, exist_ok=True)
  comparison = json.loads((RETAINED / "comparison.json").read_text())
  original_request = json.loads((RETAINED / "request.json").read_text())
  replies = [{"text": json.dumps({"text": row["text"], "observations": row["observations"]}, ensure_ascii=False),
    "input_tokens": 0, "output_tokens": 0, "latency_ms": 0, "attempts": 1, "tool_calls": []} for row in comparison["directions"]]
  with tempfile.TemporaryDirectory() as directory:
    prepared = Path(directory) / "synthetic"
    prepare(prepared, "local", "")
    request = json.loads((prepared / "request.json").read_text())
    paths = resolve_project(prepared / "book")
    source = request["source_text"]
    assert source == comparison["source_text"] == original_request["source_text"]
    before = {identifier: get_scene(paths, identifier)["body"] for identifier in request["originals"]}
    with patch("openauthor.ai._call_provider", side_effect=replies) as adapter:
      current = preview_voice(paths, request={"scene_id": request["source_scene_id"], "source_text": source,
        "instruction": request["instruction"], "preservation": request["preservation"],
        "directions": [row["profile"] for row in comparison["directions"]], "provider": "openai"})
    payloads = [{"system_prompt": call.kwargs["system_prompt"], "user_prompt": json.loads(call.kwargs["user_prompt"])} for call in adapter.call_args_list]
    assert len(payloads) == 2
    assert all(row["user_prompt"]["preservation"] == request["preservation"] for row in payloads)
    assert all(row["user_prompt"]["context"]["nearby_scenes"] == [] and "body" not in row["user_prompt"]["context"]["scene"] for row in payloads)
    assert {identifier: get_scene(paths, identifier)["body"] for identifier in before} == before
    assessment = {"evidence_kind": "offline_replay_of_retained_synthetic_provider_output", "new_provider_calls": 0,
      "retained_comparison_sha256": hashlib.sha256((RETAINED / "comparison.json").read_bytes()).hexdigest(),
      "selected_source_sha256": hashlib.sha256(source.encode()).hexdigest(), "exact_author_contract_in_both_payloads": True,
      "private_scope_expansion": False, "manuscript_unchanged": True, "staged": False,
      "preservation": request["preservation"], "preservation_fingerprint": current["preservation_fingerprint"],
      "live_quality_after_fix": "not_observed", "human_author_acceptance": "not_observed",
      "semantic_limit": "Replayed prose retains the original personal-departure ambiguity. Delivery and literal checks do not prove semantic preservation or improved model behavior.",
      "directions": [{"id": row["id"], "text_unchanged_from_retained_output": row["text"] == previous["text"],
        "consistency_observations_retained": sum(item["criterion"] == "consistency" for item in row["observations"]),
        "warnings": row["warnings"]} for row, previous in zip(current["directions"], comparison["directions"])]}
    for name, value in (("replay.json", assessment), ("replay-preview.json", current), ("provider-inputs.json", {"evidence_kind": assessment["evidence_kind"], "payloads": payloads})):
      (output / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    return assessment


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument("--output", type=Path, required=True)
  args = parser.parse_args()
  print(json.dumps(replay(args.output), ensure_ascii=False, indent=2))


if __name__ == "__main__":
  main()
