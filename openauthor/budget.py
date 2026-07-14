from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from .project import OpenAuthorError, ProjectPaths, atomic_write_json

DEFAULT_GENERATION_BUDGET_POLICY: dict[str, Any] = {
  "schema_version": 1,
  "enforcement": "fail_closed",
  "per_run": {
    "max_input_tokens": None,
    "max_output_tokens": None,
    "max_total_tokens": None,
    "max_estimated_cost_usd": None,
  },
  "rolling": {
    "daily_tokens": None,
    "daily_estimated_cost_usd": None,
    "weekly_tokens": None,
    "weekly_estimated_cost_usd": None,
  },
}


class BudgetPolicyError(OpenAuthorError):
  def __init__(
    self,
    message: str,
    *,
    violations: list[dict[str, Any]],
    policy: dict[str, Any],
    usage: dict[str, Any],
    projected: dict[str, Any],
  ) -> None:
    super().__init__(message)
    self.category = "budget_policy_violation"
    self.violations = violations
    self.policy = policy
    self.usage = usage
    self.projected = projected


def _policy_file(paths: ProjectPaths) -> Path:
  return paths.budget_policy_file


def _as_positive_int_or_none(value: Any) -> int | None:
  if value is None:
    return None
  if isinstance(value, bool):
    raise OpenAuthorError("Budget values cannot be boolean.")
  if isinstance(value, int):
    if value < 1:
      raise OpenAuthorError("Budget token limits must be >= 1.")
    return value
  if isinstance(value, float):
    normalized = int(value)
    if normalized < 1:
      raise OpenAuthorError("Budget token limits must be >= 1.")
    return normalized
  if isinstance(value, str):
    text = value.strip()
    if text == "":
      return None
    try:
      normalized = int(text)
    except ValueError as error:
      raise OpenAuthorError(f"Invalid integer budget value '{value}'.") from error
    if normalized < 1:
      raise OpenAuthorError("Budget token limits must be >= 1.")
    return normalized
  raise OpenAuthorError(f"Invalid token budget value type '{type(value).__name__}'.")


def _as_positive_float_or_none(value: Any) -> float | None:
  if value is None:
    return None
  if isinstance(value, bool):
    raise OpenAuthorError("Budget values cannot be boolean.")
  if isinstance(value, (int, float)):
    normalized = float(value)
  elif isinstance(value, str):
    text = value.strip()
    if text == "":
      return None
    try:
      normalized = float(text)
    except ValueError as error:
      raise OpenAuthorError(f"Invalid decimal budget value '{value}'.") from error
  else:
    raise OpenAuthorError(f"Invalid cost budget value type '{type(value).__name__}'.")
  if normalized <= 0:
    raise OpenAuthorError("Budget cost limits must be > 0.")
  return round(normalized, 8)


def _normalize_policy(raw: dict[str, Any] | None) -> dict[str, Any]:
  payload = raw if isinstance(raw, dict) else {}
  per_run = payload.get("per_run", {})
  rolling = payload.get("rolling", {})
  if not isinstance(per_run, dict):
    per_run = {}
  if not isinstance(rolling, dict):
    rolling = {}
  return {
    "schema_version": 1,
    "enforcement": "fail_closed",
    "per_run": {
      "max_input_tokens": _as_positive_int_or_none(per_run.get("max_input_tokens")),
      "max_output_tokens": _as_positive_int_or_none(per_run.get("max_output_tokens")),
      "max_total_tokens": _as_positive_int_or_none(per_run.get("max_total_tokens")),
      "max_estimated_cost_usd": _as_positive_float_or_none(
        per_run.get("max_estimated_cost_usd")
      ),
    },
    "rolling": {
      "daily_tokens": _as_positive_int_or_none(rolling.get("daily_tokens")),
      "daily_estimated_cost_usd": _as_positive_float_or_none(
        rolling.get("daily_estimated_cost_usd")
      ),
      "weekly_tokens": _as_positive_int_or_none(rolling.get("weekly_tokens")),
      "weekly_estimated_cost_usd": _as_positive_float_or_none(
        rolling.get("weekly_estimated_cost_usd")
      ),
    },
  }


