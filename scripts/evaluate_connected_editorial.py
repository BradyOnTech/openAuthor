"""Prepare and run a bounded synthetic chapter review through public product calls."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from openauthor.planning import add_act, add_chapter, assign_scene, update_brief
from openauthor.project import initialize_project
from openauthor.scenes import add_scene, get_scene, parse_front_matter
from openauthor.selection_editing import generate_selection, preview_selection


def prepare(output: Path, provider: str, model: str) -> dict:
  output.mkdir(parents=True, exist_ok=False)
  fixture_path = Path(__file__).resolve().parents[1] / "tests/fixtures/ferry_ledger_chapter.json"
  fixture = json.loads(fixture_path.read_text())
  paths = initialize_project(output / "book", name=fixture["title"])
  update_brief(paths, style_guide=fixture["style_guide"])
  act = add_act(paths, title="Departure")
  chapter = add_chapter(paths, act_id=act["id"], title=fixture["chapter"])
  for row in fixture["scenes"]:
    scene_path = add_scene(paths, title=row["title"], pov=row["pov"], body=row["body"])
    identifier = parse_front_matter(scene_path)["id"]
    assign_scene(paths, scene_id=identifier, chapter_id=chapter["id"])
  scene = get_scene(paths, "scene-0003")
  args = dict(scene_id=scene["id"], start=0, end=len(scene["body"]), selected_text=scene["body"], action="critique",
    provider=provider, model=model, review_scope="chapter", review_focus="character-knowledge")
  preview = preview_selection(paths, **args)
  record = {"evidence_kind": "fresh_synthetic_connected_chapter", "provider": provider, "model": preview["model"],
    "source_sha256": hashlib.sha256(fixture_path.read_bytes()).hexdigest(), "args": args,
    "context_fingerprint": preview["fingerprint"], "evaluation_targets": fixture["evaluation_targets"],
    "literary_quality": "unassessed", "author_review": "not_observed"}
  (output / "request.json").write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
  (output / "context.json").write_text(json.dumps(preview, ensure_ascii=False, indent=2) + "\n")
  (output / "reading.json").write_text(json.dumps(fixture, ensure_ascii=False, indent=2) + "\n")
  return record


def generate(output: Path, allow_provider: bool) -> dict:
  from openauthor.project import resolve_project
  from openauthor.proposals import apply_proposal
  from openauthor.project import OpenAuthorError
  record = json.loads((output / "request.json").read_text())
  if record["provider"] != "local" and not allow_provider:
    raise RuntimeError("External generation requires --allow-provider after reviewing context.json. No private manuscript is used.")
  paths = resolve_project(output / "book")
  originals = {row["scene_id"]: get_scene(paths, row["scene_id"])["body"] for row in preview_selection(paths, **record["args"])["context"]["review_sources"]}
  proposal = generate_selection(paths, **record["args"], expected_fingerprint=record["context_fingerprint"], request_id="connected-editorial-1")
  assert {identifier: get_scene(paths, identifier)["body"] for identifier in originals} == originals
  try:
    apply_proposal(paths, proposal_id=proposal["id"])
  except OpenAuthorError as error:
    if "feedback only" not in str(error):
      raise
  else:
    raise RuntimeError("Critique unexpectedly allowed a manuscript write.")
  result = {**record, "proposal_id": proposal["id"], "review": proposal["selection"]["review"],
    "raw_feedback": proposal["selection"]["feedback"], "source_unchanged": True,
    "critique_apply_refused": True, "generation": proposal["generation"]}
  (output / "results.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
  return result


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument("action", choices=["prepare", "generate"])
  parser.add_argument("--output", type=Path, required=True)
  parser.add_argument("--provider", default="local")
  parser.add_argument("--model", default="")
  parser.add_argument("--allow-provider", action="store_true")
  args = parser.parse_args()
  result = prepare(args.output, args.provider, args.model) if args.action == "prepare" else generate(args.output, args.allow_provider)
  print(json.dumps({key: result.get(key) for key in ("provider", "model", "source_unchanged", "critique_apply_refused", "literary_quality", "author_review")}))


if __name__ == "__main__":
  main()
