#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from openauthor.codex import add_entity
from openauthor.project import atomic_write_json, initialize_project, utc_now
from openauthor.retrieval import build_retrieval_index
from openauthor.scenes import build_scene_markdown, scene_filename, scene_id


def _scene_body(index: int) -> str:
  chapter = ((index - 1) // 5) + 1
  return (
    f"Scene {index} opens in chapter {chapter} with a concrete objective and a source of resistance. "
    f"Character {((index - 1) % 24) + 1} notices a recurring object and makes a choice that changes "
    "the immediate situation. The closing beat creates a question for the next scene while preserving "
    "the established point of view and timeline."
  )


def create_large_project_fixture(
  root: Path,
  *,
  scenes: int,
  proposals: int,
  generation_runs: int,
  entities: int,
  build_index: bool = True,
) -> dict[str, Any]:
  if min(scenes, proposals, generation_runs, entities) < 0:
    raise ValueError("Fixture counts must be non-negative.")
  if root.exists() and any(root.iterdir()):
    raise ValueError(f"Fixture target must be empty: {root}")

  root.mkdir(parents=True, exist_ok=True)
  paths = initialize_project(root, name="Large Project Regression Fixture")

  for index in range(1, scenes + 1):
    title = f"Chapter {((index - 1) // 5) + 1}, Scene {index}"
    content = build_scene_markdown(
      scene_identifier=scene_id(index),
      title=title,
      summary=f"Deterministic regression fixture summary for scene {index}.",
      pov=f"Character {((index - 1) % max(entities, 1)) + 1}",
      status=("draft", "revised", "outline")[index % 3],
      body=_scene_body(index),
    )
    (paths.scenes_dir / scene_filename(index, title)).write_text(content, encoding="utf-8")

  entity_types = ("character", "location", "lore", "item", "faction", "event")
  for index in range(1, entities + 1):
    kind = entity_types[(index - 1) % len(entity_types)]
    add_entity(
      paths,
      kind=kind,
      name=f"{kind.title()} {index}",
      description=f"Deterministic {kind} entry {index} used by the large-project regression fixture.",
    )

  timestamp = utc_now()
  for index in range(1, proposals + 1):
    target_scene = ((index - 1) % max(scenes, 1)) + 1 if scenes else 0
    proposal_id = f"proposal-fixture-{index:06d}"
    atomic_write_json(
      paths.proposals_dir / f"{proposal_id}.json",
      {
        "id": proposal_id,
        "title": f"Fixture revision {index}",
        "instruction": "Tighten the scene while preserving voice, canon, and timeline.",
        "scene_id": scene_id(target_scene) if target_scene else "",
        "scene_digest": "fixture",
        "vcs_branch": "primary",
        "vcs_base_commit": "",
        "status": ("pending", "applied", "rejected")[index % 3],
        "created_at": timestamp,
        "updated_at": timestamp,
        "notes": "",
        "source": "fixture",
        "proposed_body": "",
      },
    )

  for index in range(1, generation_runs + 1):
    target_scene = ((index - 1) % max(scenes, 1)) + 1 if scenes else 0
    run_id = f"gen-fixture-{index:06d}"
    atomic_write_json(
      paths.generations_dir / f"{run_id}.json",
      {
        "run_id": run_id,
        "kind": "proposal",
        "status": "succeeded",
        "created_at": timestamp,
        "scene_id": scene_id(target_scene) if target_scene else "",
        "provider": "local",
        "model": "heuristic-v1",
        "proposal_id": f"proposal-fixture-{((index - 1) % max(proposals, 1)) + 1:06d}" if proposals else "",
        "instruction": "Fixture generation instruction.",
        "usage": {
          "input_tokens": 500 + index,
          "output_tokens": 200,
          "latency_ms": 25,
          "provider_attempts": 1,
          "estimated_cost_usd": 0.0
        },
        "quality": {"score": 90, "tier": "high", "flags": []},
        "retrieval": {"mode": "off", "used": False, "result_count": 0}
      },
    )

  retrieval = build_retrieval_index(paths) if build_index else {"present": False}
  manifest = {
    "schema_version": 1,
    "created_at": timestamp,
    "counts": {
      "scenes": scenes,
      "proposals": proposals,
      "generation_runs": generation_runs,
      "entities": entities,
    },
    "retrieval": {
      "present": bool(retrieval.get("present")),
      "chunk_count": retrieval.get("chunk_count", 0),
      "source_count": retrieval.get("source_count", 0),
    },
  }
  atomic_write_json(paths.project_dir / "fixture_manifest.json", manifest)
  return manifest


def main() -> int:
  parser = argparse.ArgumentParser(description="Create a deterministic large openAuthor project fixture.")
  parser.add_argument("target", type=Path)
  parser.add_argument("--scenes", type=int, default=400)
  parser.add_argument("--proposals", type=int, default=300)
  parser.add_argument("--generation-runs", type=int, default=300)
  parser.add_argument("--entities", type=int, default=72)
  parser.add_argument("--skip-index", action="store_true")
  args = parser.parse_args()

  manifest = create_large_project_fixture(
    args.target,
    scenes=args.scenes,
    proposals=args.proposals,
    generation_runs=args.generation_runs,
    entities=args.entities,
    build_index=not args.skip_index,
  )
  print(json.dumps({"root": str(args.target.resolve()), **manifest}, indent=2))
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
