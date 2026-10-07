from __future__ import annotations

import difflib
import hashlib
import re
from typing import Any

from .project import OpenAuthorError, utc_now

CHANGE_SET_SCHEMA_VERSION = 1
HUNK_DECISIONS = {"accepted", "rejected"}


def _units(text: str, editable_scope: str = "") -> list[str]:
  if editable_scope == "quoted_text":
    from .quoted_editing import quoted_units
    return quoted_units(text)
  if not text:
    return []
  return [unit for unit in re.split(r"(?<=[.!?])(?=\s)|(?<=\n)(?=\S)", text) if unit]


def _hunk_kind(tag: str) -> str:
  return {"replace": "replace", "delete": "delete", "insert": "insert"}.get(tag, "replace")


def _preserve_terminal_newline(before_body: str, after_body: str) -> str:
  """Keep serializer-only final newlines out of the author's Change Set."""
  if before_body.endswith("\n") and after_body and not after_body.endswith("\n"):
    return f"{after_body}\n"
  if not before_body.endswith("\n") and after_body.endswith("\n"):
    return after_body.rstrip("\n")
  return after_body


def build_change_set(
  *,
  proposal_id: str,
  scene_id: str,
  intent: str,
  before_body: str,
  after_body: str,
  provenance: dict[str, Any] | None = None,
  constraints: list[str] | None = None,
  protected_elements: list[str] | None = None,
  editable_scope: str = "",
) -> dict[str, Any]:
  if editable_scope not in {"", "quoted_text"}:
    raise OpenAuthorError("Choose whole-scene or quoted-text editing for Change Hunks.")
  after_body = _preserve_terminal_newline(before_body, after_body)
  before_units = _units(before_body, editable_scope)
  after_units = _units(after_body, editable_scope)
  if editable_scope == "quoted_text":
    from .quoted_editing import QuotedRevision
    QuotedRevision(before_body).validate_result(after_body)
    # Passage positions are fixed. Sequence matching can align quoted sentences
    # with narration and create hunks that are unsafe to accept independently.
    opcodes = [("replace", index, index + 1, index, index + 1)
      for index in range(1, len(before_units), 2) if before_units[index] != after_units[index]]
  else:
    opcodes = difflib.SequenceMatcher(a=before_units, b=after_units, autojunk=False).get_opcodes()
  hunks: list[dict[str, Any]] = []
  for tag, before_start, before_end, after_start, after_end in opcodes:
    if tag == "equal":
      continue
    before_text = "".join(before_units[before_start:before_end])
    after_text = "".join(after_units[after_start:after_end])
    digest = hashlib.sha256(
      f"{before_start}:{before_end}:{after_start}:{after_end}:{before_text}:{after_text}".encode("utf-8")
    ).hexdigest()[:10]
    kind = _hunk_kind(tag)
    rationale = {
      "insert": "Adds prose in support of the revision intent.",
      "delete": "Removes prose in support of the revision intent.",
      "replace": "Rewrites this passage in support of the revision intent.",
    }[kind]
    hunks.append({
      "id": f"hunk-{len(hunks) + 1:03d}-{digest}",
      "order": len(hunks) + 1,
      "kind": kind,
      "before_start": before_start,
      "before_end": before_end,
      "after_start": after_start,
      "after_end": after_end,
      "before_text": before_text,
      "after_text": after_text,
      "decision": "accepted",
      "rationale": rationale,
    })

  risk = "low"
  if len(hunks) >= 5 or len(after_body) > max(1, len(before_body)) * 1.5:
    risk = "medium"
  if len(hunks) >= 12:
    risk = "high"
  exact_protection_violations = [
    value
    for value in (protected_elements or [])
    if value in before_body and value not in after_body
  ]
  if exact_protection_violations:
    risk = "high"
  warnings = [] if hunks else ["The generated draft contains no prose changes."]
  warnings.extend(
    f"Protected text changed or disappeared: {value}"
    for value in exact_protection_violations
  )
  return {
    "schema_version": CHANGE_SET_SCHEMA_VERSION,
    "id": f"change-set-{proposal_id.removeprefix('proposal-')}",
    "proposal_id": proposal_id,
    "scene_id": scene_id,
    "created_at": utc_now(),
    "intent": {
      "goal": intent.strip(),
      "scope": "scene",
      "constraints": constraints or [],
      "protected_elements": protected_elements or [],
      **({"editable_scope": editable_scope} if editable_scope else {}),
    },
    "base_body": before_body,
    "proposed_body": after_body,
    "hunks": hunks,
    "impact_report": {
      "risk": risk,
      "affected_scenes": [scene_id],
      "affected_story_memory": [],
      "warnings": warnings,
    },
    "provenance": provenance or {},
  }