def default_generation_budget_policy() -> dict[str, Any]:
  return _normalize_policy(DEFAULT_GENERATION_BUDGET_POLICY)


def load_generation_budget_policy(paths: ProjectPaths) -> dict[str, Any]:
  file_path = _policy_file(paths)
  if not file_path.exists():
    return default_generation_budget_policy()
  try:
    payload = json.loads(file_path.read_text(encoding="utf-8"))
  except json.JSONDecodeError as error:
    raise OpenAuthorError(f"Invalid generation budget policy JSON: {file_path}") from error
  return _normalize_policy(payload)


def save_generation_budget_policy(paths: ProjectPaths, policy: dict[str, Any]) -> dict[str, Any]:
  normalized = _normalize_policy(policy)
  file_path = _policy_file(paths)
  atomic_write_json(file_path, normalized)
  return normalized


def reset_generation_budget_policy(paths: ProjectPaths) -> dict[str, Any]:
  return save_generation_budget_policy(paths, default_generation_budget_policy())


def update_generation_budget_policy(
  paths: ProjectPaths,
  *,
  max_input_tokens: int | None = None,
  max_output_tokens: int | None = None,
  max_total_tokens: int | None = None,
  max_estimated_cost_usd: float | None = None,
  daily_tokens: int | None = None,
  daily_estimated_cost_usd: float | None = None,
  weekly_tokens: int | None = None,
  weekly_estimated_cost_usd: float | None = None,
) -> dict[str, Any]:
  policy = load_generation_budget_policy(paths)
  has_updates = any(
    value is not None
    for value in (
      max_input_tokens,
      max_output_tokens,
      max_total_tokens,
      max_estimated_cost_usd,
      daily_tokens,
      daily_estimated_cost_usd,
      weekly_tokens,
      weekly_estimated_cost_usd,
    )
  )
  if not has_updates:
    raise OpenAuthorError("No budget updates provided.")

  if max_input_tokens is not None:
    policy["per_run"]["max_input_tokens"] = _as_positive_int_or_none(max_input_tokens)
  if max_output_tokens is not None:
    policy["per_run"]["max_output_tokens"] = _as_positive_int_or_none(max_output_tokens)
  if max_total_tokens is not None:
    policy["per_run"]["max_total_tokens"] = _as_positive_int_or_none(max_total_tokens)
  if max_estimated_cost_usd is not None:
    policy["per_run"]["max_estimated_cost_usd"] = _as_positive_float_or_none(
      max_estimated_cost_usd
    )
  if daily_tokens is not None:
    policy["rolling"]["daily_tokens"] = _as_positive_int_or_none(daily_tokens)
  if daily_estimated_cost_usd is not None:
    policy["rolling"]["daily_estimated_cost_usd"] = _as_positive_float_or_none(
      daily_estimated_cost_usd
    )
  if weekly_tokens is not None:
    policy["rolling"]["weekly_tokens"] = _as_positive_int_or_none(weekly_tokens)
  if weekly_estimated_cost_usd is not None:
    policy["rolling"]["weekly_estimated_cost_usd"] = _as_positive_float_or_none(
      weekly_estimated_cost_usd
    )

  return save_generation_budget_policy(paths, policy)


def _as_nonnegative_int(value: Any) -> int:
  if isinstance(value, bool):
    return 0
  if isinstance(value, int):
    return max(0, value)
  if isinstance(value, float):
    return max(0, int(value))
  if isinstance(value, str):
    text = value.strip()
    if text == "":
      return 0
    try:
      return max(0, int(text))
    except ValueError:
      return 0
  return 0


