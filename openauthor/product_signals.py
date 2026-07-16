from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from typing import Any

from .project import OpenAuthorError, ProjectPaths, atomic_write_json, utc_now

SIGNAL_SETTINGS_SCHEMA_VERSION = 1
ALLOWED_EVENTS: dict[str, set[str]] = {
  "project_created": set(),
  "scene_created": {"word_count"},
  "manuscript_imported": {"format", "scene_count"},
  "manuscript_exported": {"format", "scene_count", "loss_count"},
  "change_hunk_decided": {"decision"},
  "change_hunk_commented": {"provider"},
  "change_set_applied": {"accepted_hunks", "total_hunks", "partial", "changed"},
  "change_set_rejected": set(),
  "change_set_undone": set(),
  "story_memory_suggestion_reviewed": {"disposition"},
  "storyline_created": set(),
  "assistant_turn_completed": {"scope", "provider", "promotable_artifacts"},
}
ALLOWED_SCALARS = (str, int, float, bool)


def _settings_path(paths: ProjectPaths) -> Path:
  return paths.project_dir / "product_signals.json"


def _events_path(paths: ProjectPaths) -> Path:
  return paths.project_dir / "product_events.jsonl"


def get_product_signal_settings(paths: ProjectPaths) -> dict[str, Any]:
  path = _settings_path(paths)
  if not path.exists():
    payload = {
      "schema_version": SIGNAL_SETTINGS_SCHEMA_VERSION,
      "local_signals_enabled": True,
      "external_telemetry_enabled": False,
      "retention_days": 365,
    }
    atomic_write_json(path, payload)
    return payload
  try:
    payload = json.loads(path.read_text(encoding="utf-8"))
  except (OSError, json.JSONDecodeError) as error:
    raise OpenAuthorError(f"Product signal settings are unreadable: {error}") from error
  if payload.get("schema_version") != SIGNAL_SETTINGS_SCHEMA_VERSION:
    raise OpenAuthorError("Unsupported product signal settings schema version.")
  payload.setdefault("local_signals_enabled", True)
  # There is deliberately no external transport in the product. Keep this
  # explicit so a local dashboard can never be confused with cloud telemetry.
  payload["external_telemetry_enabled"] = False
  payload.setdefault("retention_days", 365)
  return payload


def update_product_signal_settings(
  paths: ProjectPaths,
  *,
  local_signals_enabled: bool | None = None,
  retention_days: int | None = None,
) -> dict[str, Any]:
  payload = get_product_signal_settings(paths)
  if local_signals_enabled is not None:
    payload["local_signals_enabled"] = local_signals_enabled
  if retention_days is not None:
    if retention_days < 1 or retention_days > 3650:
      raise OpenAuthorError("Product signal retention must be between 1 and 3650 days.")
    payload["retention_days"] = retention_days
  payload["external_telemetry_enabled"] = False
  atomic_write_json(_settings_path(paths), payload)
  return payload


def _validated_properties(event: str, properties: dict[str, Any]) -> dict[str, Any]:
  if event not in ALLOWED_EVENTS:
    raise OpenAuthorError(f"Unknown content-free product event '{event}'.")
  unexpected = set(properties) - ALLOWED_EVENTS[event]
  if unexpected:
    raise OpenAuthorError(
      f"Product event '{event}' contains disallowed properties: {', '.join(sorted(unexpected))}."
    )
  for key, value in properties.items():
    if not isinstance(value, ALLOWED_SCALARS):
      raise OpenAuthorError(f"Product event property '{key}' must be a content-free scalar.")
    if isinstance(value, str) and len(value) > 80:
      raise OpenAuthorError(f"Product event property '{key}' exceeds the content-free value limit.")
  return properties


def record_product_event(paths: ProjectPaths, event: str, **properties: Any) -> bool:
  settings = get_product_signal_settings(paths)
  if not settings["local_signals_enabled"]:
    return False
  safe = _validated_properties(event, properties)
  row = {"timestamp": utc_now(), "event": event, "properties": safe}
  events_path = _events_path(paths)
  events_path.parent.mkdir(parents=True, exist_ok=True)
  with events_path.open("a", encoding="utf-8") as handle:
    handle.write(json.dumps(row, separators=(",", ":")) + "\n")
    handle.flush()
  return True


def _parse_timestamp(value: str) -> datetime | None:
  try:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
  except (ValueError, TypeError):
    return None


def list_product_events(paths: ProjectPaths) -> list[dict[str, Any]]:
  path = _events_path(paths)
  if not path.exists():
    return []
  cutoff = datetime.now(timezone.utc) - timedelta(
    days=int(get_product_signal_settings(paths)["retention_days"])
  )
  rows: list[dict[str, Any]] = []
  for line in path.read_text(encoding="utf-8").splitlines():
    try:
      row = json.loads(line)
    except json.JSONDecodeError:
      continue
    timestamp = _parse_timestamp(str(row.get("timestamp", "")))
    if (
      timestamp is None
      or timestamp < cutoff
      or row.get("event") not in ALLOWED_EVENTS
      or not isinstance(row.get("properties"), dict)
    ):
      continue
    try:
      _validated_properties(str(row["event"]), row["properties"])
    except OpenAuthorError:
      continue
    rows.append(row)
  return rows


def get_local_product_dashboard(paths: ProjectPaths) -> dict[str, Any]:
  settings = get_product_signal_settings(paths)
  rows = list_product_events(paths)
  counts = Counter(str(row["event"]) for row in rows)
  decisions = Counter(
    str(row["properties"].get("decision", ""))
    for row in rows
    if row["event"] == "change_hunk_decided"
  )
  memory = Counter(
    str(row["properties"].get("disposition", ""))
    for row in rows
    if row["event"] == "story_memory_suggestion_reviewed"
  )
  accepted = decisions["accepted"]
  rejected = decisions["rejected"]
  reviewed = accepted + rejected
  applied = counts["change_set_applied"]
  undone = counts["change_set_undone"]
  active_days = sorted({str(row["timestamp"])[:10] for row in rows})
  milestones = {
    "scene_created": counts["scene_created"] > 0 or counts["manuscript_imported"] > 0,
    "change_reviewed": reviewed > 0,
    "change_applied": applied > 0,
    "change_undone": undone > 0,
  }
  milestones["golden_loop_completed"] = all(milestones.values())
  return {
    "generated_at": utc_now(),
    "privacy": {
      "content_free": True,
      "local_only": True,
      "external_telemetry_enabled": False,
      "local_signals_enabled": settings["local_signals_enabled"],
      "retention_days": settings["retention_days"],
    },
    "event_count": len(rows),
    "active_days": len(active_days),
    "counts": dict(sorted(counts.items())),
    "activation": milestones,
    "trust": {
      "accepted_hunks": accepted,
      "rejected_hunks": rejected,
      "hunk_acceptance_rate": accepted / reviewed if reviewed else None,
      "applied_change_sets": applied,
      "undone_change_sets": undone,
      "undo_rate": undone / applied if applied else None,
      "memory_suggestions": dict(sorted(memory.items())),
    },
  }
