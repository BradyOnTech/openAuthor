#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
  sys.path.insert(0, str(ROOT))

from openauthor.ai import _generate_local_draft_text
from openauthor.editorial import list_editorial_passes
from openauthor.project import initialize_project

DEFAULT_CORPUS = ROOT / "tests" / "fixtures" / "editorial_evaluation.json"


def _count_patterns(text: str, patterns: list[str]) -> int:
  return sum(len(re.findall(pattern, text, flags=re.IGNORECASE)) for pattern in patterns)


def evaluate(corpus_path: Path = DEFAULT_CORPUS) -> dict[str, Any]:
  corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
  if corpus.get("schema_version") != 1:
    raise ValueError("Unsupported editorial evaluation corpus schema version.")
  with tempfile.TemporaryDirectory() as tmp:
    paths = initialize_project(Path(tmp), name="Editorial Evaluation")
    passes = {row["id"]: row for row in list_editorial_passes(paths)}

  results: list[dict[str, Any]] = []
  total_before = total_after = canon_errors = improved = 0
  for case in corpus["cases"]:
    editorial_pass = passes[case["pass_id"]]
    before = str(case["body"])
    after = _generate_local_draft_text(
      {"scene": {"body": before, "pov": case.get("pov", "")}},
      editorial_pass["instruction"],
    )
    before_issues = _count_patterns(before, case["undesirable_patterns"])
    after_issues = _count_patterns(after, case["undesirable_patterns"])
    missing_terms = [term for term in case["protected_terms"] if term.casefold() not in after.casefold()]
    before_names = set(re.findall(r"\b[A-Z][A-Za-z'-]{2,}\b", before))
    after_names = set(re.findall(r"\b[A-Z][A-Za-z'-]{2,}\b", after))
    introduced_names = sorted(after_names - before_names)
    case_canon_errors = len(missing_terms) + len(introduced_names)
    did_improve = after_issues < before_issues
    improved += int(did_improve)
    total_before += before_issues
    total_after += after_issues
    canon_errors += case_canon_errors
    results.append({
      "id": case["id"],
      "pass_id": case["pass_id"],
      "genre": case["genre"],
      "pov": case["pov"],
      "issues_before": before_issues,
      "issues_after": after_issues,
      "improved": did_improve,
      "missing_protected_terms": missing_terms,
      "introduced_names": introduced_names,
      "canon_errors": case_canon_errors,
    })
  task_count = len(results)
  return {
    "corpus": str(corpus_path),
    "task_count": task_count,
    "pass_count": len({row["pass_id"] for row in results}),
    "genres": sorted({row["genre"] for row in results}),
    "improved_tasks": improved,
    "improvement_rate": improved / task_count if task_count else 0.0,
    "issue_reduction_rate": (total_before - total_after) / total_before if total_before else 0.0,
    "canon_errors": canon_errors,
    "canon_error_rate": canon_errors / task_count if task_count else 0.0,
    "cases": results,
  }


if __name__ == "__main__":
  print(json.dumps(evaluate(), indent=2))
