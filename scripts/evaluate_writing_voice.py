#!/usr/bin/env python3
"""Original-scene comparison through the public Writing Voice workflow.

Local mode never calls a provider. Live mode permits only the existing ChatGPT
subscription connector, never selects an API-key fallback, and never logs in.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
  sys.path.insert(0, str(ROOT))

from openauthor.auth import get_auth_status
from openauthor.generations import list_generation_runs
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.scenes import add_scene, get_scene, list_scenes
from openauthor.style_profile import PRESETS, QUALITY_CRITERIA
from openauthor.writing_voice import preview_voice

CORPUS = ROOT / "tests" / "fixtures" / "writing_quality.json"


def candidate_checks(case: dict[str, Any], text: str) -> dict[str, Any]:
  """Mechanical witnesses only. Neither presence nor brevity proves meaning."""
  return {
    "unchanged_baseline": text == case["source"],
    "within_preview_limit": 0 < len(text.split()) <= 500 and len(text) <= 8000,
    "missing_protected_phrases": [phrase for phrase in case["protected_phrases"] if phrase not in text],
    "missing_lexical_markers": [word for word in case["markers"] if word.casefold() not in text.casefold()],
    "semantic_fidelity": "requires human review",
    "literary_quality": "requires human review",
  }


def evaluate(*, provider: str = "local", model: str = "", seed: int = 41, case_ids: list[str] | None = None, strict_review: bool = True) -> dict[str, Any]:
  # Validate before loading a project, checking auth, or consulting runtime defaults.
  if provider not in {"local", "openai-codex"}:
    raise ValueError("This evaluation permits only local or openai-codex subscription mode.")
  corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
  if corpus["schema_version"] != 1 or len(corpus["cases"]) != 3 or len(PRESETS) != 3:
    raise ValueError("Review the evaluation call bound before changing this corpus or its three directions.")
  cases_by_id = {case["id"]: case for case in corpus["cases"]}
  selected_ids = list(cases_by_id) if case_ids is None else list(dict.fromkeys(case_ids))
  if any(case_id not in cases_by_id for case_id in selected_ids):
    missing = next(case_id for case_id in selected_ids if case_id not in cases_by_id)
    raise ValueError(f"Unknown evaluation case '{missing}'.")
  selected_cases = [cases_by_id[case_id] for case_id in selected_ids]
  if provider == "openai-codex":
    status = get_auth_status()["openai-codex"]
    if not status.get("authenticated"):
      raise OpenAuthorError("The existing openAuthor ChatGPT subscription connection is not authenticated. No generation ran. Sign in through openAuthor or run local mode; there is no API fallback.")
  rows = []
  failures = []
  generations = []
  rng = random.Random(seed)
  previous_retries = os.environ.get("OPENAUTHOR_PROVIDER_MAX_RETRIES")
  os.environ["OPENAUTHOR_PROVIDER_MAX_RETRIES"] = "0"
  try:
    with tempfile.TemporaryDirectory(prefix="openauthor-writing-eval-") as directory:
      paths = initialize_project(Path(directory), name="Original writing-quality evaluation")
      for case in selected_cases:
        add_scene(paths, title=case["title"], body=case["source"], pov=case["pov"])
        scene = get_scene(paths, next(row["id"] for row in list_scenes(paths) if row["title"] == case["title"]))
        try:
          record = preview_voice(paths, request={"scene_id": scene["id"], "source_text": case["source"],
            "instruction": case["instruction"] + " Preserve these scene facts: " + " ".join(case["facts"]),
            "directions": PRESETS, "provider": provider, "model": model or ("codex-recommended" if provider == "openai-codex" else ""), "strict_review": strict_review})
        except OpenAuthorError as error:
          # Keep the public workflow strict. A rejected comparison is not prose
          # quality evidence, and its consumed calls must not disappear.
          failures.append({"id": case["id"], "title": case["title"], "error": str(error)})
          print(f"{case['title']}: rejected comparison; continuing without retry.", file=sys.stderr, flush=True)
          continue
        finally:
          assert get_scene(paths, scene["id"])["body"] == scene["body"], "Evaluation changed the source manuscript"
        candidates = list(record["directions"])
        rng.shuffle(candidates)
        rows.append({**case, "candidates": [{"label": chr(65 + index), "text": row["text"], "direction": row["profile"]["name"],
          "generation_id": row["generation_id"], "checks": candidate_checks(case, row["text"]),
          "author_review": row["author_review"], "warnings": row["warnings"], "observations": row["observations"]} for index, row in enumerate(candidates)]})
        print(f"{case['title']}: three samples accepted for review.", file=sys.stderr, flush=True)
      # Export only safe provenance summaries, never account data or private
      # prompt logs. A transport success can still be a rejected comparison.
      generations = [{key: row[key] for key in ("run_id", "status", "provider", "model", "input_tokens", "output_tokens", "latency_ms", "provider_attempts", "error_category")}
        for row in list_generation_runs(paths)]
  finally:
    if previous_retries is None:
      os.environ.pop("OPENAUTHOR_PROVIDER_MAX_RETRIES", None)
    else:
      os.environ["OPENAUTHOR_PROVIDER_MAX_RETRIES"] = previous_retries
  quality_verdict = "Not assessed. Human comparison required." if provider == "openai-codex" else "Not assessed. Human comparison required; local baselines are not creative generation."
  return {"schema_version": 1, "status": "partial" if failures else "completed", "failed_cases": failures, "generations": generations, "strict_review": strict_review,
    "provider": provider, "requested_model": model or ("codex-recommended" if provider == "openai-codex" else "local-deterministic"),
    "case_ids": selected_ids,
    "seed": seed, "corpus_sha256": hashlib.sha256(CORPUS.read_bytes()).hexdigest(),
    "implementation_sha256": hashlib.sha256((ROOT / "openauthor" / "writing_voice.py").read_bytes() + (ROOT / "openauthor" / "style_profile.py").read_bytes()).hexdigest(),
    "generation_calls": sum(row["provider_attempts"] or 0 for row in generations), "candidate_count": sum(len(row["candidates"]) for row in rows),
    "changed_candidates": sum(not candidate["checks"]["unchanged_baseline"] for row in rows for candidate in row["candidates"]),
    "quality_verdict": quality_verdict,
    "criteria": QUALITY_CRITERIA, "cases": rows}


def review_packet(result: dict[str, Any]) -> str:
  lines = ["# Original prose comparison", "", f"Mode: {result['provider']}. {result['quality_verdict']}", "",
    "Read source and anonymous samples before consulting the direction key in the JSON record. Generator self-reviews are deliberately omitted.", "",
    "For each sample: mark every fact preserved / contradicted / uncertain, quote evidence, then assess voice fit, readability, character differentiation, emotional effect and consistency. Compare against the source, not just against the other candidates. Prefer A / B / C / source / tie / none, with reasons. Do not choose a continuity-breaking sample as the winner.", "",
    "Have the author judge without direction labels; use a second reader where possible. Record disagreements rather than averaging away a factual error.", ""]
  for failure in result.get("failed_cases", []):
    lines += [f"Rejected comparison: {failure['title']}. {failure['error']}", ""]
  for case in result["cases"]:
    lines += [f"## {case['title']} — {case['mode']}", "", "### Source", "", case["source"], "", "Scene facts:", ""]
    lines += [f"- {fact}" for fact in case["facts"]]
    lines += ["", "Craft questions:", ""] + [f"- {question}" for question in case["quality_questions"]]
    lines += ["", f"Calibration warning: {case['calibration_error']}", ""]
    for candidate in case["candidates"]:
      lines += [f"### Sample {candidate['label']}", "", candidate["text"], "", "Author assessment: unreviewed. Evidence and preference: not recorded.", ""]
  return "\n".join(lines)


def main() -> None:
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("--provider", choices=["local", "openai-codex"], default="local")
  parser.add_argument("--model", default="")
  parser.add_argument("--case-id", action="append", dest="case_ids", help="Evaluate only this corpus case; repeat for multiple cases.")
  parser.add_argument("--best-effort", action="store_true", help="Keep valid prose when provider self-review metadata is malformed; not suitable for quality certification.")
  parser.add_argument("--output", type=Path, help="New output directory for a blinded Markdown packet and keyed JSON record.")
  args = parser.parse_args()
  if args.output and args.output.exists():
    parser.error("Choose a new output directory; existing evaluation records are never overwritten.")
  try:
    result = evaluate(provider=args.provider, model=args.model, case_ids=args.case_ids, strict_review=not args.best_effort)
  except (OpenAuthorError, ValueError) as error:
    parser.exit(1, f"{error}\n")
  if args.output:
    args.output.mkdir(parents=True, exist_ok=False)
    (args.output / "review.md").write_text(review_packet(result), encoding="utf-8")
    (args.output / "record.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
  print(json.dumps({key: value for key, value in result.items() if key not in {"cases", "criteria", "generations"}}, indent=2))
  if result["failed_cases"]:
    parser.exit(1, "Partial evaluation saved; rejected comparisons are not successful samples.\n")


if __name__ == "__main__":
  main()
