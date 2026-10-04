"""Cold-start extraction evidence with misses, extras and type errors kept separate."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Callable

from openauthor.project import initialize_project
from openauthor.scenes import add_scene
from openauthor.story_memory import extract_memory_suggestions


def evaluate(corpus: Path, extractor: Callable = extract_memory_suggestions) -> dict:
  fixture = json.loads(corpus.read_text(encoding="utf-8"))
  outcomes = []
  totals = {"expected_entities": 0, "matched_entities": 0, "extra_entities": 0, "missed_entities": 0, "type_errors": 0}
  for case in fixture["cases"]:
    with tempfile.TemporaryDirectory(prefix="openauthor-memory-review-") as directory:
      paths = initialize_project(Path(directory), name="Synthetic Memory review")
      add_scene(paths, title=case["id"], body=case["body"])
      suggestions = [row for row in extractor(paths)["suggestions"] if row["kind"] == "entity_create"]
      actual = {row["name"]: row["entity_type"] for row in suggestions}
      expected = case["entities"]
      matched = sorted(actual.keys() & expected.keys())
      extra = sorted(actual.keys() - expected.keys())
      missed = sorted(expected.keys() - actual.keys())
      wrong_types = [name for name in matched if actual[name] != expected[name]]
      invalid_evidence = [row["name"] for row in suggestions if any(case["body"][item["start"]:item["end"]] != item.get("anchor_text", item["excerpt"]) for item in row["evidence"])]
      outcomes.append({"id": case["id"], "expected": expected, "actual": actual, "extra": extra, "missed": missed, "type_errors": wrong_types, "invalid_evidence": invalid_evidence})
      for key, number in (("expected_entities", len(expected)), ("matched_entities", len(matched)), ("extra_entities", len(extra)), ("missed_entities", len(missed)), ("type_errors", len(wrong_types))):
        totals[key] += number
  return {"evidence_kind": fixture["evidence_kind"], "limitation": fixture["limitation"], "totals": totals, "cases": outcomes,
    "author_review_burden": "not observed", "uncased_name_extraction": "not implemented by the capitalized-name heuristic"}


if __name__ == "__main__":
  print(json.dumps(evaluate(Path(__file__).resolve().parents[1] / "tests/fixtures/memory_review_cases.json"), ensure_ascii=False, indent=2))
