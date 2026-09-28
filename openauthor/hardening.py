from __future__ import annotations

import json
import shutil
import sys
import tempfile
import time
from statistics import mean
from typing import Any, Callable

from .checks import run_continuity_checks
from .codex import ensure_codex, list_entities, replace_runtime_codex_from_snapshot
from .generations import audit_generation_pins, list_generation_runs
from .git_ops import get_branch_workspace_status, initialize_git, run_git
from .project import OpenAuthorError, ProjectPaths, utc_now
from .proposals import list_proposals
from .revisions import ensure_revision_store, verify_revision_store, recover_interrupted_edit
from .retrieval import get_retrieval_index_status
from .scenes import get_scene, list_scene_details, list_scenes, update_scene


def collect_startup_health(
  paths: ProjectPaths,
  *,
  repair: bool = False,
) -> dict[str, Any]:
  checks: list[dict[str, Any]] = []

  def record(
    identifier: str,
    status: str,
    message: str,
    *,
    recovery: str = "",
    repairable: bool = False,
    repaired: bool = False,
  ) -> None:
    checks.append({
      "id": identifier,
      "status": status,
      "message": message,
      "recovery": recovery,
      "repairable": repairable,
      "repaired": repaired,
    })

  required_directories = [
    paths.project_dir,
    paths.workspace_dir,
    paths.scenes_dir,
    paths.proposals_dir,
    paths.generations_dir,
    paths.codex_db.parent,
  ]
  missing = [directory for directory in required_directories if not directory.is_dir()]
  repaired_directories = False
  if missing and repair:
    for directory in missing:
      directory.mkdir(parents=True, exist_ok=True)
    repaired_directories = True
    missing = [directory for directory in required_directories if not directory.is_dir()]
  if missing:
    record(
      "project_directories",
      "error",
      f"{len(missing)} required project director{'y is' if len(missing) == 1 else 'ies are'} missing.",
      recovery="Create the missing local project directories.",
      repairable=True,
    )
  else:
    record(
      "project_directories",
      "ok",
      "Required project directories are present.",
      repaired=repaired_directories,
    )

  try:
    paths.workspace_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(prefix="health-", dir=paths.workspace_dir, delete=True):
      pass
  except OSError as error:
    record(
      "workspace_write",
      "error",
      f"Project workspace is not writable: {error}",
      recovery="Choose a writable local folder or repair its permissions.",
    )
  else:
    record("workspace_write", "ok", "Project workspace is writable.")

  revision_directories_missing = any(
    not directory.is_dir()
    for directory in (paths.revision_objects_dir, paths.revision_records_dir)
  )
  interrupted = (paths.workspace_dir / "author-edit.json").exists()
  if interrupted:
    if repair:
      try:
        recover_interrupted_edit(paths)
        record("interrupted_edit", "ok", "Recovered the last completed book version.", repaired=True)
      except (OpenAuthorError, OSError) as error:
        record("interrupted_edit", "error", str(error), recovery="Restore the project from a verified backup.")
    else:
      record("interrupted_edit", "error", "A previous save was interrupted.", recovery="Recover the last completed book version before continuing.", repairable=True)
  repaired_revisions = False
  if repair and revision_directories_missing:
    ensure_revision_store(paths)
    repaired_revisions = True
  revision_report = verify_revision_store(paths)
  if not revision_report["ready"]:
    record(
      "revision_store",
      "error",
      f"Revision history is damaged: {'; '.join(revision_report['errors'])}",
      recovery="Restore the .openauthor/revisions directory from backup before applying AI changes.",
      repairable=True,
    )
  else:
    record(
      "revision_store",
      "ok",
      f"Local revision history is available ({revision_report['revision_count']} revision(s)).",
      repaired=repaired_revisions,
    )

  try:
    details = list_scene_details(paths)
  except (OSError, ValueError) as error:
    record(
      "manuscript_read",
      "error",
      f"Manuscript scenes could not be read: {error}",
      recovery="Restore the damaged scene file from a revision or backup.",
    )
  else:
    identifiers = [scene.get("id", "") for scene in details]
    duplicates = sorted({identifier for identifier in identifiers if identifiers.count(identifier) > 1})
    if duplicates:
      record(
        "manuscript_read",
        "error",
        f"Duplicate scene ids detected: {', '.join(duplicates)}.",
        recovery="Assign unique scene ids before continuing.",
      )
    else:
      record("manuscript_read", "ok", f"Loaded {len(details)} scene(s).")

  codex_missing = not paths.codex_db.exists()
  codex_error: Exception | None = None
  if codex_missing and not repair:
    codex_error = OpenAuthorError("Codex database is missing.")
  else:
    try:
      if codex_missing and repair:
        replace_runtime_codex_from_snapshot(paths)
      else:
        ensure_codex(paths)
      list_entities(paths)
    except (OpenAuthorError, OSError) as error:
      codex_error = error
  if codex_error is not None:
    record(
      "codex_store",
      "error",
      f"Story reference store is unavailable: {codex_error}",
      recovery="Rebuild the local Codex database from codex/codex.json.",
      repairable=True,
    )
  else:
    record("codex_store", "ok", "Story reference store is readable.", repaired=repair and codex_missing)

  free_bytes = shutil.disk_usage(paths.root).free
  if free_bytes < 250 * 1024 * 1024:
    record(
      "disk_space",
      "warning",
      f"Only {free_bytes // (1024 * 1024)} MB of disk space is free.",
      recovery="Free at least 250 MB before importing or generating revisions.",
    )
  else:
    record("disk_space", "ok", f"{free_bytes // (1024 * 1024)} MB of disk space is free.")

  record(
    "python_runtime",
    "ok" if sys.version_info >= (3, 11) else "error",
    f"Python {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro} is running.",
    recovery="Use the bundled Python 3.11+ runtime." if sys.version_info < (3, 11) else "",
  )

  errors = sum(1 for check in checks if check["status"] == "error")
  warnings = sum(1 for check in checks if check["status"] == "warning")
  return {
    "checked_at": utc_now(),
    "project_root": str(paths.root),
    "repair_requested": repair,
    "ready": errors == 0,
    "errors": errors,
    "warnings": warnings,
    "checks": checks,
  }


