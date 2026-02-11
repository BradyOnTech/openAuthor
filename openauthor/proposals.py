from __future__ import annotations

import json
import uuid
from pathlib import Path

from .project import OpenAuthorError, ProjectPaths, utc_now

STATUSES = {"pending", "applied", "rejected"}


def _proposal_file(paths: ProjectPaths, proposal_id: str) -> Path:
  return paths.proposals_dir / f"{proposal_id}.json"


def create_proposal(
  paths: ProjectPaths,
  *,
  title: str,
  instruction: str,
  scene_id: str = "",
) -> str:
  proposal_id = f"proposal-{uuid.uuid4().hex[:12]}"
  payload = {
    "id": proposal_id,
    "title": title,
    "instruction": instruction,
    "scene_id": scene_id,
    "status": "pending",
    "created_at": utc_now(),
    "updated_at": utc_now(),
    "notes": "",
  }
  _proposal_file(paths, proposal_id).write_text(
    json.dumps(payload, indent=2) + "\n",
    encoding="utf-8",
  )
  return proposal_id


def _read_proposal(proposal_file: Path) -> dict[str, str]:
  return json.loads(proposal_file.read_text(encoding="utf-8"))


def get_proposal(paths: ProjectPaths, proposal_id: str) -> dict[str, str]:
  proposal_path = _proposal_file(paths, proposal_id)
  if not proposal_path.exists():
    raise OpenAuthorError(f"Unknown proposal id '{proposal_id}'.")
  return _read_proposal(proposal_path)


def list_proposals(paths: ProjectPaths, *, status: str | None = None) -> list[dict[str, str]]:
  if status and status not in STATUSES:
    allowed = ", ".join(sorted(STATUSES))
    raise OpenAuthorError(f"Invalid status '{status}'. Allowed: {allowed}.")

  rows: list[dict[str, str]] = []
  for proposal_file in sorted(paths.proposals_dir.glob("*.json")):
    item = _read_proposal(proposal_file)
    if status and item.get("status") != status:
      continue
    rows.append(item)
  return rows


def update_proposal_status(
  paths: ProjectPaths,
  *,
  proposal_id: str,
  status: str,
  notes: str = "",
) -> dict[str, str]:
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
  file_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
  return payload
