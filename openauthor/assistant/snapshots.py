"""Deterministic plaintext projections for encrypted mobile snapshots.

This module deliberately does not encrypt snapshot content. It produces a
canonical plaintext envelope that a platform encryption adapter can encrypt
without needing to understand openAuthor's project storage layout.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from ..codex import list_entities, list_relationships
from ..project import OpenAuthorError, ProjectPaths, ensure_project_identity
from ..project_locks import serialized_project_access
from ..revisions import revision_head
from ..planning import get_manuscript_reading
from ..review_context import build_review_context


MOBILE_SNAPSHOT_SCHEMA = "openauthor.mobile.snapshot"
MOBILE_SNAPSHOT_SCHEMA_VERSION = 1
MOBILE_SNAPSHOT_MANIFEST_SCHEMA = "openauthor.mobile.snapshot.manifest"
_REFERENCE_PATTERN = re.compile(r"^[a-z0-9._:-]+$")


def _canonical_bytes(payload: Mapping[str, Any]) -> bytes:
  return json.dumps(
    payload,
    ensure_ascii=False,
    sort_keys=True,
    separators=(",", ":"),
  ).encode("utf-8")


@dataclass(frozen=True)
class MobileSnapshotArtifact:
  snapshot: dict[str, Any]
  manifest: dict[str, Any]
  payload_bytes: bytes
  plaintext_bytes: bytes


@dataclass(frozen=True)
class MobileSnapshotPolicy:
  max_scenes: int = 2_000
  max_codex_entities: int = 5_000
  max_codex_relationships: int = 10_000
  max_evidence_items: int = 17_000
  max_reference_characters: int = 256
  max_canon_facts: int = 5_000

  def __post_init__(self) -> None:
    for name, value in (
      ("max_scenes", self.max_scenes),
      ("max_codex_entities", self.max_codex_entities),
      ("max_codex_relationships", self.max_codex_relationships),
      ("max_evidence_items", self.max_evidence_items),
      ("max_reference_characters", self.max_reference_characters),
      ("max_canon_facts", self.max_canon_facts),
    ):
      if value < 1:
        raise ValueError(f"{name} must be positive.")


def _evidence_item(
  *,
  kind: str,
  source_id: str,
  content: Mapping[str, Any],
  authority: int,
  policy: MobileSnapshotPolicy,
) -> dict[str, Any]:
  normalized_id = unicodedata.normalize("NFC", source_id.strip().lower())
  reference = f"{kind}:{normalized_id}"
  if (
    len(reference) > policy.max_reference_characters
    or _REFERENCE_PATTERN.fullmatch(reference) is None
  ):
    raise OpenAuthorError(f"Snapshot evidence reference is invalid: '{reference}'.")
  if authority < 0 or authority > 100:
    raise OpenAuthorError("Snapshot evidence authority must be between 0 and 100.")
  return {
    "kind": kind,
    "reference": reference,
    "content_digest": hashlib.sha256(_canonical_bytes(content)).hexdigest(),
    "authority": authority,
  }


def _require_count(name: str, values: list[Any], maximum: int) -> None:
  if len(values) > maximum:
    raise OpenAuthorError(
      f"Mobile snapshot {name} exceeds the configured bound of {maximum}."
    )


@serialized_project_access
def project_mobile_snapshot(
  paths: ProjectPaths,
  *,
  selected_project_id: str,
  policy: MobileSnapshotPolicy | None = None,
) -> MobileSnapshotArtifact:
  """Project one explicitly selected project into canonical mobile plaintext."""

  if selected_project_id.strip() == "":
    raise OpenAuthorError("Mobile snapshot projection requires a selected project id.")
  config = ensure_project_identity(
    paths,
    expected_project_id=selected_project_id,
  )
  project_id = str(config["project_id"])
  revision = revision_head(paths)
  if revision == "":
    raise OpenAuthorError(
      "Mobile snapshot projection requires a concrete project revision anchor."
    )
  active_policy = policy or MobileSnapshotPolicy()

  reading = get_manuscript_reading(paths)
  locations = {
    scene_id: {"chapter_title": section["title"], "act_title": section["act_title"]}
    for section in reading["sections"] for scene_id in section["scene_ids"]
  }
  scenes = []
  for scene in reading["scenes"]:
    scenes.append({
      "id": scene["id"],
      "title": scene["title"],
      "summary": scene["summary"],
      "pov": scene["pov"],
      "status": scene["status"],
      "created_at": scene["created_at"],
      "updated_at": scene["updated_at"],
      "body": scene["body"],
      **locations[scene["id"]],
    })

  entities = list_entities(paths)
  relationships = list_relationships(paths)
  _require_count("scenes", scenes, active_policy.max_scenes)
  _require_count("codex entities", entities, active_policy.max_codex_entities)
  _require_count(
    "codex relationships",
    relationships,
    active_policy.max_codex_relationships,
  )
  evidence = [
    _evidence_item(
      kind="scene",
      source_id=str(scene["id"]),
      content=scene,
      authority=100,
      policy=active_policy,
    )
    for scene in scenes
  ]
  evidence.extend(
    _evidence_item(
      kind="codex_entity",
      source_id=str(entity["id"]),
      content=entity,
      authority=90,
      policy=active_policy,
    )
    for entity in entities
  )
  evidence.extend(
    _evidence_item(
      kind="codex_relationship",
      source_id=str(relationship["id"]),
      content=relationship,
      authority=80,
      policy=active_policy,
    )
    for relationship in relationships
  )
  evidence.sort(key=lambda item: item["reference"])
  _require_count("evidence", evidence, active_policy.max_evidence_items)
  review = build_review_context(paths, scene_ids=(), project_scope=True)
  _require_count("canon facts", review["accepted_canon"], active_policy.max_canon_facts)
  snapshot = {
    "schema": MOBILE_SNAPSHOT_SCHEMA,
    "schema_version": MOBILE_SNAPSHOT_SCHEMA_VERSION,
    "project_id": project_id,
    "revision": revision,
    "scenes": scenes,
    "reading_order": "plan",
    "codex": {
      "entities": entities,
      "relationships": relationships,
    },
    "evidence": evidence,
    # Only approved craft preferences travel, never analysis, raw exemplars,
    # local preview drafts or filesystem-bound edit versions.
    "writing_voice": review["writing_voice"] or None,
    # Reuse desktop's accepted-only projection with no one-request permissions.
    "accepted_canon": review["accepted_canon"],
  }
  payload_bytes = _canonical_bytes(snapshot)
  manifest = {
    "schema": MOBILE_SNAPSHOT_MANIFEST_SCHEMA,
    "schema_version": MOBILE_SNAPSHOT_SCHEMA_VERSION,
    "project_id": project_id,
    "revision": revision,
    "content_sha256": hashlib.sha256(payload_bytes).hexdigest(),
    "byte_length": len(payload_bytes),
  }
  plaintext_bytes = _canonical_bytes({"manifest": manifest, "snapshot": snapshot})
  return MobileSnapshotArtifact(
    snapshot=snapshot,
    manifest=manifest,
    payload_bytes=payload_bytes,
    plaintext_bytes=plaintext_bytes,
  )


def write_mobile_snapshot_staging(
  artifact: MobileSnapshotArtifact,
  staging_path: Path,
) -> Path:
  """Atomically replace a plaintext staging file for platform encryption."""

  target = Path(staging_path)
  target.parent.mkdir(parents=True, exist_ok=True)
  descriptor, temporary_name = tempfile.mkstemp(
    prefix=f".{target.name}.",
    suffix=".tmp",
    dir=target.parent,
  )
  try:
    with os.fdopen(descriptor, "wb") as handle:
      handle.write(artifact.plaintext_bytes)
      handle.flush()
      os.fsync(handle.fileno())
    os.replace(temporary_name, target)
  except BaseException:
    try:
      os.unlink(temporary_name)
    except FileNotFoundError:
      pass
    raise
  return target


def _snapshot_envelope(raw: bytes) -> tuple[dict[str, Any], dict[str, Any]]:
  try:
    decoded = json.loads(raw.decode("utf-8"))
  except (UnicodeDecodeError, json.JSONDecodeError) as error:
    raise OpenAuthorError("Mobile snapshot plaintext is invalid JSON.") from error
  if not isinstance(decoded, dict):
    raise OpenAuthorError("Mobile snapshot plaintext must be an object.")
  manifest = decoded.get("manifest")
  snapshot = decoded.get("snapshot")
  if not isinstance(manifest, dict) or not isinstance(snapshot, dict):
    raise OpenAuthorError("Mobile snapshot manifest or payload is missing.")
  if _canonical_bytes(decoded) != raw:
    raise OpenAuthorError("Mobile snapshot plaintext is not canonical.")
  return dict(manifest), dict(snapshot)


def load_mobile_snapshot(
  staging_path: Path,
  *,
  expected_project_id: str,
  expected_revision: str | None = None,
) -> dict[str, Any]:
  """Load canonical plaintext after verifying schema, identity, and integrity."""

  normalized_project_id = expected_project_id.strip()
  if normalized_project_id == "":
    raise OpenAuthorError("Mobile snapshot load requires an expected project id.")
  try:
    raw = Path(staging_path).read_bytes()
  except OSError as error:
    raise OpenAuthorError("Unable to read mobile snapshot staging file.") from error
  manifest, snapshot = _snapshot_envelope(raw)

  if (
    manifest.get("schema") != MOBILE_SNAPSHOT_MANIFEST_SCHEMA
    or manifest.get("schema_version") != MOBILE_SNAPSHOT_SCHEMA_VERSION
    or snapshot.get("schema") != MOBILE_SNAPSHOT_SCHEMA
    or snapshot.get("schema_version") != MOBILE_SNAPSHOT_SCHEMA_VERSION
  ):
    raise OpenAuthorError("Mobile snapshot schema or version is unsupported.")

  manifest_project_id = str(manifest.get("project_id", ""))
  snapshot_project_id = str(snapshot.get("project_id", ""))
  if (
    manifest_project_id != snapshot_project_id
    or snapshot_project_id != normalized_project_id
  ):
    raise OpenAuthorError("Mobile snapshot project identity mismatch.")

  manifest_revision = str(manifest.get("revision", ""))
  snapshot_revision = str(snapshot.get("revision", ""))
  if manifest_revision != snapshot_revision:
    raise OpenAuthorError("Mobile snapshot revision identity mismatch.")
  if expected_revision is not None and snapshot_revision != expected_revision.strip():
    raise OpenAuthorError("Mobile snapshot revision identity mismatch.")

  payload_bytes = _canonical_bytes(snapshot)
  expected_digest = str(manifest.get("content_sha256", ""))
  actual_digest = hashlib.sha256(payload_bytes).hexdigest()
  if expected_digest != actual_digest:
    raise OpenAuthorError("Mobile snapshot failed its integrity check.")
  if manifest.get("byte_length") != len(payload_bytes):
    raise OpenAuthorError("Mobile snapshot failed its byte-length integrity check.")

  scenes = snapshot.get("scenes")
  codex = snapshot.get("codex")
  evidence = snapshot.get("evidence")
  if (
    not isinstance(scenes, list)
    or not isinstance(codex, dict)
    or not isinstance(codex.get("entities"), list)
    or not isinstance(codex.get("relationships"), list)
    or not isinstance(evidence, list)
  ):
    raise OpenAuthorError("Mobile snapshot payload shape is invalid.")
  return snapshot