def _timed_samples(fn: Callable[[], Any], repeat: int) -> tuple[list[float], Any]:
  samples_ms: list[float] = []
  last_value: Any = None
  for _ in range(repeat):
    started = time.perf_counter()
    last_value = fn()
    elapsed_ms = (time.perf_counter() - started) * 1000.0
    samples_ms.append(round(elapsed_ms, 3))
  return samples_ms, last_value


def _metric_row(name: str, samples_ms: list[float]) -> dict[str, Any]:
  return {
    "name": name,
    "samples_ms": samples_ms,
    "min_ms": min(samples_ms),
    "avg_ms": round(mean(samples_ms), 3),
    "max_ms": max(samples_ms),
  }


def _load_project_workspace(paths: ProjectPaths) -> dict[str, Any]:
  return {
    "scenes": list_scenes(paths),
    "entities": list_entities(paths),
    "proposals": list_proposals(paths),
    "generation_runs": list_generation_runs(paths, limit=None),
  }


def _search_project_workspace(paths: ProjectPaths, query: str) -> list[str]:
  normalized = query.strip().lower()
  if not normalized:
    return []
  matches: list[str] = []
  for scene in list_scenes(paths):
    haystack = " ".join(
      str(scene.get(field, ""))
      for field in ("id", "title", "summary", "pov")
    ).lower()
    if normalized in haystack:
      matches.append(str(scene.get("id", "")))
  for entity in list_entities(paths):
    haystack = " ".join(
      str(entity.get(field, ""))
      for field in ("id", "type", "name", "description")
    ).lower()
    if normalized in haystack:
      matches.append(str(entity.get("id", "")))
  return matches


