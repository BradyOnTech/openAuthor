#!/usr/bin/env python3
"""Verify immutable project-key witnesses in a disposable Unix-socket cluster."""
from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import tempfile

from verify_shared_gateway_limiter import BOOTSTRAP


def main() -> None:
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("--pg-bin", required=True, type=Path)
  parser.add_argument("--baseline-red", action="store_true")
  args = parser.parse_args()
  root = Path(__file__).resolve().parents[1]
  for name in ("initdb", "pg_ctl", "psql"):
    if not (args.pg_bin / name).is_file():
      parser.error(f"PostgreSQL executable unavailable: {name}")
  with tempfile.TemporaryDirectory(prefix="openauthor-key-verifier-", dir="/private/tmp") as directory:
    task = Path(directory)
    data, socket = task / "data", task / "socket"
    socket.mkdir()
    def run(command: list[str], **kwargs: object) -> None:
      subprocess.run(command, check=True, **kwargs)
    run([str(args.pg_bin / "initdb"), "-D", str(data), "--auth=trust", "--no-locale", "-E", "UTF8"], stdout=subprocess.DEVNULL)
    (data / "postgresql.conf").write_text(f"listen_addresses = ''\nunix_socket_directories = '{socket}'\nfsync = on\n", encoding="utf-8")
    started = False
    try:
      try:
        run([str(args.pg_bin / "pg_ctl"), "-D", str(data), "-l", str(data / "server.log"), "-w", "start"])
      except subprocess.CalledProcessError:
        if (data / "server.log").is_file():
          print((data / "server.log").read_text(), flush=True)
        raise
      started = True
      psql = [str(args.pg_bin / "psql"), "-h", str(socket), "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1"]
      run(psql, input=BOOTSTRAP, text=True)
      for migration in sorted((root / "supabase/migrations").glob("*.sql")):
        if migration.name >= "20261002220000_mobile_project_key_verifiers.sql":
          continue
        run(psql + ["-f", str(migration)], stdout=subprocess.DEVNULL)
      run(psql + ["-f", str(root / "supabase/tests/mobile_project_key_verifiers_baseline.sql")])
      if not args.baseline_red:
        run(psql + ["-f", str(root / "supabase/migrations/20261002220000_mobile_project_key_verifiers.sql")], stdout=subprocess.DEVNULL)
      run(psql + ["-f", str(root / "supabase/tests/mobile_project_key_verifiers.sql")])
      if args.baseline_red:
        raise AssertionError("Baseline unexpectedly provides the new verifier interface.")
      run(psql + ["-f", str(root / "supabase/tests/mobile_encrypted_sync_rls.sql")], stdout=subprocess.DEVNULL)
      run(psql + ["-f", str(root / "supabase/tests/realtime_rate_limit_fixtures.sql")], stdout=subprocess.DEVNULL)
      run(psql + ["-f", str(root / "supabase/tests/mobile_recovery_snapshot.sql")], stdout=subprocess.DEVNULL)
      run(psql + ["-f", str(root / "supabase/tests/mobile_project_deletion.sql")], stdout=subprocess.DEVNULL)
      print("Existing encrypted-sync, snapshot recovery and attested project-deletion SQL suites passed.", flush=True)
      run(["python3", str(root / "scripts/verify_project_key_verifiers_concurrency.py"), "--pg-bin", str(args.pg_bin), "--socket", str(socket)])
    finally:
      if started:
        run([str(args.pg_bin / "pg_ctl"), "-D", str(data), "-m", "immediate", "-w", "stop"], stdout=subprocess.DEVNULL)


if __name__ == "__main__":
  main()