def _as_nonnegative_float_or_none(value: Any) -> float | None:
  if value is None or isinstance(value, bool):
    return None
  if isinstance(value, (int, float)):
    normalized = float(value)
  elif isinstance(value, str):
    text = value.strip()
    if text == "":
      return None
    try:
      normalized = float(text)
    except ValueError:
      return None
  else:
    return None
  if normalized < 0:
    return None
  return round(normalized, 8)


def _parse_timestamp(value: Any) -> datetime | None:
  if not isinstance(value, str):
    return None
  text = value.strip()
  if text == "":
    return None
  normalized = text.replace("Z", "+00:00")
  try:
    parsed = datetime.fromisoformat(normalized)
  except ValueError:
    return None
  if parsed.tzinfo is None:
    parsed = parsed.replace(tzinfo=UTC)
  return parsed.astimezone(UTC)


def _usage_rows(paths: ProjectPaths) -> list[dict[str, Any]]:
  rows: list[dict[str, Any]] = []
  for log_file in sorted(paths.generations_dir.glob("gen-*.json")):
    try:
      payload = json.loads(log_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
      continue
    if payload.get("status") != "succeeded":
      continue
    usage = payload.get("usage", {})
    if not isinstance(usage, dict):
      usage = {}
    input_tokens = _as_nonnegative_int(usage.get("input_tokens"))
    output_tokens = _as_nonnegative_int(usage.get("output_tokens"))
    total_tokens = input_tokens + output_tokens
    estimated_cost_usd = _as_nonnegative_float_or_none(usage.get("estimated_cost_usd"))
    rows.append(
      {
        "created_at": _parse_timestamp(payload.get("created_at")),
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
        "estimated_cost_usd": estimated_cost_usd,
      }
    )
  return rows


def _summarize_window(
  rows: list[dict[str, Any]],
  *,
  since: datetime | None = None,
) -> dict[str, Any]:
  input_tokens = 0
  output_tokens = 0
  total_tokens = 0
  estimated_cost_usd = 0.0
  unknown_cost_runs = 0
  runs = 0
  for row in rows:
    created = row.get("created_at")
    if since is not None:
      if not isinstance(created, datetime) or created < since:
        continue
    runs += 1
    input_tokens += int(row.get("input_tokens", 0) or 0)
    output_tokens += int(row.get("output_tokens", 0) or 0)
    total_tokens += int(row.get("total_tokens", 0) or 0)
    cost = row.get("estimated_cost_usd")
    if isinstance(cost, (int, float)):
      estimated_cost_usd += float(cost)
    else:
      unknown_cost_runs += 1
  return {
    "runs": runs,
    "input_tokens": input_tokens,
    "output_tokens": output_tokens,
    "total_tokens": total_tokens,
    "estimated_cost_usd": round(estimated_cost_usd, 8),
    "unknown_cost_runs": unknown_cost_runs,
  }


def summarize_generation_usage(
  paths: ProjectPaths,
  *,
  now: datetime | None = None,
) -> dict[str, Any]:
  current = now or datetime.now(UTC)
  if current.tzinfo is None:
    current = current.replace(tzinfo=UTC)
  else:
    current = current.astimezone(UTC)

  rows = _usage_rows(paths)
  daily_since = current - timedelta(days=1)
  weekly_since = current - timedelta(days=7)
  return {
    "as_of": current.isoformat(),
    "daily": {
      "window_hours": 24,
      "since": daily_since.isoformat(),
      **_summarize_window(rows, since=daily_since),
    },
    "weekly": {
      "window_days": 7,
      "since": weekly_since.isoformat(),
      **_summarize_window(rows, since=weekly_since),
    },
    "lifetime": _summarize_window(rows, since=None),
  }


def _violation(
  *,
  code: str,
  message: str,
  limit: float | int,
  observed: float | int,
  projected: float | int,
) -> dict[str, Any]:
  return {
    "code": code,
    "message": message,
    "limit": limit,
    "observed": observed,
    "projected": projected,
  }


def evaluate_generation_budget(
  policy: dict[str, Any],
  usage: dict[str, Any],
  *,
  projected_input_tokens: int,
  projected_output_tokens: int,
  projected_estimated_cost_usd: float | None,
) -> list[dict[str, Any]]:
  violations: list[dict[str, Any]] = []
  projected_total_tokens = projected_input_tokens + projected_output_tokens
  per_run = policy.get("per_run", {})
  rolling = policy.get("rolling", {})

  max_input = per_run.get("max_input_tokens")
  if isinstance(max_input, int) and projected_input_tokens > max_input:
    violations.append(
      _violation(
        code="per_run_input_tokens_exceeded",
        message="Projected input tokens exceed per-run max_input_tokens.",
        limit=max_input,
        observed=projected_input_tokens,
        projected=projected_input_tokens,
      )
    )

  max_output = per_run.get("max_output_tokens")
  if isinstance(max_output, int) and projected_output_tokens > max_output:
    violations.append(
      _violation(
        code="per_run_output_tokens_exceeded",
        message="Projected output tokens exceed per-run max_output_tokens.",
        limit=max_output,
        observed=projected_output_tokens,
        projected=projected_output_tokens,
      )
    )

  max_total = per_run.get("max_total_tokens")
  if isinstance(max_total, int) and projected_total_tokens > max_total:
    violations.append(
      _violation(
        code="per_run_total_tokens_exceeded",
        message="Projected total tokens exceed per-run max_total_tokens.",
        limit=max_total,
        observed=projected_total_tokens,
        projected=projected_total_tokens,
      )
    )

  max_cost = per_run.get("max_estimated_cost_usd")
  if isinstance(max_cost, (int, float)):
    if projected_estimated_cost_usd is None:
      violations.append(
        _violation(
          code="per_run_estimated_cost_unknown",
          message=(
            "Per-run cost cap is set but projected estimated cost is unknown "
            "(missing pricing for provider/model)."
          ),
          limit=float(max_cost),
          observed=-1.0,
          projected=-1.0,
        )
      )
    elif projected_estimated_cost_usd > float(max_cost):
      violations.append(
        _violation(
          code="per_run_estimated_cost_exceeded",
          message="Projected estimated cost exceeds per-run max_estimated_cost_usd.",
          limit=float(max_cost),
          observed=projected_estimated_cost_usd,
          projected=projected_estimated_cost_usd,
        )
      )

  daily = usage.get("daily", {})
  weekly = usage.get("weekly", {})

  daily_tokens = rolling.get("daily_tokens")
  if isinstance(daily_tokens, int):
    combined = int(daily.get("total_tokens", 0) or 0) + projected_total_tokens
    if combined > daily_tokens:
      violations.append(
        _violation(
          code="daily_tokens_exceeded",
          message="Projected run exceeds rolling daily token budget.",
          limit=daily_tokens,
          observed=int(daily.get("total_tokens", 0) or 0),
          projected=combined,
        )
      )

  weekly_tokens = rolling.get("weekly_tokens")
  if isinstance(weekly_tokens, int):
    combined = int(weekly.get("total_tokens", 0) or 0) + projected_total_tokens
    if combined > weekly_tokens:
      violations.append(
        _violation(
          code="weekly_tokens_exceeded",
          message="Projected run exceeds rolling weekly token budget.",
          limit=weekly_tokens,
          observed=int(weekly.get("total_tokens", 0) or 0),
          projected=combined,
        )
      )

  daily_cost = rolling.get("daily_estimated_cost_usd")
  if isinstance(daily_cost, (int, float)):
    if projected_estimated_cost_usd is None:
      violations.append(
        _violation(
          code="daily_estimated_cost_unknown",
          message=(
            "Daily cost cap is set but projected estimated cost is unknown "
            "(missing pricing for provider/model)."
          ),
          limit=float(daily_cost),
          observed=-1.0,
          projected=-1.0,
        )
      )
    elif int(daily.get("unknown_cost_runs", 0) or 0) > 0:
      violations.append(
        _violation(
          code="daily_estimated_cost_window_unknown",
          message=(
            "Daily cost cap cannot be evaluated because existing daily runs have "
            "unknown estimated cost."
          ),
          limit=float(daily_cost),
          observed=float(daily.get("estimated_cost_usd", 0.0) or 0.0),
          projected=float(daily.get("estimated_cost_usd", 0.0) or 0.0)
          + projected_estimated_cost_usd,
        )
      )
    else:
      combined = float(daily.get("estimated_cost_usd", 0.0) or 0.0) + projected_estimated_cost_usd
      if combined > float(daily_cost):
        violations.append(
          _violation(
            code="daily_estimated_cost_exceeded",
            message="Projected run exceeds rolling daily estimated cost budget.",
            limit=float(daily_cost),
            observed=float(daily.get("estimated_cost_usd", 0.0) or 0.0),
            projected=combined,
          )
        )

  weekly_cost = rolling.get("weekly_estimated_cost_usd")
  if isinstance(weekly_cost, (int, float)):
    if projected_estimated_cost_usd is None:
      violations.append(
        _violation(
          code="weekly_estimated_cost_unknown",
          message=(
            "Weekly cost cap is set but projected estimated cost is unknown "
            "(missing pricing for provider/model)."
          ),
          limit=float(weekly_cost),
          observed=-1.0,
          projected=-1.0,
        )
      )
    elif int(weekly.get("unknown_cost_runs", 0) or 0) > 0:
      violations.append(
        _violation(
          code="weekly_estimated_cost_window_unknown",
          message=(
            "Weekly cost cap cannot be evaluated because existing weekly runs have "
            "unknown estimated cost."
          ),
          limit=float(weekly_cost),
          observed=float(weekly.get("estimated_cost_usd", 0.0) or 0.0),
          projected=float(weekly.get("estimated_cost_usd", 0.0) or 0.0)
          + projected_estimated_cost_usd,
        )
      )
    else:
      combined = float(weekly.get("estimated_cost_usd", 0.0) or 0.0) + projected_estimated_cost_usd
      if combined > float(weekly_cost):
        violations.append(
          _violation(
            code="weekly_estimated_cost_exceeded",
            message="Projected run exceeds rolling weekly estimated cost budget.",
            limit=float(weekly_cost),
            observed=float(weekly.get("estimated_cost_usd", 0.0) or 0.0),
            projected=combined,
          )
        )

  return violations


def enforce_generation_budget(
  paths: ProjectPaths,
  *,
  projected_input_tokens: int,
  projected_output_tokens: int,
  projected_estimated_cost_usd: float | None,
) -> dict[str, Any]:
  policy = load_generation_budget_policy(paths)
  usage = summarize_generation_usage(paths)
  violations = evaluate_generation_budget(
    policy,
    usage,
    projected_input_tokens=projected_input_tokens,
    projected_output_tokens=projected_output_tokens,
    projected_estimated_cost_usd=projected_estimated_cost_usd,
  )
  if violations:
    first = violations[0]
    projected = {
      "input_tokens": projected_input_tokens,
      "output_tokens": projected_output_tokens,
      "total_tokens": projected_input_tokens + projected_output_tokens,
      "estimated_cost_usd": projected_estimated_cost_usd,
    }
    raise BudgetPolicyError(
      f"{first['message']} Run `openauthor generation budget` to inspect policy and usage.",
      violations=violations,
      policy=policy,
      usage=usage,
      projected=projected,
    )
  return {
    "policy": policy,
    "usage": usage,
    "projected": {
      "input_tokens": projected_input_tokens,
      "output_tokens": projected_output_tokens,
      "total_tokens": projected_input_tokens + projected_output_tokens,
      "estimated_cost_usd": projected_estimated_cost_usd,
    },
  }


def get_generation_budget_report(paths: ProjectPaths) -> dict[str, Any]:
  return {
    "policy": load_generation_budget_policy(paths),
    "usage": summarize_generation_usage(paths),
  }
