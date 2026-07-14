from __future__ import annotations

import hashlib
import json
from typing import Any
import uuid
from pathlib import Path

from .git_ops import create_snapshot, current_branch, run_git
from .project import OpenAuthorError, ProjectPaths, atomic_write_json, utc_now
from .scenes import get_scene, update_scene

STATUSES = {"pending", "applied", "rejected"}


def _proposal_file(paths: ProjectPaths, proposal_id: str) -> Path:
  return paths.proposals_dir / f"{proposal_id}.json"


def create_proposal(
  paths: ProjectPaths,
  *,
  title: str,
  instruction: str,
  scene_id: str = "",
  source: str = "manual",
  generation: dict[str, Any] | None = None,
  proposed_body: str = "",
  merge: dict[str, Any] | None = None,
) -> str:
  proposal_id = f"proposal-{uuid.uuid4().hex[:12]}"
  vcs_branch, vcs_base_commit = _capture_vcs_anchor(paths)
  scene_digest = ""
  if scene_id.strip():
    try:
      scene_digest = _scene_digest(paths, scene_id)
    except OpenAuthorError:
      # Merge-resolution proposals can target scenes that only exist on
      # another branch; staleness tracking is skipped for those.
      scene_digest = ""
  payload: dict[str, Any] = {
    "id": proposal_id,
    "title": title,
    "instruction": instruction,
    "scene_id": scene_id,
    "scene_digest": scene_digest,
    "vcs_branch": vcs_branch,
    "vcs_base_commit": vcs_base_commit,
    "status": "pending",
    "created_at": utc_now(),
    "updated_at": utc_now(),
    "notes": "",
    "source": source,
    "proposed_body": proposed_body,
  }
  if generation is not None:
    payload["generation"] = generation
  if merge is not None:
    payload["merge"] = merge
  _proposal_file(paths, proposal_id).write_text(
    json.dumps(payload, indent=2) + "\n",
    encoding="utf-8",
  )
  return proposal_id


def _read_proposal(proposal_file: Path) -> dict[str, Any]:
  return json.loads(proposal_file.read_text(encoding="utf-8"))


def get_proposal(paths: ProjectPaths, proposal_id: str) -> dict[str, Any]:
  proposal_path = _proposal_file(paths, proposal_id)
  if not proposal_path.exists():
    raise OpenAuthorError(f"Unknown proposal id '{proposal_id}'.")
  payload = _read_proposal(proposal_path)
  payload["stale"] = _proposal_is_stale(paths, payload)
  return payload


def list_proposals(
  paths: ProjectPaths,
  *,
  status: str | None = None,
  vcs_branch: str | None = None,
) -> list[dict[str, Any]]:
  if status and status not in STATUSES:
    allowed = ", ".join(sorted(STATUSES))
    raise OpenAuthorError(f"Invalid status '{status}'. Allowed: {allowed}.")

  normalized_vcs_branch = (vcs_branch or "").strip()
  rows: list[dict[str, Any]] = []
  for proposal_file in sorted(paths.proposals_dir.glob("*.json")):
    item = _read_proposal(proposal_file)
    if status and item.get("status") != status:
      continue
    if normalized_vcs_branch and item.get("vcs_branch", "") != normalized_vcs_branch:
      continue
    item["stale"] = _proposal_is_stale(paths, item)
    rows.append(item)
  return rows


def update_proposal_status(
  paths: ProjectPaths,
  *,
  proposal_id: str,
  status: str,
  notes: str = "",
) -> dict[str, Any]:
  if status not in STATUSES:
    allowed = ", ".join(sorted(STATUSES))
    raise OpenAuthorError(f"Invalid status '{status}'. Allowed: {allowed}.")

  file_path = _proposal_file(paths, proposal_id)
  if not file_path.exists():
    raise OpenAuthorError(f"Unknown proposal id '{proposal_id}'.")

  payload = _read_proposal(file_path)
  payload["status"] = status
  payload["updated_at"] = utc_now()
  if notes:
    payload["notes"] = notes
  atomic_write_json(file_path, payload)
  payload["stale"] = _proposal_is_stale(paths, payload)
  return payload


