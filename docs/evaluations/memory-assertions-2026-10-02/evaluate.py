"""Compare recorded local heuristics on authored declaration/uncertainty controls."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import subprocess
import tempfile
from pathlib import Path

from openauthor.codex import add_entity, list_entities, list_relationships
from openauthor.canon import list_canon_facts
from openauthor.project import initialize_project
from openauthor.scenes import add_scene, get_scene
from openauthor.story_memory import extract_memory_suggestions
from scripts.evaluate_memory_review import evaluate as evaluate_names


def evaluate(corpus, extractor):
  totals = {"cases": 0, "matched_cases": 0, "extra_statements": 0, "missed_statements": 0, "invalid_evidence": 0}
  outcomes = []
  for case in corpus["cases"]:
    with tempfile.TemporaryDirectory(prefix="openauthor-memory-assertion-evaluation-") as directory:
      paths = initialize_project(Path(directory), name="Authored Memory statement evaluation")
      for name in corpus["accepted_characters"]:
        add_entity(paths, kind="character", name=name, aliases=corpus.get("accepted_aliases", {}).get(name, []))
      entities = list_entities(paths)
      add_scene(paths, title=case["id"], body=case["body"])
      saved_body = get_scene(paths, "scene-0001")["body"]
      rows = extractor(paths)["suggestions"]
      actual = set()
      invalid = []
      for row in rows:
        if row["kind"] == "canon_fact":
          actual.add(("fact", row["subject_name"], row["predicate"], row["value"]))
        elif row["kind"] == "relationship_create":
          actual.add(("connection", row["source_name"], row["relation"], row["target_name"]))
        else:
          continue
        for evidence in row["evidence"]:
          if case["body"][evidence["start"]:evidence["end"]] != evidence["excerpt"]:
            invalid.append(row["name"])
      expected = set(tuple(value) for value in case["expected"])
      extra, missed = sorted(actual - expected), sorted(expected - actual)
      assert get_scene(paths, "scene-0001")["body"] == saved_body
      assert list_entities(paths) == entities
      assert list_canon_facts(paths) == [] and list_relationships(paths) == []
      outcomes.append({"id": case["id"], "body": case["body"], "expected": sorted(expected), "actual": sorted(actual),
        "extra": extra, "missed": missed, "invalid_evidence": invalid})
      totals["cases"] += 1
      totals["matched_cases"] += int(not (extra or missed or invalid))
      totals["extra_statements"] += len(extra)
      totals["missed_statements"] += len(missed)
      totals["invalid_evidence"] += len(invalid)
  return {"totals": totals, "cases": outcomes}


if __name__ == "__main__":
  directory = Path(__file__).resolve().parent
  repository = directory.parents[2]
  corpus_path = directory / "cases.json"
  corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
  baseline_source = subprocess.check_output(["git", "show", f"{corpus['baseline_commit']}:openauthor/story_memory.py"], cwd=repository)
  with tempfile.TemporaryDirectory(prefix="openauthor-memory-baseline-") as temporary:
    source_path = Path(temporary) / "story_memory.py"
    source_path.write_bytes(baseline_source)
    spec = importlib.util.spec_from_file_location("openauthor._statement_evaluation_baseline", source_path)
    baseline = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(baseline)
    result = {"date": "2026-10-02", "evidence_kind": corpus["evidence_kind"], "limits": corpus["limits"],
      "baseline_commit": corpus["baseline_commit"], "corpus_sha256": hashlib.sha256(corpus_path.read_bytes()).hexdigest(),
      "current_source_sha256": hashlib.sha256((repository / "openauthor/story_memory.py").read_bytes()).hexdigest(),
      "baseline": evaluate(corpus, baseline.extract_memory_suggestions), "current": evaluate(corpus, extract_memory_suggestions),
      "existing_name_cases": evaluate_names(repository / "tests/fixtures/memory_review_cases.json"),
      "author_review_burden": "not observed", "provider_calls": 0}
  (directory / "results.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
  print(json.dumps({key: result[key]["totals"] for key in ("baseline", "current", "existing_name_cases")}, indent=2))
