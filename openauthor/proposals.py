from __future__ import annotations

import hashlib
import json
import re
from typing import Any
import uuid
from pathlib import Path

from .changes import build_change_set, edit_hunk_after_text, rebase_change_set, render_change_set, set_hunk_decision
from .git_ops import current_branch, merge_revision_pair
from .project import OpenAuthorError, ProjectPaths, atomic_write_json, atomic_write_text, utc_now
from .revisions import create_revision, read_file_at_revision, revision_head
from .scenes import get_scene, split_scene_text, update_scene

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
  revision_intent: dict[str, Any] | None = None,
  change_group_id: str = "",
  proposal_id: str | None = None,
) -> str:
  proposal_id = proposal_id or f"proposal-{uuid.uuid4().hex[:12]}"
  if not re.fullmatch(r"proposal-[a-f0-9]{12,64}", proposal_id):
    raise OpenAuthorError("Invalid proposal id.")
  if _proposal_file(paths, proposal_id).exists():
    raise OpenAuthorError("This proposal already exists; recover its original generation request.")
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
    "revision_intent": revision_intent or {
      "goal": instruction,
      "constraints": [],
      "protected_elements": [],
      "scope": "scene" if scene_id else "project",
    },
    "change_group_id": change_group_id.strip(),
  }
  if generation is not None:
    payload["generation"] = generation
  if merge is not None:
    payload["merge"] = merge
  atomic_write_json(_proposal_file(paths, proposal_id), payload)
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
  scene_digests = _scene_digest_map(paths)
  for proposal_file in sorted(paths.proposals_dir.glob("*.json")):
    item = _read_proposal(proposal_file)
    if status and item.get("status") != status:
      continue
    if normalized_vcs_branch and item.get("vcs_branch", "") != normalized_vcs_branch:
      continue
    item["stale"] = _proposal_is_stale(paths, item, current_digests=scene_digests)
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
  if status == "rejected":
    from .product_signals import record_product_event
    record_product_event(paths, "change_set_rejected")
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
  scene = get_scene(paths, scene_id)
  payload["proposed_body"] = proposed_body
  generation = payload.get("generation", {})
  retrieval = generation.get("retrieval", {}) if isinstance(generation, dict) else {}
  revision_intent = payload.get("revision_intent", {})
  payload["change_set"] = build_change_set(
    proposal_id=proposal_id,
    scene_id=scene_id,
    intent=str(revision_intent.get("goal", payload.get("instruction", ""))),
    before_body=str(scene.get("body", "")),
    after_body=proposed_body,
    provenance={
      "provider": (draft or {}).get("provider", generation.get("provider", "") if isinstance(generation, dict) else ""),
      "model": (draft or {}).get("model", generation.get("model", "") if isinstance(generation, dict) else ""),
      "generation_id": (draft or {}).get("generation_id", generation.get("id", "") if isinstance(generation, dict) else ""),
      "citations": retrieval.get("citations", []) if isinstance(retrieval, dict) else [],
    },
    constraints=[str(value) for value in revision_intent.get("constraints", [])],
    protected_elements=[str(value) for value in revision_intent.get("protected_elements", [])],
  )
  payload["proposed_body"] = payload["change_set"]["proposed_body"]
  from .canon import assess_story_memory_impact
  memory_impact = assess_story_memory_impact(
    paths,
    scene_id=scene_id,
    before_body=str(scene.get("body", "")),
    after_body=proposed_body,
  )
  impact_report = payload["change_set"]["impact_report"]
  impact_report["affected_story_memory"] = memory_impact["affected"]
  impact_report["warnings"].extend(memory_impact["warnings"])
  risk_order = {"low": 0, "medium": 1, "high": 2}
  if risk_order[memory_impact["risk"]] > risk_order[impact_report["risk"]]:
    impact_report["risk"] = memory_impact["risk"]
  # Re-anchor staleness to the scene state the draft was written against.
  payload["scene_digest"] = _scene_digest(paths, scene_id)
  payload["updated_at"] = utc_now()
  if draft is not None:
    payload["draft"] = draft
  atomic_write_json(file_path, payload)
  payload["stale"] = _proposal_is_stale(paths, payload)
  return payload


