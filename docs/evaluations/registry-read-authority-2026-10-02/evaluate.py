"""Replay registry read authority in a private disposable PostgreSQL cluster."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))
from verify_shared_gateway_limiter import BOOTSTRAP

BASELINE = """
create function pg_temp.observe(p_sql text) returns jsonb language plpgsql as $$
declare v_count bigint; begin
  execute p_sql into v_count;
  return jsonb_build_object('rows',v_count);
exception when others then
  return jsonb_build_object('sqlstate',sqlstate,'message',sqlerrm);
end $$;
set local role authenticated;
select pg_temp.author(1);
select jsonb_build_object('scope','live owner registry reads',
  'workspaces',pg_temp.observe('select count(*) from public.workspaces'),
  'memberships',pg_temp.observe('select count(*) from public.workspace_members'),
  'projects',pg_temp.observe('select count(*) from public.projects'),
  'activity',pg_temp.observe('select count(*) from public.project_activity'),
  'own_state',pg_temp.observe('select count(*) from public.workspace_user_state'));
reset role;
delete from auth.sessions where user_id='f1000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.author(1);
select jsonb_build_object('scope','ended owner Auth session',
  'own_state',pg_temp.observe('select count(*) from public.workspace_user_state'));
rollback;
"""


def main() -> None:
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("--pg-bin", type=Path, default=Path("/opt/homebrew/opt/postgresql@17/bin"))
  parser.add_argument("--migration-through", default="20261002200000_registry_read_authority.sql")
  parser.add_argument("--baseline", action="store_true")
  parser.add_argument("--capture-inputs", type=Path, help="Retain exact executed SQL, including the fixture bootstrap")
  args = parser.parse_args()
  with tempfile.TemporaryDirectory(prefix="openauthor-registry-read-") as directory:
    task = Path(directory)
    data, socket = task / "data", task / "socket"
    socket.mkdir()
    subprocess.run([str(args.pg_bin / "initdb"), "-D", str(data), "--auth=trust", "--no-locale", "-E", "UTF8"], check=True, stdout=subprocess.DEVNULL)
    (data / "postgresql.conf").write_text(f"listen_addresses = ''\nunix_socket_directories = '{socket}'\nfsync = on\n", encoding="utf-8")
    started = False
    try:
      subprocess.run([str(args.pg_bin / "pg_ctl"), "-D", str(data), "-l", str(data / "server.log"), "-w", "start"], check=True, stdout=subprocess.DEVNULL)
      started = True
      command = [str(args.pg_bin / "psql"), "-h", str(socket), "-d", "postgres", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"]
      inputs = {"fixture-bootstrap.sql": BOOTSTRAP}
      subprocess.run(command, input=BOOTSTRAP, text=True, check=True)
      for migration in sorted((ROOT / "supabase/migrations").glob("*.sql")):
        if migration.name <= args.migration_through:
          source = migration.read_text(encoding="utf-8")
          inputs[str(migration.relative_to(ROOT))] = source
          print(json.dumps({"applied_migration": migration.name, "sha256": hashlib.sha256(source.encode("utf-8")).hexdigest()}), flush=True)
          subprocess.run(command, input=source, text=True, check=True, stdout=subprocess.DEVNULL)
      test = (ROOT / "supabase/tests/registry_read_authority.sql").read_text(encoding="utf-8")
      if args.baseline:
        test = test.split("-- Read checks start here.", 1)[0] + BASELINE
      print(json.dumps({"executed_sql_sha256": hashlib.sha256(test.encode("utf-8")).hexdigest()}), flush=True)
      subprocess.run(command, input=test, text=True, check=True)
      if args.capture_inputs:
        inputs["executed-controls.sql"] = test
        with tarfile.open(args.capture_inputs, "w:gz") as archive:
          for name, source in inputs.items():
            content = source.encode("utf-8")
            entry = tarfile.TarInfo(name)
            entry.size, entry.mode = len(content), 0o600
            archive.addfile(entry, io.BytesIO(content))
        print(json.dumps({"captured_inputs": str(args.capture_inputs), "sha256": hashlib.sha256(args.capture_inputs.read_bytes()).hexdigest()}), flush=True)
      print("Registry baseline observations complete." if args.baseline else "Registry read-authority controls passed.", flush=True)
    finally:
      if started:
        subprocess.run([str(args.pg_bin / "pg_ctl"), "-D", str(data), "-m", "immediate", "-w", "stop"], check=True, stdout=subprocess.DEVNULL)


if __name__ == "__main__":
  main()
