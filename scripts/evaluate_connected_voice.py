"""Bounded synthetic Writing Voice evaluation through public product operations."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path

from openauthor.ai import build_generation_context
from openauthor.generations import list_generation_runs
from openauthor.planning import add_act, add_chapter, assign_scene, update_brief
from openauthor.project import initialize_project, resolve_project
from openauthor.proposals import apply_proposal, undo_proposal
from openauthor.scenes import add_scene, get_scene, parse_front_matter
from openauthor.selection_editing import preview_selection
from openauthor.style_profile import PRESETS, get_style_profile, save_style_profile
from openauthor.writing_voice import preview_voice, refine_voice_preview, stage_voice_preview, suggest_voice

FIXTURE = Path(__file__).resolve().parents[1] / "tests/fixtures/tide_table_voice_chapter.json"


def write(output: Path, name: str, value: dict) -> None:
  (output / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def prepare(output: Path, provider: str, model: str) -> None:
  output.mkdir(parents=True, exist_ok=False)
  fixture = json.loads(FIXTURE.read_text())
  paths = initialize_project(output / "book", name=fixture["title"])
  update_brief(paths, style_guide=fixture["style_guide"])
  act = add_act(paths, title="The harbor")
  chapter = add_chapter(paths, act_id=act["id"], title=fixture["chapter"])
  for row in fixture["scenes"]:
    scene_path = add_scene(paths, **{key: row[key] for key in ("title", "pov", "summary", "body")})
    assign_scene(paths, scene_id=parse_front_matter(scene_path)["id"], chapter_id=chapter["id"])
  scene = get_scene(paths, "scene-0003")
  source = scene["body"][scene["body"].index(fixture["preview_start"]):].strip()
  assert len(source.split()) <= 400
  context = build_generation_context(paths, scene_id=scene["id"], context_scene_radius=0, codex_limit=8)
  context["scene"] = {key: scene[key] for key in ("id", "title", "summary", "pov", "status")}
  context.pop("writing_voice", None)
  request = {"evidence_kind": "fresh_synthetic_connected_chapter", "provider": provider, "model": model,
    "fixture_sha256": hashlib.sha256(FIXTURE.read_bytes()).hexdigest(), "source_text": source,
    "source_scene_id": scene["id"], "instruction": fixture["instruction"], "feedback": fixture["feedback"],
    "protected_facts": fixture["protected_facts"], "originals": {
      f"scene-{index:04d}": get_scene(paths, f"scene-{index:04d}")["body"] for index in range(1, 4)},
    "approval_kind": "synthetic evaluator action; human author approval not observed",
    "author_review": "not_observed", "literary_quality": "unassessed", "provider_call_limit": 3}
  request["preservation"] = [{"kind": "fact", "text": fact} for fact in fixture["protected_facts"]]
  write(output, "request.json", request)
  write(output, "preview-context.json", {"source": source, "instruction": fixture["instruction"], "preservation": request["preservation"], "context": context})
  write(output, "reading.json", fixture)


def run(output: Path, action: str, allow_provider: bool, feedback_file: Path | None = None,
        additional_call_approved: bool = False) -> None:
  request = json.loads((output / "request.json").read_text())
  if hashlib.sha256(FIXTURE.read_bytes()).hexdigest() != request["fixture_sha256"]:
    raise RuntimeError("Synthetic fixture changed; create fresh evidence.")
  paths = resolve_project(output / "book")
  if request["provider"] != "local":
    if not allow_provider:
      raise RuntimeError("Review the synthetic context before enabling external generation with --allow-provider.")
    from openauthor.auth import get_auth_status
    if request["provider"] != "openai-codex" or not get_auth_status()["openai-codex"].get("authenticated"):
      raise RuntimeError("Existing subscription unavailable. No fallback provider is permitted.")
    calls = sum(row.get("provider_attempts") or 0 for row in list_generation_runs(paths))
    needed = 2 if action == "compare" else 0 if action == "handoff" else 1
    limit = min(request["provider_call_limit"], 3) + (1 if additional_call_approved and action == "refine" else 0)
    if calls + needed > limit:
      raise RuntimeError("Three-call authorization is exhausted. Refinement needs explicit human approval for one additional call.")
  if action not in {"handoff"}:
    with (output / f"{action}-started.json").open("x") as marker:
      json.dump({"action": action, "retry_policy": "never automatically repeat an uncertain provider attempt"}, marker)
  os.environ["OPENAUTHOR_PROVIDER_MAX_RETRIES"] = "0"
  originals = request["originals"]
  assert {identifier: get_scene(paths, identifier)["body"] for identifier in originals} == originals
  provider = {key: request[key] for key in ("provider", "model")}
  try:
    if action == "analyze":
      suggested = suggest_voice(paths, request={**provider, "scene_ids": ["scene-0001", "scene-0002"],
        "brief": "Study only these original scenes. Favor restrained emotion, practical questions, dry qualification and clear staging. Offer evidence for the craft traits; retain uncertainty rather than inferring character knowledge."})
      write(output, "suggested-profile.json", suggested)
      profile = save_style_profile(paths, profile=suggested["profile"], expected_version=suggested["base_version"], expected_scope=suggested["scope"])
      write(output, "saved-profile.json", {"approval_kind": request["approval_kind"], "profile": profile})
      scene = get_scene(paths, request["source_scene_id"])
      start = scene["body"].index(request["source_text"])
      approved_context = preview_selection(paths, scene_id=scene["id"], start=start, end=start + len(request["source_text"]),
        selected_text=request["source_text"], action="rewrite", **provider)
      assert approved_context["context"]["style_profile_status"]["included"]
      write(output, "approved-revision-context.json", approved_context)
    elif action == "compare":
      profile = get_style_profile(paths)
      if not profile or not profile["usable_for_ai"]:
        raise RuntimeError("A verified synthetic profile is required before comparison.")
      preview = preview_voice(paths, request={**provider, "scene_id": request["source_scene_id"],
        "source_text": request["source_text"], "instruction": request["instruction"], "preservation": request.get("preservation", []), "directions": [profile, PRESETS[1]]})
      write(output, "comparison.json", preview)
    elif action == "refine":
      comparison = json.loads((output / "comparison.json").read_text())
      feedback = feedback_file.read_text().strip() if feedback_file else request["feedback"]
      write(output, "refinement-input.json", {"feedback": feedback, "reviewer": "assistant evaluator; human author review not observed"})
      result = refine_voice_preview(paths, request={**provider, "preview_id": comparison["id"],
        "direction_id": "direction-1", "feedback": feedback,
        **({"expected_preservation_fingerprint": comparison["preservation_fingerprint"]} if "preservation_fingerprint" in comparison else {})})
      write(output, "refined.json", result)
    else:
      result = json.loads((output / "refined.json").read_text())
      profile_before = get_style_profile(paths)
      proposal = stage_voice_preview(paths, preview_id=result["id"], direction_id="direction-1",
        expected_preservation_fingerprint=result.get("preservation_fingerprint"))
      assert get_scene(paths, request["source_scene_id"])["body"] == originals[request["source_scene_id"]]
      apply_proposal(paths, proposal_id=proposal["id"])
      expected = originals[request["source_scene_id"]].replace(request["source_text"], result["directions"][0]["text"], 1)
      assert get_scene(paths, request["source_scene_id"])["body"] == expected
      undo_proposal(paths, proposal_id=proposal["id"])
      assert get_style_profile(paths) == profile_before
      write(output, "handoff.json", {"pending_until_apply": True, "applied_exact_candidate": True,
        "undo_restored_original": True, "profile_unchanged": True, "approval_kind": request["approval_kind"]})
    assert {identifier: get_scene(paths, identifier)["body"] for identifier in originals} == originals
  finally:
    fields = ("provider", "model", "status", "provider_attempts", "latency_ms", "input_tokens", "output_tokens", "estimated_cost_usd")
    write(output, "generations.json", {"runs": [{key: row.get(key) for key in fields} for row in list_generation_runs(paths)]})


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument("action", choices=["prepare", "analyze", "compare", "refine", "handoff"])
  parser.add_argument("--output", type=Path, required=True)
  parser.add_argument("--provider", default="local")
  parser.add_argument("--model", default="")
  parser.add_argument("--allow-provider", action="store_true")
  parser.add_argument("--feedback-file", type=Path)
  parser.add_argument("--additional-call-approved", action="store_true", help="Use only after the human approves one extra refinement call.")
  args = parser.parse_args()
  if args.action == "prepare":
    prepare(args.output, args.provider, args.model)
  else:
    run(args.output, args.action, args.allow_provider, args.feedback_file, args.additional_call_approved)
  print(json.dumps({"action": args.action, "output": str(args.output), "author_review": "not_observed"}), flush=True)


if __name__ == "__main__":
  main()
