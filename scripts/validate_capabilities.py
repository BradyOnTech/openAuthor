#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = ROOT / "docs" / "capabilities.json"
VISIBLE_COMPONENT_ROOT = ROOT / "desktop" / "src" / "components"

ALLOWED = {
  "core": {"implemented", "partial", "not_started"},
  "active_ui": {"implemented", "partial", "hidden", "not_applicable"},
  "end_to_end": {"verified", "missing"},
  "release": {"ready", "not_ready"},
}
UNSHIPPED_COPY = re.compile(
  r"\b(will be ported|coming soon|not yet implemented|hardcoded demo|mock data|stubbed|every step is undoable)\b",
  re.IGNORECASE,
)


def _load_registry(path: Path = REGISTRY_PATH) -> dict[str, Any]:
  try:
    payload = json.loads(path.read_text(encoding="utf-8"))
  except FileNotFoundError as error:
    raise ValueError(f"Capability registry is missing: {path}") from error
  except json.JSONDecodeError as error:
    raise ValueError(f"Capability registry is invalid JSON: {error}") from error
  if not isinstance(payload, dict):
    raise ValueError("Capability registry root must be an object.")
  return payload


def validate_registry(payload: dict[str, Any]) -> list[str]:
  errors: list[str] = []
  if payload.get("schema_version") != 1:
    errors.append("schema_version must be 1")

  capabilities = payload.get("capabilities")
  if not isinstance(capabilities, list) or not capabilities:
    return [*errors, "capabilities must be a non-empty list"]

  seen_ids: set[str] = set()
  for index, capability in enumerate(capabilities):
    label = f"capabilities[{index}]"
    if not isinstance(capability, dict):
      errors.append(f"{label} must be an object")
      continue
    capability_id = capability.get("id")
    if not isinstance(capability_id, str) or not re.fullmatch(r"[a-z][a-z0-9_]*", capability_id):
      errors.append(f"{label}.id must be stable snake_case")
      capability_id = label
    elif capability_id in seen_ids:
      errors.append(f"duplicate capability id: {capability_id}")
    else:
      seen_ids.add(capability_id)

    for field, allowed_values in ALLOWED.items():
      value = capability.get(field)
      if value not in allowed_values:
        errors.append(f"{capability_id}.{field} must be one of {sorted(allowed_values)}")

    visible = capability.get("visible")
    if not isinstance(visible, bool):
      errors.append(f"{capability_id}.visible must be boolean")
    if visible and capability.get("active_ui") in {"hidden", "not_applicable"}:
      errors.append(f"{capability_id} is visible but active_ui is {capability.get('active_ui')}")
    if capability.get("active_ui") == "partial" and not capability.get("scope_note"):
      errors.append(f"{capability_id} has partial active UI without scope_note")
    if capability.get("end_to_end") == "verified":
      if capability.get("core") != "implemented":
        errors.append(f"{capability_id} is end-to-end verified without implemented core")
      if capability.get("active_ui") != "implemented":
        errors.append(f"{capability_id} is end-to-end verified without complete active UI")
    if capability.get("release") == "ready":
      if capability.get("core") != "implemented":
        errors.append(f"{capability_id} is release-ready without implemented core")
      if capability.get("active_ui") not in {"implemented", "not_applicable"}:
        errors.append(f"{capability_id} is release-ready without complete active UI")
      if capability.get("end_to_end") != "verified":
        errors.append(f"{capability_id} is release-ready without end-to-end verification")

    evidence = capability.get("evidence")
    if not isinstance(evidence, list) or not evidence:
      errors.append(f"{capability_id}.evidence must be a non-empty list")
    else:
      for relative in evidence:
        if not isinstance(relative, str) or not relative.strip():
          errors.append(f"{capability_id}.evidence contains an invalid path")
          continue
        if not (ROOT / relative).exists():
          errors.append(f"{capability_id}.evidence does not exist: {relative}")

  return errors


def find_unshipped_visible_copy() -> list[str]:
  findings: list[str] = []
  for path in sorted(VISIBLE_COMPONENT_ROOT.rglob("*.tsx")):
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
      if UNSHIPPED_COPY.search(line):
        findings.append(f"{path.relative_to(ROOT)}:{line_number}: {line.strip()}")
  return findings


def main() -> int:
  try:
    payload = _load_registry()
  except ValueError as error:
    print(f"Capability registry: FAILED\n- {error}", file=sys.stderr)
    return 1

  errors = validate_registry(payload)
  errors.extend(
    f"visible shell contains unshipped copy: {finding}"
    for finding in find_unshipped_visible_copy()
  )
  if errors:
    print("Capability registry: FAILED", file=sys.stderr)
    for error in errors:
      print(f"- {error}", file=sys.stderr)
    return 1

  capabilities = payload["capabilities"]
  visible = sum(1 for item in capabilities if item["visible"])
  verified = sum(1 for item in capabilities if item["end_to_end"] == "verified")
  ready = sum(1 for item in capabilities if item["release"] == "ready")
  print(
    "Capability registry: OK "
    f"({len(capabilities)} tracked, {visible} visible, {verified} e2e verified, {ready} release-ready)"
  )
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
