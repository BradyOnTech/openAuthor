#!/usr/bin/env python3
"""Public account-RPC races in an already bootstrapped disposable fixture."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import uuid

from verify_project_deletion_concurrency import Database, Fixture, Session, literal


def fixture(database: Database) -> Fixture:
  value = Fixture(*(str(uuid.uuid4()) for _ in range(6)))
  key = hashlib.sha256(value.key.encode()).hexdigest()
  database.sql(f"""begin;
    insert into auth.users(id) values ('{value.user}');
    insert into auth.sessions(id,user_id) values ('{value.session}','{value.user}');
    insert into public.workspaces(id,name,slug) values ('{value.workspace}','Synthetic account race','race-{value.workspace}');
    insert into public.workspace_members(workspace_id,user_id,role) values ('{value.workspace}','{value.user}','owner');
    insert into public.projects(id,workspace_id,name,slug,created_by) values ('{value.project}','{value.workspace}','Synthetic book','race-{value.project}','{value.user}');
    {value.auth()}
    select public.mobile_register_device('{value.device}','{value.key}','desktop','Synthetic race','x25519-v1',decode('{key}','hex'));
    commit;""")
  return value


def preflight(database: Database, value: Fixture) -> str:
  output = database.sql(value.auth() + f"select public.mobile_account_deletion_preflight('{value.device}');")
  return json.loads(output.splitlines()[-1])["inventory_sha256"]


def begin(value: Fixture, reviewed: str, shared: bool = False, project: str | None = None, workspace: str | None = None) -> str:
  choices = {"workspaces": [{"workspace_id": workspace or value.workspace, "action": "leave" if shared else "delete"}],
    "projects": [{"project_id": project or value.project, "action": "retain" if shared else "delete", "outbox": "preserve"}]}
  return f"select public.mobile_begin_account_deletion('{value.device}','{reviewed}',{literal(json.dumps(choices))}::jsonb,{'true' if shared else 'false'});"


def held_author_write(database: Database) -> None:
  value = fixture(database)
  reviewed = preflight(database, value)
  added = str(uuid.uuid4())
  with Session(database) as writer, Session(database) as deleting:
    writer.send(f"begin; insert into public.projects(id,workspace_id,name,slug,created_by) values ('{added}','{value.workspace}','Held book','held','{value.user}');\n\\echo WRITER_HELD")
    writer.wait("WRITER_HELD")
    deleting.send("begin; " + value.auth() + begin(value, reviewed))
    database.waiting(deleting)
    writer.send("commit;"); writer.finish()
    deleting.finish("40001")
  assert database.sql(f"select exists(select 1 from public.mobile_account_deletion_jobs where user_id='{value.user}');") == "f"
  assert database.sql(f"select count(*) from public.projects where id='{added}';") == "1"
  print("PASS held account contribution wins; waiting stale reviewed request refuses 40001 with no intent", flush=True)


def held_intent(database: Database) -> None:
  value = fixture(database)
  reviewed = preflight(database, value)
  with Session(database) as deleting, Session(database) as authority, Session(database) as elevated:
    deleting.send("begin; " + value.auth() + begin(value, reviewed) + "\n\\echo INTENT_HELD")
    deleting.wait("INTENT_HELD")
    # Elevated tuple triggers fail promptly rather than waiting for an account
    # fence while holding rows; ordinary author entry points lock account first.
    elevated.send(f"insert into public.projects(workspace_id,name,slug,created_by) values ('{value.workspace}','Late','late','{value.user}');")
    elevated.finish("40001")
    authority.send(value.auth() + f"select public.mobile_register_device('{value.device}','{value.key}','desktop','Synthetic race','x25519-v1',digest('{value.key}','sha256'));")
    database.waiting(authority)
    deleting.send("commit;"); deleting.finish()
    authority.finish("42501")
  assert database.sql(f"select count(*) from public.mobile_account_deletion_jobs where user_id='{value.user}';") == "1"
  assert database.sql(f"select count(*) from public.projects where workspace_id='{value.workspace}';") == "1"
  print("PASS held intent rejects reverse-order elevated write and waiting author authority cannot reopen account", flush=True)


def stale_snapshot(database: Database) -> None:
  value = fixture(database)
  reviewed = preflight(database, value)
  with Session(database) as stale:
    stale.send("begin isolation level repeatable read; select count(*) from public.projects; " + value.auth() + "\n\\echo OLD_SNAPSHOT")
    stale.wait("OLD_SNAPSHOT")
    database.sql(value.auth() + begin(value, reviewed))
    stale.send(begin(value, reviewed)); stale.finish("25000")
  print("PASS pre-intent repeatable-read snapshot cannot bypass account freeze", flush=True)


def competing_shared_owners(database: Database) -> None:
  first, second = fixture(database), fixture(database)
  # Second author's unrelated solo workspace is removed in the synthetic setup,
  # so the exact review concerns only one shared namespace.
  database.sql(f"delete from public.projects where id='{second.project}'; delete from public.workspace_members where workspace_id='{second.workspace}'; delete from public.workspaces where id='{second.workspace}'; insert into public.workspace_members(workspace_id,user_id,role) values ('{first.workspace}','{second.user}','owner');")
  first_hash, second_hash = preflight(database, first), preflight(database, second)
  with Session(database) as deleting_first, Session(database) as deleting_second:
    deleting_first.send("begin; " + first.auth() + begin(first, first_hash, shared=True) + "\n\\echo FIRST_OWNER_HELD")
    deleting_first.wait("FIRST_OWNER_HELD")
    deleting_second.send("begin; " + second.auth() + begin(second, second_hash, shared=True, project=first.project, workspace=first.workspace))
    database.waiting(deleting_second)
    deleting_first.send("commit;"); deleting_first.finish()
    deleting_second.finish("40001")
  assert database.sql(f"select count(*) from public.mobile_account_deletion_jobs where user_id in ('{first.user}','{second.user}');") == "1"
  assert database.sql(f"select exists(select 1 from public.mobile_account_deletion_jobs where user_id='{second.user}');") == "f"
  print("PASS competing shared owners serialize; stale second intent cannot orphan retained workspace", flush=True)


def main() -> None:
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("--pg-bin", required=True, type=Path)
  parser.add_argument("--socket", required=True, type=Path)
  args = parser.parse_args()
  database = Database(args.pg_bin, args.socket)
  held_author_write(database)
  held_intent(database)
  stale_snapshot(database)
  competing_shared_owners(database)


if __name__ == "__main__":
  main()
