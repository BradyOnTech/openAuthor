#!/usr/bin/env python3
"""Exercise shared quotas using a disposable PostgreSQL cluster and real HTTP adapters."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import subprocess
import tempfile


BOOTSTRAP = """
create role anon nologin;
create role authenticated nologin;
create role supabase_auth_admin nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key, instance_id uuid, aud text, role text, email text,
  encrypted_password text, email_confirmed_at timestamptz,
  raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  created_at timestamptz, updated_at timestamptz
);
create table auth.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  not_after timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
grant usage on schema auth to anon, authenticated, supabase_auth_admin;
grant execute on all functions in schema auth to anon, authenticated, supabase_auth_admin;
-- Only the metadata columns used by the project's real Storage RLS policies.
-- This exercises PostgreSQL policies, not the Supabase Storage HTTP/backend.
create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean not null,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id), name text not null,
  unique(bucket_id, name)
);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
"""


def main() -> None:
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("--pg-bin", required=True, type=Path)
  parser.add_argument("--sql-only", action="store_true", help="Run database authorization checks without gateway HTTP tests")
  parser.add_argument("--migration-through", help="Apply migrations up to this filename in the disposable cluster")
  args = parser.parse_args()
  root = Path(__file__).resolve().parents[1]
  for name in ("initdb", "pg_ctl", "psql"):
    if not (args.pg_bin / name).is_file():
      parser.error(f"PostgreSQL executable unavailable: {name}")
  with tempfile.TemporaryDirectory(prefix="openauthor-rate-sql-") as directory:
    task_dir = Path(directory)
    data = task_dir / "data"
    socket = task_dir / "socket"
    socket.mkdir()
    def run(command: list[str], **kwargs: object) -> None:
      subprocess.run(command, check=True, **kwargs)
    run([str(args.pg_bin / "initdb"), "-D", str(data), "--auth=trust", "--no-locale", "-E", "UTF8"], stdout=subprocess.DEVNULL)
    # Unix-domain socket only; no TCP listener or existing database is touched.
    (data / "postgresql.conf").write_text(f"listen_addresses = ''\nunix_socket_directories = '{socket}'\nfsync = on\n", encoding="utf-8")
    started = False
    try:
      run([str(args.pg_bin / "pg_ctl"), "-D", str(data), "-l", str(data / "server.log"), "-w", "start"])
      started = True
      psql = [str(args.pg_bin / "psql"), "-h", str(socket), "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1"]
      run(psql, input=BOOTSTRAP, text=True)
      for migration in sorted((root / "supabase/migrations").glob("*.sql")):
        if args.migration_through and migration.name > args.migration_through:
          continue
        run(psql + ["-f", str(migration)], stdout=subprocess.DEVNULL)
      run(psql + ["-f", str(root / "supabase/tests/mobile_encrypted_sync_rls.sql")], stdout=subprocess.DEVNULL)
      print("Existing encrypted-sync authorization SQL suite passed.", flush=True)
      run(psql + ["-f", str(root / "supabase/tests/realtime_rate_limit_fixtures.sql")], stdout=subprocess.DEVNULL)
      run(psql + ["-f", str(root / "supabase/tests/mobile_active_authority.sql")], stdout=subprocess.DEVNULL)
      print("Live Auth-session, workspace, project and key authority SQL checks passed.", flush=True)
      for name, migration in (
        ("mobile_recovery_snapshot.sql", "20261002150000_mobile_recovery_snapshot.sql"),
        ("mobile_project_deletion.sql", "20261002160000_mobile_project_deletion.sql"),
      ):
        if args.migration_through and args.migration_through < migration:
          continue
        run(psql + ["-f", str(root / "supabase/tests" / name)], stdout=subprocess.DEVNULL)
        print(f"{name}: real PostgreSQL checks passed.", flush=True)
      if not args.migration_through or args.migration_through >= "20261002160000_mobile_project_deletion.sql":
        run(["python3", str(root / "scripts/verify_project_deletion_concurrency.py"),
          "--pg-bin", str(args.pg_bin), "--socket", str(socket)])
      if args.sql_only:
        return
      environment = {**os.environ, "OPENAUTHOR_TEST_PG_SOCKET": str(socket), "OPENAUTHOR_TEST_PG_DATA": str(data), "OPENAUTHOR_TEST_PG_BIN": str(args.pg_bin)}
      run(["npm", "run", "check"], cwd=root / "gateway", env=environment)
    finally:
      if started:
        run([str(args.pg_bin / "pg_ctl"), "-D", str(data), "-m", "immediate", "-w", "stop"], stdout=subprocess.DEVNULL)


if __name__ == "__main__":
  main()
