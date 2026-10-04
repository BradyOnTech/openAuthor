#!/usr/bin/env python3
"""Verify reviewed account lifecycle only in a new Unix-socket PostgreSQL fixture."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import subprocess
import tempfile

from verify_shared_gateway_limiter import BOOTSTRAP


def main() -> None:
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("--pg-bin", required=True, type=Path)
  args = parser.parse_args()
  root = Path(__file__).resolve().parents[1]
  for name in ("initdb", "pg_ctl", "psql"):
    if not (args.pg_bin / name).is_file():
      parser.error(f"PostgreSQL executable unavailable: {name}")
  with tempfile.TemporaryDirectory(prefix="openauthor-account-sql-") as directory:
    task = Path(directory)
    data, socket = task / "data", task / "socket"
    socket.mkdir()
    def run(command: list[str], **kwargs: object) -> None:
      subprocess.run(command, check=True, **kwargs)
    run([str(args.pg_bin / "initdb"), "-D", str(data), "--auth=trust", "--no-locale", "-E", "UTF8"], stdout=subprocess.DEVNULL)
    (data / "postgresql.conf").write_text(f"listen_addresses = ''\nunix_socket_directories = '{socket}'\nfsync = on\n", encoding="utf-8")
    started = False
    try:
      run([str(args.pg_bin / "pg_ctl"), "-D", str(data), "-l", str(data / "server.log"), "-w", "start"])
      started = True
      psql = [str(args.pg_bin / "psql"), "-h", str(socket), "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1"]
      run(psql, input=BOOTSTRAP, text=True)
      for migration in sorted((root / "supabase/migrations").glob("*.sql")):
        if migration.name <= "20261002180000_mobile_account_deletion.sql":
          run(psql + ["-f", str(migration)], stdout=subprocess.DEVNULL)
      run(psql + ["-f", str(root / "supabase/tests/mobile_account_deletion.sql")])
      run(["python3", str(root / "scripts/verify_account_deletion_concurrency.py"), "--pg-bin", str(args.pg_bin), "--socket", str(socket)])
      environment = {**os.environ, "OPENAUTHOR_TEST_PG_SOCKET": str(socket), "OPENAUTHOR_TEST_PG_BIN": str(args.pg_bin)}
      run(["node", "--experimental-strip-types", "--test", "test/accountDeletion.test.ts", "test/accountDeletion.postgres.test.ts"], cwd=root / "gateway", env=environment)
    finally:
      if started:
        run([str(args.pg_bin / "pg_ctl"), "-D", str(data), "-m", "immediate", "-w", "stop"], stdout=subprocess.DEVNULL)


if __name__ == "__main__":
  main()
