from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .ai import SUPPORTED_PROVIDERS, generate_proposal, get_provider_runtime_config
from .budget import get_generation_budget_report
from .project import OpenAuthorError, ProjectPaths, atomic_write_json
from .scenes import list_scenes

STATUSES = {"succeeded", "failed"}
QUALITY_TIERS = {"high", "medium", "low"}


def _generation_file(paths: ProjectPaths, run_id: str) -> Path:
  return paths.generations_dir / f"{run_id}.json"


def _pins_file(paths: ProjectPaths) -> Path:
  return paths.project_dir / "generation_pins.json"


def _read_pins(paths: ProjectPaths) -> dict[str, str]:
  pins_file = _pins_file(paths)
  if not pins_file.exists():
    return {}
  try:
    payload = json.loads(pins_file.read_text(encoding="utf-8"))
  except json.JSONDecodeError as error:
    raise OpenAuthorError(f"Invalid generation pins JSON: {pins_file}") from error
  if not isinstance(payload, dict):
    raise OpenAuthorError(f"Invalid generation pins shape: {pins_file}")
  rows: dict[str, str] = {}
  for scene_id, run_id in payload.items():
    if isinstance(scene_id, str) and isinstance(run_id, str):
      normalized_scene = scene_id.strip()
      normalized_run = run_id.strip()
      if normalized_scene and normalized_run:
        rows[normalized_scene] = normalized_run
  return rows


def _write_pins(paths: ProjectPaths, pins: dict[str, str]) -> None:
  pins_file = _pins_file(paths)
  payload = {
    scene_id: run_id
    for scene_id, run_id in sorted(pins.items())
    if scene_id.strip() and run_id.strip()
  }
  atomic_write_json(pins_file, payload)


def _read_generation(log_file: Path) -> dict[str, Any]:
  try:
    payload = json.loads(log_file.read_text(encoding="utf-8"))
  except json.JSONDecodeError as error:
    raise OpenAuthorError(f"Invalid generation log JSON: {log_file}") from error
  if "run_id" not in payload:
    payload["run_id"] = log_file.stem
  return payload


def _summary(
  payload: dict[str, Any],
  *,
  log_file: Path,
  paths: ProjectPaths,
  pins: dict[str, str] | None = None,
) -> dict[str, Any]:
  usage = payload.get("usage", {}) if isinstance(payload.get("usage"), dict) else {}
  error = payload.get("error", {}) if isinstance(payload.get("error"), dict) else {}
  normalization = (
    payload.get("normalization", {})
    if isinstance(payload.get("normalization"), dict)
    else {}
  )
  quality = payload.get("quality", {}) if isinstance(payload.get("quality"), dict) else {}
  retrieval = (
    payload.get("retrieval", {})
    if isinstance(payload.get("retrieval"), dict)
    else {}
  )
  scene_id = payload.get("scene_id", "")
  run_id = payload.get("run_id", log_file.stem)
  preferred_for_scene = (
    isinstance(scene_id, str)
    and scene_id.strip() != ""
    and isinstance(run_id, str)
    and (pins or {}).get(scene_id.strip()) == run_id
  )

  return {
    "run_id": run_id,
    "kind": payload.get("kind", "proposal"),
    "status": payload.get("status", "unknown"),
    "created_at": payload.get("created_at", ""),
    "scene_id": scene_id,
    "thread_id": payload.get("thread_id", ""),
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
    "retrieval_mode": retrieval.get("mode", "off"),
    "retrieval_used": retrieval.get("used", False),
    "retrieval_result_count": retrieval.get("result_count", 0),
    "preferred_for_scene": preferred_for_scene,
    "log_path": str(log_file.relative_to(paths.root)),
  }


def get_generation_run(paths: ProjectPaths, run_id: str) -> dict[str, Any]:
  log_file = _generation_file(paths, run_id)
  if not log_file.exists():
    raise OpenAuthorError(f"Unknown generation run id '{run_id}'.")
  payload = _read_generation(log_file)
  scene_id = payload.get("scene_id")
  pins = _read_pins(paths)
  payload["preferred_for_scene"] = (
    isinstance(scene_id, str)
    and scene_id.strip() != ""
    and pins.get(scene_id.strip()) == payload.get("run_id", log_file.stem)
  )
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

  pins = _read_pins(paths)
  rows: list[dict[str, Any]] = []
  for log_file in sorted(paths.generations_dir.glob("gen-*.json")):
    payload = _read_generation(log_file)
    if status is not None and payload.get("status") != status:
      continue
    if scene_id is not None and payload.get("scene_id") != scene_id:
      continue
    if provider is not None and payload.get("provider") != provider:
      continue
    summary = _summary(payload, log_file=log_file, paths=paths, pins=pins)
    if quality_tier is not None and summary.get("quality_tier") != quality_tier:
      continue
    rows.append(summary)

  rows.sort(key=lambda row: row.get("created_at", ""), reverse=True)
  if limit is not None:
    return rows[:limit]
  return rows