def collect_performance_baseline(
  paths: ProjectPaths,
  *,
  repeat: int = 3,
) -> dict[str, Any]:
  if repeat < 1:
    raise OpenAuthorError("repeat must be >= 1.")

  scene_samples, scene_rows = _timed_samples(lambda: list_scenes(paths), repeat)
  proposal_samples, proposal_rows = _timed_samples(lambda: list_proposals(paths), repeat)
  run_samples, run_rows = _timed_samples(
    lambda: list_generation_runs(paths, limit=None),
    repeat,
  )
  retrieval_samples, retrieval_status = _timed_samples(
    lambda: get_retrieval_index_status(paths),
    repeat,
  )
  project_load_samples, project_workspace = _timed_samples(
    lambda: _load_project_workspace(paths),
    repeat,
  )
  target_scene_id = str(scene_rows[-1].get("id", "")) if scene_rows else ""
  if target_scene_id:
    scene_open_samples, opened_scene = _timed_samples(
      lambda: get_scene(paths, target_scene_id),
      repeat,
    )
    scene_save_samples, _ = _timed_samples(
      lambda: update_scene(
        paths,
        scene_identifier=target_scene_id,
        title=str(opened_scene.get("title", "")),
        summary=str(opened_scene.get("summary", "")),
        pov=str(opened_scene.get("pov", "")),
        status=str(opened_scene.get("status", "draft")),
        body=str(opened_scene.get("body", "")),
      ),
      repeat,
    )
  else:
    scene_open_samples = [0.0 for _ in range(repeat)]
    scene_save_samples = [0.0 for _ in range(repeat)]
  project_search_samples, search_rows = _timed_samples(
    lambda: _search_project_workspace(paths, "character"),
    repeat,
  )
  analysis_samples, analysis_rows = _timed_samples(
    lambda: run_continuity_checks(paths),
    repeat,
  )

  return {
    "checked_at": utc_now(),
    "repeat": repeat,
    "counts": {
      "scenes": len(scene_rows),
      "proposals": len(proposal_rows),
      "generation_runs": len(run_rows),
      "entities": len(project_workspace["entities"]),
      "search_results": len(search_rows),
      "continuity_issues": len(analysis_rows),
    },
    "metrics": [
      _metric_row("scene_list", scene_samples),
      _metric_row("proposal_list", proposal_samples),
      _metric_row("generation_list", run_samples),
      _metric_row("retrieval_status", retrieval_samples),
      _metric_row("project_load", project_load_samples),
      _metric_row("scene_open", scene_open_samples),
      _metric_row("scene_save", scene_save_samples),
      _metric_row("project_search", project_search_samples),
      _metric_row("continuity_analysis", analysis_samples),
    ],
    "retrieval": retrieval_status,
  }


def _issue(
  *,
  code: str,
  severity: str,
  message: str,
  recovery: str,
) -> dict[str, str]:
  return {
    "code": code,
    "severity": severity,
    "message": message,
    "recovery": recovery,
  }


def audit_workspace_metadata(
  paths: ProjectPaths,
  *,
  repair: bool = False,
) -> dict[str, Any]:
  issues: list[dict[str, str]] = []
  recovery_actions: list[str] = []
  repair_applied = False

  try:
    branch_status = get_branch_workspace_status(paths)
  except OpenAuthorError as error:
    branch_status = {
      "drift_detected": True,
      "error": str(error),
      "drift_reasons": ["git_unavailable"],
      "recommendations": ["Initialize git for this project workspace."],
    }
    issues.append(
      _issue(
        code="branch_workspace_unavailable",
        severity="warning",
        message=str(error),
        recovery="Initialize git repo (`git init`) or re-run `openauthor init`.",
      )
    )
    recovery_actions.append("Initialize git for this project workspace.")
  else:
    if branch_status.get("drift_detected"):
      reasons = ", ".join(branch_status.get("drift_reasons", [])) or "unknown"
      issues.append(
        _issue(
          code="branch_workspace_drift",
          severity="warning",
          message=f"Branch workspace drift detected ({reasons}).",
          recovery="Switch to a named local branch and refresh refs.",
        )
      )
      recovery_actions.extend(branch_status.get("recommendations", []))

  retrieval_status: dict[str, Any]
  try:
    retrieval_status = get_retrieval_index_status(paths)
  except OpenAuthorError as error:
    retrieval_status = {
      "present": False,
      "error": str(error),
    }
    issues.append(
      _issue(
        code="retrieval_index_invalid",
        severity="error",
        message=str(error),
        recovery="Rebuild retrieval index (`openauthor retrieval build --json`).",
      )
    )
    recovery_actions.append("Run `openauthor retrieval build --json`.")
  else:
    if not retrieval_status.get("present"):
      issues.append(
        _issue(
          code="retrieval_index_missing",
          severity="warning",
          message="Retrieval index is not built.",
          recovery="Build retrieval index before retrieval-required generation.",
        )
      )
      recovery_actions.append("Run `openauthor retrieval build --json`.")
    elif retrieval_status.get("stale"):
      reasons = ", ".join(retrieval_status.get("stale_reasons", [])) or "unknown"
      issues.append(
        _issue(
          code="retrieval_index_stale",
          severity="warning",
          message=f"Retrieval index is stale ({reasons}).",
          recovery="Rebuild retrieval index to re-align with current branch state.",
        )
      )
      recovery_actions.append("Run `openauthor retrieval build --json`.")

  pins_audit: dict[str, Any]
  try:
    pins_audit = audit_generation_pins(paths, repair=repair)
  except OpenAuthorError as error:
    pins_file = paths.project_dir / "generation_pins.json"
    pins_audit = {
      "total": 0,
      "valid": 0,
      "stale": 0,
      "repair_applied": False,
      "repaired_count": 0,
      "issues": [],
      "error": str(error),
    }
    issues.append(
      _issue(
        code="generation_pins_invalid",
        severity="error",
        message=str(error),
        recovery="Reset generation pins file to an empty object.",
      )
    )
    recovery_actions.append("Reset `.openauthor/generation_pins.json` to `{}`.")
    if repair:
      pins_file.write_text("{}\n", encoding="utf-8")
      pins_audit["repair_applied"] = True
      pins_audit["repair_note"] = "Reset invalid generation pins file."
      repair_applied = True
  else:
    if pins_audit.get("stale", 0) > 0:
      issues.append(
        _issue(
          code="generation_pins_stale",
          severity="warning",
          message=f"{pins_audit['stale']} generation pin(s) reference missing or mismatched data.",
          recovery="Clear stale pins and re-pin preferred runs.",
        )
      )
      recovery_actions.append("Run `openauthor generation unpin --scene <scene-id> --json`.")
    if pins_audit.get("repair_applied"):
      repair_applied = True

  deduped_actions: list[str] = []
  seen_actions: set[str] = set()
  for action in recovery_actions:
    normalized = action.strip()
    if normalized and normalized not in seen_actions:
      deduped_actions.append(normalized)
      seen_actions.add(normalized)

  return {
    "checked_at": utc_now(),
    "repair_requested": repair,
    "repair_applied": repair_applied,
    "branch": branch_status,
    "retrieval": retrieval_status,
    "generation_pins": pins_audit,
    "issues": issues,
    "recovery_actions": deduped_actions,
    "ok": len(issues) == 0,
  }


