from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .ai import (
  DEFAULT_MODELS,
  SUPPORTED_PROVIDERS,
  generate_merge_resolution,
  generate_proposal,
  generate_proposal_draft,
  regenerate_change_hunk,
  preview_proposal_revision,
  preview_proposal_generation,
  preview_merge_resolution,
)
from .auth import SUPPORTED_AUTH_PROVIDERS, get_auth_status, login as auth_login, logout as auth_logout
from .backups import create_backup, restore_backup, verify_backup
from .budget import (
  BUDGET_LIMIT_FIELDS,
  get_generation_budget_report,
  reset_generation_budget_policy,
  summarize_generation_usage,
  update_generation_budget_policy,
)
from .checks import run_continuity_checks
from .chat import (
  create_chat_thread,
  execute_pending_tool_call,
  get_chat_thread,
  get_chat_turn_diff,
  list_chat_messages,
  list_chat_threads,
  rename_chat_thread,
  send_chat_message,
  preview_chat_context,
  reconcile_chat_delivery,
  truncate_chat_messages,
  update_chat_thread,
)
from .codex import (
  AI_VISIBILITY_VALUES,
  ENTITY_TYPES,
  SCOPE_VALUES,
  add_entity,
  add_relationship,
  delete_relationship,
  ensure_codex,
  get_entity,
  list_entities,
  list_relationships,
  update_entity,
)
from .generations import (
  clear_pinned_generation_run,
  get_generation_run,
  get_generation_runtime_config,
  list_generation_runs,
  list_pinned_generation_runs,
  rerun_generation,
  set_pinned_generation_run,
)
from .hardening import (
  audit_workspace_metadata,
  collect_startup_health,
  collect_performance_baseline,
  format_performance_baseline_text,
  format_workspace_audit_text,
)
from .manuscript_io import export_manuscript, import_manuscript, preview_manuscript_import
from .planning import (
  add_act,
  add_beat,
  add_chapter,
  add_scene_note,
  assign_scene,
  get_plan,
  get_manuscript_reading,
  get_plan_workspace,
  preview_scene_move,
  update_brief,
  update_scene_metadata,
)
from .git_ops import (
  create_branch,
  create_snapshot,
  diff_branches,
  initialize_git,
  list_branches,
  list_snapshots,
  merge_branches,
  merge_revision_pair,
  preflight_merge,
  scan_merge_conflicts,
  switch_branch,
)
from .project import (
  OpenAuthorError,
  ensure_project_identity,
  initialize_project,
  initialize_project_from_folder,
  initialize_project_from_zip,
  inspect_project,
  resolve_project,
)
from .proposals import (
  apply_proposal,
  apply_proposal_batch,
  create_proposal,
  edit_change_hunk,
  get_proposal,
  select_draft_candidate,
  list_proposals,
  rebase_proposal_change_set,
  undo_proposal,
  undo_proposal_batch,
  update_change_hunk,
  update_proposal_status,
)
from .project_lock import project_write_lock
from .retrieval import build_retrieval_index, get_retrieval_index_status, query_retrieval_index
from .revisions import checkpointed_edit, compare_revisions, create_revision, get_revision, list_revisions, restore_revision, revision_retrospective
from .scenes import add_scene, get_scene, list_scenes, scene_id, update_scene
from .scene_edits import SceneEditConflict, save_scene_edit
from .story_memory import correct_memory_suggestion, extract_memory_suggestions, list_memory_suggestions, queue_memory_suggestion, review_memory_suggestion
from .search import search_project
from .editorial import add_editorial_pass, list_editorial_passes
from .canon import (
  add_canon_fact,
  add_arc_state,
  add_open_question,
  add_setup,
  disposition_diagnostic,
  list_canon_facts,
  update_canon_fact,
  list_arc_states,
  list_open_questions,
  list_setups,
  resolve_setup,
  review_canon_fact,
  run_canon_diagnostics,
)
from .storylines import (
  compare_storyline,
  create_storyline,
  create_storyline_integration_changes,
  duplicate_storyline,
  list_storylines,
  save_storyline_progress,
  rename_storyline,
  switch_storyline,
  update_storyline_status,
)
from .style_profile import save_style_profile
from .writing_voice import voice_workspace, suggest_voice, preview_voice, refine_voice_preview, review_voice_preview, stage_voice_preview
from .style_profile import build_style_profile, get_style_profile, set_style_profile_reference
from .product_signals import (
  get_local_product_dashboard,
  get_product_signal_settings,
  update_product_signal_settings,
)


