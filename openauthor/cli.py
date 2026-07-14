from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .ai import DEFAULT_MODELS, SUPPORTED_PROVIDERS, generate_proposal
from .auth import SUPPORTED_AUTH_PROVIDERS, get_auth_status, login as auth_login, logout as auth_logout
from .budget import (
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
  truncate_chat_messages,
  update_chat_thread,
)
from .codex import ENTITY_TYPES, add_entity, ensure_codex, get_entity, list_entities, update_entity
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
  collect_performance_baseline,
  format_performance_baseline_text,
  format_workspace_audit_text,
)
from .git_ops import (
  create_branch,
  create_snapshot,
  diff_branches,
  initialize_git,
  list_branches,
  list_snapshots,
  merge_branches,
  preflight_merge,
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
from .proposals import create_proposal, get_proposal, list_proposals, update_proposal_status
from .retrieval import build_retrieval_index, get_retrieval_index_status, query_retrieval_index
from .scenes import add_scene, get_scene, list_scenes, update_scene


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
  project_ensure_id = project_sub.add_parser(
    "ensure-id",
    help="Ensure project has a persistent project_id; optionally enforce expected id.",
  )
  project_ensure_id.add_argument("--id", dest="expected_id", default=None, help="Expected project id.")
  project_ensure_id.add_argument("--json", action="store_true", help="Output JSON.")

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
  scene_update.add_argument("--json", action="store_true", help="Output JSON.")

  codex_parser = subparsers.add_parser("codex", help="Manage codex entities.")
  codex_sub = codex_parser.add_subparsers(dest="codex_command", required=True)
  codex_add = codex_sub.add_parser("add", help="Add codex entity.")
  codex_add.add_argument("--type", required=True, choices=sorted(ENTITY_TYPES), help="Entity type.")
  codex_add.add_argument("--name", required=True, help="Entity name.")
  codex_add.add_argument("--description", default="", help="Entity description.")
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
  codex_update.add_argument("--json", action="store_true", help="Output JSON.")

  proposal_parser = subparsers.add_parser("proposal", help="Manage AI proposal queue.")
  proposal_sub = proposal_parser.add_subparsers(dest="proposal_command", required=True)
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
  proposal_apply = proposal_sub.add_parser("apply", help="Mark proposal as applied.")
  proposal_apply.add_argument("--id", required=True, help="Proposal id.")
  proposal_apply.add_argument("--notes", default="", help="Optional note.")
  proposal_apply.add_argument("--json", action="store_true", help="Output JSON.")
  proposal_reject = proposal_sub.add_parser("reject", help="Mark proposal as rejected.")
  proposal_reject.add_argument("--id", required=True, help="Proposal id.")
  proposal_reject.add_argument("--notes", default="", help="Optional note.")
  proposal_reject.add_argument("--json", action="store_true", help="Output JSON.")
  proposal_generate = proposal_sub.add_parser("generate", help="Generate proposal via provider.")
  proposal_generate.add_argument("--scene", required=True, help="Scene id.")
  proposal_generate.add_argument("--instruction", required=True, help="User generation instruction.")
  proposal_generate.add_argument("--title", default="", help="Optional proposal title override.")
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
  branch_merge.add_argument("--json", action="store_true", help="Output JSON.")

  check_parser = subparsers.add_parser("check", help="Run repository quality checks.")
  check_sub = check_parser.add_subparsers(dest="check_command", required=True)
  check_continuity = check_sub.add_parser("continuity", help="Run continuity checks.")
  check_continuity.add_argument("--json", action="store_true", help="Output JSON.")
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

  chat_send = chat_sub.add_parser("send", help="Send a message to a chat thread.")
  chat_send.add_argument("--thread", required=True, help="Thread id.")
  chat_send.add_argument("--message", required=True, help="Message content.")
  chat_send.add_argument("--current-scene", default="", help="Current scene id.")
  chat_send.add_argument(
    "--scene-id",
    action="append",
    default=None,
    help="Explicit scene id to include in context. Repeatable.",
  )
  chat_send.add_argument("--selected-text", default="", help="Selected editor text.")
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
    initialize_git(paths)
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

  paths = _paths_from_cwd()

  if args.command == "project":
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
      scene_file = update_scene(
        paths,
        scene_identifier=args.id,
        title=args.title,
        summary=args.summary,
        pov=args.pov,
        status=args.status,
        body=args.body,
      )
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
      if all(value is None for value in (args.type, args.name, args.description)):
        raise OpenAuthorError("No updates provided. Supply at least one field.")
      row = update_entity(
        paths,
        entity_id=args.id,
        kind=args.type,
        name=args.name,
        description=args.description,
      )
      if args.json:
        print(json.dumps(row))
        return 0
      print(f"Updated entity {row['id']}")
      return 0

    rows = list_entities(paths, kind=args.type)
    if args.json:
      print(json.dumps(rows))
      return 0
    for row in rows:
      print(f"{row['id']}\t{row['type']}\t{row['name']}\t{row['description']}")
    return 0

  if args.command == "proposal":
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
      row = update_proposal_status(
        paths,
        proposal_id=args.id,
        status="applied",
        notes=args.notes,
      )
      if args.json:
        print(json.dumps(row))
        return 0
      print(f"Applied proposal {args.id}")
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
      row = generate_proposal(
        paths,
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
      row = merge_branches(paths, base=args.base, head=args.head)
      if args.json:
        print(json.dumps(row))
        return 0
      print(
        f"Merged {row['head']} into {row['base']} at {row['merge_commit']}"
      )
      return 0

  if args.command == "check":
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

    if args.chat_command == "send":
      context_overrides = _chat_context_overrides(args)
      row = send_chat_message(
        paths,
        thread_id=args.thread,
        message=args.message,
        current_scene_id=args.current_scene,
        scene_ids=args.scene_id or [],
        selected_text=args.selected_text,
        codex_ids=args.codex_id or [],
        context_overrides=context_overrides if context_overrides else None,
      )
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
      has_updates = any(
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
    return _run(args)
  except OpenAuthorError as error:
    print(f"error: {error}", file=sys.stderr)
    return 2


if __name__ == "__main__":
  raise SystemExit(main())
