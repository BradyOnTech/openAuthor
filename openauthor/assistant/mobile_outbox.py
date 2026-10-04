"""Desktop import boundary for already decrypted mobile outbox items.

Encryption, transport authentication, and envelope decryption deliberately live
outside this module.  This boundary validates the authenticated identity it is
given and persists review-safe project artifacts with durable idempotency.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterator, Mapping

from ..project import (
  OpenAuthorError,
  ProjectPaths,
  atomic_write_json,
  ensure_project_identity,
  utc_now,
)
from ..proposals import get_proposal
from ..revisions import get_revision, revision_head
from ..scenes import get_scene
from ..story_memory import list_memory_suggestions, queue_memory_suggestion

try:
  import fcntl
except ImportError:  # pragma: no cover - POSIX CI exercises the primary path
  fcntl = None  # type: ignore[assignment]


MOBILE_OUTBOX_SCHEMA_VERSION = 1
_IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_DIGEST_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")
_FALLBACK_LOCK = threading.Lock()
_SUPPORTED_KINDS = {
  "capture_note",
  "change_set_request",
  "dictated_passage",
  "review_decision",
  "story_memory_suggestion",
  "thread_turn",
}
_WRITE_LIKE_KINDS = {
  "change_set_request",
  "dictated_passage",
  "review_decision",
  "story_memory_suggestion",
}


class MobileOutboxIdempotencyConflict(OpenAuthorError):
  category = "idempotency_conflict"


@dataclass(frozen=True)
class MobileOutboxEnvelope:
  project_id: str
  device_id: str
  operation_id: str
  base_revision: str
  payload_digest: str


@dataclass(frozen=True)
class MobileOutboxImportResult:
  schema_version: int
  project_id: str
  device_id: str
  operation_id: str
  kind: str
  payload_digest: str
  base_revision: str
  imported_revision: str
  stale: bool
  disposition: str
  artifact_kind: str
  artifact_id: str
  imported_at: str

  @classmethod
  def from_dict(cls, payload: Mapping[str, Any]) -> "MobileOutboxImportResult":
    return cls(
      schema_version=int(payload.get("schema_version", 0)),
      project_id=str(payload.get("project_id", "")),
      device_id=str(payload.get("device_id", "")),
      operation_id=str(payload.get("operation_id", "")),
      kind=str(payload.get("kind", "")),
      payload_digest=str(payload.get("payload_digest", "")),
      base_revision=str(payload.get("base_revision", "")),
      imported_revision=str(payload.get("imported_revision", "")),
      stale=bool(payload.get("stale", False)),
      disposition=str(payload.get("disposition", "")),
      artifact_kind=str(payload.get("artifact_kind", "")),
      artifact_id=str(payload.get("artifact_id", "")),
      imported_at=str(payload.get("imported_at", "")),
    )

  def to_dict(self) -> dict[str, Any]:
    return asdict(self)


def _canonical_bytes(payload: Mapping[str, Any]) -> bytes:
  try:
    return json.dumps(
      payload,
      ensure_ascii=False,
      sort_keys=True,
      separators=(",", ":"),
    ).encode("utf-8")
  except (TypeError, ValueError) as error:
    raise OpenAuthorError("Mobile outbox payload must be JSON-compatible.") from error


def mobile_outbox_payload_digest(payload: Mapping[str, Any]) -> str:
  """Return the canonical digest authenticated by the transport envelope."""

  return "sha256:" + hashlib.sha256(_canonical_bytes(payload)).hexdigest()


def _store_root(paths: ProjectPaths) -> Path:
  return paths.workspace_dir / "mobile-outbox"


def _operation_key(envelope: MobileOutboxEnvelope) -> str:
  identity = "\0".join((envelope.project_id, envelope.device_id, envelope.operation_id))
  return hashlib.sha256(identity.encode("utf-8")).hexdigest()


@contextmanager
def _import_lock(paths: ProjectPaths) -> Iterator[None]:
  lock_path = _store_root(paths) / "locks" / "import.lock"
  lock_path.parent.mkdir(parents=True, exist_ok=True)
  if fcntl is not None:
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
      fcntl.flock(descriptor, fcntl.LOCK_EX)
      yield
    finally:
      fcntl.flock(descriptor, fcntl.LOCK_UN)
      os.close(descriptor)
    return
  with _FALLBACK_LOCK:  # pragma: no cover - POSIX CI uses fcntl
    yield


def _validated_identity(
  paths: ProjectPaths,
  envelope: MobileOutboxEnvelope,
  payload: Mapping[str, Any],
) -> str:
  for label, value in (
    ("project_id", envelope.project_id),
    ("device_id", envelope.device_id),
    ("operation_id", envelope.operation_id),
  ):
    if (
      not isinstance(value, str)
      or value != value.strip()
      or not _IDENTIFIER_PATTERN.fullmatch(value)
    ):
      raise OpenAuthorError(f"Mobile outbox {label} is invalid.")
  ensure_project_identity(paths, expected_project_id=envelope.project_id)
  for label, expected in (
    ("project_id", envelope.project_id),
    ("device_id", envelope.device_id),
    ("operation_id", envelope.operation_id),
    ("base_revision", envelope.base_revision),
  ):
    if label in payload and str(payload[label]).strip() != expected.strip():
      raise OpenAuthorError(f"Mobile outbox payload {label} conflicts with its envelope.")
  if (
    not isinstance(envelope.payload_digest, str)
    or not _DIGEST_PATTERN.fullmatch(envelope.payload_digest)
  ):
    raise OpenAuthorError("Mobile outbox payload digest is invalid.")
  actual_digest = mobile_outbox_payload_digest(payload)
  if actual_digest != envelope.payload_digest:
    raise OpenAuthorError("Mobile outbox payload digest does not match the payload.")
  if not isinstance(envelope.base_revision, str):
    raise OpenAuthorError("Mobile outbox base revision is invalid.")
  base_revision = envelope.base_revision.strip()
  if base_revision == "" or base_revision != envelope.base_revision:
    raise OpenAuthorError("Mobile outbox base revision is required.")
  get_revision(paths, base_revision)
  return base_revision


def _read_journal(path: Path) -> dict[str, Any]:
  try:
    payload = json.loads(path.read_text(encoding="utf-8"))
  except (OSError, json.JSONDecodeError) as error:
    raise OpenAuthorError("Mobile outbox import journal is unreadable.") from error
  if (
    not isinstance(payload, dict)
    or payload.get("schema_version") != MOBILE_OUTBOX_SCHEMA_VERSION
    or payload.get("status") not in {"accepted", "completed"}
  ):
    raise OpenAuthorError("Mobile outbox import journal is invalid.")
  return payload


def _journal_matches(
  journal: Mapping[str, Any],
  *,
  envelope: MobileOutboxEnvelope,
  base_revision: str,
  kind: str,
) -> bool:
  return all((
    journal.get("project_id") == envelope.project_id,
    journal.get("device_id") == envelope.device_id,
    journal.get("operation_id") == envelope.operation_id,
    journal.get("base_revision") == base_revision,
    journal.get("payload_digest") == envelope.payload_digest,
    journal.get("kind") == kind,
  ))


def _scene_digest(scene: Mapping[str, Any]) -> str:
  content = {
    "id": scene.get("id", ""),
    "title": scene.get("title", ""),
    "summary": scene.get("summary", ""),
    "pov": scene.get("pov", ""),
    "status": scene.get("status", ""),
    "body": scene.get("body", ""),
  }
  return hashlib.sha256(_canonical_bytes(content)).hexdigest()


def _import_proposal(
  paths: ProjectPaths,
  *,
  envelope: MobileOutboxEnvelope,
  payload: Mapping[str, Any],
  operation_key: str,
  base_revision: str,
  current_revision: str,
  imported_at: str,
) -> str:
  kind = str(payload["kind"])
  title = str(payload.get("title", "")).strip()
  if title == "":
    raise OpenAuthorError(f"Mobile {kind.replace('_', ' ')} title is required.")
  scene_id = str(payload.get("scene_id", "")).strip()
  scene = get_scene(paths, scene_id) if scene_id else None
  if kind == "dictated_passage":
    proposed_body = str(payload.get("content", "")).strip()
    if proposed_body == "":
      raise OpenAuthorError("Mobile dictated passage content is required.")
    instruction = str(payload.get("instruction", "")).strip()
    if instruction == "":
      instruction = "Review this dictated mobile passage before applying it."
  else:
    proposed_body = str(payload.get("proposed_body", ""))
    instruction = str(payload.get("instruction", "")).strip()
    if instruction == "":
      raise OpenAuthorError("Mobile change set request instruction is required.")

  proposal_id = f"proposal-mobile-{operation_key[:24]}"
  proposal_path = paths.proposals_dir / f"{proposal_id}.json"
  stale = base_revision != current_revision
  provenance = {
    "schema_version": MOBILE_OUTBOX_SCHEMA_VERSION,
    "project_id": envelope.project_id,
    "device_id": envelope.device_id,
    "operation_id": envelope.operation_id,
    "base_revision": base_revision,
    "imported_revision": current_revision,
    "payload_digest": envelope.payload_digest,
    "conflict": stale,
    "conflict_reason": "base_revision_is_stale" if stale else "",
  }
  if proposal_path.exists():
    try:
      proposal = json.loads(proposal_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
      raise OpenAuthorError("Imported mobile proposal is unreadable.") from error
    if (
      not isinstance(proposal, dict)
      or proposal.get("id") != proposal_id
      or proposal.get("mobile_outbox") != provenance
    ):
      raise MobileOutboxIdempotencyConflict(
        "Mobile proposal conflicts with its outbox operation."
      )
    return proposal_id

  scene_digest = _scene_digest(scene) if scene is not None else ""
  if stale and scene is not None:
    scene_digest = f"mobile-base-revision:{base_revision}"
  constraints = payload.get("constraints", [])
  protected = payload.get("protected_elements", [])
  proposal = {
    "id": proposal_id,
    "title": title,
    "instruction": instruction,
    "scene_id": scene_id,
    "scene_digest": scene_digest,
    "vcs_branch": "",
    "vcs_base_commit": "",
    "status": "pending",
    "created_at": imported_at,
    "updated_at": imported_at,
    "notes": "",
    "source": "mobile_outbox",
    "proposed_body": proposed_body,
    "revision_intent": {
      "goal": instruction,
      "constraints": [str(item) for item in constraints] if isinstance(constraints, list) else [],
      "protected_elements": [str(item) for item in protected] if isinstance(protected, list) else [],
      "scope": "scene" if scene_id else "project",
    },
    "change_group_id": str(payload.get("change_group_id", "")).strip(),
    "generation": {
      "source": "mobile_outbox",
      "operation_key": operation_key,
      "project_id": envelope.project_id,
      "device_id": envelope.device_id,
      "operation_id": envelope.operation_id,
      "base_revision": base_revision,
      "imported_revision": current_revision,
      "payload_digest": envelope.payload_digest,
    },
    "mobile_outbox": provenance,
  }
  atomic_write_json(proposal_path, proposal)
  return proposal_id


def _import_story_memory_suggestion(
  paths: ProjectPaths,
  *,
  envelope: MobileOutboxEnvelope,
  payload: Mapping[str, Any],
  operation_key: str,
  base_revision: str,
  current_revision: str,
) -> str:
  title = str(payload.get("title", "")).strip()
  content = str(payload.get("content", "")).strip()
  if content == "":
    raise OpenAuthorError("Mobile Story Memory suggestion content is required.")
  suggestion = queue_memory_suggestion(
    paths,
    title=title,
    content=content,
    scene_id=str(payload.get("scene_id", "")).strip(),
    source=f"mobile_outbox:{operation_key}",
  )
  suggestion_id = str(suggestion["id"])
  store_path = paths.root / "codex" / "suggestions.json"
  try:
    store = json.loads(store_path.read_text(encoding="utf-8"))
  except (OSError, json.JSONDecodeError) as error:
    raise OpenAuthorError("Story Memory suggestions are unreadable.") from error
  rows = store.get("suggestions", []) if isinstance(store, dict) else []
  persisted = next(
    (row for row in rows if isinstance(row, dict) and row.get("id") == suggestion_id),
    None,
  )
  if persisted is None:
    raise OpenAuthorError("Imported Story Memory suggestion was not persisted.")
  stale = base_revision != current_revision
  persisted["mobile_outbox"] = {
    "schema_version": MOBILE_OUTBOX_SCHEMA_VERSION,
    "project_id": envelope.project_id,
    "device_id": envelope.device_id,
    "operation_id": envelope.operation_id,
    "base_revision": base_revision,
    "imported_revision": current_revision,
    "payload_digest": envelope.payload_digest,
    "conflict": stale,
    "conflict_reason": "base_revision_is_stale" if stale else "",
  }
  atomic_write_json(store_path, store)
  return suggestion_id


def _import_review_decision(
  paths: ProjectPaths,
  *,
  envelope: MobileOutboxEnvelope,
  payload: Mapping[str, Any],
  operation_key: str,
  base_revision: str,
  current_revision: str,
  imported_at: str,
) -> str:
  target_kind = str(payload.get("target_kind", "")).strip()
  target_id = str(payload.get("target_id", "")).strip()
  decision = str(payload.get("decision", "")).strip()
  if target_kind == "proposal":
    get_proposal(paths, target_id)
  elif target_kind == "story_memory_suggestion":
    if not any(row.get("id") == target_id for row in list_memory_suggestions(paths)):
      raise OpenAuthorError(f"Unknown Story Memory suggestion '{target_id}'.")
  else:
    raise OpenAuthorError("Mobile review decision target kind is unsupported.")
  if decision not in {"accepted", "rejected", "deferred"}:
    raise OpenAuthorError(
      "Mobile review decision must be accepted, rejected, or deferred."
    )

  artifact_id = f"mobile-review-{operation_key[:24]}"
  artifact_path = _store_root(paths) / "review-decisions" / f"{artifact_id}.json"
  if not artifact_path.exists():
    stale = base_revision != current_revision
    atomic_write_json(artifact_path, {
      "schema_version": MOBILE_OUTBOX_SCHEMA_VERSION,
      "id": artifact_id,
      "project_id": envelope.project_id,
      "device_id": envelope.device_id,
      "operation_id": envelope.operation_id,
      "base_revision": base_revision,
      "imported_revision": current_revision,
      "payload_digest": envelope.payload_digest,
      "kind": "review_decision",
      "status": "conflict" if stale else "pending_desktop_review",
      "stale": stale,
      "payload": dict(payload),
      "created_at": imported_at,
    })
  return artifact_id


def import_mobile_outbox_item(
  paths: ProjectPaths,
  *,
  envelope: MobileOutboxEnvelope,
  payload: Mapping[str, Any],
) -> MobileOutboxImportResult:
  """Import one authenticated plaintext item without mutating manuscript prose."""

  base_revision = _validated_identity(paths, envelope, payload)
  kind = str(payload.get("kind", "")).strip()
  if kind not in _SUPPORTED_KINDS:
    raise OpenAuthorError(f"Unsupported mobile outbox kind '{kind}'.")
  title = str(payload.get("title", "")).strip()
  if kind in {"capture_note", "thread_turn"}:
    content = str(payload.get("content", "")).strip()
    if content == "":
      raise OpenAuthorError(f"Mobile {kind.replace('_', ' ')} content is required.")
  if kind == "thread_turn":
    for label in ("thread_id", "turn_id"):
      if not _IDENTIFIER_PATTERN.fullmatch(str(payload.get(label, "")).strip()):
        raise OpenAuthorError(f"Mobile thread turn {label} is invalid.")
    if str(payload.get("role", "")).strip() not in {"user", "assistant"}:
      raise OpenAuthorError("Mobile thread turn role must be user or assistant.")

  operation_key = _operation_key(envelope)
  root = _store_root(paths)
  journal_path = root / "imports" / f"{operation_key}.json"
  with _import_lock(paths):
    if journal_path.exists():
      journal = _read_journal(journal_path)
      if not _journal_matches(
        journal,
        envelope=envelope,
        base_revision=base_revision,
        kind=kind,
      ):
        raise MobileOutboxIdempotencyConflict(
          "Mobile outbox operation conflicts with an existing import."
        )
      if journal["status"] == "completed":
        result_payload = journal.get("result")
        if not isinstance(result_payload, dict):
          raise OpenAuthorError("Completed mobile outbox journal has no result.")
        result = MobileOutboxImportResult.from_dict(result_payload)
        if result.schema_version != MOBILE_OUTBOX_SCHEMA_VERSION:
          raise OpenAuthorError("Mobile outbox result version is unsupported.")
        return result
    else:
      current_revision = revision_head(paths)
      if current_revision == "":
        raise OpenAuthorError("Mobile outbox import requires a current project revision.")
      journal = {
        "schema_version": MOBILE_OUTBOX_SCHEMA_VERSION,
        "status": "accepted",
        "project_id": envelope.project_id,
        "device_id": envelope.device_id,
        "operation_id": envelope.operation_id,
        "base_revision": base_revision,
        "payload_digest": envelope.payload_digest,
        "kind": kind,
        "imported_revision": current_revision,
        "accepted_at": utc_now(),
        "result": None,
      }
      atomic_write_json(journal_path, journal)

    current_revision = str(journal.get("imported_revision", "")).strip()
    imported_at = str(journal.get("accepted_at", "")).strip()
    if current_revision == "" or imported_at == "":
      raise OpenAuthorError("Mobile outbox import journal is missing its revision anchor.")
    if kind in {"capture_note", "thread_turn"}:
      artifact_id = f"mobile-inbox-{operation_key[:24]}"
      artifact_path = root / "inbox" / f"{artifact_id}.json"
      if not artifact_path.exists():
        atomic_write_json(artifact_path, {
          "schema_version": MOBILE_OUTBOX_SCHEMA_VERSION,
          "id": artifact_id,
          "project_id": envelope.project_id,
          "device_id": envelope.device_id,
          "operation_id": envelope.operation_id,
          "base_revision": base_revision,
          "imported_revision": current_revision,
          "payload_digest": envelope.payload_digest,
          "kind": kind,
          "title": title,
          "payload": dict(payload),
          "created_at": imported_at,
        })
      artifact_kind = "mobile_inbox_item"
    elif kind in {"dictated_passage", "change_set_request"}:
      artifact_id = _import_proposal(
        paths,
        envelope=envelope,
        payload=payload,
        operation_key=operation_key,
        base_revision=base_revision,
        current_revision=current_revision,
        imported_at=imported_at,
      )
      artifact_kind = "proposal"
    elif kind == "story_memory_suggestion":
      artifact_id = _import_story_memory_suggestion(
        paths,
        envelope=envelope,
        payload=payload,
        operation_key=operation_key,
        base_revision=base_revision,
        current_revision=current_revision,
      )
      artifact_kind = "story_memory_suggestion"
    else:
      artifact_id = _import_review_decision(
        paths,
        envelope=envelope,
        payload=payload,
        operation_key=operation_key,
        base_revision=base_revision,
        current_revision=current_revision,
        imported_at=imported_at,
      )
      artifact_kind = "mobile_review_decision"
    stale = base_revision != current_revision
    if kind in _WRITE_LIKE_KINDS:
      disposition = "conflict" if stale else "pending_review"
    else:
      disposition = "imported"
    result = MobileOutboxImportResult(
      schema_version=MOBILE_OUTBOX_SCHEMA_VERSION,
      project_id=envelope.project_id,
      device_id=envelope.device_id,
      operation_id=envelope.operation_id,
      kind=kind,
      payload_digest=envelope.payload_digest,
      base_revision=base_revision,
      imported_revision=current_revision,
      stale=stale,
      disposition=disposition,
      artifact_kind=artifact_kind,
      artifact_id=artifact_id,
      imported_at=imported_at,
    )
    journal["status"] = "completed"
    journal["completed_at"] = utc_now()
    journal["result"] = result.to_dict()
    atomic_write_json(journal_path, journal)
    return result


def list_mobile_inbox_items(paths: ProjectPaths) -> list[dict[str, Any]]:
  """List immutable capture/turn inbox items in import order."""

  rows: list[dict[str, Any]] = []
  for path in sorted((_store_root(paths) / "inbox").glob("*.json")):
    try:
      payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
      raise OpenAuthorError("Mobile inbox is unreadable.") from error
    if not isinstance(payload, dict) or payload.get("schema_version") != 1:
      raise OpenAuthorError("Mobile inbox contains an invalid item.")
    rows.append(payload)
  return sorted(rows, key=lambda row: (str(row.get("created_at", "")), str(row["id"])))


def list_mobile_review_decisions(paths: ProjectPaths) -> list[dict[str, Any]]:
  """List immutable mobile decisions awaiting authoritative desktop review."""

  rows: list[dict[str, Any]] = []
  for path in sorted((_store_root(paths) / "review-decisions").glob("*.json")):
    try:
      payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
      raise OpenAuthorError("Mobile review decision store is unreadable.") from error
    if not isinstance(payload, dict) or payload.get("schema_version") != 1:
      raise OpenAuthorError("Mobile review decision store contains an invalid item.")
    rows.append(payload)
  return sorted(rows, key=lambda row: (str(row.get("created_at", "")), str(row["id"])))