def build_parser() -> argparse.ArgumentParser:
  parser = argparse.ArgumentParser(prog="openauthor", description="Local-first fiction authoring tools.")
  subparsers = parser.add_subparsers(dest="command", required=True)

  init_parser = subparsers.add_parser("init", help="Initialize an openAuthor project.")
  init_parser.add_argument("path", nargs="?", default=".", help="Project directory (default: current directory).")
  init_parser.add_argument("--name", default=None, help="Project name override.")
  init_parser.add_argument("--project-id", default=None, help="Optional explicit project id.")
  init_parser.add_argument("--from-zip", default=None, help="Optional zip archive to scaffold/import.")
  init_parser.add_argument("--from-folder", default=None, help="Optional folder source to scaffold/import.")
  init_parser.add_argument("--json", action="store_true", help="Output JSON.")

  project_parser = subparsers.add_parser("project", help="Inspect and manage project identity metadata.")
  project_sub = project_parser.add_subparsers(dest="project_command", required=True)
  project_inspect = project_sub.add_parser("inspect", help="Inspect project metadata and identity.")
  project_inspect.add_argument("--json", action="store_true", help="Output JSON.")
  project_recovery_status = project_sub.add_parser("recovery-status", help="Inspect interrupted-edit files without changing them.")
  project_recovery_status.add_argument("--json", action="store_true")
  project_recovery_resolve = project_sub.add_parser("recovery-resolve", help="Resolve an exact reviewed interrupted-edit comparison.")
  project_recovery_resolve.add_argument("--fingerprint", required=True)
  project_recovery_resolve.add_argument("--decisions", required=True, help="JSON mapping conflicting file paths to keep_current or restore_before.")
  project_recovery_resolve.add_argument("--json", action="store_true")
  project_ensure_id = project_sub.add_parser(
    "ensure-id",
    help="Ensure project has a persistent project_id; optionally enforce expected id.",
  )
  project_ensure_id.add_argument("--id", dest="expected_id", default=None, help="Expected project id.")
  project_ensure_id.add_argument("--json", action="store_true", help="Output JSON.")

  manuscript_parser = subparsers.add_parser("manuscript", help="Import and export manuscript files.")
  manuscript_sub = manuscript_parser.add_subparsers(dest="manuscript_command", required=True)
  manuscript_read = manuscript_sub.add_parser("read", help="Read saved prose in planned chapter order.")
  manuscript_read.add_argument("--json", action="store_true", help="Output JSON.")
  manuscript_preview = manuscript_sub.add_parser("preview", help="Preview detected manuscript structure without writing scenes.")
  manuscript_preview.add_argument("--source", required=True, help="Markdown, TXT, DOCX, Scrivener, or folder source.")
  manuscript_preview.add_argument("--strategy", choices=["auto", "files", "headings", "single"], default="auto")
  manuscript_preview.add_argument("--corrections", default="{}", help="JSON object mapping preview section IDs to role/title corrections.")
  manuscript_preview.add_argument("--json", action="store_true", help="Output JSON.")
  manuscript_import = manuscript_sub.add_parser("import", help="Import a previously reviewed manuscript structure.")
  manuscript_import.add_argument("--source", required=True, help="Markdown, TXT, DOCX, Scrivener, or folder source.")
  manuscript_import.add_argument("--strategy", choices=["auto", "files", "headings", "single"], default="auto")
  manuscript_import.add_argument("--corrections", default="{}", help="Reviewed section role/title corrections as JSON.")
  manuscript_import.add_argument("--expected-fingerprint", default=None, help="Refuse import if the reviewed source or corrections changed.")
  manuscript_import.add_argument("--json", action="store_true", help="Output JSON.")
  manuscript_export = manuscript_sub.add_parser("export", help="Export the manuscript with a loss report.")
  manuscript_export.add_argument("--format", choices=["markdown", "docx"], required=True)
  manuscript_export.add_argument("--target", required=True, help="Output folder for Markdown or .docx path.")
  manuscript_export.add_argument("--json", action="store_true", help="Output JSON.")

  auth_parser = subparsers.add_parser("auth", help="Manage provider authentication.")
  auth_sub = auth_parser.add_subparsers(dest="auth_command", required=True)
  auth_login_parser = auth_sub.add_parser("login", help="Sign in with a provider subscription.")
  auth_login_parser.add_argument("--provider", required=True, choices=sorted(SUPPORTED_AUTH_PROVIDERS), help="Auth provider.")
  auth_login_parser.add_argument("--json", action="store_true")
  auth_logout_parser = auth_sub.add_parser("logout", help="Sign out from a provider.")
  auth_logout_parser.add_argument("--provider", required=True, choices=sorted(SUPPORTED_AUTH_PROVIDERS), help="Auth provider.")
  auth_logout_parser.add_argument("--json", action="store_true")
  auth_status_parser = auth_sub.add_parser("status", help="Show authentication status.")
  auth_status_parser.add_argument("--json", action="store_true")

  scene_parser = subparsers.add_parser("scene", help="Manage scene files.")
  scene_sub = scene_parser.add_subparsers(dest="scene_command", required=True)
  scene_add = scene_sub.add_parser("add", help="Add a scene.")
  scene_add.add_argument("--title", required=True, help="Scene title.")
  scene_add.add_argument("--summary", default="", help="Scene summary.")
  scene_add.add_argument("--pov", default="", help="POV character.")
  scene_add.add_argument("--status", default="draft", help="Scene status.")
  scene_add.add_argument("--body", default="", help="Initial body text.")
  scene_add.add_argument("--json", action="store_true", help="Output the created scene as JSON.")
  scene_list = scene_sub.add_parser("list", help="List scenes.")
  scene_list.add_argument("--json", action="store_true", help="Output JSON.")
  scene_get = scene_sub.add_parser("get", help="Get a scene by id.")
  scene_get.add_argument("--id", required=True, help="Scene id.")
  scene_get.add_argument("--json", action="store_true", help="Output JSON.")
  scene_update = scene_sub.add_parser("update", help="Update scene fields.")
  scene_update.add_argument("--id", required=True, help="Scene id.")
  scene_update.add_argument("--title", default=None, help="New title.")
  scene_update.add_argument("--summary", default=None, help="New summary.")
  scene_update.add_argument("--pov", default=None, help="New POV.")
  scene_update.add_argument("--status", default=None, help="New status.")
  scene_update.add_argument("--body", default=None, help="New body content.")
  scene_update.add_argument("--expected-version", default=None, help="Loaded scene edit_version JSON; required for guarded editor saves.")
  scene_update.add_argument("--json", action="store_true", help="Output JSON.")

  codex_parser = subparsers.add_parser("codex", help="Manage codex entities.")
  codex_sub = codex_parser.add_subparsers(dest="codex_command", required=True)
  codex_add = codex_sub.add_parser("add", help="Add codex entity.")
  codex_add.add_argument("--type", required=True, choices=sorted(ENTITY_TYPES), help="Entity type.")
  codex_add.add_argument("--name", required=True, help="Entity name.")
  codex_add.add_argument("--description", default="", help="Entity description.")
  codex_add.add_argument("--category", default="")
  codex_add.add_argument("--alias", action="append", default=[])
  codex_add.add_argument("--tag", action="append", default=[])
  codex_add.add_argument("--details-json", default="[]")
  codex_add.add_argument("--notes", default="")
  codex_add.add_argument("--ai-visibility", choices=sorted(AI_VISIBILITY_VALUES), default="include")
  codex_add.add_argument("--scope", choices=sorted(SCOPE_VALUES), default="project")
  codex_add.add_argument("--json", action="store_true", help="Output JSON.")
  codex_list = codex_sub.add_parser("list", help="List codex entities.")
  codex_list.add_argument("--type", choices=sorted(ENTITY_TYPES), default=None, help="Filter by type.")
  codex_list.add_argument("--json", action="store_true", help="Output JSON.")
  codex_get = codex_sub.add_parser("get", help="Get codex entity by id.")
  codex_get.add_argument("--id", required=True, help="Entity id.")
  codex_get.add_argument("--json", action="store_true", help="Output JSON.")
  codex_update = codex_sub.add_parser("update", help="Update codex entity.")
  codex_update.add_argument("--id", required=True, help="Entity id.")
  codex_update.add_argument("--type", choices=sorted(ENTITY_TYPES), default=None, help="Entity type.")
  codex_update.add_argument("--name", default=None, help="Entity name.")
  codex_update.add_argument("--description", default=None, help="Entity description.")
  codex_update.add_argument("--category", default=None)
  codex_update.add_argument("--alias", action="append", default=None)
  codex_update.add_argument("--tag", action="append", default=None)
  codex_update.add_argument("--details-json", default=None)
  codex_update.add_argument("--notes", default=None)
  codex_update.add_argument("--ai-visibility", choices=sorted(AI_VISIBILITY_VALUES), default=None)
  codex_update.add_argument("--scope", choices=sorted(SCOPE_VALUES), default=None)
  codex_update.add_argument("--json", action="store_true", help="Output JSON.")
  codex_relationship_add = codex_sub.add_parser("relationship-add", help="Relate two Story Memory entries.")
  codex_relationship_add.add_argument("--source", required=True)
  codex_relationship_add.add_argument("--target", required=True)
  codex_relationship_add.add_argument("--relation", required=True)
  codex_relationship_add.add_argument("--notes", default="")
  codex_relationship_add.add_argument("--valid-from", default="")
  codex_relationship_add.add_argument("--valid-to", default="")
  codex_relationship_add.add_argument("--json", action="store_true", help="Output JSON.")
  codex_relationship_list = codex_sub.add_parser("relationship-list", help="List explicit entity relationships.")
  codex_relationship_list.add_argument("--entity", default=None)
  codex_relationship_list.add_argument("--json", action="store_true", help="Output JSON.")
  codex_relationship_delete = codex_sub.add_parser("relationship-delete", help="Delete an entity relationship.")
  codex_relationship_delete.add_argument("--id", required=True)
  codex_relationship_delete.add_argument("--json", action="store_true", help="Output JSON.")

  proposal_parser = subparsers.add_parser("proposal", help="Manage AI proposal queue.")
  proposal_sub = proposal_parser.add_subparsers(dest="proposal_command", required=True)
  for selection_action in ("selection-preview", "selection-generate"):
    selection_parser = proposal_sub.add_parser(selection_action, help="Preview or generate a range-anchored selection edit.")
    selection_parser.add_argument("--input-json", required=True, help="Selection range, action, provider and one-turn permissions.")
    selection_parser.add_argument("--json", action="store_true")
    if selection_action == "selection-generate":
      selection_parser.add_argument("--expected-fingerprint", required=True)
      selection_parser.add_argument("--request-id", required=True)
  proposal_add = proposal_sub.add_parser("add", help="Create proposal.")
  proposal_add.add_argument("--title", required=True, help="Proposal title.")
  proposal_add.add_argument("--instruction", required=True, help="Change instruction.")
  proposal_add.add_argument("--scene", default="", help="Associated scene id.")
  proposal_add.add_argument("--json", action="store_true", help="Output JSON.")
  proposal_list = proposal_sub.add_parser("list", help="List proposals.")
  proposal_list.add_argument("--status", choices=["pending", "applied", "rejected"], default=None)
  proposal_list.add_argument("--json", action="store_true", help="Output JSON.")
  proposal_get = proposal_sub.add_parser("get", help="Get proposal by id.")
  proposal_get.add_argument("--id", required=True, help="Proposal id.")
  proposal_get.add_argument("--json", action="store_true", help="Output JSON.")
  proposal_apply = proposal_sub.add_parser(
    "apply",
    help="Apply proposal (writes the drafted scene body when present).",
  )
  proposal_apply.add_argument("--id", required=True, help="Proposal id.")
  proposal_apply.add_argument("--notes", default="", help="Optional note.")
  proposal_apply.add_argument(
    "--force",
    action="store_true",
    help="Apply the drafted body even if the scene changed since drafting.",
  )
  proposal_apply.add_argument("--json", action="store_true", help="Output JSON.")
  proposal_apply_batch = proposal_sub.add_parser("apply-batch", help="Atomically apply coordinated Change Sets across scenes.")
  proposal_apply_batch.add_argument("--id", action="append", required=True, dest="ids")
  proposal_apply_batch.add_argument("--notes", default="")
  proposal_apply_batch.add_argument("--force", action="store_true")
  proposal_apply_batch.add_argument("--json", action="store_true", help="Output JSON.")

  proposal_undo_batch = proposal_sub.add_parser("undo-batch", help="Undo every scene in a coordinated Revision, protecting newer work.")
  proposal_undo_batch.add_argument("--revision", required=True, help="Applied coordinated Revision id.")
  proposal_undo_batch.add_argument("--json", action="store_true", help="Output JSON.")
  proposal_draft = proposal_sub.add_parser(
    "draft",
    help="Generate the full revised scene body for a pending proposal.",
  )
  proposal_draft.add_argument("--id", required=True, help="Proposal id.")
  proposal_draft.add_argument("--request-id", default="", help="Reuse this id to recover the same draft delivery.")
  proposal_draft.add_argument("--memory-approvals", default="[]", help="JSON array of one-request Memory permissions.")
  proposal_draft.add_argument("--story-approvals", default="[]", help="JSON array of one-request Canon and relationship ids.")
  proposal_draft.add_argument("--expected-context-fingerprint", default="", help="Fingerprint from revision-preview; required for external AI providers.")
  proposal_draft.add_argument("--review-mode", choices=["off", "refine"], default="off", help="Evidence-based critique and focused refinement (up to four model calls).")
  proposal_draft.add_argument("--review-reasoning-effort", choices=["low", "medium", "high"], default=None, help="ChatGPT reasoning effort for critique, refinement and verification; writer keeps its model default.")
  proposal_draft.add_argument(
    "--provider",
    choices=sorted(SUPPORTED_PROVIDERS),
    default="local",
    help="AI provider (default: local).",
  )
  proposal_draft.add_argument("--model", default=None, help="Model override.")
  proposal_draft.add_argument(
    "--temperature",
    type=float,
    default=0.3,
    help="Sampling temperature (default: 0.3).",
  )
  proposal_draft.add_argument(
    "--max-output-tokens",
    type=int,
    default=None,
    help="Output allowance (default: sized to the complete scene, 2,000–12,000 tokens).",
  )
  proposal_draft.add_argument("--json", action="store_true", help="Output JSON.")
  proposal_draft_select = proposal_sub.add_parser("draft-select", help="Choose a retained draft candidate; rebuilds hunks for author review.")
  proposal_draft_select.add_argument("--id", required=True)
  proposal_draft_select.add_argument("--candidate", choices=["first", "refined"], required=True)
  proposal_draft_select.add_argument("--expected-updated-at", required=True)
  proposal_draft_select.add_argument("--json", action="store_true")
  proposal_hunk = proposal_sub.add_parser("hunk", help="Accept or reject one Change Hunk.")
  proposal_hunk.add_argument("--id", required=True, help="Proposal id.")
  proposal_hunk.add_argument("--hunk", required=True, help="Change Hunk id.")
  proposal_hunk.add_argument("--decision", choices=["accepted", "rejected"], required=True)
  proposal_hunk.add_argument("--json", action="store_true", help="Output JSON.")
  proposal_hunk_edit = proposal_sub.add_parser("hunk-edit", help="Directly edit one Change Hunk replacement.")
  proposal_hunk_edit.add_argument("--id", required=True, help="Proposal id.")
  proposal_hunk_edit.add_argument("--hunk", required=True, help="Change Hunk id.")
  proposal_hunk_edit.add_argument("--after-text", required=True, help="Replacement prose for this hunk.")
  proposal_hunk_edit.add_argument("--json", action="store_true", help="Output JSON.")
  proposal_hunk_regenerate = proposal_sub.add_parser("hunk-regenerate", help="Regenerate one Change Hunk.")
  proposal_hunk_regenerate.add_argument("--id", required=True, help="Proposal id.")
  proposal_hunk_regenerate.add_argument("--hunk", required=True, help="Change Hunk id.")
  proposal_hunk_regenerate.add_argument("--provider", choices=sorted(SUPPORTED_PROVIDERS), default="local")
  proposal_hunk_regenerate.add_argument("--model", default=None)
  proposal_hunk_regenerate.add_argument("--temperature", type=float, default=0.3)
  proposal_hunk_regenerate.add_argument("--max-output-tokens", type=int, default=700)
  proposal_hunk_regenerate.add_argument("--feedback", default="", help="Author feedback for this hunk revision.")
  proposal_hunk_regenerate.add_argument("--request-id", default="", help="Reuse this id to recover the same hunk regeneration.")
  proposal_hunk_regenerate.add_argument("--memory-approvals", default="[]", help="JSON array of one-request Memory permissions.")
  proposal_hunk_regenerate.add_argument("--story-approvals", default="[]", help="JSON array of one-request Canon and relationship ids.")
  proposal_hunk_regenerate.add_argument("--expected-context-fingerprint", default="", help="Fingerprint from revision-preview; required for external AI providers.")
  proposal_hunk_regenerate.add_argument("--json", action="store_true", help="Output JSON.")
  revision_preview = proposal_sub.add_parser("revision-preview", help="Preview scene or passage revision context without contacting a provider.")
  revision_preview.add_argument("--input-json", required=True, help="Revision parameters including proposal_id and optional hunk_id.")
  revision_preview.add_argument("--json", action="store_true")
  generation_preview = proposal_sub.add_parser("generation-preview", help="Review the exact edit-plan request locally before generation.")
  generation_preview.add_argument("--input-json", required=True)
  generation_preview.add_argument("--json", action="store_true")
  proposal_rebase = proposal_sub.add_parser("rebase", help="Carry safe Change Hunks onto the current scene.")
  proposal_rebase.add_argument("--id", required=True, help="Proposal id.")
  proposal_rebase.add_argument("--json", action="store_true", help="Output JSON.")
  proposal_reject = proposal_sub.add_parser("reject", help="Mark proposal as rejected.")
  proposal_reject.add_argument("--id", required=True, help="Proposal id.")
  proposal_reject.add_argument("--notes", default="", help="Optional note.")
  proposal_reject.add_argument("--json", action="store_true", help="Output JSON.")
  proposal_generate = proposal_sub.add_parser("generate", help="Generate proposal via provider.")
  proposal_generate.add_argument("--scene", required=True, help="Scene id.")
  proposal_generate.add_argument("--request-id", default="", help="Reuse this id to recover the same proposal delivery.")
  proposal_generate.add_argument("--instruction", required=True, help="User generation instruction.")
  proposal_generate.add_argument("--scene-contract", default="{}", help="JSON object with authored purpose, turn, ending and optional word_range [minimum, maximum].")
  proposal_generate.add_argument("--memory-approvals", default="[]")
  proposal_generate.add_argument("--story-approvals", default="[]")
  proposal_generate.add_argument("--expected-context-fingerprint", default="", help="Fingerprint from generation-preview; required for external AI providers.")
  proposal_generate.add_argument("--title", default="", help="Optional proposal title override.")
  proposal_generate.add_argument(
    "--constraint",
    action="append",
    default=[],
    help="Hard revision constraint; repeat for multiple constraints.",
  )
  proposal_generate.add_argument(
    "--protect",
    action="append",
    default=[],
    help="Text, fact, voice trait, or other element that must remain unchanged.",
  )
  proposal_generate.add_argument(
    "--provider",
    choices=sorted(SUPPORTED_PROVIDERS),
    default="local",
    help="Generation provider.",
  )
  proposal_generate.add_argument(
    "--model",
    default=None,
    help=(
      "Provider model override. "
      f"Defaults: local={DEFAULT_MODELS['local']}, "
      f"openai={DEFAULT_MODELS['openai']}, "
      f"anthropic={DEFAULT_MODELS['anthropic']}."
    ),
  )
  proposal_generate.add_argument(
    "--temperature",
    type=float,
    default=0.2,
    help="Sampling temperature.",
  )
  proposal_generate.add_argument(
    "--max-output-tokens",
    type=int,
    default=700,
    help="Maximum output tokens.",
  )
  proposal_generate.add_argument(
    "--context-scenes",
    type=int,
    default=1,
    help="Nearby scene radius for context packing.",
  )
  proposal_generate.add_argument(
    "--codex-limit",
    type=int,
    default=20,
    help="Maximum codex entities in packed context.",
  )
  proposal_generate.add_argument(
    "--retrieval-mode",
    choices=["off", "auto", "required"],
    default="off",
    help="Retrieval mode for citation-backed context.",
  )
  proposal_generate.add_argument(
    "--retrieval-limit",
    type=int,
    default=5,
    help="Maximum retrieval citations to include when enabled.",
  )
  proposal_generate.add_argument(
    "--retrieval-min-score",
    type=float,
    default=0.0,
    help="Minimum retrieval score threshold.",
  )
  proposal_generate.add_argument(
    "--retrieval-require-fresh",
    action="store_true",
    help="Require retrieval index freshness when retrieval mode is enabled.",
  )
  proposal_generate.add_argument("--json", action="store_true", help="Output JSON.")
  proposal_generate.add_argument("--change-group", default="", help="Coordinate this Change Set with other scene proposals.")

  proposal_undo = proposal_sub.add_parser("undo", help="Restore the scene revision from before an applied proposal.")
  proposal_undo.add_argument("--id", required=True, help="Proposal id.")
  proposal_undo.add_argument("--force", action="store_true", help="Replace scene changes made after apply.")
  proposal_undo.add_argument("--json", action="store_true", help="Output JSON.")

  backup_parser = subparsers.add_parser("backup", help="Create, verify, and recover portable book archives.")
  backup_sub = backup_parser.add_subparsers(dest="backup_command", required=True)
  for action in ("create", "verify", "restore"):
    command = backup_sub.add_parser(action)
    if action != "create":
      command.add_argument("--source", required=True)
    if action != "verify":
      command.add_argument("--target", required=True)
    command.add_argument("--json", action="store_true")

  revision_parser = subparsers.add_parser("revision", help="Inspect, compare, and restore local Revisions.")
  revision_sub = revision_parser.add_subparsers(dest="revision_command", required=True)
  revision_save = revision_sub.add_parser("save", help="Save a named version of the manuscript, Plan, and Story Memory.")
  revision_save.add_argument("--message", required=True)
  revision_save.add_argument("--json", action="store_true", help="Output JSON.")
  revision_list = revision_sub.add_parser("list", help="List recent Revisions.")
  revision_list.add_argument("--limit", type=int, default=50)
  revision_list.add_argument("--json", action="store_true", help="Output JSON.")
  revision_get = revision_sub.add_parser("get", help="Inspect one Revision.")
  revision_get.add_argument("--id", required=True)
  revision_get.add_argument("--json", action="store_true", help="Output JSON.")
  revision_diff = revision_sub.add_parser("diff", help="Compare two Revisions.")
  revision_diff.add_argument("--base", required=True)
  revision_diff.add_argument("--head", required=True)
  revision_diff.add_argument("--include-unchanged", action="store_true", help="Include all files available to restore.")
  revision_diff.add_argument("--json", action="store_true", help="Output JSON.")
  revision_restore = revision_sub.add_parser("restore", help="Restore selected files as a new Revision.")
  revision_restore.add_argument("--id", required=True)
  revision_restore.add_argument("--path", action="append", required=True, dest="paths")
  revision_restore.add_argument("--json", action="store_true", help="Output JSON.")
  revision_retro = revision_sub.add_parser("retrospective", help="Summarize creative outcomes and remaining goals.")
  revision_retro.add_argument("--base", required=True)
  revision_retro.add_argument("--head", required=True)
  revision_retro.add_argument("--json", action="store_true", help="Output JSON.")

  plan_parser = subparsers.add_parser("plan", help="Manage the portable manuscript plan and hierarchy.")
  plan_sub = plan_parser.add_subparsers(dest="plan_command", required=True)
  plan_get = plan_sub.add_parser("get", help="Get the project brief and manuscript hierarchy.")
  plan_get.add_argument("--json", action="store_true", help="Output JSON.")
  plan_brief = plan_sub.add_parser("brief", help="Update project brief fields.")
  plan_brief.add_argument("--synopsis", default=None)
  plan_brief.add_argument("--genre", default=None)
  plan_brief.add_argument("--theme", action="append", default=None, dest="themes")
  plan_brief.add_argument("--style-guide", default=None)
  plan_brief.add_argument("--outline", default=None)
  plan_brief.add_argument("--expected-version", default=None)
  plan_brief.add_argument("--clear-themes", action="store_true")
  plan_brief.add_argument("--json", action="store_true", help="Output JSON.")
  plan_act = plan_sub.add_parser("act-add", help="Add an act.")
  plan_act.add_argument("--title", required=True)
  plan_act.add_argument("--synopsis", default="")
  plan_act.add_argument("--expected-workspace", default=None)
  plan_act.add_argument("--json", action="store_true", help="Output JSON.")
  plan_chapter = plan_sub.add_parser("chapter-add", help="Add a chapter to an act.")
  plan_chapter.add_argument("--act", required=True, dest="act_id")
  plan_chapter.add_argument("--title", required=True)
  plan_chapter.add_argument("--synopsis", default="")
  plan_chapter.add_argument("--expected-workspace", default=None)
  plan_chapter.add_argument("--json", action="store_true", help="Output JSON.")
  plan_assign = plan_sub.add_parser("scene-assign", help="Assign or reorder a scene.")
  plan_assign.add_argument("--scene", required=True, dest="scene_id")
  plan_assign.add_argument("--chapter", default=None, dest="chapter_id")
  plan_assign.add_argument("--before", default=None, dest="before_scene_id")
  plan_assign.add_argument("--expected-workspace", default=None)
  plan_assign.add_argument("--json", action="store_true", help="Output JSON.")
  plan_preview = plan_sub.add_parser("scene-preview", help="Preview structural consequences before moving a scene.")
  plan_preview.add_argument("--scene", required=True, dest="scene_id")
  plan_preview.add_argument("--chapter", default=None, dest="chapter_id")
  plan_preview.add_argument("--before", default=None, dest="before_scene_id")
  plan_preview.add_argument("--json", action="store_true", help="Output JSON.")
  plan_scene_meta = plan_sub.add_parser("scene-meta", help="Update a scene's story-time position and planning labels.")
  plan_scene_meta.add_argument("--scene", required=True, dest="scene_id")
  plan_scene_meta.add_argument("--timeline", default=None, dest="timeline_position")
  plan_scene_meta.add_argument("--label", action="append", default=None, dest="labels")
  plan_scene_meta.add_argument("--expected-version", default=None)
  plan_scene_meta.add_argument("--clear-labels", action="store_true")
  plan_scene_meta.add_argument("--json", action="store_true", help="Output JSON.")
  plan_beat = plan_sub.add_parser("beat-add", help="Add a planned beat to a scene.")
  plan_beat.add_argument("--scene", required=True, dest="scene_id")
  plan_beat.add_argument("--summary", required=True)
  plan_beat.add_argument("--status", default="planned")
  plan_beat.add_argument("--expected-workspace", default=None)
  plan_beat.add_argument("--json", action="store_true", help="Output JSON.")
  plan_note = plan_sub.add_parser("note-add", help="Save a durable project or scene note.")
  plan_note.add_argument("--content", required=True)
  plan_note.add_argument("--scene", default="", dest="scene_id")
  plan_note.add_argument("--title", default="Assistant note")
  plan_note.add_argument("--source", default="author")
  plan_note.add_argument("--json", action="store_true", help="Output JSON.")

  memory_parser = subparsers.add_parser("memory", help="Extract and review evidence-backed Story Memory suggestions.")
  memory_sub = memory_parser.add_subparsers(dest="memory_command", required=True)
  memory_scan = memory_sub.add_parser("scan", help="Scan manuscript prose into a non-canon suggestion queue.")
  memory_scan.add_argument("--scene", action="append", default=None, dest="scene_ids")
  memory_scan.add_argument("--json", action="store_true", help="Output JSON.")
  for action, help_text in (("scan-preview", "Review exact selected sources before an optional AI Memory scan."),
      ("scan-ai", "Queue reviewed AI Memory candidates without accepting them.")):
    reviewed_scan = memory_sub.add_parser(action, help=help_text)
    reviewed_scan.add_argument("--request-json", required=True)
    reviewed_scan.add_argument("--json", action="store_true", help="Output JSON.")
  memory_list = memory_sub.add_parser("list", help="List Story Memory suggestions.")
  memory_list.add_argument("--status", choices=["pending", "accepted", "rejected", "deferred"], default=None)
  memory_list.add_argument("--json", action="store_true", help="Output JSON.")
  memory_review = memory_sub.add_parser("review", help="Accept, reject, or defer a suggestion.")
  memory_review.add_argument("--id", required=True)
  memory_review.add_argument("--disposition", choices=["accepted", "rejected", "deferred"], required=True)
  memory_review.add_argument("--expected-version", default=None)
  memory_review.add_argument("--json", action="store_true", help="Output JSON.")
  memory_correct = memory_sub.add_parser("correct", help="Correct a suggestion before accepting or deferring it.")
  memory_correct.add_argument("--id", required=True)
  memory_correct.add_argument("--name", default=None)
  memory_correct.add_argument("--description", default=None)
  memory_correct.add_argument("--predicate", default=None)
  memory_correct.add_argument("--value", default=None)
  memory_correct.add_argument("--entity-type", default=None)
  memory_correct.add_argument("--expected-version", default=None)
  memory_correct.add_argument("--json", action="store_true", help="Output JSON.")
  memory_suggest = memory_sub.add_parser("suggest", help="Queue a non-canon Story Memory suggestion for review.")
  memory_suggest.add_argument("--title", default="Assistant insight")
  memory_suggest.add_argument("--content", required=True)
  memory_suggest.add_argument("--scene", default="", dest="scene_id")
  memory_suggest.add_argument("--source", default="assistant")
  memory_suggest.add_argument("--json", action="store_true", help="Output JSON.")
  memory_fact_add = memory_sub.add_parser("fact-add", help="Add an evidence-backed temporal Canon Fact.")
  memory_fact_add.add_argument("--subject", default="")
  memory_fact_add.add_argument("--predicate", required=True)
  memory_fact_add.add_argument("--value", required=True)
  memory_fact_add.add_argument("--evidence-json", required=True)
  memory_fact_add.add_argument("--knowledge-json", default="[]")
  memory_fact_add.add_argument("--confidence", type=float, default=1.0)
  memory_fact_add.add_argument("--status", choices=["accepted", "suggested", "rejected"], default="accepted")
  memory_fact_add.add_argument("--valid-from", default="")
  memory_fact_add.add_argument("--valid-to", default="")
  memory_fact_add.add_argument("--scope", choices=["project", "series"], default="project")
  memory_fact_add.add_argument("--json", action="store_true", help="Output JSON.")
  memory_fact_list = memory_sub.add_parser("fact-list", help="List Canon Facts.")
  memory_fact_list.add_argument("--status", choices=["accepted", "suggested", "rejected"], default=None)
  memory_fact_list.add_argument("--for-editing", action="store_true", help="Include transient guarded-save versions.")
  memory_fact_list.add_argument("--json", action="store_true", help="Output JSON.")
  memory_fact_update = memory_sub.add_parser("fact-update", help="Correct or withdraw a Canon Fact without changing manuscript prose.")
  memory_fact_update.add_argument("--id", required=True)
  memory_fact_update.add_argument("--expected-version", required=True)
  memory_fact_update.add_argument("--changes-json", required=True)
  memory_fact_update.add_argument("--json", action="store_true", help="Output JSON.")
  memory_fact_review = memory_sub.add_parser("fact-review", help="Re-link current evidence or retire a Canon Fact without deleting its history.")
  memory_fact_review.add_argument("--id", required=True)
  memory_fact_review.add_argument("--disposition", choices=["accepted", "rejected"], required=True)
  memory_fact_review.add_argument("--evidence-json", default=None)
  memory_fact_review.add_argument("--expected-updated-at", default=None)
  memory_fact_review.add_argument("--expected-version", default=None, help="Original loaded fact version, including its Storyline.")
  memory_fact_review.add_argument("--json", action="store_true", help="Output JSON.")
  memory_arc_add = memory_sub.add_parser("arc-add", help="Add an evidence-backed Character Arc State.")
  memory_arc_add.add_argument("--character", required=True)
  memory_arc_add.add_argument("--dimension", required=True)
  memory_arc_add.add_argument("--value", required=True)
  memory_arc_add.add_argument("--scene", required=True)
  memory_arc_add.add_argument("--excerpt", required=True)
  memory_arc_add.add_argument("--type", choices=["observed", "planned"], default="observed", dest="state_type")
  memory_arc_add.add_argument("--json", action="store_true", help="Output JSON.")
  memory_arc_list = memory_sub.add_parser("arc-list", help="List Character Arc States.")
  memory_arc_list.add_argument("--character", default=None)
  memory_arc_list.add_argument("--json", action="store_true", help="Output JSON.")
  memory_setup_add = memory_sub.add_parser("setup-add", help="Track a narrative setup.")
  memory_setup_add.add_argument("--description", required=True)
  memory_setup_add.add_argument("--scene", required=True)
  memory_setup_add.add_argument("--excerpt", required=True)
  memory_setup_add.add_argument("--json", action="store_true", help="Output JSON.")
  memory_setup_payoff = memory_sub.add_parser("setup-payoff", help="Resolve a setup with payoff evidence.")
  memory_setup_payoff.add_argument("--id", required=True)
  memory_setup_payoff.add_argument("--scene", required=True)
  memory_setup_payoff.add_argument("--excerpt", required=True)
  memory_setup_payoff.add_argument("--json", action="store_true", help="Output JSON.")
  memory_setup_list = memory_sub.add_parser("setup-list", help="List setups and payoffs.")
  memory_setup_list.add_argument("--json", action="store_true", help="Output JSON.")
  memory_question_add = memory_sub.add_parser("question-add", help="Track a deliberately open story question.")
  memory_question_add.add_argument("--question", required=True)
  memory_question_add.add_argument("--scene", default="")
  memory_question_add.add_argument("--intentional", action="store_true")
  memory_question_add.add_argument("--json", action="store_true", help="Output JSON.")
  memory_question_list = memory_sub.add_parser("question-list", help="List open questions.")
  memory_question_list.add_argument("--json", action="store_true", help="Output JSON.")
  memory_diagnose = memory_sub.add_parser("diagnose", help="Run evidence-backed Canon diagnostics.")
  memory_diagnose.add_argument("--scene", action="append", default=None, dest="scene_ids")
  memory_diagnose.add_argument("--json", action="store_true", help="Output JSON.")
  memory_dispose = memory_sub.add_parser("dispose", help="Remember an author disposition for a diagnostic.")
  memory_dispose.add_argument("--id", required=True)
  memory_dispose.add_argument("--disposition", choices=["fixed", "dismissed", "intentional", "deferred"], required=True)
  memory_dispose.add_argument("--notes", default="")
  memory_dispose.add_argument("--json", action="store_true", help="Output JSON.")

  search_parser = subparsers.add_parser("search", help="Search manuscript prose, planning, and Story Memory.")
  search_parser.add_argument("--query", required=True)
  search_parser.add_argument("--limit", type=int, default=80)
  search_parser.add_argument("--json", action="store_true", help="Output JSON.")

  pass_parser = subparsers.add_parser("pass", help="Manage reusable Editorial Passes.")
  pass_sub = pass_parser.add_subparsers(dest="pass_command", required=True)
  pass_list = pass_sub.add_parser("list", help="List built-in and custom Editorial Passes.")
  pass_list.add_argument("--json", action="store_true", help="Output JSON.")
  pass_add = pass_sub.add_parser("add", help="Create a custom Editorial Pass.")
  pass_add.add_argument("--name", required=True)
  pass_add.add_argument("--goal", required=True)
  pass_add.add_argument("--instruction", required=True)
  pass_add.add_argument("--criterion", action="append", default=[])
  pass_add.add_argument("--json", action="store_true", help="Output JSON.")

  storyline_parser = subparsers.add_parser("storyline", help="Explore and integrate named story experiments.")
  storyline_sub = storyline_parser.add_subparsers(dest="storyline_command", required=True)
  storyline_list = storyline_sub.add_parser("list", help="Show Storyline dashboard.")
  storyline_list.add_argument("--json", action="store_true", help="Output JSON.")
  storyline_create = storyline_sub.add_parser("create", help="Create and enter a Storyline experiment.")
  storyline_create.add_argument("--name", required=True)
  storyline_create.add_argument("--hypothesis", required=True)
  storyline_create.add_argument("--scope", default="")
  storyline_create.add_argument("--success", default="")
  storyline_create.add_argument("--protect", action="append", default=[])
  storyline_create.add_argument("--no-switch", action="store_true")
  storyline_create.add_argument("--json", action="store_true", help="Output JSON.")
  storyline_switch = storyline_sub.add_parser("switch", help="Switch to a Storyline or the primary manuscript.")
  storyline_switch.add_argument("--id", default=None)
  storyline_switch.add_argument("--primary", action="store_true")
  storyline_switch.add_argument("--json", action="store_true", help="Output JSON.")
  storyline_compare = storyline_sub.add_parser("compare", help="Show semantic Storyline divergence.")
  storyline_compare.add_argument("--id", required=True)
  storyline_compare.add_argument("--json", action="store_true", help="Output JSON.")
  storyline_integrate = storyline_sub.add_parser("integrate", help="Prepare selected Storyline scenes as Change Sets.")
  storyline_integrate.add_argument("--id", required=True)
  storyline_integrate.add_argument("--scene-path", action="append", required=True, dest="scene_paths")
  storyline_integrate.add_argument("--json", action="store_true", help="Output JSON.")
  storyline_save = storyline_sub.add_parser("save", help="Save current Storyline progress.")
  storyline_save.add_argument("--id", required=True)
  storyline_save.add_argument("--json", action="store_true", help="Output JSON.")
  storyline_archive = storyline_sub.add_parser("archive", help="Archive a Storyline from the active dashboard.")
  storyline_archive.add_argument("--id", required=True)
  storyline_archive.add_argument("--json", action="store_true", help="Output JSON.")
  storyline_restore = storyline_sub.add_parser("restore", help="Restore an archived Storyline.")
  storyline_restore.add_argument("--id", required=True)
  storyline_restore.add_argument("--json", action="store_true", help="Output JSON.")
  storyline_rename = storyline_sub.add_parser("rename", help="Rename a Storyline and its backing line.")
  storyline_rename.add_argument("--id", required=True)
  storyline_rename.add_argument("--name", required=True)
  storyline_rename.add_argument("--json", action="store_true", help="Output JSON.")
  storyline_duplicate = storyline_sub.add_parser("duplicate", help="Duplicate a Storyline experiment.")
  storyline_duplicate.add_argument("--id", required=True)
  storyline_duplicate.add_argument("--name", required=True)
  storyline_duplicate.add_argument("--json", action="store_true", help="Output JSON.")

  style_parser = subparsers.add_parser("style", help="Build an author-controlled Style Profile from exemplar scenes.")
  style_sub = style_parser.add_subparsers(dest="style_command", required=True)
  style_get = style_sub.add_parser("get", help="Get the active Style Profile.")
  style_get.add_argument("--json", action="store_true", help="Output JSON.")
  style_build = style_sub.add_parser("build", help="Rebuild from selected exemplar scenes.")
  style_build.add_argument("--scene", action="append", required=True, dest="scene_ids")
  style_build.add_argument("--expected-fingerprint")
  style_build.add_argument("--json", action="store_true", help="Output JSON.")
  style_workspace = style_sub.add_parser("workspace", help="Get Writing Voice controls and the approved profile.")
  style_workspace.add_argument("--json", action="store_true")
  for name in ("save", "suggest", "preview", "refine", "review", "stage"):
    action = style_sub.add_parser(name, help=f"Writing Voice: {name}.")
    action.add_argument("--request-json", required=True)
    action.add_argument("--json", action="store_true")
  style_reference = style_sub.add_parser("reference", help="Choose current sources or deliberately retain frozen measurements.")
  style_reference.add_argument("--mode", choices=["current", "frozen"], required=True)
  style_reference.add_argument("--expected-fingerprint", required=True)
  style_reference.add_argument("--json", action="store_true", help="Output JSON.")

  snapshot_parser = subparsers.add_parser("snapshot", help="Git-backed snapshot workflow.")
  snapshot_sub = snapshot_parser.add_subparsers(dest="snapshot_command", required=True)
  snapshot_create = snapshot_sub.add_parser("create", help="Create git snapshot.")
  snapshot_create.add_argument("-m", "--message", required=True, help="Snapshot message.")
  snapshot_log = snapshot_sub.add_parser("log", help="Show snapshot history.")
  snapshot_log.add_argument("--limit", type=int, default=10, help="Max entries.")

  branch_parser = subparsers.add_parser("branch", help="Manage git-backed branch workspaces.")
  branch_sub = branch_parser.add_subparsers(dest="branch_command", required=True)
  branch_create = branch_sub.add_parser("create", help="Create a new branch workspace.")
  branch_create.add_argument("--name", required=True, help="Branch name.")
  branch_create.add_argument("--from", dest="from_ref", default=None, help="Optional source ref.")
  branch_create.add_argument(
    "--no-switch",
    action="store_true",
    help="Create branch without switching to it.",
  )
  branch_create.add_argument("--json", action="store_true", help="Output JSON.")
  branch_switch = branch_sub.add_parser("switch", help="Switch current workspace branch.")
  branch_switch.add_argument("--name", required=True, help="Branch name.")
  branch_switch.add_argument("--json", action="store_true", help="Output JSON.")
  branch_list = branch_sub.add_parser("list", help="List local branches.")
  branch_list.add_argument("--json", action="store_true", help="Output JSON.")
  branch_diff = branch_sub.add_parser("diff", help="Diff authoring artifacts between branches.")
  branch_diff.add_argument("--base", required=True, help="Base branch/ref.")
  branch_diff.add_argument("--head", required=True, help="Head branch/ref.")
  branch_diff.add_argument("--json", action="store_true", help="Output JSON.")
  branch_preflight = branch_sub.add_parser(
    "preflight",
    help="Preflight merge risk analysis for two branches.",
  )
  branch_preflight.add_argument("--base", required=True, help="Base branch/ref.")
  branch_preflight.add_argument("--head", required=True, help="Head branch/ref.")
  branch_preflight.add_argument("--json", action="store_true", help="Output JSON.")
  branch_merge = branch_sub.add_parser("merge", help="Merge head branch into base branch.")
  branch_merge.add_argument("--base", required=True, help="Base branch/ref.")
  branch_merge.add_argument("--head", required=True, help="Head branch/ref.")
  branch_merge.add_argument(
    "--resolution",
    action="append",
    default=[],
    metavar="PROPOSAL_ID",
    help="Merge-resolution proposal id to resolve a conflicted scene (repeatable).",
  )
  branch_merge.add_argument("--json", action="store_true", help="Output JSON.")
  branch_conflicts = branch_sub.add_parser(
    "conflicts",
    help="Scan for merge conflicts between two branches without touching the worktree.",
  )
  branch_conflicts.add_argument("--base", required=True, help="Base branch/ref.")
  branch_conflicts.add_argument("--head", required=True, help="Head branch/ref.")
  branch_conflicts.add_argument("--json", action="store_true", help="Output JSON.")
  merge_preview = branch_sub.add_parser("resolve-preview", help="Review reconciliation context locally before contacting a provider.")
  merge_preview.add_argument("--input-json", required=True)
  merge_preview.add_argument("--json", action="store_true")
  branch_resolve = branch_sub.add_parser(
    "resolve",
    help="Draft an AI-reconciled version of a conflicted scene as a proposal.",
  )
  branch_resolve.add_argument("--base", required=True, help="Base branch/ref.")
  branch_resolve.add_argument("--head", required=True, help="Head branch/ref.")
  branch_resolve.add_argument(
    "--path", required=True, help="Conflicted scene path (manuscript/scenes/...)."
  )
  branch_resolve.add_argument(
    "--provider",
    choices=sorted(SUPPORTED_PROVIDERS),
    default="local",
    help="AI provider (default: local).",
  )
  branch_resolve.add_argument("--model", default=None, help="Model override.")
  branch_resolve.add_argument("--request-id", default="", help="Reuse this id to recover the same reconciliation.")
  branch_resolve.add_argument("--memory-approvals", default="[]")
  branch_resolve.add_argument("--story-approvals", default="[]")
  branch_resolve.add_argument("--expected-context-fingerprint", default="", help="Fingerprint from resolve-preview; required for external AI providers.")
  branch_resolve.add_argument(
    "--temperature", type=float, default=0.3, help="Sampling temperature (default: 0.3)."
  )
  branch_resolve.add_argument(
    "--max-output-tokens", type=int, default=3000, help="Max output tokens (default: 3000)."
  )
  branch_resolve.add_argument("--json", action="store_true", help="Output JSON.")

  check_parser = subparsers.add_parser("check", help="Run repository quality checks.")
  check_sub = check_parser.add_subparsers(dest="check_command", required=True)
  check_continuity = check_sub.add_parser("continuity", help="Run continuity checks.")
  check_continuity.add_argument("--json", action="store_true", help="Output JSON.")
  check_startup = check_sub.add_parser("startup", help="Validate project readiness and optionally apply safe repairs.")
  check_startup.add_argument("--repair", action="store_true", help="Create missing directories and initialize revision storage.")
  check_startup.add_argument("--json", action="store_true", help="Output JSON.")
  check_workspace = check_sub.add_parser(
    "workspace",
    help="Audit branch/retrieval/pin drift with optional safe repair actions.",
  )
  check_workspace.add_argument(
    "--repair",
    action="store_true",
    help="Apply safe repairs (clear stale pins, reset invalid pins JSON).",
  )
  check_workspace.add_argument("--json", action="store_true", help="Output JSON.")
  check_performance = check_sub.add_parser(
    "performance",
    help="Collect local list/query performance baseline metrics.",
  )
  check_performance.add_argument(
    "--repeat",
    type=int,
    default=3,
    help="Number of timing samples per metric.",
  )
  check_performance.add_argument("--json", action="store_true", help="Output JSON.")

  retrieval_parser = subparsers.add_parser(
    "retrieval",
    help="Manage local retrieval index and query results.",
  )
  retrieval_sub = retrieval_parser.add_subparsers(dest="retrieval_command", required=True)
  retrieval_build = retrieval_sub.add_parser("build", help="Build retrieval index.")
  retrieval_build.add_argument(
    "--chunk-words",
    type=int,
    default=None,
    help="Chunk size in words (default from retrieval module).",
  )
  retrieval_build.add_argument(
    "--overlap-words",
    type=int,
    default=None,
    help="Chunk overlap in words (default from retrieval module).",
  )
  retrieval_build.add_argument("--json", action="store_true", help="Output JSON.")
  retrieval_status = retrieval_sub.add_parser("status", help="Show retrieval index status.")
  retrieval_status.add_argument("--json", action="store_true", help="Output JSON.")
  retrieval_query = retrieval_sub.add_parser("query", help="Query retrieval index.")
  retrieval_query.add_argument("--text", required=True, help="Query text.")
  retrieval_query.add_argument("--limit", type=int, default=5, help="Max results to return.")
  retrieval_query.add_argument(
    "--min-score",
    type=float,
    default=0.0,
    help="Filter matches below this normalized score.",
  )
  retrieval_query.add_argument(
    "--require-fresh",
    action="store_true",
    help="Fail if index is stale for current project state.",
  )
  retrieval_query.add_argument("--json", action="store_true", help="Output JSON.")

  generation_parser = subparsers.add_parser("generation", help="Inspect generation runs.")
  generation_sub = generation_parser.add_subparsers(dest="generation_command", required=True)
  generation_list = generation_sub.add_parser("list", help="List generation runs.")
  generation_list.add_argument(
    "--status",
    choices=["succeeded", "failed"],
    default=None,
    help="Filter by generation status.",
  )
  generation_list.add_argument("--scene", default=None, help="Filter by scene id.")
  generation_list.add_argument(
    "--provider",
    choices=sorted(SUPPORTED_PROVIDERS),
    default=None,
    help="Filter by provider.",
  )
  generation_list.add_argument(
    "--quality",
    choices=["high", "medium", "low"],
    default=None,
    help="Filter by quality tier.",
  )
  generation_list.add_argument("--limit", type=int, default=None, help="Max rows.")
  generation_list.add_argument("--json", action="store_true", help="Output JSON.")
  generation_get = generation_sub.add_parser("get", help="Get generation run by id.")
  generation_get.add_argument("--id", required=True, help="Generation run id.")
  generation_get.add_argument("--json", action="store_true", help="Output JSON.")
  generation_rerun = generation_sub.add_parser(
    "rerun",
    help="Rerun a prior generation using its stored scene/instruction.",
  )
  generation_rerun.add_argument("--id", required=True, help="Generation run id.")
  generation_rerun.add_argument("--title", default="", help="Optional proposal title override.")
  generation_rerun.add_argument(
    "--provider",
    choices=sorted(SUPPORTED_PROVIDERS),
    default=None,
    help="Provider override (defaults to original run provider).",
  )
  generation_rerun.add_argument(
    "--model",
    default=None,
    help="Model override (defaults to original run model).",
  )
  generation_rerun.add_argument(
    "--temperature",
    type=float,
    default=None,
    help="Temperature override.",
  )
  generation_rerun.add_argument(
    "--max-output-tokens",
    type=int,
    default=None,
    help="Max output tokens override.",
  )
  generation_rerun.add_argument(
    "--context-scenes",
    type=int,
    default=None,
    help="Context scene radius override.",
  )
  generation_rerun.add_argument(
    "--codex-limit",
    type=int,
    default=None,
    help="Codex limit override.",
  )
  generation_rerun.add_argument(
    "--retrieval-mode",
    choices=["off", "auto", "required"],
    default=None,
    help="Retrieval mode override (defaults to original run retrieval mode).",
  )
  generation_rerun.add_argument(
    "--retrieval-limit",
    type=int,
    default=None,
    help="Retrieval limit override.",
  )
  generation_rerun.add_argument(
    "--retrieval-min-score",
    type=float,
    default=None,
    help="Retrieval min score override.",
  )
  generation_rerun.add_argument(
    "--retrieval-require-fresh",
    action="store_true",
    help="Force retrieval freshness for rerun.",
  )
  generation_rerun.add_argument(
    "--retrieval-allow-stale",
    action="store_true",
    help="Allow stale retrieval index for rerun.",
  )
  generation_rerun.add_argument("--json", action="store_true", help="Output JSON.")
  generation_pin = generation_sub.add_parser(
    "pin",
    help="Pin preferred generation run for a scene.",
  )
  generation_pin.add_argument("--scene", required=True, help="Scene id.")
  generation_pin.add_argument("--run", required=True, help="Generation run id.")
  generation_pin.add_argument("--json", action="store_true", help="Output JSON.")
  generation_unpin = generation_sub.add_parser(
    "unpin",
    help="Clear preferred generation run for a scene.",
  )
  generation_unpin.add_argument("--scene", required=True, help="Scene id.")
  generation_unpin.add_argument("--json", action="store_true", help="Output JSON.")
  generation_pins = generation_sub.add_parser(
    "pins",
    help="List pinned generation runs.",
  )
  generation_pins.add_argument("--scene", default=None, help="Optional scene id filter.")
  generation_pins.add_argument("--json", action="store_true", help="Output JSON.")
  generation_budget = generation_sub.add_parser(
    "budget",
    help="Inspect or update generation budget policy.",
  )
  generation_budget.add_argument(
    "--reset",
    action="store_true",
    help="Reset budget policy to defaults (all limits disabled).",
  )
  generation_budget.add_argument("--max-input-tokens", type=int, default=None)
  generation_budget.add_argument("--max-output-tokens", type=int, default=None)
  generation_budget.add_argument("--max-total-tokens", type=int, default=None)
  generation_budget.add_argument("--max-estimated-cost-usd", type=float, default=None)
  generation_budget.add_argument("--daily-tokens", type=int, default=None)
  generation_budget.add_argument("--daily-estimated-cost-usd", type=float, default=None)
  generation_budget.add_argument("--weekly-tokens", type=int, default=None)
  generation_budget.add_argument("--weekly-estimated-cost-usd", type=float, default=None)
  generation_budget.add_argument(
    "--clear-limit", action="append", default=[], choices=BUDGET_LIMIT_FIELDS,
    help="Disable one budget limit while preserving the others; repeat for several limits.",
  )
  generation_budget.add_argument("--json", action="store_true", help="Output JSON.")
  generation_config = generation_sub.add_parser("config", help="Show generation runtime config.")
  generation_config.add_argument("--json", action="store_true", help="Output JSON.")

  chat_parser = subparsers.add_parser("chat", help="Chat threads and agent workflows.")
  chat_sub = chat_parser.add_subparsers(dest="chat_command", required=True)

  chat_thread = chat_sub.add_parser("thread", help="Manage chat threads.")
  chat_thread_sub = chat_thread.add_subparsers(dest="chat_thread_command", required=True)
  chat_thread_list = chat_thread_sub.add_parser("list", help="List chat threads.")
  chat_thread_list.add_argument("--json", action="store_true", help="Output JSON.")
  chat_thread_get = chat_thread_sub.add_parser("get", help="Get thread by id.")
  chat_thread_get.add_argument("--id", required=True, help="Thread id.")
  chat_thread_get.add_argument("--json", action="store_true", help="Output JSON.")
  chat_thread_create = chat_thread_sub.add_parser("create", help="Create chat thread.")
  chat_thread_create.add_argument("--title", required=True, help="Thread title.")
  chat_thread_create.add_argument(
    "--provider",
    choices=sorted(SUPPORTED_PROVIDERS),
    default="local",
    help="Thread provider.",
  )
  chat_thread_create.add_argument("--model", default="", help="Provider model override.")
  chat_thread_create.add_argument(
    "--mode",
    choices=["chat", "agent"],
    default="chat",
    help="Thread mode.",
  )
  chat_thread_create.add_argument("--json", action="store_true", help="Output JSON.")
  chat_thread_rename = chat_thread_sub.add_parser("rename", help="Rename chat thread.")
  chat_thread_rename.add_argument("--id", required=True, help="Thread id.")
  chat_thread_rename.add_argument("--title", required=True, help="Thread title.")
  chat_thread_rename.add_argument("--json", action="store_true", help="Output JSON.")
  chat_thread_update = chat_thread_sub.add_parser(
    "update",
    help="Update thread provider/model/mode/context profile.",
  )
  chat_thread_update.add_argument("--id", required=True, help="Thread id.")
  chat_thread_update.add_argument(
    "--provider",
    choices=sorted(SUPPORTED_PROVIDERS),
    default=None,
    help="Provider override.",
  )
  chat_thread_update.add_argument("--model", default=None, help="Model override.")
  chat_thread_update.add_argument(
    "--mode",
    choices=["chat", "agent"],
    default=None,
    help="Thread mode override.",
  )
  chat_thread_update.add_argument(
    "--include-current-scene",
    choices=["true", "false"],
    default=None,
  )
  chat_thread_update.add_argument(
    "--include-selection",
    choices=["true", "false"],
    default=None,
  )
  chat_thread_update.add_argument(
    "--include-recent-scenes-radius",
    type=int,
    default=None,
  )
  chat_thread_update.add_argument(
    "--include-codex",
    choices=["off", "explicit", "auto", "auto_and_explicit"],
    default=None,
  )
  chat_thread_update.add_argument(
    "--retrieval-mode",
    choices=["off", "auto", "required"],
    default=None,
  )
  chat_thread_update.add_argument("--retrieval-limit", type=int, default=None)
  chat_thread_update.add_argument("--retrieval-min-score", type=float, default=None)
  chat_thread_update.add_argument(
    "--retrieval-require-fresh",
    choices=["true", "false"],
    default=None,
  )
  chat_thread_update.add_argument("--history-token-budget", type=int, default=None)
  chat_thread_update.add_argument(
    "--agent-auto-read-only",
    choices=["true", "false"],
    default=None,
  )
  chat_thread_update.add_argument(
    "--agent-confirm-writes",
    choices=["true", "false"],
    default=None,
  )
  chat_thread_update.add_argument("--json", action="store_true", help="Output JSON.")

  chat_reconcile = chat_sub.add_parser("reconcile", help="Recover a saved reply or close a delivery before fresh context review; never contacts a provider.")
  chat_reconcile.add_argument("--thread", required=True)
  chat_reconcile.add_argument("--request-id", required=True)
  chat_reconcile.add_argument("--turn-id", default="")
  chat_reconcile.add_argument("--json", action="store_true", help="Output JSON.")
  chat_send = chat_sub.add_parser("send", help="Send a message to a chat thread.")
  chat_send.add_argument("--thread", required=True, help="Thread id.")
  chat_send.add_argument("--message", required=True, help="Message content.")
  chat_send.add_argument("--request-id", default="", help="Reuse this id when retrying the same chat delivery.")
  chat_send.add_argument("--current-scene", default="", help="Current scene id.")
  chat_send.add_argument(
    "--scene-id",
    action="append",
    default=None,
    help="Explicit scene id to include in context. Repeatable.",
  )
  chat_send.add_argument("--selected-text", default="", help="Selected editor text.")
  chat_send.add_argument("--allow-memory-once", action="append", default=[], help="Allow one explicitly selected ask-before-use Memory entry and its ask details for this request; never releases private notes or exclusions.")
  chat_send.add_argument(
    "--codex-id",
    action="append",
    default=None,
    help="Explicit codex entity id. Repeatable.",
  )
  chat_send.add_argument(
    "--include-current-scene",
    choices=["true", "false"],
    default=None,
  )
  chat_send.add_argument(
    "--include-selection",
    choices=["true", "false"],
    default=None,
  )
  chat_send.add_argument(
    "--include-recent-scenes-radius",
    type=int,
    default=None,
  )
  chat_send.add_argument(
    "--include-codex",
    choices=["off", "explicit", "auto", "auto_and_explicit"],
    default=None,
  )
  chat_send.add_argument(
    "--retrieval-mode",
    choices=["off", "auto", "required"],
    default=None,
  )
  chat_send.add_argument("--retrieval-limit", type=int, default=None)
  chat_send.add_argument("--retrieval-min-score", type=float, default=None)
  chat_send.add_argument(
    "--retrieval-require-fresh",
    choices=["true", "false"],
    default=None,
  )
  chat_send.add_argument("--history-token-budget", type=int, default=None)
  chat_send.add_argument(
    "--agent-auto-read-only",
    choices=["true", "false"],
    default=None,
  )
  chat_send.add_argument(
    "--agent-confirm-writes",
    choices=["true", "false"],
    default=None,
  )
  chat_send.add_argument("--json", action="store_true", help="Output JSON.")
  chat_send.add_argument("--memory-approvals", default="[]", help="JSON array of one-time Ask first permissions (entity_id and optional detail_key).")
  chat_send.add_argument("--story-approvals", default="[]", help="JSON array of Canon Fact or relationship ids approved for this request only.")
  chat_send.add_argument("--expected-context-fingerprint", default="", help="Require the context reviewed with chat context.")
  chat_context = chat_sub.add_parser("context", parents=[chat_send], add_help=False, help="Preview the exact initial AI context without contacting a provider.")
  chat_context.add_argument("--history-before-message-id", default="", help="Preview a replacement for an earlier message.")

  chat_message = chat_sub.add_parser("message", help="Manage chat messages.")
  chat_message_sub = chat_message.add_subparsers(dest="chat_message_command", required=True)
  chat_message_list = chat_message_sub.add_parser("list", help="List messages for a thread.")
  chat_message_list.add_argument("--thread", required=True, help="Thread id.")
  chat_message_list.add_argument("--limit", type=int, default=None, help="Optional max rows.")
  chat_message_list.add_argument("--json", action="store_true", help="Output JSON.")
  chat_message_truncate = chat_message_sub.add_parser(
    "truncate",
    help="Remove a message and everything after it (used by regenerate).",
  )
  chat_message_truncate.add_argument("--thread", required=True, help="Thread id.")
  chat_message_truncate.add_argument(
    "--from-message",
    required=True,
    help="Message id to remove, along with all later messages.",
  )
  chat_message_truncate.add_argument("--json", action="store_true", help="Output JSON.")

  chat_tool = chat_sub.add_parser("tool", help="Execute pending agent tool calls.")
  chat_tool_sub = chat_tool.add_subparsers(dest="chat_tool_command", required=True)
  chat_tool_execute = chat_tool_sub.add_parser(
    "execute",
    help="Execute a pending tool call from an assistant message.",
  )
  chat_tool_execute.add_argument("--thread", required=True, help="Thread id.")
  chat_tool_execute.add_argument("--message", required=True, help="Assistant message id.")
  chat_tool_execute.add_argument("--index", type=int, required=True, help="Tool call index.")
  chat_tool_execute.add_argument("--json", action="store_true", help="Output JSON.")

  chat_diff = chat_sub.add_parser(
    "diff",
    help="Diff authoring artifacts between a chat turn's VCS anchor and HEAD.",
  )
  chat_diff.add_argument("--thread", required=True, help="Thread id.")
  chat_diff.add_argument("--message", required=True, help="Message id with a VCS anchor.")
  chat_diff.add_argument("--json", action="store_true", help="Output JSON.")

  metrics_parser = subparsers.add_parser("metrics", help="View private, content-free product signals stored on this device.")
  metrics_sub = metrics_parser.add_subparsers(dest="metrics_command", required=True)
  metrics_dashboard = metrics_sub.add_parser("dashboard", help="Summarize activation and trust signals locally.")
  metrics_dashboard.add_argument("--json", action="store_true", help="Output JSON.")
  metrics_settings = metrics_sub.add_parser("settings", help="Configure local signal collection and retention.")
  metrics_settings.add_argument("--local-signals", choices=["on", "off"], default=None)
  metrics_settings.add_argument("--retention-days", type=int, default=None)
  metrics_settings.add_argument("--json", action="store_true", help="Output JSON.")

  subparsers.add_parser(
    "serve",
    help="Run the persistent JSON-RPC sidecar over stdin/stdout.",
  )

  return parser


