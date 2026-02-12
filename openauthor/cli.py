from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .ai import DEFAULT_MODELS, SUPPORTED_PROVIDERS, generate_proposal
from .budget import (
  get_generation_budget_report,
  reset_generation_budget_policy,
  summarize_generation_usage,
  update_generation_budget_policy,
)
from .checks import run_continuity_checks
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
from .project import OpenAuthorError, initialize_project, resolve_project
from .proposals import create_proposal, get_proposal, list_proposals, update_proposal_status
from .retrieval import build_retrieval_index, get_retrieval_index_status, query_retrieval_index
from .scenes import add_scene, get_scene, list_scenes, update_scene


def build_parser() -> argparse.ArgumentParser:
  parser = argparse.ArgumentParser(prog="openauthor", description="Local-first fiction authoring tools.")
  subparsers = parser.add_subparsers(dest="command", required=True)

  init_parser = subparsers.add_parser("init", help="Initialize an openAuthor project.")
  init_parser.add_argument("path", nargs="?", default=".", help="Project directory (default: current directory).")
  init_parser.add_argument("--name", default=None, help="Project name override.")

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

  return parser


def _paths_from_cwd():
  return resolve_project(Path.cwd())


def _run(args: argparse.Namespace) -> int:
  if args.command == "init":
    root = Path(args.path).resolve()
    paths = initialize_project(root, name=args.name)
    ensure_codex(paths)
    initialize_git(paths)
    print(f"Initialized openAuthor project at {paths.root}")
    return 0

  paths = _paths_from_cwd()

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
      for category in ("scene", "proposal", "codex", "project", "budget", "other"):
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
    if args.check_command != "continuity":
      raise OpenAuthorError(f"Unsupported check command: {args.check_command}")
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
      for name in ("local", "openai", "anthropic"):
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