def get_generation_runtime_config(paths: ProjectPaths) -> dict[str, Any]:
  runtime = get_provider_runtime_config()
  runtime["budget"] = get_generation_budget_report(paths)
  return runtime


def list_pinned_generation_runs(
  paths: ProjectPaths,
  *,
  scene_id: str | None = None,
) -> list[dict[str, str]]:
  pins = _read_pins(paths)
  if scene_id is not None:
    normalized = scene_id.strip()
    if normalized == "":
      raise OpenAuthorError("scene_id cannot be empty.")
    run_id = pins.get(normalized)
    if run_id is None:
      return []
    return [{"scene_id": normalized, "run_id": run_id}]
  return [
    {"scene_id": row_scene_id, "run_id": row_run_id}
    for row_scene_id, row_run_id in sorted(pins.items())
  ]


def set_pinned_generation_run(
  paths: ProjectPaths,
  *,
  scene_id: str,
  run_id: str,
) -> dict[str, str]:
  normalized_scene = scene_id.strip()
  normalized_run = run_id.strip()
  if normalized_scene == "":
    raise OpenAuthorError("scene_id cannot be empty.")
  if normalized_run == "":
    raise OpenAuthorError("run_id cannot be empty.")
  run_payload = get_generation_run(paths, normalized_run)
  run_scene_id = str(run_payload.get("scene_id", "")).strip()
  if run_scene_id != normalized_scene:
    raise OpenAuthorError(
      f"Run '{normalized_run}' belongs to scene '{run_scene_id}', "
      f"not '{normalized_scene}'."
    )
  pins = _read_pins(paths)
  pins[normalized_scene] = normalized_run
  _write_pins(paths, pins)
  return {"scene_id": normalized_scene, "run_id": normalized_run}


def clear_pinned_generation_run(
  paths: ProjectPaths,
  *,
  scene_id: str,
) -> dict[str, Any]:
  normalized_scene = scene_id.strip()
  if normalized_scene == "":
    raise OpenAuthorError("scene_id cannot be empty.")
  pins = _read_pins(paths)
  removed = pins.pop(normalized_scene, None)
  _write_pins(paths, pins)
  return {
    "scene_id": normalized_scene,
    "run_id": removed or "",
    "cleared": removed is not None,
  }


def audit_generation_pins(
  paths: ProjectPaths,
  *,
  repair: bool = False,
) -> dict[str, Any]:
  pins = _read_pins(paths)
  known_scene_ids = {
    str(row.get("id", "")).strip()
    for row in list_scenes(paths)
    if str(row.get("id", "")).strip()
  }
  issues: list[dict[str, str]] = []
  valid_pins: dict[str, str] = {}

  for scene_id, run_id in sorted(pins.items()):
    issue_code = ""
    issue_detail = ""
    if scene_id not in known_scene_ids:
      issue_code = "scene_missing"
      issue_detail = f"Scene '{scene_id}' does not exist."
    else:
      generation_log = _generation_file(paths, run_id)
      if not generation_log.exists():
        issue_code = "run_missing"
        issue_detail = f"Run '{run_id}' does not exist."
      else:
        run_payload = _read_generation(generation_log)
        run_scene_id = str(run_payload.get("scene_id", "")).strip()
        if run_scene_id != scene_id:
          issue_code = "run_scene_mismatch"
          issue_detail = (
            f"Run '{run_id}' belongs to '{run_scene_id or 'unknown'}', not '{scene_id}'."
          )

    if issue_code:
      issues.append(
        {
          "scene_id": scene_id,
          "run_id": run_id,
          "code": issue_code,
          "detail": issue_detail,
        }
      )
    else:
      valid_pins[scene_id] = run_id

  repaired_count = 0
  if repair and issues:
    _write_pins(paths, valid_pins)
    repaired_count = len(issues)

  return {
    "total": len(pins),
    "valid": len(valid_pins),
    "stale": len(issues),
    "repair_applied": repaired_count > 0,
    "repaired_count": repaired_count,
    "issues": issues,
  }