def _paths_from_cwd():
  return resolve_project(Path.cwd())


def _optional_bool(raw: str | None) -> bool | None:
  if raw is None:
    return None
  normalized = raw.strip().lower()
  if normalized == "true":
    return True
  if normalized == "false":
    return False
  raise OpenAuthorError(f"Invalid boolean value '{raw}'. Use true or false.")


def _chat_context_overrides(args: argparse.Namespace) -> dict[str, Any]:
  overrides: dict[str, Any] = {}
  include_current_scene = _optional_bool(getattr(args, "include_current_scene", None))
  if include_current_scene is not None:
    overrides["include_current_scene"] = include_current_scene
  include_selection = _optional_bool(getattr(args, "include_selection", None))
  if include_selection is not None:
    overrides["include_selection"] = include_selection
  include_recent_scenes_radius = getattr(args, "include_recent_scenes_radius", None)
  if include_recent_scenes_radius is not None:
    overrides["include_recent_scenes_radius"] = include_recent_scenes_radius
  include_codex = getattr(args, "include_codex", None)
  if include_codex is not None:
    overrides["include_codex"] = include_codex
  retrieval_mode = getattr(args, "retrieval_mode", None)
  if retrieval_mode is not None:
    overrides["retrieval_mode"] = retrieval_mode
  retrieval_limit = getattr(args, "retrieval_limit", None)
  if retrieval_limit is not None:
    overrides["retrieval_limit"] = retrieval_limit
  retrieval_min_score = getattr(args, "retrieval_min_score", None)
  if retrieval_min_score is not None:
    overrides["retrieval_min_score"] = retrieval_min_score
  retrieval_require_fresh = _optional_bool(getattr(args, "retrieval_require_fresh", None))
  if retrieval_require_fresh is not None:
    overrides["retrieval_require_fresh"] = retrieval_require_fresh
  history_token_budget = getattr(args, "history_token_budget", None)
  if history_token_budget is not None:
    overrides["history_token_budget"] = history_token_budget
  agent_auto_read_only = _optional_bool(getattr(args, "agent_auto_read_only", None))
  if agent_auto_read_only is not None:
    overrides["agent_auto_read_only"] = agent_auto_read_only
  agent_confirm_writes = _optional_bool(getattr(args, "agent_confirm_writes", None))
  if agent_confirm_writes is not None:
    overrides["agent_confirm_writes"] = agent_confirm_writes
  return overrides