def update_change_hunk(
  paths: ProjectPaths,
  *,
  proposal_id: str,
  hunk_id: str,
  decision: str,
) -> dict[str, Any]:
  file_path = _proposal_file(paths, proposal_id)
  if not file_path.exists():
    raise OpenAuthorError(f"Unknown proposal id '{proposal_id}'.")
  payload = _read_proposal(file_path)
  if payload.get("status") != "pending":
    raise OpenAuthorError("Applied or rejected Change Sets cannot be edited.")
  change_set = payload.get("change_set")
  if not isinstance(change_set, dict):
    raise OpenAuthorError("Draft this proposal before reviewing Change Hunks.")
  payload["change_set"] = set_hunk_decision(change_set, hunk_id, decision)
  payload["updated_at"] = utc_now()
  atomic_write_json(file_path, payload)
  from .product_signals import record_product_event
  record_product_event(paths, "change_hunk_decided", decision=decision)
  payload["stale"] = _proposal_is_stale(paths, payload)
  return payload


def edit_change_hunk(
  paths: ProjectPaths,
  *,
  proposal_id: str,
  hunk_id: str,
  after_text: str,
  editor: str = "author",
  regeneration: dict[str, Any] | None = None,
) -> dict[str, Any]:
  file_path = _proposal_file(paths, proposal_id)
  if not file_path.exists():
    raise OpenAuthorError(f"Unknown proposal id '{proposal_id}'.")
  payload = _read_proposal(file_path)
  if payload.get("status") != "pending":
    raise OpenAuthorError("Applied or rejected Change Sets cannot be edited.")
  change_set = payload.get("change_set")
  if not isinstance(change_set, dict):
    raise OpenAuthorError("Draft this proposal before editing Change Hunks.")
  payload["change_set"] = edit_hunk_after_text(
    change_set,
    hunk_id,
    after_text,
    editor=editor,
    regeneration=regeneration,
  )
  payload["proposed_body"] = payload["change_set"]["proposed_body"]
  payload["updated_at"] = utc_now()
  atomic_write_json(file_path, payload)
  payload["stale"] = _proposal_is_stale(paths, payload)
  return payload


