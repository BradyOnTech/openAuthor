from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .ai import get_provider_runtime_config
from .project import OpenAuthorError, ProjectPaths

STATUSES = {"succeeded", "failed"}
QUALITY_TIERS = {"high", "medium", "low"}


def _generation_file(paths: ProjectPaths, run_id: str) -> Path:
  return paths.generations_dir / f"{run_id}.json"


def _read_generation(log_file: Path) -> dict[str, Any]:
  try:
    payload = json.loads(log_file.read_text(encoding="utf-8"))
  except json.JSONDecodeError as error:
    raise OpenAuthorError(f"Invalid generation log JSON: {log_file}") from error
  if "run_id" not in payload:
    payload["run_id"] = log_file.stem
  return payload


def _summary(payload: dict[str, Any], *, log_file: Path, paths: ProjectPaths) -> dict[str, Any]:
  usage = payload.get("usage", {}) if isinstance(payload.get("usage"), dict) else {}
  error = payload.get("error", {}) if isinstance(payload.get("error"), dict) else {}
  normalization = (
    payload.get("normalization", {})
    if isinstance(payload.get("normalization"), dict)
    else {}
  )
  quality = payload.get("quality", {}) if isinstance(payload.get("quality"), dict) else {}

  return {
    "run_id": payload.get("run_id", log_file.stem),
    "status": payload.get("status", "unknown"),
    "created_at": payload.get("created_at", ""),
    "scene_id": payload.get("scene_id", ""),
    "provider": payload.get("provider", ""),
    "model": payload.get("model", ""),
    "proposal_id": payload.get("proposal_id", ""),
    "input_tokens": usage.get("input_tokens"),
    "output_tokens": usage.get("output_tokens"),
    "latency_ms": usage.get("latency_ms"),
    "provider_attempts": usage.get("provider_attempts", error.get("attempts")),
    "estimated_cost_usd": usage.get("estimated_cost_usd"),
    "error_category": error.get("category", ""),
    "error_retriable": error.get("retriable"),
    "normalization_changed": normalization.get("normalization_changed"),
    "missing_sections_filled": normalization.get("missing_sections_filled", []),
    "quality_score": quality.get("score"),
    "quality_tier": quality.get("tier"),
    "quality_flags": quality.get("flags", []),
    "log_path": str(log_file.relative_to(paths.root)),
  }


def get_generation_run(paths: ProjectPaths, run_id: str) -> dict[str, Any]:
  log_file = _generation_file(paths, run_id)
  if not log_file.exists():
    raise OpenAuthorError(f"Unknown generation run id '{run_id}'.")
  payload = _read_generation(log_file)
  payload["log_path"] = str(log_file.relative_to(paths.root))
  return payload


def list_generation_runs(
  paths: ProjectPaths,
  *,
  status: str | None = None,
  scene_id: str | None = None,
  provider: str | None = None,
  quality_tier: str | None = None,
  limit: int | None = None,
) -> list[dict[str, Any]]:
  if status is not None and status not in STATUSES:
    allowed = ", ".join(sorted(STATUSES))
    raise OpenAuthorError(f"Invalid generation status '{status}'. Allowed: {allowed}.")
  if quality_tier is not None and quality_tier not in QUALITY_TIERS:
    allowed = ", ".join(sorted(QUALITY_TIERS))
    raise OpenAuthorError(
      f"Invalid quality tier '{quality_tier}'. Allowed: {allowed}."
    )
  if limit is not None and limit < 1:
    raise OpenAuthorError("limit must be >= 1.")

  rows: list[dict[str, Any]] = []
  for log_file in sorted(paths.generations_dir.glob("gen-*.json")):
    payload = _read_generation(log_file)
    if status is not None and payload.get("status") != status:
      continue
    if scene_id is not None and payload.get("scene_id") != scene_id:
      continue
    if provider is not None and payload.get("provider") != provider:
      continue
    summary = _summary(payload, log_file=log_file, paths=paths)
    if quality_tier is not None and summary.get("quality_tier") != quality_tier:
      continue
    rows.append(summary)

  rows.sort(key=lambda row: row.get("created_at", ""), reverse=True)
  if limit is not None:
    return rows[:limit]
  return rows


def get_generation_runtime_config(paths: ProjectPaths) -> dict[str, Any]:
  del paths
  return get_provider_runtime_config()