def _run(args: argparse.Namespace) -> int:
  if args.command == "backup":
    if args.backup_command == "create":
      row = create_backup(_paths_from_cwd(), Path(args.target))
    elif args.backup_command == "verify":
      row = verify_backup(Path(args.source))
    else:
      row = restore_backup(Path(args.source), Path(args.target))
    print(json.dumps(row, indent=None if args.json else 2))
    return 0

  if args.command == "init":
    root = Path(args.path).resolve()
    import_summary = None
    if args.from_zip and args.from_folder:
      raise OpenAuthorError("Use either --from-zip or --from-folder, not both.")
    if args.from_zip:
      paths, import_summary = initialize_project_from_zip(
        Path(args.from_zip),
        root,
        name=args.name,
        project_id=args.project_id,
      )
    elif args.from_folder:
      paths, import_summary = initialize_project_from_folder(
        Path(args.from_folder),
        root,
        name=args.name,
        project_id=args.project_id,
      )
    else:
      paths = initialize_project(root, name=args.name, project_id=args.project_id)
    ensure_codex(paths)
    if args.json:
      row = inspect_project(paths)
      row["initialized"] = True
      row["import_summary"] = import_summary
      print(json.dumps(row))
      return 0
    print(f"Initialized openAuthor project at {paths.root}")
    return 0

  if args.command == "auth":
    if args.auth_command == "login":
      result = auth_login(args.provider)
      if args.json:
        print(json.dumps(result))
        return 0
      print(result.get("message", f"Authenticated with {args.provider}."))
      return 0

    if args.auth_command == "logout":
      result = auth_logout(args.provider)
      if args.json:
        print(json.dumps(result))
        return 0
      if result.get("removed"):
        print(f"Signed out from {args.provider}.")
      else:
        print(f"No active session for {args.provider}.")
      return 0

    if args.auth_command == "status":
      status = get_auth_status()
      if args.json:
        print(json.dumps(status))
        return 0
      for provider, info in status.items():
        if info.get("authenticated"):
          email = info.get("email", "")
          email_str = f" ({email})" if email else ""
          print(f"{provider}: authenticated{email_str}")
        else:
          print(f"{provider}: not authenticated")
      return 0

    raise OpenAuthorError(f"Unsupported auth command: {args.auth_command}")

  if args.command == "revision":
    paths = resolve_project(Path.cwd())
    if args.revision_command == "list":
      rows = list_revisions(paths, limit=args.limit)
      if args.json:
        print(json.dumps(rows))
      else:
        for row in rows:
          print(f"{row['id'][:12]}\t{row['kind']}\t{row['message']}")
      return 0
    if args.revision_command == "save":
      if not args.message.strip():
        raise OpenAuthorError("A version name is required.")
      row = get_revision(paths, create_revision(paths, args.message.strip()))
    elif args.revision_command == "get":
      row = get_revision(paths, args.id)
    elif args.revision_command == "diff":
      row = compare_revisions(paths, args.base, args.head, include_unchanged=args.include_unchanged)
    elif args.revision_command == "retrospective":
      row = revision_retrospective(paths, args.base, args.head)
    else:
      row = restore_revision(paths, args.id, relative_paths=args.paths)
    if args.json:
      print(json.dumps(row))
    else:
      print(json.dumps(row, indent=2))
    return 0

  if args.command == "manuscript" and args.manuscript_command in {"preview", "import"}:
    try:
      import_corrections = json.loads(args.corrections)
    except json.JSONDecodeError as error:
      raise OpenAuthorError(f"Invalid import corrections JSON: {error}") from error

  if args.command == "manuscript" and args.manuscript_command == "preview":
    row = preview_manuscript_import(Path(args.source), strategy=args.strategy, corrections=import_corrections)
    if args.json:
      print(json.dumps(row))
    else:
      print(f"preview: {row.get('scene_count', 0)} scene(s)")
    return 0

  paths = _paths_from_cwd()

  if args.command == "metrics":
    if args.metrics_command == "dashboard":
      row = get_local_product_dashboard(paths)
    elif args.local_signals is None and args.retention_days is None:
      row = get_product_signal_settings(paths)
    else:
      row = update_product_signal_settings(
        paths,
        local_signals_enabled=(args.local_signals == "on") if args.local_signals is not None else None,
        retention_days=args.retention_days,
      )
    if args.json:
      print(json.dumps(row))
    else:
      print(json.dumps(row, indent=2))
    return 0

  if args.command == "project":
    if args.project_command in {"recovery-status", "recovery-resolve"}:
      from .book_transactions import transaction_recovery_status, resolve_transaction_recovery
      if args.project_command == "recovery-status":
        row = transaction_recovery_status(paths)
      else:
        try:
          decisions = json.loads(args.decisions)
        except ValueError as error:
          raise OpenAuthorError("Recovery decisions must be a JSON object.") from error
        if not isinstance(decisions, dict):
          raise OpenAuthorError("Recovery decisions must be a JSON object.")
        row = resolve_transaction_recovery(paths, fingerprint=args.fingerprint, decisions=decisions)
      print(json.dumps(row, indent=None if args.json else 2))
      return 0
    if args.project_command == "inspect":
      row = inspect_project(paths)
      if args.json:
        print(json.dumps(row))
        return 0
      print(
        f"{row.get('project_id','')}\t{row.get('name','')}\t{row.get('project_root','')}"
      )
      return 0

    if args.project_command == "ensure-id":
      config = ensure_project_identity(paths, expected_project_id=args.expected_id)
      row = {
        "project_id": config.get("project_id"),
        "name": config.get("name", ""),
        "created_at": config.get("created_at", ""),
        "project_root": str(paths.root),
      }
      if args.json:
        print(json.dumps(row))
        return 0
      print(f"{row['project_id']}\t{row['name']}\t{row['project_root']}")
      return 0

    raise OpenAuthorError(f"Unsupported project command: {args.project_command}")

  if args.command == "manuscript":
    if args.manuscript_command == "read":
      row = get_manuscript_reading(paths)
      row["scene_count"] = len(row["scenes"])
    elif args.manuscript_command == "import":
      row = import_manuscript(paths, Path(args.source), strategy=args.strategy, corrections=import_corrections, expected_fingerprint=args.expected_fingerprint)
    elif args.manuscript_command == "export":
      row = export_manuscript(paths, Path(args.target), format=args.format)
    else:
      raise OpenAuthorError(f"Unsupported manuscript command: {args.manuscript_command}")
    if args.json:
      print(json.dumps(row))
    else:
      print(f"{args.manuscript_command}: {row.get('scene_count', 0)} scene(s)")
    return 0

  if args.command == "plan":
    if args.plan_command == "get":
      row = get_plan_workspace(paths)
    elif args.plan_command == "brief":
      if not args.clear_themes and all(value is None for value in (
        args.synopsis, args.genre, args.themes, args.style_guide, args.outline
      )):
        raise OpenAuthorError("No project brief updates provided.")
      row = update_brief(
        paths,
        synopsis=args.synopsis,
        genre=args.genre,
        themes=[] if args.clear_themes else args.themes,
        style_guide=args.style_guide,
        outline=args.outline,
        expected_version=json.loads(args.expected_version) if args.expected_version is not None else None,
      )
    elif args.plan_command == "act-add":
      row = add_act(paths, title=args.title, synopsis=args.synopsis, expected_workspace=args.expected_workspace)
    elif args.plan_command == "chapter-add":
      row = add_chapter(paths, act_id=args.act_id, title=args.title, synopsis=args.synopsis, expected_workspace=args.expected_workspace)
    elif args.plan_command == "scene-assign":
      row = assign_scene(
        paths,
        scene_id=args.scene_id,
        chapter_id=args.chapter_id,
        before_scene_id=args.before_scene_id,
        expected_workspace=args.expected_workspace,
      )
    elif args.plan_command == "scene-preview":
      row = preview_scene_move(
        paths,
        scene_id=args.scene_id,
        chapter_id=args.chapter_id,
        before_scene_id=args.before_scene_id,
      )
    elif args.plan_command == "scene-meta":
      if args.timeline_position is None and args.labels is None and not args.clear_labels:
        raise OpenAuthorError("No scene planning metadata updates provided.")
      row = update_scene_metadata(
        paths,
        scene_id=args.scene_id,
        timeline_position=args.timeline_position,
        labels=[] if args.clear_labels else args.labels,
        expected_version=json.loads(args.expected_version) if args.expected_version is not None else None,
      )
    elif args.plan_command == "beat-add":
      row = add_beat(paths, scene_id=args.scene_id, summary=args.summary, status=args.status, expected_workspace=args.expected_workspace)
    elif args.plan_command == "note-add":
      row = add_scene_note(paths, content=args.content, scene_id=args.scene_id, title=args.title, source=args.source)
    else:
      raise OpenAuthorError(f"Unsupported plan command: {args.plan_command}")
    if getattr(args, "json", False):
      print(json.dumps(row))
    else:
      print(json.dumps(row, indent=2))
    return 0

  if args.command == "memory":
    if args.memory_command in {"scan-preview", "scan-ai"}:
      try:
        request = json.loads(args.request_json)
      except ValueError as error:
        raise OpenAuthorError("Memory scan request must be valid JSON.") from error
      if not isinstance(request, dict):
        raise OpenAuthorError("Memory scan request must be an object.")
      allowed = {"scene_ids", "provider", "model"}
      if args.memory_command == "scan-ai":
        allowed.add("expected_fingerprint")
      if set(request) - allowed:
        raise OpenAuthorError("Memory scan request has unsupported fields.")
      from .memory_scan import generate_memory_scan, preview_memory_scan
      inputs = {"scene_ids": request.get("scene_ids", []), "provider": request.get("provider", "local"), "model": request.get("model", "")}
      if args.memory_command == "scan-preview":
        row = preview_memory_scan(paths, **inputs)
      else:
        row = generate_memory_scan(paths, **inputs, expected_fingerprint=request.get("expected_fingerprint", ""))
    elif args.memory_command == "scan":
      row = extract_memory_suggestions(paths, scene_ids=args.scene_ids)
    elif args.memory_command == "list":
      row = list_memory_suggestions(paths, status=args.status)
    elif args.memory_command == "review":
      row = review_memory_suggestion(paths, args.id, disposition=args.disposition, expected_version=args.expected_version)
    elif args.memory_command == "correct":
      row = correct_memory_suggestion(
        paths,
        args.id,
        name=args.name,
        description=args.description,
        predicate=args.predicate,
        value=args.value,
        entity_type=args.entity_type,
        expected_version=args.expected_version,
      )
    elif args.memory_command == "suggest":
      row = queue_memory_suggestion(paths, title=args.title, content=args.content, scene_id=args.scene_id, source=args.source)
    elif args.memory_command == "fact-add":
      row = add_canon_fact(
        paths,
        subject_entity_id=args.subject,
        predicate=args.predicate,
        value=args.value,
        evidence=json.loads(args.evidence_json),
        knowledge=json.loads(args.knowledge_json),
        confidence=args.confidence,
        status=args.status,
        valid_from_scene_id=args.valid_from,
        valid_to_scene_id=args.valid_to,
        scope=args.scope,
      )
    elif args.memory_command == "fact-list":
      row = list_canon_facts(paths, status=args.status, for_editing=args.for_editing)
    elif args.memory_command == "fact-review":
      row = review_canon_fact(paths, args.id, disposition=args.disposition, evidence=json.loads(args.evidence_json) if args.evidence_json is not None else None, expected_updated_at=args.expected_updated_at, expected_version=args.expected_version)
    elif args.memory_command == "fact-update":
      row = update_canon_fact(paths, args.id, expected_version=args.expected_version, changes=json.loads(args.changes_json))
    elif args.memory_command == "arc-add":
      row = add_arc_state(paths, character_entity_id=args.character, dimension=args.dimension, value=args.value, scene_id=args.scene, excerpt=args.excerpt, state_type=args.state_type)
    elif args.memory_command == "arc-list":
      row = list_arc_states(paths, character_entity_id=args.character)
    elif args.memory_command == "setup-add":
      row = add_setup(paths, description=args.description, setup_scene_id=args.scene, excerpt=args.excerpt)
    elif args.memory_command == "setup-payoff":
      row = resolve_setup(paths, args.id, payoff_scene_id=args.scene, excerpt=args.excerpt)
    elif args.memory_command == "setup-list":
      row = list_setups(paths)
    elif args.memory_command == "question-add":
      row = add_open_question(paths, question=args.question, scene_id=args.scene, intentionally_unresolved=args.intentional)
    elif args.memory_command == "question-list":
      row = list_open_questions(paths)
    elif args.memory_command == "diagnose":
      row = run_canon_diagnostics(paths, affected_scene_ids=args.scene_ids)
    elif args.memory_command == "dispose":
      row = disposition_diagnostic(paths, args.id, disposition=args.disposition, notes=args.notes)
    else:
      raise OpenAuthorError(f"Unsupported memory command: {args.memory_command}")
    if args.json:
      print(json.dumps(row))
    else:
      print(json.dumps(row, indent=2))
    return 0

  if args.command == "search":
    rows = search_project(paths, args.query, limit=args.limit)
    if args.json:
      print(json.dumps(rows))
    else:
      for row in rows:
        print(f"{row['source_kind']}\t{row['title']}\t{row['excerpt']}")
    return 0

  if args.command == "pass":
    if args.pass_command == "list":
      row = list_editorial_passes(paths)
    elif args.pass_command == "add":
      row = add_editorial_pass(
        paths,
        name=args.name,
        goal=args.goal,
        instruction=args.instruction,
        evaluation_criteria=args.criterion,
      )
    else:
      raise OpenAuthorError(f"Unsupported Editorial Pass command: {args.pass_command}")
    if args.json:
      print(json.dumps(row))
    else:
      print(json.dumps(row, indent=2))
    return 0

  if args.command == "storyline":
    if args.storyline_command == "list":
      row = list_storylines(paths)
    elif args.storyline_command == "create":
      row = create_storyline(
        paths,
        name=args.name,
        hypothesis=args.hypothesis,
        intended_scope=args.scope,
        success_criteria=args.success,
        protected_constraints=args.protect,
        switch=not args.no_switch,
      )
    elif args.storyline_command == "switch":
      if not args.primary and not args.id:
        raise OpenAuthorError("Choose --id or --primary.")
      row = switch_storyline(paths, args.id, primary=args.primary)
    elif args.storyline_command == "compare":
      row = compare_storyline(paths, args.id)
    elif args.storyline_command == "integrate":
      row = create_storyline_integration_changes(paths, args.id, scene_paths=args.scene_paths)
    elif args.storyline_command == "save":
      row = save_storyline_progress(paths, args.id)
    elif args.storyline_command == "archive":
      row = update_storyline_status(paths, args.id, status="archived")
    elif args.storyline_command == "restore":
      row = update_storyline_status(paths, args.id, status="active")
    elif args.storyline_command == "rename":
      row = rename_storyline(paths, args.id, name=args.name)
    elif args.storyline_command == "duplicate":
      row = duplicate_storyline(paths, args.id, name=args.name)
    else:
      raise OpenAuthorError(f"Unsupported Storyline command: {args.storyline_command}")
    if args.json:
      print(json.dumps(row))
    else:
      print(json.dumps(row, indent=2))
    return 0

  if args.command == "style":
    if args.style_command == "get":
      row = get_style_profile(paths)
    elif args.style_command == "build":
      row = build_style_profile(paths, scene_ids=args.scene_ids, expected_fingerprint=args.expected_fingerprint)
    elif args.style_command == "reference":
      row = set_style_profile_reference(paths, mode=args.mode, expected_fingerprint=args.expected_fingerprint)
    elif args.style_command == "workspace":
      row = voice_workspace(paths)
    elif args.style_command in {"save", "suggest", "preview", "refine", "review", "stage"}:
      try:
        request = json.loads(args.request_json)
      except ValueError as error:
        raise OpenAuthorError("Writing Voice request must be valid JSON.") from error
      if not isinstance(request, dict):
        raise OpenAuthorError("Writing Voice request must be an object.")
      if args.style_command == "save":
        row = save_style_profile(paths, profile=request.get("profile"), expected_version=request.get("expected_version"), expected_scope=request.get("scope", ""))
      elif args.style_command == "suggest":
        row = suggest_voice(paths, request=request)
      elif args.style_command == "preview":
        row = preview_voice(paths, request=request)
      elif args.style_command == "refine":
        row = refine_voice_preview(paths, request=request)
      elif args.style_command == "review":
        row = review_voice_preview(paths, preview_id=request.get("preview_id", ""), direction_id=request.get("direction_id", ""), review=request.get("review", {}), expected_review=request.get("expected_review"))
      else:
        if "preservation" in request:
          raise OpenAuthorError("Stage the preservation contract from the saved preview. Start a fresh comparison to change author constraints.")
        if "expected_preservation_fingerprint" in request and request["expected_preservation_fingerprint"] is None:
          raise OpenAuthorError("The reviewed preservation fingerprint must be text.")
        row = stage_voice_preview(paths, preview_id=request.get("preview_id", ""), direction_id=request.get("direction_id", ""),
          expected_preservation_fingerprint=request.get("expected_preservation_fingerprint"))
    else:
      raise OpenAuthorError(f"Unsupported Style Profile command: {args.style_command}")
    if args.json:
      print(json.dumps(row))
    else:
      print(json.dumps(row, indent=2))
    return 0

  if args.command == "scene":
    if args.scene_command == "add":
      scene_file = add_scene(
        paths,
        title=args.title,
        summary=args.summary,
        pov=args.pov,
        status=args.status,
        body=args.body,
      )
      try:
        extract_memory_suggestions(paths)
      except OpenAuthorError:
        pass
      if args.json:
        print(json.dumps(get_scene(paths, scene_id(int(scene_file.stem.split("-", 1)[0])))))
        return 0
      print(f"Created scene {scene_file.relative_to(paths.root)}")
      return 0

    if args.scene_command == "list":
      rows = list_scenes(paths)
      if args.json:
        print(json.dumps(rows))
        return 0
      for row in rows:
        print(f"{row['id']}\t{row['status']}\t{row['title']}\t{row['path']}")
      return 0

    if args.scene_command == "get":
      row = get_scene(paths, args.id)
      if args.json:
        print(json.dumps(row))
        return 0
      print(f"{row['id']}\t{row['status']}\t{row['title']}\t{row['path']}")
      return 0

    if args.scene_command == "update":
      if all(
        value is None
        for value in (args.title, args.summary, args.pov, args.status, args.body)
      ):
        raise OpenAuthorError("No updates provided. Supply at least one field.")
      if args.expected_version is not None:
        try:
          expected = json.loads(args.expected_version)
        except json.JSONDecodeError as error:
          raise OpenAuthorError("Invalid loaded-scene version JSON.") from error
        row = save_scene_edit(
          paths,
          scene_identifier=args.id,
          expected_version=expected,
          changes={field: getattr(args, field) for field in ("title", "body", "summary", "pov", "status") if getattr(args, field) is not None},
        )
        try:
          extract_memory_suggestions(paths, scene_ids=[args.id])
        except Exception:
          # Derived suggestions cannot invalidate an already committed save.
          # Return a visible warning, preserving the exact saved-scene response.
          row["save_warnings"] = ["Scene saved, but Story Memory suggestions could not refresh. Run a memory scan to retry."]
        # Return the scene captured while holding the write lock, never a later
        # reread that could acknowledge a different writer's version.
        if args.json:
          print(json.dumps(row))
        else:
          print(f"Updated scene {row['path']}")
        return 0
      scene_file = update_scene(
        paths,
        scene_identifier=args.id,
        title=args.title,
        summary=args.summary,
        pov=args.pov,
        status=args.status,
        body=args.body,
      )
      extract_memory_suggestions(paths, scene_ids=[args.id])
      if args.json:
        print(json.dumps(get_scene(paths, args.id)))
        return 0
      print(f"Updated scene {scene_file.relative_to(paths.root)}")
      return 0

  if args.command == "codex":
    if args.codex_command == "add":
      entity_id = add_entity(
        paths,
        kind=args.type,
        name=args.name,
        description=args.description,
        category=args.category,
        aliases=args.alias,
        tags=args.tag,
        details=json.loads(args.details_json),
        notes=args.notes,
        ai_visibility=args.ai_visibility,
        scope=args.scope,
      )
      if args.json:
        print(json.dumps(get_entity(paths, entity_id)))
        return 0
      print(f"Created entity {entity_id}")
      return 0

    if args.codex_command == "get":
      row = get_entity(paths, args.id)
      if args.json:
        print(json.dumps(row))
        return 0
      print(f"{row['id']}\t{row['type']}\t{row['name']}\t{row['description']}")
      return 0

    if args.codex_command == "update":
      if all(value is None for value in (
        args.type, args.name, args.description, args.category, args.alias, args.tag,
        args.details_json, args.notes, args.ai_visibility, args.scope,
      )):
        raise OpenAuthorError("No updates provided. Supply at least one field.")
      row = update_entity(
        paths,
        entity_id=args.id,
        kind=args.type,
        name=args.name,
        description=args.description,
        category=args.category,
        aliases=args.alias,
        tags=args.tag,
        details=json.loads(args.details_json) if args.details_json is not None else None,
        notes=args.notes,
        ai_visibility=args.ai_visibility,
        scope=args.scope,
      )
      if args.json:
        print(json.dumps(row))
        return 0
      print(f"Updated entity {row['id']}")
      return 0

    if args.codex_command == "relationship-add":
      row = add_relationship(
        paths,
        source_entity_id=args.source,
        target_entity_id=args.target,
        relation=args.relation,
        notes=args.notes,
        valid_from_scene_id=args.valid_from,
        valid_to_scene_id=args.valid_to,
      )
      print(json.dumps(row) if args.json else f"Created relationship {row['id']}")
      return 0

    if args.codex_command == "relationship-list":
      rows = list_relationships(paths, entity_id=args.entity)
      if args.json:
        print(json.dumps(rows))
      else:
        for row in rows:
          print(f"{row['source_name']}\t{row['relation']}\t{row['target_name']}")
      return 0

    if args.codex_command == "relationship-delete":
      row = delete_relationship(paths, args.id)
      print(json.dumps(row) if args.json else f"Deleted relationship {args.id}")
      return 0

    rows = list_entities(paths, kind=args.type)
    if args.json:
      print(json.dumps(rows))
      return 0
    for row in rows:
      print(f"{row['id']}\t{row['type']}\t{row['name']}\t{row['description']}")
    return 0

  if args.command == "proposal":
    if args.proposal_command in {"selection-preview", "selection-generate"}:
      from .selection_editing import preview_selection, generate_selection
      try:
        selection_args = json.loads(args.input_json)
        if not isinstance(selection_args, dict):
          raise ValueError("Expected an object")
        row = (preview_selection(paths, **selection_args) if args.proposal_command == "selection-preview" else generate_selection(paths, **selection_args, expected_fingerprint=args.expected_fingerprint, request_id=args.request_id))
      except (TypeError, ValueError) as error:
        raise OpenAuthorError(f"Invalid selection input: {error}") from error
      print(json.dumps(row))
      return 0
    if args.proposal_command == "add":
      proposal_id = create_proposal(
        paths,
        title=args.title,
        instruction=args.instruction,
        scene_id=args.scene,
      )
      if args.json:
        print(json.dumps(get_proposal(paths, proposal_id)))
        return 0
      print(f"Created proposal {proposal_id}")
      return 0

    if args.proposal_command == "get":
      row = get_proposal(paths, args.id)
      if args.json:
        print(json.dumps(row))
        return 0
      print(f"{row['id']}\t{row['status']}\t{row['title']}\t{row['scene_id']}")
      return 0

    if args.proposal_command == "apply":
      row = apply_proposal(
        paths,
        proposal_id=args.id,
        notes=args.notes,
        force=args.force,
      )
      if args.json:
        print(json.dumps(row))
        return 0
      print(f"Applied proposal {args.id} (scene {row.get('scene_id', '')} updated)")
      return 0

    if args.proposal_command == "apply-batch":
      row = apply_proposal_batch(paths, proposal_ids=args.ids, notes=args.notes, force=args.force)
      print(json.dumps(row) if args.json else f"Applied {len(row['proposal_ids'])} coordinated Change Sets")
      return 0

    if args.proposal_command == "undo-batch":
      row = undo_proposal_batch(paths, applied_revision=args.revision)
      print(json.dumps(row) if args.json else f"Undid {len(row['scene_ids'])} scenes together in Revision {row['undo_revision']}")
      return 0

    if args.proposal_command == "draft-select":
      row = select_draft_candidate(paths, proposal_id=args.id, candidate=args.candidate, expected_updated_at=args.expected_updated_at)
      print(json.dumps(row) if args.json else f"Selected {args.candidate} candidate; review the rebuilt hunks before applying.")
      return 0

    if args.proposal_command == "hunk":
      row = update_change_hunk(
        paths,
        proposal_id=args.id,
        hunk_id=args.hunk,
        decision=args.decision,
      )
      if args.json:
        print(json.dumps(row))
        return 0
      print(f"Marked {args.hunk} {args.decision}")
      return 0

    if args.proposal_command == "hunk-edit":
      row = edit_change_hunk(
        paths,
        proposal_id=args.id,
        hunk_id=args.hunk,
        after_text=args.after_text,
      )
      if args.json:
        print(json.dumps(row))
      else:
        print(f"Edited {args.hunk}")
      return 0

    if args.proposal_command in {"revision-preview", "generation-preview"}:
      try:
        inputs = json.loads(args.input_json)
        if not isinstance(inputs, dict):
          raise ValueError("Revision parameters must be an object.")
        preview = preview_proposal_revision if args.proposal_command == "revision-preview" else preview_proposal_generation
        row = preview(paths, **inputs)
      except (ValueError, TypeError) as error:
        raise OpenAuthorError(f"Invalid revision preview: {error}") from error
      print(json.dumps(row, indent=None if args.json else 2))
      return 0

    if args.proposal_command == "hunk-regenerate":
      try:
        memory_approvals = json.loads(args.memory_approvals)
        story_approvals = json.loads(args.story_approvals)
      except json.JSONDecodeError as error:
        raise OpenAuthorError("Revision permissions must be valid JSON arrays.") from error
      row = regenerate_change_hunk(
        paths,
        request_id=args.request_id,
        proposal_id=args.id,
        hunk_id=args.hunk,
        provider=args.provider,
        model=args.model,
        temperature=args.temperature,
        max_output_tokens=args.max_output_tokens,
        feedback=args.feedback,
        memory_approvals=memory_approvals,
        story_approvals=story_approvals,
        expected_context_fingerprint=args.expected_context_fingerprint,
      )
      if args.json:
        print(json.dumps(row))
      else:
        print(f"Regenerated {args.hunk}")
      return 0

    if args.proposal_command == "rebase":
      row = rebase_proposal_change_set(paths, proposal_id=args.id)
      if args.json:
        print(json.dumps(row))
      else:
        print(f"Change Set rebase: {row.get('rebase_report', {}).get('status', 'unknown')}")
      return 0

    if args.proposal_command == "undo":
      row = undo_proposal(paths, proposal_id=args.id, force=args.force)
      if args.json:
        print(json.dumps(row))
        return 0
      print(f"Undid proposal {args.id} (scene {row.get('scene_id', '')} restored)")
      return 0

    if args.proposal_command == "draft":
      try:
        memory_approvals = json.loads(args.memory_approvals)
        story_approvals = json.loads(args.story_approvals)
      except json.JSONDecodeError as error:
        raise OpenAuthorError("Revision permissions must be valid JSON arrays.") from error
      row = generate_proposal_draft(
        paths,
        request_id=args.request_id,
        proposal_id=args.id,
        provider=args.provider,
        model=args.model,
        temperature=args.temperature,
        max_output_tokens=args.max_output_tokens,
        memory_approvals=memory_approvals,
        story_approvals=story_approvals,
        expected_context_fingerprint=args.expected_context_fingerprint,
        review_mode=args.review_mode,
        review_reasoning_effort=args.review_reasoning_effort,
      )
      if args.json:
        print(json.dumps(row))
        return 0
      draft = row.get("draft", {})
      print(
        f"Drafted proposal {args.id} via "
        f"{draft.get('provider', 'unknown')}/{draft.get('model', 'unknown')}"
      )
      return 0

    if args.proposal_command == "reject":
      row = update_proposal_status(
        paths,
        proposal_id=args.id,
        status="rejected",
        notes=args.notes,
      )
      if args.json:
        print(json.dumps(row))
        return 0
      print(f"Rejected proposal {args.id}")
      return 0

    if args.proposal_command == "generate":
      try:
        memory_approvals = json.loads(args.memory_approvals)
        story_approvals = json.loads(args.story_approvals)
        scene_contract = json.loads(args.scene_contract)
      except json.JSONDecodeError as error:
        raise OpenAuthorError("Revision permissions and scene intent must be valid JSON.") from error
      row = generate_proposal(
        paths,
        request_id=args.request_id,
        scene_id=args.scene,
        instruction=args.instruction,
        title=args.title,
        provider=args.provider,
        model=args.model,
        temperature=args.temperature,
        max_output_tokens=args.max_output_tokens,
        context_scene_radius=args.context_scenes,
        codex_limit=args.codex_limit,
        retrieval_mode=args.retrieval_mode,
        retrieval_limit=args.retrieval_limit,
        retrieval_min_score=args.retrieval_min_score,
        retrieval_require_fresh=args.retrieval_require_fresh,
        constraints=args.constraint,
        protected_elements=args.protect,
        scene_contract=scene_contract,
        change_group_id=args.change_group,
        memory_approvals=memory_approvals,
        story_approvals=story_approvals,
        expected_context_fingerprint=args.expected_context_fingerprint,
      )
      if args.json:
        print(json.dumps(row))
        return 0
      generation = row.get("generation", {})
      provider = generation.get("provider", "unknown")
      model = generation.get("model", "unknown")
      print(f"Generated proposal {row['id']} via {provider}/{model}")
      return 0

    rows = list_proposals(paths, status=args.status)
    if args.json:
      print(json.dumps(rows))
      return 0
    for row in rows:
      print(f"{row['id']}\t{row['status']}\t{row['title']}\t{row['scene_id']}")
    return 0

  if args.command == "snapshot":
    if args.snapshot_command == "create":
      initialize_git(paths)
      print(create_snapshot(paths, args.message))
      return 0

    for line in list_snapshots(paths, limit=args.limit):
      print(line)
    return 0

  if args.command == "branch":
    if args.branch_command == "create":
      row = create_branch(
        paths,
        name=args.name,
        from_ref=args.from_ref,
        switch=not args.no_switch,
      )
      if args.json:
        print(json.dumps(row))
        return 0
      if row.get("current"):
        print(f"Created and switched to branch {row['name']}")
      else:
        print(f"Created branch {row['name']}")
      return 0

    if args.branch_command == "switch":
      row = switch_branch(paths, name=args.name)
      if args.json:
        print(json.dumps(row))
        return 0
      print(f"Switched to branch {row['name']}")
      return 0

    if args.branch_command == "list":
      rows = list_branches(paths)
      if args.json:
        print(json.dumps(rows))
        return 0
      for row in rows:
        marker = "*" if row.get("current") else " "
        upstream = row.get("upstream", "")
        if upstream:
          print(f"{marker} {row['name']}\tupstream={upstream}")
        else:
          print(f"{marker} {row['name']}")
      return 0

    if args.branch_command == "diff":
      row = diff_branches(paths, base=args.base, head=args.head)
      if args.json:
        print(json.dumps(row))
        return 0
      print(
        f"{row['base']}...{row['head']}\tahead_by={row['ahead_by']}\tbehind_by={row['behind_by']}"
      )
      files = row.get("files", [])
      if not files:
        print("No authoring file changes between branches.")
      else:
        for file_row in files:
          print(
            f"{file_row.get('status','')}\t{file_row.get('path','')}\t"
            f"+{file_row.get('added')}\t-{file_row.get('deleted')}"
          )
      return 0

    if args.branch_command == "preflight":
      row = preflight_merge(paths, base=args.base, head=args.head)
      if args.json:
        print(json.dumps(row))
        return 0
      print(
        f"Preflight {row['base']} <- {row['head']}\trisk={row['risk_level']}\t"
        f"safe_to_merge={row['safe_to_merge']}\toverlap_count={row['overlap_count']}"
      )
      overlap_by_category = row.get("overlap_by_category", {})
      for category in ("scene", "codex", "project", "budget", "other"):
        paths_in_category = overlap_by_category.get(category, [])
        if paths_in_category:
          print(f"{category}\t{len(paths_in_category)}")
          for path in paths_in_category:
            print(f"  - {path}")
      for recommendation in row.get("recommendations", []):
        print(f"recommendation\t{recommendation}")
      return 0

    if args.branch_command == "merge":
      resolutions: dict[str, str] = {}
      resolution_proposal_ids: list[str] = []
      for resolution_id in args.resolution:
        proposal = get_proposal(paths, resolution_id)
        merge_meta = proposal.get("merge") or {}
        if proposal.get("source") != "merge_resolution" or not merge_meta.get("path"):
          raise OpenAuthorError(
            f"Proposal '{resolution_id}' is not a merge-resolution proposal."
          )
        if proposal.get("status") != "pending":
          raise OpenAuthorError(
            f"Merge-resolution proposal '{resolution_id}' is not pending."
          )
        if merge_meta.get("base") != args.base or merge_meta.get("head") != args.head:
          raise OpenAuthorError(
            f"Proposal '{resolution_id}' was drafted for merge "
            f"{merge_meta.get('base')} <- {merge_meta.get('head')}, "
            f"not {args.base} <- {args.head}."
          )
        revisions = merge_revision_pair(paths, base=args.base, head=args.head)
        if any(merge_meta.get(key) != value for key, value in revisions.items()):
          raise OpenAuthorError("The Storyline revisions changed or this reconciliation lacks revision anchors. Check compatibility and generate a new reconciliation before merging.")
        resolutions[str(merge_meta["path"])] = str(merge_meta.get("file_content", ""))
        resolution_proposal_ids.append(resolution_id)
      row = merge_branches(
        paths,
        base=args.base,
        head=args.head,
        resolutions=resolutions or None,
      )
      for resolution_id in resolution_proposal_ids:
        update_proposal_status(
          paths,
          proposal_id=resolution_id,
          status="applied",
          notes=f"Applied as merge resolution in {row.get('merge_commit', '')}",
        )
      if args.json:
        row["applied_resolutions"] = resolution_proposal_ids
        print(json.dumps(row))
        return 0
      print(
        f"Merged {row['head']} into {row['base']} at {row['merge_commit']}"
      )
      if resolution_proposal_ids:
        print(f"Applied resolutions: {', '.join(resolution_proposal_ids)}")
      return 0

    if args.branch_command == "conflicts":
      row = scan_merge_conflicts(paths, base=args.base, head=args.head)
      if args.json:
        print(json.dumps(row))
        return 0
      print(
        f"{row['base']}...{row['head']}\tconflicts={row['conflict_count']}\t"
        f"auto-mergeable={len(row['auto_mergeable'])}"
      )
      for conflict in row["conflicts"]:
        print(
          f"conflict\t{conflict['path']}\t{conflict['category']}\t{conflict['kind']}"
        )
      for path in row["auto_mergeable"]:
        print(f"auto\t{path}")
      return 0

    if args.branch_command == "resolve-preview":
      try:
        inputs = json.loads(args.input_json)
        if not isinstance(inputs, dict):
          raise ValueError("Reconciliation parameters must be an object.")
        row = preview_merge_resolution(paths, **inputs)
      except (ValueError, TypeError) as error:
        raise OpenAuthorError(f"Invalid reconciliation preview: {error}") from error
      print(json.dumps(row, indent=None if args.json else 2))
      return 0

    if args.branch_command == "resolve":
      try:
        memory_approvals = json.loads(args.memory_approvals)
        story_approvals = json.loads(args.story_approvals)
      except json.JSONDecodeError as error:
        raise OpenAuthorError("Revision permissions must be valid JSON arrays.") from error
      row = generate_merge_resolution(
        paths,
        request_id=args.request_id,
        base=args.base,
        head=args.head,
        scene_path=args.path,
        provider=args.provider,
        model=args.model,
        temperature=args.temperature,
        max_output_tokens=args.max_output_tokens,
        memory_approvals=memory_approvals,
        story_approvals=story_approvals,
        expected_context_fingerprint=args.expected_context_fingerprint,
      )
      if args.json:
        print(json.dumps(row))
        return 0
      print(
        f"Drafted merge resolution {row['id']} for {args.path} "
        f"({args.base} <- {args.head}). Review it, then merge with "
        f"--resolution {row['id']}."
      )
      return 0

  if args.command == "check":
    if args.check_command == "startup":
      report = collect_startup_health(paths, repair=args.repair)
      if args.json:
        print(json.dumps(report))
      else:
        print(f"Startup Health\nready={report['ready']} errors={report['errors']} warnings={report['warnings']}")
        for check in report["checks"]:
          print(f"{check['status']}\t{check['id']}\t{check['message']}")
      return 0

    if args.check_command == "continuity":
      rows = run_continuity_checks(paths)
      if args.json:
        print(json.dumps(rows))
        return 0
      if not rows:
        print("No continuity issues found.")
        return 0
      for row in rows:
        print(
          f"{row['severity']}\t{row['code']}\t{row['scene_id']}\t{row['title']}\t{row['path']}"
        )
      return 0

    if args.check_command == "workspace":
      report = audit_workspace_metadata(paths, repair=args.repair)
      if args.json:
        print(json.dumps(report))
        return 0
      print(format_workspace_audit_text(report))
      return 0

    if args.check_command == "performance":
      report = collect_performance_baseline(paths, repeat=args.repeat)
      if args.json:
        print(json.dumps(report))
        return 0
      print(format_performance_baseline_text(report))
      return 0

    raise OpenAuthorError(f"Unsupported check command: {args.check_command}")

  if args.command == "retrieval":
    if args.retrieval_command == "build":
      kwargs: dict[str, int] = {}
      if args.chunk_words is not None:
        kwargs["chunk_words"] = args.chunk_words
      if args.overlap_words is not None:
        kwargs["overlap_words"] = args.overlap_words
      row = build_retrieval_index(paths, **kwargs)
      if args.json:
        print(json.dumps(row))
        return 0
      print(
        f"Built retrieval index {row.get('path','')} "
        f"(sources={row.get('source_count', 0)} chunks={row.get('chunk_count', 0)})"
      )
      if row.get("stale"):
        reasons = ", ".join(row.get("stale_reasons", []))
        print(f"warning: retrieval index is stale ({reasons})")
      return 0

    if args.retrieval_command == "status":
      row = get_retrieval_index_status(paths)
      if args.json:
        print(json.dumps(row))
        return 0
      if not row.get("present"):
        print(f"Retrieval index not built ({row.get('path', '')}).")
        return 0
      print(
        f"Retrieval index {row.get('path','')}\t"
        f"sources={row.get('source_count')}\tchunks={row.get('chunk_count')}\t"
        f"stale={row.get('stale')}"
      )
      if row.get("stale"):
        for reason in row.get("stale_reasons", []):
          print(f"reason\t{reason}")
      return 0

    if args.retrieval_command == "query":
      row = query_retrieval_index(
        paths,
        query=args.text,
        limit=args.limit,
        min_score=args.min_score,
        require_fresh=args.require_fresh,
      )
      if args.json:
        print(json.dumps(row))
        return 0
      index = row.get("index", {})
      print(
        f"Query '{row.get('query','')}'\tresults={row.get('result_count', 0)}\t"
        f"index_stale={index.get('stale')}"
      )
      for result in row.get("results", []):
        print(
          f"{result.get('score')}\t{result.get('source_type')}\t"
          f"{result.get('source_ref')}\t{result.get('source_title')}\t"
          f"{result.get('source_path')}"
        )
      return 0

  if args.command == "chat":
    if args.chat_command == "thread":
      if args.chat_thread_command == "list":
        rows = list_chat_threads(paths)
        if args.json:
          print(json.dumps(rows))
          return 0
        if not rows:
          print("No chat threads.")
          return 0
        for row in rows:
          print(
            f"{row.get('id','')}\t{row.get('mode','')}\t{row.get('provider','')}\t"
            f"{row.get('title','')}"
          )
        return 0

      if args.chat_thread_command == "get":
        row = get_chat_thread(paths, args.id)
        if args.json:
          print(json.dumps(row))
          return 0
        print(
          f"{row.get('id','')}\t{row.get('mode','')}\t{row.get('provider','')}\t"
          f"{row.get('model','')}\t{row.get('title','')}"
        )
        return 0

      if args.chat_thread_command == "create":
        row = create_chat_thread(
          paths,
          title=args.title,
          provider=args.provider,
          model=args.model,
          mode=args.mode,
        )
        if args.json:
          print(json.dumps(row))
          return 0
        print(
          f"Created chat thread {row.get('id','')} "
          f"({row.get('mode','')}, {row.get('provider','')}/{row.get('model','')})"
        )
        return 0

      if args.chat_thread_command == "rename":
        row = rename_chat_thread(paths, thread_id=args.id, title=args.title)
        if args.json:
          print(json.dumps(row))
          return 0
        print(f"Renamed thread {row.get('id','')} to {row.get('title','')}")
        return 0

      if args.chat_thread_command == "update":
        context_overrides = _chat_context_overrides(args)
        row = update_chat_thread(
          paths,
          thread_id=args.id,
          provider=args.provider,
          model=args.model,
          mode=args.mode,
          context_profile=context_overrides if context_overrides else None,
        )
        if args.json:
          print(json.dumps(row))
          return 0
        print(
          f"Updated thread {row.get('id','')} "
          f"({row.get('mode','')}, {row.get('provider','')}/{row.get('model','')})"
        )
        return 0

      raise OpenAuthorError(
        f"Unsupported chat thread command: {args.chat_thread_command}"
      )

    if args.chat_command == "reconcile":
      row = reconcile_chat_delivery(paths, thread_id=args.thread, request_id=args.request_id, turn_id=args.turn_id)
      print(json.dumps(row) if args.json else row["message"])
      return 0

    if args.chat_command in {"send", "context"}:
      context_overrides = _chat_context_overrides(args)
      try:
        memory_approvals = json.loads(args.memory_approvals)
      except json.JSONDecodeError as error:
        raise OpenAuthorError("Memory permissions must be a valid JSON array.") from error
      try:
        story_approvals = json.loads(args.story_approvals)
      except json.JSONDecodeError as error:
        raise OpenAuthorError("Story permissions must be a valid JSON array.") from error
      operation = send_chat_message if args.chat_command == "send" else preview_chat_context
      extra = {"request_id": args.request_id, "expected_context_fingerprint": args.expected_context_fingerprint} if args.chat_command == "send" else {"history_before_message_id": args.history_before_message_id}
      row = operation(
        paths,
        **extra,
        memory_approvals=memory_approvals,
        story_approvals=story_approvals,
        thread_id=args.thread,
        message=args.message,
        current_scene_id=args.current_scene,
        scene_ids=args.scene_id or [],
        selected_text=args.selected_text,
        codex_ids=args.codex_id or [],
        approved_codex_ids=args.allow_memory_once,
        context_overrides=context_overrides if context_overrides else None,
      )
      if args.chat_command == "context":
        print(json.dumps(row, indent=None if args.json else 2))
        return 0
      if args.json:
        print(json.dumps(row))
        return 0
      assistant = row.get("assistant_message", {})
      pending = row.get("pending_tool_calls", [])
      print(
        f"Sent message to {args.thread}; assistant={assistant.get('id','')} "
        f"pending_tool_calls={len(pending)}"
      )
      return 0

    if args.chat_command == "message":
      if args.chat_message_command == "truncate":
        row = truncate_chat_messages(
          paths,
          thread_id=args.thread,
          from_message_id=args.from_message,
        )
        if args.json:
          print(json.dumps(row))
          return 0
        print(
          f"Removed {row.get('removed_count', 0)} message(s); "
          f"{row.get('remaining_count', 0)} remain."
        )
        return 0
      if args.chat_message_command != "list":
        raise OpenAuthorError(
          f"Unsupported chat message command: {args.chat_message_command}"
        )
      rows = list_chat_messages(paths, thread_id=args.thread, limit=args.limit)
      if args.json:
        print(json.dumps(rows))
        return 0
      if not rows:
        print("No chat messages.")
        return 0
      for row in rows:
        print(f"{row.get('id','')}\t{row.get('role','')}\t{row.get('created_at','')}")
      return 0

    if args.chat_command == "tool":
      if args.chat_tool_command != "execute":
        raise OpenAuthorError(f"Unsupported chat tool command: {args.chat_tool_command}")
      row = execute_pending_tool_call(
        paths,
        thread_id=args.thread,
        assistant_message_id=args.message,
        tool_index=args.index,
      )
      if args.json:
        print(json.dumps(row))
        return 0
      print(
        f"Executed tool {row.get('tool','')} "
        f"for message {row.get('assistant_message_id','')}"
      )
      return 0

    if args.chat_command == "diff":
      row = get_chat_turn_diff(
        paths,
        thread_id=args.thread,
        message_id=args.message,
      )
      if args.json:
        print(json.dumps(row))
        return 0
      files = row.get("files", [])
      if not files:
        print("No authoring changes since this turn.")
        return 0
      for item in files:
        print(f"{item.get('status','')}\t{item.get('path','')}")
      return 0

    raise OpenAuthorError(f"Unsupported chat command: {args.chat_command}")

  if args.command == "generation":
    if args.generation_command == "budget":
      has_updates = bool(args.clear_limit) or any(
        value is not None
        for value in (
          args.max_input_tokens,
          args.max_output_tokens,
          args.max_total_tokens,
          args.max_estimated_cost_usd,
          args.daily_tokens,
          args.daily_estimated_cost_usd,
          args.weekly_tokens,
          args.weekly_estimated_cost_usd,
        )
      )
      if args.reset and has_updates:
        raise OpenAuthorError("Cannot combine --reset with budget update flags.")

      if args.reset:
        policy = reset_generation_budget_policy(paths)
        row = {
          "policy": policy,
          "usage": summarize_generation_usage(paths),
        }
      elif has_updates:
        policy = update_generation_budget_policy(
          paths,
          max_input_tokens=args.max_input_tokens,
          max_output_tokens=args.max_output_tokens,
          max_total_tokens=args.max_total_tokens,
          max_estimated_cost_usd=args.max_estimated_cost_usd,
          daily_tokens=args.daily_tokens,
          daily_estimated_cost_usd=args.daily_estimated_cost_usd,
          weekly_tokens=args.weekly_tokens,
          weekly_estimated_cost_usd=args.weekly_estimated_cost_usd,
          clear_limits=args.clear_limit,
        )
        row = {
          "policy": policy,
          "usage": summarize_generation_usage(paths),
        }
      else:
        row = get_generation_budget_report(paths)

      if args.json:
        print(json.dumps(row))
        return 0

      per_run = row.get("policy", {}).get("per_run", {})
      rolling = row.get("policy", {}).get("rolling", {})
      daily = row.get("usage", {}).get("daily", {})
      weekly = row.get("usage", {}).get("weekly", {})
      print("Budget Policy")
      print(
        "per_run\t"
        f"max_input_tokens={per_run.get('max_input_tokens')}\t"
        f"max_output_tokens={per_run.get('max_output_tokens')}\t"
        f"max_total_tokens={per_run.get('max_total_tokens')}\t"
        f"max_estimated_cost_usd={per_run.get('max_estimated_cost_usd')}"
      )
      print(
        "rolling\t"
        f"daily_tokens={rolling.get('daily_tokens')}\t"
        f"daily_estimated_cost_usd={rolling.get('daily_estimated_cost_usd')}\t"
        f"weekly_tokens={rolling.get('weekly_tokens')}\t"
        f"weekly_estimated_cost_usd={rolling.get('weekly_estimated_cost_usd')}"
      )
      print(
        "usage.daily\t"
        f"runs={daily.get('runs')}\t"
        f"total_tokens={daily.get('total_tokens')}\t"
        f"estimated_cost_usd={daily.get('estimated_cost_usd')}\t"
        f"unknown_cost_runs={daily.get('unknown_cost_runs')}"
      )
      print(
        "usage.weekly\t"
        f"runs={weekly.get('runs')}\t"
        f"total_tokens={weekly.get('total_tokens')}\t"
        f"estimated_cost_usd={weekly.get('estimated_cost_usd')}\t"
        f"unknown_cost_runs={weekly.get('unknown_cost_runs')}"
      )
      return 0

    if args.generation_command == "config":
      row = get_generation_runtime_config(paths)
      if args.json:
        print(json.dumps(row))
        return 0
      retry = row.get("retry", {})
      providers = row.get("providers", {})
      print(
        f"retry.max_retries={retry.get('max_retries')} "
        f"retry.base_delay_ms={retry.get('base_delay_ms')}"
      )
      for name in ("local", "openai", "anthropic", "openrouter", "openai-codex"):
        provider = providers.get(name, {})
        print(
          f"{name}\tdefault_model={provider.get('default_model','')}\t"
          f"credential_present={provider.get('credential_present')}"
        )
      budget = row.get("budget", {}).get("policy", {})
      per_run = budget.get("per_run", {})
      rolling = budget.get("rolling", {})
      print(
        "budget\t"
        f"max_total_tokens={per_run.get('max_total_tokens')}\t"
        f"max_estimated_cost_usd={per_run.get('max_estimated_cost_usd')}\t"
        f"daily_tokens={rolling.get('daily_tokens')}\t"
        f"weekly_tokens={rolling.get('weekly_tokens')}"
      )
      return 0

    if args.generation_command == "get":
      row = get_generation_run(paths, args.id)
      if args.json:
        print(json.dumps(row))
        return 0
      print(
        f"{row.get('run_id','')}\t{row.get('status','')}\t{row.get('provider','')}\t"
        f"{row.get('scene_id','')}\t{row.get('log_path','')}"
      )
      return 0

    if args.generation_command == "rerun":
      if args.retrieval_require_fresh and args.retrieval_allow_stale:
        raise OpenAuthorError(
          "Cannot combine --retrieval-require-fresh with --retrieval-allow-stale."
        )
      retrieval_require_fresh: bool | None = None
      if args.retrieval_require_fresh:
        retrieval_require_fresh = True
      elif args.retrieval_allow_stale:
        retrieval_require_fresh = False
      row = rerun_generation(
        paths,
        run_id=args.id,
        title=args.title,
        provider=args.provider,
        model=args.model,
        temperature=args.temperature,
        max_output_tokens=args.max_output_tokens,
        context_scene_radius=args.context_scenes,
        codex_limit=args.codex_limit,
        retrieval_mode=args.retrieval_mode,
        retrieval_limit=args.retrieval_limit,
        retrieval_min_score=args.retrieval_min_score,
        retrieval_require_fresh=retrieval_require_fresh,
      )
      if args.json:
        print(json.dumps(row))
        return 0
      generation = row.get("generation", {})
      provider = generation.get("provider", "unknown")
      model = generation.get("model", "unknown")
      print(f"Re-ran generation as proposal {row['id']} via {provider}/{model}")
      return 0

    if args.generation_command == "pin":
      row = set_pinned_generation_run(
        paths,
        scene_id=args.scene,
        run_id=args.run,
      )
      if args.json:
        print(json.dumps(row))
        return 0
      print(f"Pinned scene {row['scene_id']} to run {row['run_id']}")
      return 0

    if args.generation_command == "unpin":
      row = clear_pinned_generation_run(paths, scene_id=args.scene)
      if args.json:
        print(json.dumps(row))
        return 0
      if row.get("cleared"):
        print(f"Unpinned scene {row['scene_id']} (was {row.get('run_id','')})")
      else:
        print(f"Scene {row['scene_id']} had no pinned run.")
      return 0

    if args.generation_command == "pins":
      rows = list_pinned_generation_runs(paths, scene_id=args.scene)
      if args.json:
        print(json.dumps(rows))
        return 0
      if not rows:
        print("No pinned generation runs.")
        return 0
      for row in rows:
        print(f"{row['scene_id']}\t{row['run_id']}")
      return 0

    rows = list_generation_runs(
      paths,
      status=args.status,
      scene_id=args.scene,
      provider=args.provider,
      quality_tier=args.quality,
      limit=args.limit,
    )
    if args.json:
      print(json.dumps(rows))
      return 0
    if not rows:
      print("No generation runs found.")
      return 0
    for row in rows:
      print(
        f"{row.get('run_id','')}\t{row.get('status','')}\t{row.get('provider','')}\t"
        f"{row.get('scene_id','')}\t{row.get('proposal_id','')}\t{row.get('log_path','')}"
      )
    return 0

  if args.command == "serve":
    from .server import run_server

    run_server(_paths_from_cwd())
    return 0

  raise OpenAuthorError(f"Unsupported command: {args.command}")