def set_proposal_draft(
  paths: ProjectPaths,
  *,
  proposal_id: str,
  proposed_body: str,
  draft: dict[str, Any] | None = None,
) -> dict[str, Any]:
  file_path = _proposal_file(paths, proposal_id)
  if not file_path.exists():
    raise OpenAuthorError(f"Unknown proposal id '{proposal_id}'.")
  payload = _read_proposal(file_path)
  if payload.get("status") != "pending":
    raise OpenAuthorError(
      f"Proposal '{proposal_id}' is not pending; cannot attach a draft."
    )
  scene_id = str(payload.get("scene_id", "")).strip()
  if scene_id == "":
    raise OpenAuthorError(
      f"Proposal '{proposal_id}' has no target scene; cannot attach a draft."
    )
  payload["proposed_body"] = proposed_body
  # Re-anchor staleness to the scene state the draft was written against.
  payload["scene_digest"] = _scene_digest(paths, scene_id)
  payload["updated_at"] = utc_now()
  if draft is not None:
    payload["draft"] = draft
  atomic_write_json(file_path, payload)
  payload["stale"] = _proposal_is_stale(paths, payload)
  return payload


def apply_proposal(
  paths: ProjectPaths,
  *,
  proposal_id: str,
  notes: str = "",
  force: bool = False,
) -> dict[str, Any]:
  file_path = _proposal_file(paths, proposal_id)
  if not file_path.exists():
    raise OpenAuthorError(f"Unknown proposal id '{proposal_id}'.")
  payload = _read_proposal(file_path)
  if payload.get("status") != "pending":
    raise OpenAuthorError(
      f"Proposal '{proposal_id}' is not pending (status: {payload.get('status')})."
    )
  if payload.get("source") == "merge_resolution":
    raise OpenAuthorError(
      "Merge-resolution proposals are applied through the merge itself: "
      f"`branch merge --base <base> --head <head> --resolution {proposal_id}`."
    )

  scene_id = str(payload.get("scene_id", "")).strip()
  proposed_body = str(payload.get("proposed_body", "") or "")
  applied_changes = False
  pre_apply_snapshot = ""

  if proposed_body.strip() and scene_id:
    if _proposal_is_stale(paths, payload) and not force:
      raise OpenAuthorError(
        "Scene has changed since this proposal's draft was written. "
        "Regenerate the draft (`proposal draft`) or apply with force to overwrite."
      )
    try:
      pre_apply_snapshot = create_snapshot(
        paths, f"pre-apply snapshot for {proposal_id}"
      )
    except OpenAuthorError:
      pre_apply_snapshot = ""
    update_scene(paths, scene_identifier=scene_id, body=proposed_body)
    applied_changes = True
    payload["scene_digest"] = _scene_digest(paths, scene_id)

  payload["status"] = "applied"
  payload["updated_at"] = utc_now()
  payload["applied_at"] = utc_now()
  payload["applied_changes"] = applied_changes
  if pre_apply_snapshot:
    payload["pre_apply_snapshot"] = pre_apply_snapshot
  if notes:
    payload["notes"] = notes
  atomic_write_json(file_path, payload)
  payload["stale"] = _proposal_is_stale(paths, payload)
  return payload


def _capture_vcs_anchor(paths: ProjectPaths) -> tuple[str, str]:
  branch = ""
  commit = ""
  try:
    branch = current_branch(paths)
    commit = run_git(paths, ["rev-parse", "HEAD"], check=False).stdout.strip()
  except OpenAuthorError:
    return "", ""
  return branch, commit


def _scene_digest(paths: ProjectPaths, scene_id: str) -> str:
  scene = get_scene(paths, scene_id)
  payload = {
    "id": scene.get("id", ""),
    "title": scene.get("title", ""),
    "summary": scene.get("summary", ""),
    "pov": scene.get("pov", ""),
    "status": scene.get("status", ""),
    "body": scene.get("body", ""),
  }
  raw = json.dumps(payload, sort_keys=True, separators=(",", ":"))
  return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _proposal_is_stale(paths: ProjectPaths, proposal: dict[str, Any]) -> bool:
  scene_id = str(proposal.get("scene_id", "")).strip()
  if scene_id == "":
    return False
  expected = str(proposal.get("scene_digest", "")).strip()
  if expected == "":
    return False
  try:
    current = _scene_digest(paths, scene_id)
  except OpenAuthorError:
    return True
  return current != expected
