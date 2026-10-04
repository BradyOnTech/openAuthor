#!/usr/bin/env python3
"""Actual bootstrap lock races in a caller-owned disposable PostgreSQL cluster."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import uuid

from verify_project_deletion_concurrency import Database, Session, literal


def main() -> None:
  parser=argparse.ArgumentParser(description=__doc__)
  parser.add_argument('--pg-bin',required=True,type=Path)
  parser.add_argument('--socket',required=True,type=Path)
  args=parser.parse_args()
  database=Database(args.pg_bin,args.socket)
  def fixture() -> tuple[str,str]:
    user,session=str(uuid.uuid4()),str(uuid.uuid4())
    database.sql(f'insert into auth.users(id) values ({literal(user)}); insert into auth.sessions(id,user_id) values ({literal(session)},{literal(user)});')
    return user,session
  def claims(user: str,session: str) -> str:
    return f"set role authenticated; select set_config('request.jwt.claims',{literal(json.dumps({'sub':user,'session_id':session}))},false);"
  results=[]
  for same_account in [True,False]:
    first=fixture(); second=first if same_account else fixture(); base='bootstrap-race-'+str(uuid.uuid4())
    with Session(database) as hold,Session(database) as waiting:
      hold.send(f"begin; {claims(*first)} select 'ID:' || (public.workspace_bootstrap('First',{literal(base)})).id::text; select 'HOLDING';")
      first_id=hold.wait('ID:').split('ID:',1)[1];hold.wait('HOLDING')
      waiting.send(f"{claims(*second)} select 'ID:' || (public.workspace_bootstrap('Second',{literal(base)})).id::text; select 'DONE';")
      if same_account:
        database.waiting(waiting)
      hold.send('commit;');hold.finish()
      second_id=waiting.wait('ID:').split('ID:',1)[1];waiting.wait('DONE');waiting.finish()
      assert (first_id==second_id)==same_account
      for workspace in {first_id,second_id}:
        assert database.sql(f'select count(*) from public.workspace_members where workspace_id={literal(workspace)};')=='1'
      results.append({'control':'same-account serialization' if same_account else 'different-account isolation','result':'passed','actual_lock_wait':same_account})
  user,session=fixture();base='bootstrap-revoke-'+str(uuid.uuid4())
  with Session(database) as hold,Session(database) as waiting:
    hold.send(f"begin; select pg_advisory_xact_lock(hashtextextended({literal('openauthor-workspace-bootstrap:'+user+':'+base)},0)); select 'HOLDING';")
    hold.wait('HOLDING')
    waiting.send(f"{claims(user,session)} select public.workspace_bootstrap('Must refuse',{literal(base)});")
    database.waiting(waiting)
    database.sql(f'delete from auth.sessions where id={literal(session)};')
    hold.send('commit;');hold.finish();waiting.finish('42501')
    assert database.sql(f'select count(*) from public.workspaces where slug={literal(base+"-"+user)};')=='0'
  results.append({'control':'Auth session removed during bootstrap lock wait','result':'passed','actual_lock_wait':True})
  user,session=fixture()
  with Session(database) as transaction:
    transaction.send(f"begin isolation level repeatable read; {claims(user,session)} select public.workspace_bootstrap('Must refuse','repeatable-bootstrap');")
    transaction.finish('25000')
  results.append({'control':'stale snapshot isolation refused','result':'passed'})
  print(json.dumps({'scope':'Actual PostgreSQL transactions, no deployment','controls':results},indent=2))


if __name__=='__main__':
  main()