def rebase_proposal_change_set(paths: ProjectPaths, *, proposal_id: str) -> dict[str, Any]:
  file_path = _proposal_file(paths, proposal_id)
  if not file_path.exists():
    raise OpenAuthorError(f"Unknown proposal id '{proposal_id}'.")
  payload = _read_proposal(file_path)
  if payload.get("status") != "pending":
    raise OpenAuthorError("Only pending Change Sets can be rebased.")
  change_set = payload.get("change_set")
  if not isinstance(change_set, dict):
    raise OpenAuthorError("Draft this proposal before rebasing it.")
  scene_id = str(payload.get("scene_id", ""))
  current_body = str(get_scene(paths, scene_id).get("body", ""))
  rebased, report = rebase_change_set(change_set, current_body)
  payload["rebase_report"] = report
  if report["status"] == "rebased":
    payload["change_set"] = rebased
    payload["proposed_body"] = rebased["proposed_body"]
    payload["scene_digest"] = _scene_digest(paths, scene_id)
  payload["updated_at"] = utc_now()
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
  if not scene_id:
    raise OpenAuthorError(
      f"Proposal '{proposal_id}' has no target scene and cannot be applied as a manuscript edit."
    )
  if not proposed_body.strip():
    raise OpenAuthorError(
      f"Proposal '{proposal_id}' has no drafted scene text. Draft it before applying."
    )
  if _proposal_is_stale(paths, payload) and not force:
    raise OpenAuthorError(
      "Scene has changed since this proposal's draft was written. "
      "Regenerate the draft (`proposal draft`) or apply with force to overwrite."
    )

  scene_before = get_scene(paths, scene_id)
  selected_body = proposed_body
  change_set = payload.get("change_set")
  if isinstance(change_set, dict):
    selected_body = render_change_set(change_set)
    accepted_hunks = [
      str(hunk.get("id", ""))
      for hunk in change_set.get("hunks", [])
      if hunk.get("decision") == "accepted"
    ]
    rejected_hunks = [
      str(hunk.get("id", ""))
      for hunk in change_set.get("hunks", [])
      if hunk.get("decision") == "rejected"
    ]
    protected_elements = change_set.get("intent", {}).get("protected_elements", [])
    protection_violations = [
      str(value)
      for value in protected_elements
      if str(value) in str(change_set.get("base_body", "")) and str(value) not in selected_body
    ]
    if protection_violations:
      raise OpenAuthorError(
        "Selected hunks modify protected text: " + "; ".join(protection_violations)
      )
  else:
    accepted_hunks = []
    rejected_hunks = []
  if str(scene_before.get("body", "")).rstrip("\n") == selected_body.rstrip("\n"):
    raise OpenAuthorError(
      "The drafted scene is identical to the current prose, so no manuscript revision was applied."
    )
  scene_path = paths.root / scene_before["path"]
  original_content = scene_path.read_text(encoding="utf-8")
  try:
    pre_apply_snapshot = create_revision(
      paths,
      f"Before applying {proposal_id}",
      kind="change_set_before",
      metadata={"proposal_id": proposal_id, "scene_id": scene_id},
    )
  except (OpenAuthorError, OSError) as error:
    raise OpenAuthorError(
      f"Cannot apply safely because the pre-change revision failed: {error}"
    ) from error

  update_scene(paths, scene_identifier=scene_id, body=selected_body)
  try:
    applied_revision = create_revision(
      paths,
      f"Apply {proposal_id}: {payload.get('title', '').strip()}",
      kind="change_set_apply",
      metadata={"proposal_id": proposal_id, "scene_id": scene_id},
    )
  except (OpenAuthorError, OSError) as error:
    atomic_write_text(scene_path, original_content)
    raise OpenAuthorError(
      f"Apply was rolled back because the new revision could not be recorded: {error}"
    ) from error

  payload["scene_digest"] = _scene_digest(paths, scene_id)

  payload["status"] = "applied"
  payload["updated_at"] = utc_now()
  payload["applied_at"] = utc_now()
  payload["applied_changes"] = True
  payload["pre_apply_snapshot"] = pre_apply_snapshot
  payload["applied_revision"] = applied_revision
  payload["applied_scene_digest"] = payload["scene_digest"]
  payload["accepted_hunk_ids"] = accepted_hunks
  payload["rejected_hunk_ids"] = rejected_hunks
  if notes:
    payload["notes"] = notes
  atomic_write_json(file_path, payload)
  try:
    from .story_memory import extract_memory_suggestions
    memory_report = extract_memory_suggestions(paths, scene_ids=[scene_id])
    payload["story_memory_suggestions"] = {
      "added": memory_report["added"],
      "pending": memory_report["pending"],
    }
    atomic_write_json(file_path, payload)
  except OpenAuthorError as error:
    # The manuscript Revision is authoritative; derived suggestion refresh is repairable.
    payload["story_memory_suggestion_error"] = str(error)
  payload["stale"] = _proposal_is_stale(paths, payload)
  from .product_signals import record_product_event
  record_product_event(
    paths,
    "change_set_applied",
    accepted_hunks=len(accepted_hunks),
    total_hunks=len(accepted_hunks) + len(rejected_hunks),
    partial=bool(accepted_hunks and rejected_hunks),
    changed=True,
  )
  return payload


