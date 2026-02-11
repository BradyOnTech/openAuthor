from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .codex import ENTITY_TYPES, add_entity, ensure_codex, get_entity, list_entities, update_entity
from .git_ops import create_snapshot, initialize_git, list_snapshots
from .project import OpenAuthorError, initialize_project, resolve_project
from .proposals import create_proposal, get_proposal, list_proposals, update_proposal_status
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

  snapshot_parser = subparsers.add_parser("snapshot", help="Git-backed snapshot workflow.")
  snapshot_sub = snapshot_parser.add_subparsers(dest="snapshot_command", required=True)
  snapshot_create = snapshot_sub.add_parser("create", help="Create git snapshot.")
  snapshot_create.add_argument("-m", "--message", required=True, help="Snapshot message.")
  snapshot_log = snapshot_sub.add_parser("log", help="Show snapshot history.")
  snapshot_log.add_argument("--limit", type=int, default=10, help="Max entries.")

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
