"""Bounded author constraints and literal checks, without semantic certification."""
from __future__ import annotations

import hashlib
import json
from typing import Any

from .project import OpenAuthorError

PRESERVATION_KINDS = {"fact", "knowledge", "uncertainty", "protected_text", "end_beat"}
PRESERVATION_FIELDS = {"preservation", "preservation_schema_version", "preservation_fingerprint"}


def validate_preservation(value: Any, *, source: str) -> list[dict[str, str]]:
  if not isinstance(value, list) or len(value) > 12:
    raise OpenAuthorError("Preservation must contain at most 12 author constraints.")
  result = []
  for row in value:
    if (not isinstance(row, dict) or set(row) != {"kind", "text"}
        or not isinstance(row["kind"], str) or row["kind"] not in PRESERVATION_KINDS
        or not isinstance(row["text"], str) or not row["text"].strip() or len(row["text"]) > 400):
      raise OpenAuthorError("Each preservation constraint needs a valid kind and nonempty text of at most 400 characters.")
    if row["kind"] == "protected_text" and row["text"] not in source:
      raise OpenAuthorError("Protected wording must occur exactly in the selected original passage.")
    # Exact authored wording is part of the contract, including whitespace.
    result.append({"kind": row["kind"], "text": row["text"]})
  if sum(len(row["text"]) for row in result) > 3000:
    raise OpenAuthorError("Preservation constraints must total at most 3,000 characters.")
  return result


def preservation_fingerprint(record: dict[str, Any], clauses: list[dict[str, str]]) -> str:
  bound = {key: record[key] for key in ("scene_id", "scene_version", "source_text", "instruction")}
  bound.update({"preservation_schema_version": 1, "preservation": clauses})
  return hashlib.sha256(json.dumps(bound, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()


def check_expected_preservation(record: dict[str, Any], expected: Any) -> None:
  if (not isinstance(expected, str) or len(expected) != 64
      or any(char not in "0123456789abcdef" for char in expected)
      or expected != record.get("preservation_fingerprint")):
    raise OpenAuthorError("The reviewed preservation contract changed or is unavailable. Reopen the original preview before continuing.")


def missing_protected_wording(clauses: list[dict[str, str]], candidate: str) -> list[str]:
  return [row["text"] for row in clauses if row["kind"] == "protected_text" and row["text"] not in candidate]
