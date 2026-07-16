#!/usr/bin/env python3
from __future__ import annotations

import json
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any

from openauthor.canon import add_arc_state, add_canon_fact, add_open_question, add_setup, run_canon_diagnostics
from openauthor.codex import add_entity
from openauthor.project import initialize_project
from openauthor.scenes import add_scene

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CORPUS = ROOT / "tests" / "fixtures" / "canon_evaluation.json"


def evaluate(corpus_path: Path = DEFAULT_CORPUS) -> dict[str, Any]:
  corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
  true_positive = false_positive = false_negative = 0
  case_results: list[dict[str, Any]] = []
  for case in corpus["cases"]:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name=case["id"])
      for scene in case["scenes"]:
        add_scene(paths, title=scene["title"], pov=scene.get("pov", ""), body=scene["body"])
      entity_ids = {
        row["key"]: add_entity(paths, kind=row["type"], name=row["name"])
        for row in case["entities"]
      }
      for fact in case["facts"]:
        add_canon_fact(
          paths,
          subject_entity_id=entity_ids[fact["subject"]],
          predicate=fact["predicate"],
          value=fact["value"],
          evidence=[{"scene_id": fact["scene"], "excerpt": fact["excerpt"]}],
          valid_from_scene_id=fact.get("valid_from", ""),
          valid_to_scene_id=fact.get("valid_to", ""),
          knowledge=[
            {
              "character_entity_id": entity_ids[row["character"]],
              "state": row["state"],
              "from_scene_id": row.get("from_scene_id", ""),
            }
            for row in fact.get("knowledge", [])
          ],
          status=fact.get("status", "accepted"),
          scope=fact.get("scope", "project"),
        )
      for setup in case.get("setups", []):
        add_setup(paths, description=setup["description"], setup_scene_id=setup["scene"], excerpt=setup["excerpt"])
      for question in case.get("questions", []):
        add_open_question(paths, question=question["question"], scene_id=question.get("scene", ""), intentionally_unresolved=question.get("intentional", False))
      for arc in case.get("arcs", []):
        add_arc_state(paths, character_entity_id=entity_ids[arc["character"]], dimension=arc["dimension"], value=arc["value"], scene_id=arc["scene"], excerpt=arc["excerpt"], state_type=arc.get("type", "observed"))
      actual = Counter(row["code"] for row in run_canon_diagnostics(paths)["diagnostics"])
      expected = Counter(case.get("expected", {}))
      for code in set(actual).union(expected):
        true_positive += min(actual[code], expected[code])
        false_positive += max(0, actual[code] - expected[code])
        false_negative += max(0, expected[code] - actual[code])
      case_results.append({"id": case["id"], "expected": dict(expected), "actual": dict(actual)})
  precision = true_positive / (true_positive + false_positive) if true_positive + false_positive else 1.0
  recall = true_positive / (true_positive + false_negative) if true_positive + false_negative else 1.0
  return {
    "corpus": str(corpus_path),
    "cases": case_results,
    "true_positive": true_positive,
    "false_positive": false_positive,
    "false_negative": false_negative,
    "precision": precision,
    "recall": recall,
  }


if __name__ == "__main__":
  print(json.dumps(evaluate(), indent=2))
