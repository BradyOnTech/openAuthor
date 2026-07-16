#!/usr/bin/env python3
from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Any

from create_large_project_fixture import create_large_project_fixture
from openauthor.hardening import collect_performance_baseline
from openauthor.project import resolve_project

ROOT = Path(__file__).resolve().parents[1]
BUDGET_PATH = ROOT / "docs" / "performance-budgets.json"


def evaluate_report(report: dict[str, Any], budget: dict[str, Any]) -> list[str]:
  failures: list[str] = []
  expected_counts = budget["fixture"]
  for key in ("scenes", "proposals", "generation_runs"):
    if report["counts"].get(key) != expected_counts[key]:
      failures.append(
        f"{key} count was {report['counts'].get(key)}, expected {expected_counts[key]}"
      )

  maximums = budget["max_ms"]
  metrics = {row["name"]: row for row in report["metrics"]}
  for name, threshold in maximums.items():
    row = metrics.get(name)
    if row is None:
      failures.append(f"missing performance metric: {name}")
      continue
    if row["max_ms"] > threshold:
      failures.append(
        f"{name} max {row['max_ms']:.3f}ms exceeds {float(threshold):.3f}ms budget"
      )
  return failures


def main() -> int:
  budget = json.loads(BUDGET_PATH.read_text(encoding="utf-8"))
  fixture = budget["fixture"]
  with tempfile.TemporaryDirectory(prefix="openauthor-scale-") as tmp:
    root = Path(tmp)
    manifest = create_large_project_fixture(
      root,
      scenes=fixture["scenes"],
      proposals=fixture["proposals"],
      generation_runs=fixture["generation_runs"],
      entities=fixture["entities"],
      build_index=True,
    )
    report = collect_performance_baseline(resolve_project(root), repeat=budget["repeat"])
    failures = evaluate_report(report, budget)

  payload = {"manifest": manifest, "report": report, "budgets": budget["max_ms"], "failures": failures}
  print(json.dumps(payload, indent=2))
  return 1 if failures else 0


if __name__ == "__main__":
  raise SystemExit(main())