def validate_change_set(change_set: dict[str, Any]) -> None:
  if change_set.get("schema_version") != CHANGE_SET_SCHEMA_VERSION:
    raise OpenAuthorError("Unsupported Change Set schema version.")
  hunks = change_set.get("hunks")
  if not isinstance(hunks, list):
    raise OpenAuthorError("Change Set hunks are invalid.")
  seen: set[str] = set()
  for hunk in hunks:
    identifier = str(hunk.get("id", ""))
    if not identifier or identifier in seen:
      raise OpenAuthorError("Change Set hunk ids must be unique and non-empty.")
    seen.add(identifier)
    if hunk.get("decision") not in HUNK_DECISIONS:
      raise OpenAuthorError(f"Change hunk '{identifier}' has an invalid decision.")


def set_hunk_decision(change_set: dict[str, Any], hunk_id: str, decision: str) -> dict[str, Any]:
  validate_change_set(change_set)
  if decision not in HUNK_DECISIONS:
    raise OpenAuthorError("Hunk decision must be 'accepted' or 'rejected'.")
  for hunk in change_set["hunks"]:
    if hunk["id"] == hunk_id:
      hunk["decision"] = decision
      return change_set
  raise OpenAuthorError(f"Unknown Change Hunk '{hunk_id}'.")


def edit_hunk_after_text(
  change_set: dict[str, Any],
  hunk_id: str,
  after_text: str,
  *,
  editor: str = "author",
  regeneration: dict[str, Any] | None = None,
) -> dict[str, Any]:
  validate_change_set(change_set)
  for hunk in change_set["hunks"]:
    if hunk["id"] == hunk_id:
      hunk["after_text"] = after_text
      hunk["decision"] = "accepted"
      hunk["edited_by"] = editor
      hunk["edited_at"] = utc_now()
      if regeneration is not None:
        hunk["regeneration"] = regeneration
      change_set["proposed_body"] = render_change_set(change_set)
      return change_set
  raise OpenAuthorError(f"Unknown Change Hunk '{hunk_id}'.")


def render_change_set(change_set: dict[str, Any]) -> str:
  validate_change_set(change_set)
  editable_scope = change_set.get("intent", {}).get("editable_scope", "")
  base_body = str(change_set.get("base_body", ""))
  before_units = _units(base_body, editable_scope)
  output: list[str] = []
  cursor = 0
  for hunk in sorted(change_set["hunks"], key=lambda row: int(row.get("order", 0))):
    start = int(hunk["before_start"])
    end = int(hunk["before_end"])
    if start < cursor or end < start or end > len(before_units):
      raise OpenAuthorError(f"Change hunk '{hunk['id']}' has invalid source bounds.")
    output.extend(before_units[cursor:start])
    if hunk["decision"] == "accepted":
      output.append(str(hunk.get("after_text", "")))
    else:
      output.extend(before_units[start:end])
    cursor = end
  output.extend(before_units[cursor:])
  result = "".join(output)
  if editable_scope == "quoted_text":
    from .quoted_editing import QuotedRevision
    QuotedRevision(base_body).validate_result(result)
  return result