def _coerce_float(value: Any, *, default: float) -> float:
  if isinstance(value, (int, float)):
    return float(value)
  if isinstance(value, str):
    try:
      return float(value.strip())
    except ValueError:
      return default
  return default


def _coerce_int(value: Any, *, default: int, minimum: int) -> int:
  if isinstance(value, bool):
    return default
  if isinstance(value, int):
    return max(minimum, value)
  if isinstance(value, float):
    return max(minimum, int(value))
  if isinstance(value, str):
    try:
      return max(minimum, int(value.strip()))
    except ValueError:
      return default
  return default


def _coerce_bool(value: Any, *, default: bool) -> bool:
  if isinstance(value, bool):
    return value
  if isinstance(value, str):
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
      return True
    if normalized in {"0", "false", "no", "off"}:
      return False
  return default


def rerun_generation(
  paths: ProjectPaths,
  *,
  run_id: str,
  title: str = "",
  provider: str | None = None,
  model: str | None = None,
  temperature: float | None = None,
  max_output_tokens: int | None = None,
  context_scene_radius: int | None = None,
  codex_limit: int | None = None,
  retrieval_mode: str | None = None,
  retrieval_limit: int | None = None,
  retrieval_min_score: float | None = None,
  retrieval_require_fresh: bool | None = None,
) -> dict[str, Any]:
  payload = get_generation_run(paths, run_id)
  scene_id = str(payload.get("scene_id", "")).strip()
  instruction = str(payload.get("instruction", "")).strip()
  if scene_id == "":
    raise OpenAuthorError(f"Generation run '{run_id}' is missing scene_id.")
  if instruction == "":
    raise OpenAuthorError(f"Generation run '{run_id}' is missing instruction.")

  selected_provider = provider or str(payload.get("provider", "")).strip()
  if selected_provider not in SUPPORTED_PROVIDERS:
    allowed = ", ".join(sorted(SUPPORTED_PROVIDERS))
    raise OpenAuthorError(
      f"Invalid provider '{selected_provider}' for rerun. Allowed: {allowed}."
    )

  selected_model = model
  if selected_model is None:
    model_from_log = payload.get("model")
    if isinstance(model_from_log, str) and model_from_log.strip() != "":
      selected_model = model_from_log.strip()

  selected_temperature = (
    temperature
    if temperature is not None
    else _coerce_float(payload.get("temperature"), default=0.2)
  )
  selected_max_output_tokens = (
    max_output_tokens
    if max_output_tokens is not None
    else _coerce_int(payload.get("max_output_tokens"), default=700, minimum=64)
  )
  selected_context_scene_radius = (
    context_scene_radius
    if context_scene_radius is not None
    else _coerce_int(payload.get("context_scene_radius"), default=1, minimum=0)
  )
  selected_codex_limit = (
    codex_limit
    if codex_limit is not None
    else _coerce_int(payload.get("codex_limit"), default=20, minimum=1)
  )
  retrieval_payload = (
    payload.get("retrieval", {})
    if isinstance(payload.get("retrieval"), dict)
    else {}
  )
  selected_retrieval_mode = (
    retrieval_mode
    if retrieval_mode is not None
    else str(retrieval_payload.get("mode", "off"))
  )
  selected_retrieval_limit = (
    retrieval_limit
    if retrieval_limit is not None
    else _coerce_int(retrieval_payload.get("limit"), default=5, minimum=1)
  )
  selected_retrieval_min_score = (
    retrieval_min_score
    if retrieval_min_score is not None
    else _coerce_float(retrieval_payload.get("min_score"), default=0.0)
  )
  selected_retrieval_require_fresh = (
    retrieval_require_fresh
    if retrieval_require_fresh is not None
    else _coerce_bool(retrieval_payload.get("require_fresh"), default=False)
  )

  return generate_proposal(
    paths,
    scene_id=scene_id,
    instruction=instruction,
    title=title,
    provider=selected_provider,
    model=selected_model,
    temperature=selected_temperature,
    max_output_tokens=selected_max_output_tokens,
    context_scene_radius=selected_context_scene_radius,
    codex_limit=selected_codex_limit,
    retrieval_mode=selected_retrieval_mode,
    retrieval_limit=selected_retrieval_limit,
    retrieval_min_score=selected_retrieval_min_score,
    retrieval_require_fresh=selected_retrieval_require_fresh,
  )