def main(argv: list[str] | None = None) -> int:
  parser = build_parser()
  args = parser.parse_args(argv)
  try:
    author_edits = {
      "style": {"build", "reference"},
      "scene": {"add", "update"},
      "plan": {"brief", "act-add", "chapter-add", "scene-assign", "scene-meta", "beat-add", "note-add"},
      "codex": {"add", "update", "relationship-add", "relationship-delete"},
      "memory": {"review", "correct", "suggest", "fact-add", "fact-review", "arc-add", "setup-add", "setup-payoff", "question-add", "dispose"},
    }
    action = getattr(args, f"{args.command}_command", "")
    if action in author_edits.get(args.command, set()):
      import io
      from contextlib import redirect_stdout
      output = io.StringIO()
      label = f"{args.command.title()} {action}: {getattr(args, 'id', '') or getattr(args, 'title', '') or getattr(args, 'name', '')}".rstrip(": ")
      paths = _paths_from_cwd()
      with project_write_lock(paths):
        with checkpointed_edit(paths, label):
          with redirect_stdout(output):
            result = _run(args)
      print(output.getvalue(), end="")
      return result
    if (
      args.command == "revision" and action in {"save", "restore"}
      or args.command == "snapshot" and action == "create"
      or args.command == "proposal" and action in {"apply", "apply-batch", "undo", "hunk", "hunk-edit", "rebase", "reject"}
      or args.command == "storyline" and action not in {"list"}
      or args.command == "branch" and action in {"switch", "merge", "create"}
    ):
      with project_write_lock(_paths_from_cwd()):
        return _run(args)
    return _run(args)
  except SceneEditConflict as error:
    if getattr(args, "json", False):
      print(json.dumps({"error": {**error.details, "message": str(error)}}))
    else:
      print(f"error: {error}", file=sys.stderr)
    return 3
  except (OpenAuthorError, OSError) as error:
    print(f"error: {error}", file=sys.stderr)
    return 2


if __name__ == "__main__":
  raise SystemExit(main())