def apply_proposal_batch(
  paths: ProjectPaths,
  *,
  proposal_ids: list[str],
  notes: str = "",
  force: bool = False,
) -> dict[str, Any]:
  normalized = list(dict.fromkeys(value.strip() for value in proposal_ids if value.strip()))
  if len(normalized) < 2:
    raise OpenAuthorError("A coordinated Change Set requires at least two proposals.")

  prepared: list[dict[str, Any]] = []
  scene_ids: set[str] = set()
  original_proposals: dict[Path, str] = {}
  for proposal_id in normalized:
    file_path = _proposal_file(paths, proposal_id)
    if not file_path.exists():
      raise OpenAuthorError(f"Unknown proposal id '{proposal_id}'.")
    payload = _read_proposal(file_path)
    if payload.get("status") != "pending":
      raise OpenAuthorError(f"Proposal '{proposal_id}' is not pending.")
    if payload.get("source") == "merge_resolution":
      raise OpenAuthorError("Merge resolutions cannot be part of a coordinated Change Set.")
    scene_id = str(payload.get("scene_id", "")).strip()
    if not scene_id or scene_id in scene_ids:
      raise OpenAuthorError("Coordinated Change Sets require one distinct target scene per proposal.")
    if _proposal_is_stale(paths, payload) and not force:
      raise OpenAuthorError(f"Scene '{scene_id}' changed after its Change Set was drafted.")
    change_set = payload.get("change_set")
    selected_body = render_change_set(change_set) if isinstance(change_set, dict) else str(payload.get("proposed_body", ""))
    if not selected_body.strip():
      raise OpenAuthorError(f"Proposal '{proposal_id}' has no drafted scene text.")
    scene = get_scene(paths, scene_id)
    if str(scene.get("body", "")).rstrip("\n") == selected_body.rstrip("\n"):
      raise OpenAuthorError(f"Proposal '{proposal_id}' contains no selected prose change.")
    accepted_hunks: list[str] = []
    rejected_hunks: list[str] = []
    if isinstance(change_set, dict):
      accepted_hunks = [str(row.get("id", "")) for row in change_set.get("hunks", []) if row.get("decision") == "accepted"]
      rejected_hunks = [str(row.get("id", "")) for row in change_set.get("hunks", []) if row.get("decision") == "rejected"]
      violations = [
        str(value) for value in change_set.get("intent", {}).get("protected_elements", [])
        if str(value) in str(change_set.get("base_body", "")) and str(value) not in selected_body
      ]
      if violations:
        raise OpenAuthorError(f"Proposal '{proposal_id}' modifies protected text: " + "; ".join(violations))
    scene_ids.add(scene_id)
    original_proposals[file_path] = file_path.read_text(encoding="utf-8")
    prepared.append({
      "id": proposal_id,
      "file": file_path,
      "payload": payload,
      "scene_id": scene_id,
      "scene": scene,
      "selected_body": selected_body,
      "accepted_hunks": accepted_hunks,
      "rejected_hunks": rejected_hunks,
    })

  originals = {
    paths.root / row["scene"]["path"]: (paths.root / row["scene"]["path"]).read_text(encoding="utf-8")
    for row in prepared
  }
  group_id = next((str(row["payload"].get("change_group_id", "")) for row in prepared if row["payload"].get("change_group_id")), f"change-group-{uuid.uuid4().hex[:12]}")
  try:
    pre_apply_snapshot = create_revision(
      paths,
      f"Before coordinated Change Set {group_id}",
      kind="change_group_before",
      metadata={"change_group_id": group_id, "proposal_ids": normalized, "scene_ids": sorted(scene_ids)},
    )
  except (OpenAuthorError, OSError) as error:
    raise OpenAuthorError(f"Cannot apply safely because the pre-change revision failed: {error}") from error

  try:
    for row in prepared:
      update_scene(paths, scene_identifier=row["scene_id"], body=row["selected_body"])
    applied_revision = create_revision(
      paths,
      f"Apply coordinated Change Set {group_id}",
      kind="change_group_apply",
      metadata={"change_group_id": group_id, "proposal_ids": normalized, "scene_ids": sorted(scene_ids)},
    )
    applied_at = utc_now()
    results: list[dict[str, Any]] = []
    for row in prepared:
      payload = row["payload"]
      payload.update({
        "change_group_id": group_id,
        "status": "applied",
        "updated_at": applied_at,
        "applied_at": applied_at,
        "applied_changes": True,
        "pre_apply_snapshot": pre_apply_snapshot,
        "applied_revision": applied_revision,
        "scene_digest": _scene_digest(paths, row["scene_id"]),
        "accepted_hunk_ids": row["accepted_hunks"],
        "rejected_hunk_ids": row["rejected_hunks"],
      })
      payload["applied_scene_digest"] = payload["scene_digest"]
      if notes:
        payload["notes"] = notes
      atomic_write_json(row["file"], payload)
      payload["stale"] = False
      results.append(payload)
  except (OpenAuthorError, OSError, ValueError) as error:
    for path, content in originals.items():
      atomic_write_text(path, content)
    for path, content in original_proposals.items():
      atomic_write_text(path, content)
    raise OpenAuthorError(f"Coordinated apply was rolled back: {error}") from error

  try:
    from .story_memory import extract_memory_suggestions
    extract_memory_suggestions(paths, scene_ids=sorted(scene_ids))
  except OpenAuthorError:
    pass
  from .product_signals import record_product_event
  record_product_event(
    paths,
    "change_set_applied",
    accepted_hunks=sum(len(row["accepted_hunks"]) for row in prepared),
    total_hunks=sum(len(row["accepted_hunks"]) + len(row["rejected_hunks"]) for row in prepared),
    partial=any(row["rejected_hunks"] for row in prepared),
    changed=True,
  )
  return {
    "change_group_id": group_id,
    "proposal_ids": normalized,
    "scene_ids": sorted(scene_ids),
    "pre_apply_snapshot": pre_apply_snapshot,
    "applied_revision": applied_revision,
    "proposals": results,
  }