def format_workspace_audit_text(report: dict[str, Any]) -> str:
  lines = [
    "Workspace Audit",
    f"ok={report.get('ok')}",
    f"repair_requested={report.get('repair_requested')}",
    f"repair_applied={report.get('repair_applied')}",
  ]
  branch = report.get("branch", {})
  lines.append(
    "branch\t"
    f"current={branch.get('current_branch','')}\t"
    f"detached={branch.get('detached_head')}\t"
    f"drift={branch.get('drift_detected')}"
  )
  retrieval = report.get("retrieval", {})
  lines.append(
    "retrieval\t"
    f"present={retrieval.get('present')}\t"
    f"stale={retrieval.get('stale')}"
  )
  pins = report.get("generation_pins", {})
  lines.append(
    "pins\t"
    f"total={pins.get('total')}\t"
    f"valid={pins.get('valid')}\t"
    f"stale={pins.get('stale')}\t"
    f"repaired={pins.get('repaired_count')}"
  )
  issues = report.get("issues", [])
  if not issues:
    lines.append("No drift issues detected.")
  else:
    for issue in issues:
      lines.append(
        f"{issue.get('severity','info')}\t{issue.get('code','')}\t{issue.get('message','')}"
      )
  for action in report.get("recovery_actions", []):
    lines.append(f"recovery\t{action}")
  return "\n".join(lines)


def format_performance_baseline_text(report: dict[str, Any]) -> str:
  lines = [
    "Performance Baseline",
    f"repeat={report.get('repeat')}",
  ]
  counts = report.get("counts", {})
  lines.append(
    "counts\t"
    f"scenes={counts.get('scenes', 0)}\t"
    f"proposals={counts.get('proposals', 0)}\t"
    f"generation_runs={counts.get('generation_runs', 0)}"
  )
  for metric in report.get("metrics", []):
    lines.append(
      f"{metric.get('name','metric')}\t"
      f"min_ms={metric.get('min_ms')}\t"
      f"avg_ms={metric.get('avg_ms')}\t"
      f"max_ms={metric.get('max_ms')}"
    )
  retrieval = report.get("retrieval", {})
  if isinstance(retrieval, dict):
    lines.append(
      "retrieval\t"
      f"present={retrieval.get('present')}\t"
      f"stale={retrieval.get('stale')}\t"
      f"chunks={retrieval.get('chunk_count', 0)}"
    )
  return "\n".join(lines)


def format_json(payload: dict[str, Any]) -> str:
  return json.dumps(payload)
