from __future__ import annotations

import json
import time
from statistics import mean
from typing import Any, Callable

from .generations import audit_generation_pins, list_generation_runs
from .git_ops import get_branch_workspace_status
from .project import OpenAuthorError, ProjectPaths, utc_now
from .proposals import list_proposals
from .retrieval import get_retrieval_index_status
from .scenes import list_scenes


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

  return {
    "checked_at": utc_now(),
    "repeat": repeat,
    "counts": {
      "scenes": len(scene_rows),
      "proposals": len(proposal_rows),
      "generation_runs": len(run_rows),
    },
    "metrics": [
      _metric_row("scene_list", scene_samples),
      _metric_row("proposal_list", proposal_samples),
      _metric_row("generation_list", run_samples),
      _metric_row("retrieval_status", retrieval_samples),
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
