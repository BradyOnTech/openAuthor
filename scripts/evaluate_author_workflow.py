#!/usr/bin/env python3
"""Consent-gated, human-reviewed author workflow evaluation. No network by default."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
  sys.path.insert(0, str(ROOT))

from openauthor.ai import SUPPORTED_PROVIDERS, generate_proposal_draft, preview_proposal_revision
from openauthor.backups import create_backup, restore_backup
from openauthor.canon import list_canon_facts
from openauthor.changes import render_change_set
from openauthor.generations import list_generation_runs
from openauthor.manuscript_io import import_manuscript
from openauthor.project import OpenAuthorError, atomic_write_json, initialize_project, resolve_project, utc_now
from openauthor.project_lock import project_write_lock
from openauthor.proposals import apply_proposal, create_proposal, get_proposal, undo_proposal, update_change_hunk
from openauthor.revisions import _book_files, create_revision, verify_revision_store
from openauthor.scenes import get_scene, list_scene_details

SYNTHETIC_BODY = "Mara began to count the lanterns.\n\nThe gate remained closed.\n\nMara started to search for Ivo."
SYNTHETIC_SOURCE = f"# The Gate\n\n{SYNTHETIC_BODY}\n\n# The Watch\n\nIvo is the keeper. Ivo waits until dawn.\n"


def digest(data: bytes) -> str:
  return hashlib.sha256(data).hexdigest()


def read_json(path: Path) -> dict[str, Any]:
  value = json.loads(path.read_text(encoding="utf-8"))
  if not isinstance(value, dict):
    raise OpenAuthorError(f"Expected a JSON object: {path.name}")
  return value


def validate_consent(case: dict[str, Any], *, provider: str, model: str, transmission: bool) -> None:
  """Validate recorded scope, not the authenticity or legal sufficiency of consent."""
  consent = case.get("consent", {})
  if not isinstance(consent, dict) or consent.get("status") != "approved":
    raise OpenAuthorError("Recorded author consent is required before reading the manuscript.")
  for field in ("authority_ref", "evidence_ref", "participant_code"):
    if not isinstance(consent.get(field), str) or not consent[field].strip():
      raise OpenAuthorError(f"Consent requires {field}; keep contact details outside the run.")
  if consent.get("local_analysis") is not True or consent.get("retain_artifacts") is not True:
    raise OpenAuthorError("Consent must cover local analysis and retained prompts, outputs, history, and backups.")
  try:
    deadline = datetime.fromisoformat(str(consent["retain_until"]).replace("Z", "+00:00"))
    if deadline.tzinfo is None or deadline <= datetime.now(timezone.utc):
      raise ValueError("expired")
  except (KeyError, ValueError):
    raise OpenAuthorError("Consent needs a future timezone-aware retain_until deadline.") from None
  if transmission and provider != "local":
    allowed = consent.get("provider_transmission", [])
    if not isinstance(allowed, list) or {"provider": provider, "model": model} not in allowed:
      raise OpenAuthorError("Consent does not cover transmission to this exact provider and model.")


def book_fingerprint(paths) -> dict[str, str]:
  return {path.relative_to(paths.root).as_posix(): digest(path.read_bytes()) for path in _book_files(paths)}


def prepare(output: Path, *, manifest: Path | None = None) -> dict[str, Any]:
  synthetic = manifest is None
  case = {
    "case_id": "synthetic-gate", "provider": "local", "model": "heuristic-v1",
    "instruction": "Tighten the prose by removing began to and started to. Preserve named people and events.",
    "protected_elements": ["Mara", "Ivo", "The gate remained closed."],
  } if synthetic else read_json(manifest)
  provider, model = case.get("provider"), case.get("model")
  if provider not in SUPPORTED_PROVIDERS or not isinstance(model, str) or not model.strip():
    raise OpenAuthorError("Choose a supported provider and an explicit model.")
  if not isinstance(case.get("instruction"), str) or not case["instruction"].strip():
    raise OpenAuthorError("An explicit editorial instruction is required.")
  output = output.expanduser().resolve()
  if output.exists():
    raise OpenAuthorError("Use a new evaluation folder; existing runs are never overwritten.")
  if not synthetic:
    validate_consent(case, provider=provider, model=model, transmission=False)
    if any((parent / ".git").exists() for parent in [output, *output.parents]):
      raise OpenAuthorError("Store real-author evaluation artifacts outside Git repositories.")
    source = (manifest.parent / str(case.get("source", ""))).expanduser().resolve()
    if not source.is_file() or source.suffix.lower() not in {".md", ".txt", ".docx"}:
      raise OpenAuthorError("Approve one exact Markdown, text, or DOCX file per case.")
    if source.stat().st_size > 20 * 1024 * 1024:
      raise OpenAuthorError("Use an approved excerpt of at most 20 MiB.")
    source_bytes = source.read_bytes()
    if digest(source_bytes) != case.get("source_sha256"):
      raise OpenAuthorError("The source does not match the approved SHA-256 digest.")
    extension = source.suffix.lower()
  else:
    source_bytes, extension = SYNTHETIC_SOURCE.encode(), ".md"
  output.mkdir(parents=True, mode=0o700)
  source_copy = output / f"source{extension}"
  source_copy.write_bytes(source_bytes)
  paths = initialize_project(output / "book", name="Isolated author evaluation")
  imported = import_manuscript(paths, source_copy, strategy=case.get("strategy", "headings"))
  list_canon_facts(paths)  # Initialize the empty store; never seed evaluation ground truth as Canon.
  baseline = create_revision(paths, "Imported evaluation source")
  scenes = list_scene_details(paths)
  target_index = case.get("target_scene_index", 0)
  if type(target_index) is not int or not 0 <= target_index < len(scenes):
    raise OpenAuthorError("target_scene_index must select an imported scene (zero-based).")
  state = {
    "schema_version": 1, "run_id": uuid.uuid4().hex, "status": "prepared", "created_at": utc_now(),
    "evidence_kind": "synthetic_workflow" if synthetic else "author_manuscript",
    "case": case, "source_file": source_copy.name, "source_sha256": digest(source_bytes),
    "consent_manifest": str(manifest.expanduser().resolve()) if manifest else None,
    "import": imported, "baseline_revision": baseline, "baseline_files": book_fingerprint(paths),
    "target_scene_id": scenes[target_index]["id"], "extraction_engine": "heuristic_cold_start",
    "extraction_suggestions": imported["story_memory_suggestions"]["suggestions"],
    "import_fidelity": {"automated_exact_bodies": [s["body"].rstrip("\n") for s in scenes] == [SYNTHETIC_BODY, "Ivo is the keeper. Ivo waits until dawn."] if synthetic else None,
                        "human_assessment": None},
    "provider_settings": {"provider": provider, "model": model, "temperature": 0.3, "max_output_tokens": 2000},
  }
  atomic_write_json(output / "run.json", state)
  atomic_write_json(output / "pilot-record.json", {
    "schema_version": 1, "run_id": state["run_id"], "observation_kind": "not_observed",
    "participant_code": case.get("consent", {}).get("participant_code"),
    "outreach_authorized": False, "follow_up_authorized": False,
    "tasks": {task: "not_observed" for task in ("import_and_find_version", "explain_change", "reject_hunk_apply_undo", "return_to_primary", "backup_recovery")},
    "undo_confidence_before_1_to_5": None, "undo_confidence_after_1_to_5": None,
    "data_loss_incidents": None, "returned_to_own_revision": "not_observed",
    "follow_up_date": None, "blockers": [], "approved_quotes": [],
  })
  return state


def checked_run(output: Path, *, transmission: bool = False) -> tuple[dict[str, Any], Any]:
  state = read_json(output / "run.json")
  if state.get("schema_version") != 1:
    raise OpenAuthorError("Unsupported evaluation run schema.")
  case = state["case"]
  settings = state["provider_settings"]
  if state["evidence_kind"] != "synthetic_workflow":
    validate_consent(case, provider=settings["provider"], model=settings["model"], transmission=transmission)
    current_case = read_json(Path(state["consent_manifest"]))
    validate_consent(current_case, provider=settings["provider"], model=settings["model"], transmission=transmission)
    if current_case.get("source_sha256") != state["source_sha256"]:
      raise OpenAuthorError("The current consent record no longer approves this source digest.")
  else:
    # The exemption is only for the fixed built-in passage and local provider.
    if state["source_sha256"] != digest(SYNTHETIC_SOURCE.encode()) or settings["provider"] != "local":
      raise OpenAuthorError("Synthetic runs must use the built-in source and local provider.")
  source_name = state["source_file"]
  if source_name not in {"source.md", "source.txt", "source.docx"}:
    raise OpenAuthorError("Invalid evaluation source path.")
  if digest((output / source_name).read_bytes()) != state["source_sha256"]:
    raise OpenAuthorError("The retained source changed; start a new approved run.")
  return state, resolve_project(output / "book")


def preview_draft(output: Path) -> dict[str, Any]:
  state, paths = checked_run(output, transmission=True)
  with project_write_lock(paths):
    state, paths = checked_run(output, transmission=True)
    if state["status"] not in {"prepared", "generation_failed", "generating"}:
      raise OpenAuthorError("This run is not awaiting generation.")
    if book_fingerprint(paths) != state["baseline_files"]:
      raise OpenAuthorError("The evaluation book changed after intake; start a new approved run.")
    if not state.get("proposal_id"):
      state["proposal_id"] = create_proposal(
        paths, title="Author-reviewed evaluation", instruction=state["case"]["instruction"],
        scene_id=state["target_scene_id"], revision_intent={"goal": state["case"]["instruction"],
          "constraints": [], "protected_elements": state["case"].get("protected_elements", []), "scope": "scene"},
      )
      atomic_write_json(output / "run.json", state)
    preview = preview_proposal_revision(paths, proposal_id=state["proposal_id"], **state["provider_settings"])
    atomic_write_json(output / "draft-context.json", preview)
    return {"run_id": state["run_id"], "status": state["status"], "fingerprint": preview["fingerprint"], "review_path": str(output / "draft-context.json")}


def generate(output: Path, *, allow_provider: bool = False, retry: bool = False, expected_context_fingerprint: str = "") -> dict[str, Any]:
  state, paths = checked_run(output, transmission=True)
  with project_write_lock(paths):
    state, paths = checked_run(output, transmission=True)
    if state["status"] == "awaiting_review":
      return state
    if state["status"] not in {"prepared", "generation_failed", "generating"}:
      raise OpenAuthorError("This run is not awaiting generation.")
    if state["status"] != "prepared" and not retry:
      raise OpenAuthorError("Explicit --retry is required; an earlier provider attempt may have incurred charges.")
    if state["provider_settings"]["provider"] != "local" and not allow_provider:
      raise OpenAuthorError("Provider calls require --allow-provider as well as recorded consent.")
    if state["provider_settings"]["provider"] != "local" and not expected_context_fingerprint:
      raise OpenAuthorError("Review the preview-draft artifact, then provide --expected-context-fingerprint before sending to a provider.")
    if book_fingerprint(paths) != state["baseline_files"]:
      raise OpenAuthorError("The evaluation book changed after intake; start a new approved run.")
    if not state.get("proposal_id"):
      state["proposal_id"] = create_proposal(
        paths, title="Author-reviewed evaluation", instruction=state["case"]["instruction"],
        scene_id=state["target_scene_id"], revision_intent={"goal": state["case"]["instruction"],
          "constraints": [], "protected_elements": state["case"].get("protected_elements", []), "scope": "scene"},
      )
    state["status"] = "generating"
    atomic_write_json(output / "run.json", state)
    try:
      proposal = get_proposal(paths, state["proposal_id"])
      # Recover a saved draft if only the runner's response/checkpoint was lost.
      if not proposal.get("draft"):
        proposal = generate_proposal_draft(paths, proposal_id=state["proposal_id"],
          expected_context_fingerprint=expected_context_fingerprint, **state["provider_settings"])
      state.update(status="awaiting_review", draft_sha256=digest(proposal["proposed_body"].encode()), usage=proposal["draft"])
      state.pop("error", None)
      review = {
        "run_id": state["run_id"], "proposal_id": state["proposal_id"], "draft_sha256": state["draft_sha256"],
        "observation_kind": "synthetic" if state["evidence_kind"] == "synthetic_workflow" else "human",
        "reviewer_code": None, "hunks": {row["id"]: None for row in proposal["change_set"]["hunks"]},
        "extraction_labels": {row["id"]: None for row in state["extraction_suggestions"]},
        "extraction_complete": False, "missed_items": [], "voice_rating_1_to_5": None,
        "unsupported_additions": None, "protected_fact_violations": None,
        "import_losses": None, "review_seconds": None,
      }
      if not (output / "review.json").exists():
        atomic_write_json(output / "review.json", review)
      atomic_write_json(output / "draft.json", proposal)
      atomic_write_json(output / "run.json", state)
      return state
    except Exception as error:
      state.update(status="generation_failed", error=str(error))
      atomic_write_json(output / "run.json", state)
      raise


def validate_review(state: dict[str, Any], proposal: dict[str, Any], review: dict[str, Any]) -> None:
  for key in ("run_id", "proposal_id", "draft_sha256"):
    if review.get(key) != state[key]:
      raise OpenAuthorError("Review does not match this exact run and generated draft.")
  if digest(proposal["proposed_body"].encode()) != state["draft_sha256"]:
    raise OpenAuthorError("The generated draft changed after review was prepared.")
  if not isinstance(review.get("reviewer_code"), str) or not review["reviewer_code"].strip():
    raise OpenAuthorError("Record a reviewer code before applying decisions.")
  expected_kind = "synthetic" if state["evidence_kind"] == "synthetic_workflow" else "human"
  if review.get("observation_kind") != expected_kind:
    raise OpenAuthorError("Synthetic decisions must not be reported as human observations.")
  hunks = review.get("hunks", {})
  if set(hunks) != {row["id"] for row in proposal["change_set"]["hunks"]} or any(value not in {"accepted", "rejected"} for value in hunks.values()):
    raise OpenAuthorError("Explicitly accept or reject every generated hunk.")
  labels = review.get("extraction_labels", {})
  if set(labels) != {row["id"] for row in state["extraction_suggestions"]} or any(value not in {"correct", "incorrect", "uncertain"} for value in labels.values()):
    raise OpenAuthorError("Label every extraction suggestion, including uncertain items.")
  for field in ("unsupported_additions", "protected_fact_violations", "import_losses"):
    if review.get(field) is not None and (not isinstance(review[field], list) or any(not isinstance(row, str) for row in review[field])):
      raise OpenAuthorError(f"{field} must contain text observations, or null when unobserved.")
  rating = review.get("voice_rating_1_to_5")
  if rating is not None and (type(rating) is not int or not 1 <= rating <= 5):
    raise OpenAuthorError("Voice rating must be 1–5 or null when unobserved.")
  elapsed = review.get("review_seconds")
  if elapsed is not None and (type(elapsed) not in {int, float} or not 0 <= elapsed < float("inf")):
    raise OpenAuthorError("Review seconds must be nonnegative and finite, or null.")
  if type(review.get("extraction_complete")) is not bool or not isinstance(review.get("missed_items"), list):
    raise OpenAuthorError("Record whether extraction annotation is complete, including missed items.")
  seen = set()
  for item in review["missed_items"]:
    if not isinstance(item, dict) or item.get("kind") not in {"entity_create", "relationship_create", "canon_fact"} or not isinstance(item.get("description"), str) or not item["description"].strip():
      raise OpenAuthorError("Each missed item needs an extraction kind and a description.")
    key = (item["kind"], item["description"].strip().casefold())
    if key in seen:
      raise OpenAuthorError("Do not count the same missed item twice.")
    seen.add(key)


def extraction_metrics(state: dict[str, Any], review: dict[str, Any]) -> dict[str, Any]:
  def counts(kind: str | None) -> dict[str, Any]:
    ids = {row["id"] for row in state["extraction_suggestions"] if kind is None or row["kind"] == kind}
    labels = [value for key, value in review["extraction_labels"].items() if key in ids]
    correct, incorrect, uncertain = (labels.count(label) for label in ("correct", "incorrect", "uncertain"))
    missed = sum(kind is None or item["kind"] == kind for item in review["missed_items"])
    graded = review["extraction_complete"] and uncertain == 0
    return {"suggestions": len(labels), "correct": correct, "incorrect": incorrect, "uncertain": uncertain,
      "missed": missed, "annotation_complete": graded,
      "precision": correct / (correct + incorrect) if graded and correct + incorrect else None,
      "recall": correct / (correct + missed) if graded and correct + missed else None}
  return {"engine": state["extraction_engine"], **counts(None),
    "by_kind": {kind: counts(kind) for kind in ("entity_create", "relationship_create", "canon_fact")}}


def finish(output: Path, review_path: Path) -> dict[str, Any]:
  state, paths = checked_run(output)
  with project_write_lock(paths):
    state, paths = checked_run(output)
    if state["status"] == "completed":
      return read_json(output / "report.json")
    if state["status"] != "awaiting_review":
      raise OpenAuthorError("This run is not awaiting review. Inspect any interrupted apply before continuing.")
    proposal = get_proposal(paths, state["proposal_id"])
    review = read_json(review_path)
    validate_review(state, proposal, review)
    if book_fingerprint(paths) != state["baseline_files"]:
      raise OpenAuthorError("The evaluation book changed since intake; review/apply was stopped.")
    atomic_write_json(output / "accepted-review.json", review)
    state["status"] = "applying_review"
    atomic_write_json(output / "run.json", state)
    before = {row["path"]: (paths.root / row["path"]).read_bytes() for row in list_scene_details(paths)}
    for hunk_id, decision in review["hunks"].items():
      proposal = update_change_hunk(paths, proposal_id=proposal["id"], hunk_id=hunk_id, decision=decision)
    expected = render_change_set(proposal["change_set"])
    changed = expected.rstrip("\n") != get_scene(paths, state["target_scene_id"])["body"].rstrip("\n")
    applied_matches = undo_exact = None
    if changed:
      apply_proposal(paths, proposal_id=proposal["id"])
      applied_matches = get_scene(paths, state["target_scene_id"])["body"].rstrip("\n") == expected.rstrip("\n")
      undo_proposal(paths, proposal_id=proposal["id"])
      undo_exact = all((paths.root / name).read_bytes() == content for name, content in before.items())
    backup_before = book_fingerprint(paths)
    create_backup(paths, output / "recovery.openauthor.zip")
    restore_backup(output / "recovery.openauthor.zip", output / "recovered")
    recovered = resolve_project(output / "recovered")
    backup_exact = book_fingerprint(recovered) == backup_before
    def history_files(project):
      return {path.relative_to(project.revisions_dir).as_posix(): digest(path.read_bytes())
        for path in project.revisions_dir.rglob("*") if path.is_file()}
    history_exact = history_files(paths) == history_files(recovered) and verify_revision_store(recovered)["ready"]
    attempts = list_generation_runs(paths)
    report = {
      "schema_version": 1, "run_id": state["run_id"], "completed_at": utc_now(), "evidence_kind": state["evidence_kind"],
      "provider_settings": state["provider_settings"], "usage": state["usage"], "source_sha256": state["source_sha256"],
      "generation_attempts": attempts, "failed_generations": sum(row["status"] == "failed" for row in attempts),
      "billing_note": "Recorded usage is not a billing receipt; failed or interrupted provider usage may be unknown.",
      "extraction": extraction_metrics(state, review),
      "human_observations": review if review["observation_kind"] == "human" else None,
      "synthetic_decisions": review if review["observation_kind"] == "synthetic" else None,
      "import_fidelity": {**state["import_fidelity"], "human_assessment":
        {"losses": review["import_losses"]} if review["observation_kind"] == "human" and review.get("import_losses") is not None else None},
      "accepted_hunks": list(review["hunks"].values()).count("accepted"),
      "rejected_hunks": list(review["hunks"].values()).count("rejected"), "applied": changed,
      "applied_matches_review": applied_matches, "undo_byte_exact": undo_exact, "backup_book_exact": backup_exact,
      "backup_history_exact": history_exact,
      "pilot_outcomes": None,
    }
    atomic_write_json(output / "report.json", report)
    state["status"] = "completed"
    atomic_write_json(output / "run.json", state)
    return report


def smoke() -> dict[str, Any]:
  with tempfile.TemporaryDirectory(prefix="openauthor-evaluation-") as temporary:
    output = Path(temporary) / "run"
    prepare(output)
    generate(output)
    review = read_json(output / "review.json")
    review["reviewer_code"] = "synthetic-contract"
    review["hunks"] = {key: "accepted" if index == 0 else "rejected" for index, key in enumerate(review["hunks"])}
    review["extraction_labels"] = {key: "uncertain" for key in review["extraction_labels"]}
    atomic_write_json(output / "review.json", review)
    result = finish(output, output / "review.json")
    if not all(result[key] is True for key in ("applied_matches_review", "undo_byte_exact", "backup_book_exact", "backup_history_exact")):
      raise OpenAuthorError("Synthetic workflow recovery gate failed.")
    return result


def main() -> None:
  parser = argparse.ArgumentParser(description=__doc__)
  commands = parser.add_subparsers(dest="command", required=True)
  commands.add_parser("smoke", help="Run only the built-in synthetic workflow with the local provider.")
  intake = commands.add_parser("prepare")
  intake.add_argument("--output", type=Path, required=True)
  intake.add_argument("--manifest", type=Path, help="Approved case manifest; omitted means the built-in synthetic passage.")
  drafting = commands.add_parser("generate")
  drafting.add_argument("--run", type=Path, required=True)
  drafting.add_argument("--allow-provider", action="store_true")
  drafting.add_argument("--retry", action="store_true")
  drafting.add_argument("--expected-context-fingerprint", default="", help="Fingerprint from the reviewed preview-draft artifact; required for external providers.")
  previewing = commands.add_parser("preview-draft", help="Save exact draft context locally without contacting a provider.")
  previewing.add_argument("--run", type=Path, required=True)
  review = commands.add_parser("finish")
  review.add_argument("--run", type=Path, required=True)
  review.add_argument("--review", type=Path, required=True)
  args = parser.parse_args()
  try:
    if args.command == "smoke":
      result = smoke()
    elif args.command == "prepare":
      result = prepare(args.output, manifest=args.manifest)
    elif args.command == "generate":
      result = generate(args.run, allow_provider=args.allow_provider, retry=args.retry, expected_context_fingerprint=args.expected_context_fingerprint)
    elif args.command == "preview-draft":
      result = preview_draft(args.run)
    else:
      result = finish(args.run, args.review)
    # Full prose-bearing artifacts stay in the run directory, never on stdout.
    print(json.dumps({key: result[key] for key in ("run_id", "status", "fingerprint", "review_path", "evidence_kind", "applied_matches_review", "undo_byte_exact", "backup_book_exact", "backup_history_exact") if key in result}, indent=2))
  except (OpenAuthorError, OSError, ValueError, KeyError, TypeError) as error:
    print(json.dumps({"error": str(error)}), file=sys.stderr)
    raise SystemExit(1) from None


if __name__ == "__main__":
  main()