def rebase_change_set(change_set: dict[str, Any], current_body: str) -> tuple[dict[str, Any], dict[str, Any]]:
  validate_change_set(change_set)
  candidate = current_body
  conflicts: list[dict[str, str]] = []
  carried: list[str] = []
  original_decisions = {
    (str(hunk.get("before_text", "")), str(hunk.get("after_text", ""))): hunk.get("decision", "accepted")
    for hunk in change_set["hunks"]
  }
  editable_scope = change_set.get("intent", {}).get("editable_scope", "")
  if editable_scope == "quoted_text":
    try:
      original_units = _units(str(change_set.get("base_body", "")), editable_scope)
      current_units = _units(current_body, editable_scope)
    except OpenAuthorError as error:
      return change_set, {"status": "conflicted", "carried_hunk_ids": [], "conflicts": [{
        "hunk_id": "", "reason": "quotation_boundaries_changed", "message": str(error)}]}
  for hunk in sorted(change_set["hunks"], key=lambda row: int(row.get("order", 0))):
    before_text = str(hunk.get("before_text", ""))
    after_text = str(hunk.get("after_text", ""))
    if editable_scope == "quoted_text":
      start, end = int(hunk["before_start"]), int(hunk["before_end"])
      if len(original_units) != len(current_units) or start % 2 != 1 or end != start + 1 or start >= len(current_units) or current_units[start] != before_text:
        conflicts.append({"hunk_id": hunk["id"], "reason": "source_passage_changed",
          "message": "The quoted passage or its position changed. Review a fresh quoted-text draft."})
      else:
        current_units[start] = after_text
        carried.append(hunk["id"])
      continue
    if not before_text:
      conflicts.append({
        "hunk_id": hunk["id"],
        "reason": "insert_anchor_changed",
        "message": "An insertion has no stable passage anchor and must be reviewed again.",
      })
      continue
    matches = candidate.count(before_text)
    if matches == 1:
      candidate = candidate.replace(before_text, after_text, 1)
      carried.append(hunk["id"])
    elif matches == 0 and after_text and candidate.count(after_text) == 1:
      conflicts.append({
        "hunk_id": hunk["id"],
        "reason": "candidate_already_present",
        "message": "The proposed passage already appears in the current scene; confirm manually.",
      })
    else:
      conflicts.append({
        "hunk_id": hunk["id"],
        "reason": "source_passage_changed" if matches == 0 else "source_passage_ambiguous",
        "message": "The original passage changed or is no longer unique in the current scene.",
      })

  report = {
    "status": "conflicted" if conflicts else "rebased",
    "carried_hunk_ids": carried,
    "conflicts": conflicts,
  }
  if conflicts:
    return change_set, report

  if editable_scope == "quoted_text":
    candidate = "".join(current_units)
  rebased = build_change_set(
    proposal_id=str(change_set.get("proposal_id", "")),
    scene_id=str(change_set.get("scene_id", "")),
    intent=str(change_set.get("intent", {}).get("goal", "")),
    before_body=current_body,
    after_body=candidate,
    provenance=dict(change_set.get("provenance", {})),
    constraints=[str(value) for value in change_set.get("intent", {}).get("constraints", [])],
    protected_elements=[str(value) for value in change_set.get("intent", {}).get("protected_elements", [])],
    editable_scope=editable_scope,
  )
  quote_decisions = {row["before_start"]: row["decision"] for row in change_set["hunks"]}
  for hunk in rebased["hunks"]:
    hunk["decision"] = quote_decisions.get(hunk["before_start"], "accepted") if editable_scope == "quoted_text" else original_decisions.get(
      (str(hunk.get("before_text", "")), str(hunk.get("after_text", ""))),
      "accepted",
    )
  rebased["rebased_from_created_at"] = change_set.get("created_at", "")
  rebased["rebase_report"] = report
  return rebased, report