def undo_proposal(
  paths: ProjectPaths,
  *,
  proposal_id: str,
  force: bool = False,
) -> dict[str, Any]:
  file_path = _proposal_file(paths, proposal_id)
  if not file_path.exists():
    raise OpenAuthorError(f"Unknown proposal id '{proposal_id}'.")
  payload = _read_proposal(file_path)
  if payload.get("status") != "applied" or not payload.get("applied_changes"):
    raise OpenAuthorError(f"Proposal '{proposal_id}' has no applied manuscript change to undo.")
  if payload.get("undone_at"):
    raise OpenAuthorError(f"Proposal '{proposal_id}' has already been undone.")

  scene_id = str(payload.get("scene_id", "")).strip()
  before_revision = str(payload.get("pre_apply_snapshot", "")).strip()
  expected_digest = str(payload.get("applied_scene_digest", "")).strip()
  if not scene_id or not before_revision:
    raise OpenAuthorError(f"Proposal '{proposal_id}' does not contain a restorable revision.")
  if expected_digest and _scene_digest(paths, scene_id) != expected_digest and not force:
    raise OpenAuthorError(
      "Scene has changed since this proposal was applied. Restore was stopped to protect newer work; "
      "retry with force only if replacing those changes is intentional."
    )

  scene = get_scene(paths, scene_id)
  relative_path = scene["path"]
  restored = read_file_at_revision(paths, before_revision, relative_path)

  scene_path = paths.root / relative_path
  current_content = scene_path.read_text(encoding="utf-8")
  atomic_write_text(scene_path, restored)
  try:
    undo_revision = create_revision(
      paths,
      f"Undo {proposal_id}: {payload.get('title', '').strip()}",
      kind="change_set_undo",
      metadata={"proposal_id": proposal_id, "scene_id": scene_id, "restored_revision": before_revision},
    )
  except (OpenAuthorError, OSError) as error:
    atomic_write_text(scene_path, current_content)
    raise OpenAuthorError(
      f"Undo was rolled back because its revision could not be recorded: {error}"
    ) from error

  payload["undone_at"] = utc_now()
  payload["undo_revision"] = undo_revision
  payload["restored_revision"] = before_revision
  payload["scene_digest"] = _scene_digest(paths, scene_id)
  atomic_write_json(file_path, payload)
  payload["stale"] = False
  from .product_signals import record_product_event
  record_product_event(paths, "change_set_undone")
  return payload


def _capture_vcs_anchor(paths: ProjectPaths) -> tuple[str, str]:
  branch = ""
  commit = revision_head(paths)
  try:
    branch = current_branch(paths)
  except OpenAuthorError:
    return "", commit
  return branch, commit


def _digest_scene_payload(scene: dict[str, Any]) -> str:
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


def _scene_digest(paths: ProjectPaths, scene_id: str) -> str:
  return _digest_scene_payload(get_scene(paths, scene_id))


def _scene_digest_map(paths: ProjectPaths) -> dict[str, str]:
  digests: dict[str, str] = {}
  for scene_file in sorted(paths.scenes_dir.glob("*.md")):
    front_matter, body = split_scene_text(scene_file.read_text(encoding="utf-8"))
    identifier = front_matter.get("id", scene_file.stem)
    digests[identifier] = _digest_scene_payload(
      {
        "id": identifier,
        "title": front_matter.get("title", ""),
        "summary": front_matter.get("summary", ""),
        "pov": front_matter.get("pov", ""),
        "status": front_matter.get("status", "draft"),
        "body": body,
      }
    )
  return digests


def _proposal_is_stale(
  paths: ProjectPaths,
  proposal: dict[str, Any],
  *,
  current_digests: dict[str, str] | None = None,
) -> bool:
  if proposal.get("source") == "merge_resolution":
    metadata = proposal.get("merge") or {}
    try:
      revisions = merge_revision_pair(paths, base=metadata.get("base", ""), head=metadata.get("head", ""))
      return any(metadata.get(key) != value for key, value in revisions.items())
    except OpenAuthorError:
      return True
  scene_id = str(proposal.get("scene_id", "")).strip()
  if scene_id == "":
    return False
  expected = str(proposal.get("scene_digest", "")).strip()
  if expected == "":
    return False
  if current_digests is not None:
    current = current_digests.get(scene_id)
    if current is None:
      return True
  else:
    try:
      current = _scene_digest(paths, scene_id)
    except OpenAuthorError:
      return True
  return current != expected
