#!/usr/bin/env python3
"""Real queued retention-amendment transactions in a disposable local fixture."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import uuid

from verify_account_deletion_concurrency import begin, fixture, preflight
from verify_project_deletion_concurrency import Database, Fixture, Session, literal


def shared_fixture(database: Database) -> tuple[Fixture, Fixture, str, str]:
  departing, owner = fixture(database), fixture(database)
  database.sql(f"insert into public.workspace_members(workspace_id,user_id,role) values ('{departing.workspace}','{owner.user}','owner');")
  reviewed = preflight(database, departing)
  job = json.loads(database.sql(departing.auth() + begin(departing, reviewed, shared=True)).splitlines()[-1])["job_id"]
  return departing, owner, reviewed, job


def review(database: Database, departing: Fixture, job: str) -> dict[str, object]:
  return json.loads(database.sql(departing.auth() + f"select public.mobile_account_deletion_amendment_preflight('{job}');").splitlines()[-1])


def apply(departing: Fixture, owner: Fixture, job: str, value: dict[str, object], amendment: str | None = None) -> str:
  choices = [{"project_id": departing.project, "resolution": "retain_current_scope", "workspace_id": owner.workspace}]
  return f"select public.mobile_amend_account_deletion('{job}','{amendment or uuid.uuid4()}',{value['base_revision']},'{value['review_sha256']}',{literal(json.dumps(choices))}::jsonb);"


def move(database: Database, departing: Fixture, workspace: str) -> None:
  database.sql(f"update public.projects set workspace_id='{workspace}' where id='{departing.project}';")


def held_move(database: Database) -> None:
  departing, owner, _original, job = shared_fixture(database)
  move(database, departing, owner.workspace)
  current = review(database, departing, job)
  with Session(database) as moving, Session(database) as amending:
    moving.send(f"begin; update public.projects set workspace_id='{departing.workspace}' where id='{departing.project}';\n\\echo MOVE_HELD")
    moving.wait("MOVE_HELD")
    amending.send("begin; " + departing.auth() + apply(departing, owner, job, current))
    database.waiting(amending)
    moving.send("commit;"); moving.finish()
    amending.finish("40001")
  assert database.sql(f"select amendment_revision from public.mobile_account_deletion_jobs where job_id='{job}';") == "0"
  print("PASS held project move wins; waiting stale amendment refuses 40001 without audit or scope change", flush=True)


def held_amendment(database: Database) -> None:
  departing, owner, original, job = shared_fixture(database)
  database.sql(f"set role mobile_deletion_verifier; select public.mobile_prepare_account_auth_finalization('{job}','{original}',repeat('ab',32));")
  move(database, departing, owner.workspace)
  current = review(database, departing, job)
  with Session(database) as amending, Session(database) as verifying, Session(database) as removing:
    amending.send("begin; " + departing.auth() + apply(departing, owner, job, current) + "\n\\echo AMENDMENT_HELD")
    amending.wait("AMENDMENT_HELD")
    verifying.send(f"set role mobile_deletion_verifier; select public.mobile_prepare_account_auth_finalization('{job}','{original}',repeat('cd',32));")
    database.waiting(verifying)
    removing.send(f"delete from auth.users where id='{departing.user}';")
    removing.finish("40001")
    amending.send("commit;"); amending.finish()
    verifying.finish("55000")
  assert database.sql(f"select phase||':'||amendment_revision from public.mobile_account_deletion_jobs where job_id='{job}';") == "deleting:1"
  assert database.sql(f"select exists(select 1 from auth.users where id='{departing.user}');") == "t"
  print("PASS held amendment invalidates waiting stale verifier and refuses reverse-order Auth deletion without deadlock", flush=True)


def competing_amendments(database: Database) -> None:
  departing, owner, _original, job = shared_fixture(database)
  move(database, departing, owner.workspace)
  current = review(database, departing, job)
  first, second = str(uuid.uuid4()), str(uuid.uuid4())
  with Session(database) as winning, Session(database) as stale:
    winning.send("begin; " + departing.auth() + apply(departing, owner, job, current, first) + "\n\\echo FIRST_AMENDMENT_HELD")
    winning.wait("FIRST_AMENDMENT_HELD")
    stale.send(departing.auth() + apply(departing, owner, job, current, second))
    database.waiting(stale)
    winning.send("commit;"); winning.finish()
    stale.finish("40001")
  assert database.sql(f"select count(*) from public.mobile_account_deletion_amendments where job_id='{job}';") == "1"
  receipt = database.sql(departing.auth() + f"select public.mobile_get_account_deletion_amendment('{job}','{second}') is null;").splitlines()[-1]
  assert receipt == "t"
  print("PASS competing reviewed amendments serialize; one durable receipt wins and stale second request leaves no audit", flush=True)


def held_owner_delete(database: Database, auth_ready: bool) -> None:
  departing, owner, original, job = shared_fixture(database)
  if auth_ready:
    database.sql(f"set role mobile_deletion_verifier; select public.mobile_prepare_account_auth_finalization('{job}','{original}',repeat('ab',32));")
  with Session(database) as owner_removal, Session(database) as finalizing:
    owner_removal.send(f"begin; delete from public.workspace_members where workspace_id='{departing.workspace}' and user_id='{owner.user}';\n\\echo OWNER_DELETE_HELD")
    owner_removal.wait("OWNER_DELETE_HELD")
    if auth_ready:
      finalizing.send(f"delete from auth.users where id='{departing.user}';")
    else:
      finalizing.send(f"set role mobile_deletion_verifier; select public.mobile_prepare_account_auth_finalization('{job}','{original}',repeat('ab',32));")
    database.waiting(finalizing)
    owner_removal.send("commit;"); owner_removal.finish()
    finalizing.finish("55000")
  assert database.sql(f"select exists(select 1 from auth.users where id='{departing.user}');") == "t"
  print(f"PASS uncommitted remaining-owner DELETE fences {'Auth removal' if auth_ready else 'preparation'}; committed owner loss refuses 55000", flush=True)


def held_scope_owner_delete(database: Database) -> None:
  departing, owner, _original, job = shared_fixture(database)
  move(database, departing, owner.workspace)
  current = review(database, departing, job)
  with Session(database) as owner_removal, Session(database) as amending:
    owner_removal.send(f"begin; delete from public.workspace_members where workspace_id='{owner.workspace}' and user_id='{owner.user}';\n\\echo DESTINATION_OWNER_HELD")
    owner_removal.wait("DESTINATION_OWNER_HELD")
    amending.send(departing.auth() + apply(departing, owner, job, current))
    database.waiting(amending)
    owner_removal.send("commit;"); owner_removal.finish()
    amending.finish("40001")
  assert database.sql(f"select amendment_revision from public.mobile_account_deletion_jobs where job_id='{job}';") == "0"
  print("PASS held destination-owner loss refreshes fingerprint after wait and refuses stale amendment", flush=True)


def expired_session_wait(database: Database) -> None:
  departing, owner, _original, job = shared_fixture(database)
  move(database, departing, owner.workspace)
  current = review(database, departing, job)
  with Session(database) as holding, Session(database) as amending:
    holding.send(f"begin; select pg_advisory_xact_lock(hashtextextended('openauthor-mobile-account:{departing.user}',0));\n\\echo ACCOUNT_HELD")
    holding.wait("ACCOUNT_HELD")
    amending.send(departing.auth() + apply(departing, owner, job, current))
    database.waiting(amending)
    database.sql(f"delete from auth.sessions where id='{departing.session}';")
    holding.send("commit;"); holding.finish()
    amending.finish("42501")
  assert database.sql(f"select amendment_revision from public.mobile_account_deletion_jobs where job_id='{job}';") == "0"
  print("PASS Auth session deleted during account-fence wait cannot amend frozen intent", flush=True)


def stale_snapshot(database: Database) -> None:
  departing, owner, _original, job = shared_fixture(database)
  move(database, departing, owner.workspace)
  with Session(database) as stale:
    stale.send("begin isolation level repeatable read; " + departing.auth() + f"select public.mobile_account_deletion_amendment_preflight('{job}');")
    stale.finish("25000")
  print("PASS repeatable-read amendment review refuses stale snapshot before mutation", flush=True)


def main() -> None:
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("--pg-bin", required=True, type=Path)
  parser.add_argument("--socket", required=True, type=Path)
  args = parser.parse_args()
  database = Database(args.pg_bin, args.socket)
  held_move(database)
  held_amendment(database)
  competing_amendments(database)
  held_owner_delete(database, False)
  held_owner_delete(database, True)
  held_scope_owner_delete(database)
  expired_session_wait(database)
  stale_snapshot(database)


if __name__ == "__main__":
  main()
