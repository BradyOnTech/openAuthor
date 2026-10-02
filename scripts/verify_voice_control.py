"""Verify known-call control against an isolated PostgreSQL cluster and HTTP fixtures."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import subprocess
import tempfile

from verify_shared_gateway_limiter import BOOTSTRAP


def main() -> None:
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("--pg-bin", type=Path, required=True)
  args = parser.parse_args()
  root = Path(__file__).resolve().parents[1]
  for name in ("initdb", "pg_ctl", "psql"):
    if not (args.pg_bin / name).is_file():
      parser.error(f"PostgreSQL executable unavailable: {name}")
  with tempfile.TemporaryDirectory(prefix="openauthor-voice-control-") as directory:
    task = Path(directory)
    data = task / "data"
    socket = task / "socket"
    socket.mkdir()
    subprocess.run([str(args.pg_bin / "initdb"), "-D", str(data), "--auth=trust", "--no-locale", "-E", "UTF8"], check=True, stdout=subprocess.DEVNULL)
    (data / "postgresql.conf").write_text(f"listen_addresses = ''\nunix_socket_directories = '{socket}'\nfsync = on\n", encoding="utf-8")
    subprocess.run([str(args.pg_bin / "pg_ctl"), "-D", str(data), "-l", str(data / "server.log"), "-w", "start"], check=True)
    try:
      psql = [str(args.pg_bin / "psql"), "-h", str(socket), "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1"]
      subprocess.run(psql, input=BOOTSTRAP, text=True, check=True)
      for migration in sorted((root / "supabase/migrations").glob("*.sql")):
        subprocess.run(psql + ["-f", str(migration)], check=True, stdout=subprocess.DEVNULL)
      subprocess.run(psql + ["-f", str(root / "supabase/tests/mobile_voice_control.sql")], check=True, stdout=subprocess.DEVNULL)
      print("Independent known-call control SQL checks passed.", flush=True)
      environment = {**os.environ, "OPENAUTHOR_TEST_PG_SOCKET": str(socket), "OPENAUTHOR_TEST_PG_DATA": str(data), "OPENAUTHOR_TEST_PG_BIN": str(args.pg_bin)}
      subprocess.run(["node", "--experimental-strip-types", "--test", "--test-concurrency=1", "test/voiceControl.postgres.test.ts"], cwd=root / "gateway", env=environment, check=True)
    finally:
      subprocess.run([str(args.pg_bin / "pg_ctl"), "-D", str(data), "-m", "immediate", "-w", "stop"], check=True, stdout=subprocess.DEVNULL)


if __name__ == "__main__":
  main()
