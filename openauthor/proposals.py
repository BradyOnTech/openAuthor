from __future__ import annotations

from .book_transactions import recoverable_project_edit

import hashlib
import json
import re
from typing import Any
import uuid
from pathlib import Path

from .changes import build_change_set, edit_hunk_after_text, rebase_change_set, render_change_set, set_hunk_decision
from .git_ops import current_branch, merge_revision_pair
from .project import OpenAuthorError, ProjectPaths, atomic_write_json, atomic_write_text, utc_now
from .project_locks import serialized_project_access
from .revisions import create_revision, get_revision, read_file_at_revision, revision_head
from .scenes import get_scene, split_scene_text, update_scene

STATUSES = {"pending", "applied", "rejected"}


def _proposal_file(paths: ProjectPaths, proposal_id: str) -> Path:
  return paths.proposals_dir / f"{proposal_id}.json"


@serialized_project_access
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
  selection: dict[str, Any] | None = None,
  draft_revision: dict[str, Any] | None = None,
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
  if selection is not None:
    payload["selection"] = selection
  if draft_revision is not None:
    payload["draft_revision"] = draft_revision
  atomic_write_json(_proposal_file(paths, proposal_id), payload)
  return proposal_id


@serialized_project_access
def prepare_draft_revision(paths: ProjectPaths, *, proposal_id: str, feedback: str,
                           expected_updated_at: str, request_id: str) -> dict[str, Any]:
  """Fork an unapplied candidate locally; the source and manuscript stay intact."""
  if not isinstance(feedback, str) or not feedback.strip() or len(feedback) > 6000:
    raise OpenAuthorError("Draft feedback needs 1–6,000 characters.")
  if not isinstance(request_id, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{8,128}", request_id):
    raise OpenAuthorError("A draft revision needs a stable request id.")
  source = get_proposal(paths, proposal_id)
  if source["updated_at"] != expected_updated_at:
    raise OpenAuthorError("This draft changed. Review it again before creating a revision.")
  if source["status"] != "pending" or source.get("stale") or source.get("selection") or source.get("source") == "merge_resolution" or not source.get("scene_id") or not str(source.get("proposed_body", "")).strip():
    raise OpenAuthorError("Choose a current, unapplied whole-scene draft to revise.")
  revision_id = "proposal-" + hashlib.sha256(request_id.encode()).hexdigest()[:32]
  revision = {"feedback": feedback.strip(), "source": {
    "proposal_id": source["id"], "updated_at": source["updated_at"], "body": source["proposed_body"],
    "generation_id": source.get("draft", {}).get("generation_id", ""),
    "provider": source.get("draft", {}).get("provider", ""), "model": source.get("draft", {}).get("model", ""),
  }}
  if _proposal_file(paths, revision_id).exists():
    existing = get_proposal(paths, revision_id)
    if existing.get("draft_revision") != revision:
      raise OpenAuthorError("This revision request id belongs to another draft or direction.")
    return existing
  create_proposal(paths, proposal_id=revision_id, title=f"Revise draft: {source['title']}",
    instruction=source["instruction"], scene_id=source["scene_id"], source="draft_revision",
    generation=source.get("generation"), revision_intent=source.get("revision_intent"), draft_revision=revision)
  return get_proposal(paths, revision_id)


def _read_proposal(proposal_file: Path) -> dict[str, Any]:
  return json.loads(proposal_file.read_text(encoding="utf-8"))


@serialized_project_access
def get_proposal(paths: ProjectPaths, proposal_id: str) -> dict[str, Any]:
  proposal_path = _proposal_file(paths, proposal_id)
  if not proposal_path.exists():
    raise OpenAuthorError(f"Unknown proposal id '{proposal_id}'.")
  payload = _read_proposal(proposal_path)
  payload["stale"] = _proposal_is_stale(paths, payload)
  return payload


@serialized_project_access
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


@serialized_project_access
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


@serialized_project_access
def select_draft_candidate(paths: ProjectPaths, *, proposal_id: str, candidate: str, expected_updated_at: str) -> dict[str, Any]:
  """Let the author choose a retained candidate without spending or applying."""
  proposal = get_proposal(paths, proposal_id)
  if proposal.get("status") != "pending" or proposal.get("stale") or proposal.get("selection"):
    raise OpenAuthorError("Only current pending scene drafts can switch candidates.")
  if not expected_updated_at or proposal.get("updated_at") != expected_updated_at:
    raise OpenAuthorError("The Change Set changed. Refresh it before choosing a draft candidate.")
  draft = dict(proposal.get("draft", {}))
  report = dict(draft.get("writing_review") or {})
  field = {"first": "first_candidate", "refined": "refined_candidate"}.get(candidate)
  body = report.get(field) if field else None
  if not isinstance(body, str) or not body.strip():
    raise OpenAuthorError("Choose a retained first or refined draft candidate.")
  report["author_selected"] = candidate
  draft["writing_review"] = report
  source = next((row for row in report.get("stages", []) if row.get("stage") == "refine"), {}) if candidate == "refined" else {}
  draft["generation_id"] = source.get("generation_id", draft.get("initial_generation_id", draft.get("generation_id")))
  draft["log_path"] = source.get("log_path", draft.get("initial_log_path", draft.get("log_path")))
  draft["changed"] = re.sub(r"\s+", " ", body).strip() != re.sub(r"\s+", " ", get_scene(paths, proposal["scene_id"])["body"]).strip()
  return set_proposal_draft(paths, proposal_id=proposal_id, proposed_body=body, draft=draft)


@serialized_project_access
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
  if payload.get("selection"):
    raise OpenAuthorError("A selection edit cannot be replaced with a whole-scene draft. Select the passage again.")
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


@serialized_project_access
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


@serialized_project_access
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


@serialized_project_access
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


@serialized_project_access
@recoverable_project_edit
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
  selection = payload.get("selection")
  if isinstance(selection, dict):
    if selection.get("action") == "critique":
      raise OpenAuthorError("Critique is feedback only and cannot be applied to the manuscript.")
    if selection.get("unchanged") or selection.get("after") == selection.get("before"):
      raise OpenAuthorError("This result suggests no replacement. The selected passage was returned unchanged.")
    if _proposal_is_stale(paths, payload):
      raise OpenAuthorError("The scene or book version changed. Select the passage again; selection edits cannot force-overwrite newer writing.")
    before = get_scene(paths, scene_id)["body"]
    start, end = selection["start"], selection["end"]
    if before[start:end] != selection["before"] or proposed_body != before[:start] + selection["after"] + before[end:] or payload.get("change_set"):
      raise OpenAuthorError("The selection anchor or replacement is invalid. Select the passage again.")
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


@serialized_project_access
@recoverable_project_edit
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
    if payload.get("selection"):
      raise OpenAuthorError("Selection edits must be reviewed and applied individually.")
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
  group_metadata = {
    "change_group_id": group_id,
    "proposal_ids": normalized,
    "scene_ids": sorted(scene_ids),
    "undo_schema_version": 1,
    "workspace": prepared[0]["scene"]["edit_version"]["workspace"],
    "proposal_scenes": {row["id"]: {"id": row["scene_id"], "path": row["scene"]["path"]} for row in prepared},
  }
  try:
    pre_apply_snapshot = create_revision(
      paths,
      f"Before coordinated Change Set {group_id}",
      kind="change_group_before",
      metadata=group_metadata,
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
      metadata=group_metadata,
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
        "coordinated_undo_available": True,
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


@serialized_project_access
@recoverable_project_edit
def undo_proposal_batch(paths: ProjectPaths, *, applied_revision: str) -> dict[str, Any]:
  """Restore an exact recorded group, or leave every member untouched.

  Membership, original files and Storyline scope come from the applied Revision.
  There is deliberately no force option or caller-selected subset. Old groups
  without a recorded undo recipe retain the individual scene review workflow.
  """
  if not re.fullmatch(r"[a-f0-9]{64}", applied_revision):
    raise OpenAuthorError("A valid applied Revision id is required for coordinated undo.")
  applied = get_revision(paths, applied_revision)
  metadata = applied.get("metadata", {})
  if applied.get("kind") != "change_group_apply" or not isinstance(metadata, dict) or metadata.get("undo_schema_version") != 1:
    raise OpenAuthorError("This Revision has no coordinated undo record. Review its scenes individually.")
  ids = metadata.get("proposal_ids")
  members = metadata.get("proposal_scenes")
  if (
    not isinstance(ids, list) or len(ids) < 2
    or any(not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", value) for value in ids)
    or len(set(ids)) != len(ids) or not isinstance(members, dict) or set(members) != set(ids)
    or not isinstance(metadata.get("change_group_id"), str) or not metadata["change_group_id"].strip()
    or not isinstance(metadata.get("workspace"), str) or not re.fullmatch(r"[a-f0-9]{64}", metadata["workspace"])
    or not isinstance(metadata.get("scene_ids"), list)
  ):
    raise OpenAuthorError("The coordinated undo membership is incomplete. No scenes were restored.")
  before_id = str(applied.get("parent", ""))
  if not re.fullmatch(r"[a-f0-9]{64}", before_id):
    raise OpenAuthorError("The coordinated pre-change Revision id is invalid.")
  before = get_revision(paths, before_id)
  if before.get("kind") != "change_group_before" or before.get("metadata") != metadata:
    raise OpenAuthorError("The coordinated pre-change Revision does not match its applied group.")

  original_head = revision_head(paths)
  ancestor = original_head
  visited: set[str] = set()
  while ancestor and ancestor != applied_revision and ancestor not in visited:
    visited.add(ancestor)
    ancestor = str(get_revision(paths, ancestor).get("parent", ""))
  if ancestor != applied_revision:
    raise OpenAuthorError("This coordinated Revision is not in the current manuscript history.")

  prepared: list[dict[str, Any]] = []
  scene_ids: set[str] = set()
  originals: dict[Path, str] = {}
  for proposal_id in ids:
    member = members[proposal_id]
    if not isinstance(member, dict) or not isinstance(member.get("id"), str) or member["id"] in scene_ids:
      raise OpenAuthorError("The coordinated undo scene membership is invalid.")
    scene = get_scene(paths, member["id"])
    if scene["path"] != member.get("path") or scene["edit_version"]["workspace"] != metadata.get("workspace"):
      raise OpenAuthorError("Coordinated undo was stopped because the Storyline or scene location changed.")
    scene_path = paths.root / scene["path"]
    current = scene_path.read_text(encoding="utf-8")
    if current != read_file_at_revision(paths, applied_revision, scene["path"]):
      raise OpenAuthorError(f"Scene '{scene['title']}' has changed since this Revision. Undo was stopped to protect newer work; no scenes were restored.")
    restored = read_file_at_revision(paths, before_id, scene["path"])
    if split_scene_text(restored)[0].get("id") != scene["id"]:
      raise OpenAuthorError("The coordinated undo snapshot targets a different scene.")
    file_path = _proposal_file(paths, proposal_id)
    try:
      original_proposal = file_path.read_text(encoding="utf-8")
      payload = json.loads(original_proposal)
    except (OSError, ValueError) as error:
      raise OpenAuthorError(f"Coordinated undo needs every proposal record, including '{proposal_id}'.") from error
    if (
      not isinstance(payload, dict) or payload.get("id") != proposal_id
      or payload.get("status") != "applied" or not payload.get("applied_changes")
      or payload.get("undone_at") or payload.get("applied_revision") != applied_revision
      or payload.get("pre_apply_snapshot") != before_id or payload.get("scene_id") != scene["id"]
    ):
      raise OpenAuthorError(f"Proposal '{proposal_id}' was already undone or no longer matches this coordinated Revision. No scenes were restored.")
    scene_ids.add(scene["id"])
    originals[scene_path] = current
    originals[file_path] = original_proposal
    prepared.append({"file": file_path, "scene_path": scene_path, "scene_id": scene["id"], "restored": restored, "payload": payload})
  if sorted(scene_ids) != metadata.get("scene_ids"):
    raise OpenAuthorError("The coordinated undo scene list does not match the recorded group.")

  originals[paths.revision_head_file] = paths.revision_head_file.read_text(encoding="utf-8")
  try:
    for row in prepared:
      atomic_write_text(row["scene_path"], row["restored"])
    undo_revision = create_revision(
      paths, f"Undo coordinated Change Set {metadata['change_group_id']}", kind="change_group_undo",
      metadata={**metadata, "applied_revision": applied_revision, "restored_revision": before_id},
    )
    undone_at = utc_now()
    for row in prepared:
      row["payload"].update({
        "undone_at": undone_at, "updated_at": undone_at, "undo_revision": undo_revision,
        "restored_revision": before_id, "scene_digest": _scene_digest(paths, row["scene_id"]),
      })
      atomic_write_json(row["file"], row["payload"])
    scenes = [get_scene(paths, row["scene_id"]) for row in prepared]
  except (OpenAuthorError, OSError, ValueError) as error:
    rollback_errors = []
    for path, content in originals.items():
      try:
        atomic_write_text(path, content)
      except OSError as rollback_error:
        rollback_errors.append(str(rollback_error))
    if rollback_errors:
      raise OpenAuthorError("Coordinated undo failed and rollback could not finish. Stop editing and recover from Revision history: " + "; ".join(rollback_errors)) from error
    raise OpenAuthorError(f"Coordinated undo was rolled back: {error}") from error
  warnings = []
  try:
    from .product_signals import record_product_event
    record_product_event(paths, "change_set_undone")
  except (OpenAuthorError, OSError) as error:
    warnings.append(f"Undo succeeded, but its local activity signal could not be recorded: {error}")
  return {
    "change_group_id": metadata["change_group_id"], "applied_revision": applied_revision,
    "undo_revision": undo_revision, "restored_revision": before_id,
    "proposal_ids": ids, "scene_ids": sorted(scene_ids), "scenes": scenes,
    "proposals": [{**row["payload"], "stale": False} for row in prepared], "warnings": warnings,
  }


@serialized_project_access
@recoverable_project_edit
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
  if payload.get("selection") and _proposal_is_stale(paths, payload):
    raise OpenAuthorError("The scene or book version changed since applying this selection. Undo stopped to protect newer writing.")

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
  if proposal.get("selection") and proposal["selection"].get("branch") != _capture_vcs_anchor(paths)[0]:
    return True
  source_digests = (proposal.get("selection") or {}).get("review_source_digests")
  if isinstance(source_digests, dict):
    for source_id, expected_digest in source_digests.items():
      try:
        actual_digest = current_digests.get(source_id) if current_digests is not None else _scene_digest(paths, source_id)
      except OpenAuthorError:
        return True
      if actual_digest != expected_digest:
        return True
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
