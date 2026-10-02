"""Replay the bootstrap security control in a disposable local database."""
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))
from verify_shared_gateway_limiter import BOOTSTRAP

pg = Path("/opt/homebrew/opt/postgresql@17/bin")
with tempfile.TemporaryDirectory(prefix="openauthor-bootstrap-") as directory:
  task = Path(directory)
  data = task / "data"
  socket = task / "socket"
  socket.mkdir()
  subprocess.run([str(pg / "initdb"), "-D", str(data), "--auth=trust", "--no-locale", "-E", "UTF8"], check=True, stdout=subprocess.DEVNULL)
  (data / "postgresql.conf").write_text(f"listen_addresses = ''\nunix_socket_directories = '{socket}'\nfsync = on\n")
  subprocess.run([str(pg / "pg_ctl"), "-D", str(data), "-l", str(data / "server.log"), "-w", "start"], check=True, stdout=subprocess.DEVNULL)
  try:
    command = [str(pg / "psql"), "-h", str(socket), "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1"]
    subprocess.run(command, input=BOOTSTRAP, text=True, check=True)
    for migration in sorted((ROOT / "supabase/migrations").glob("*.sql")):
      if len(sys.argv) > 1 and migration.name > sys.argv[1]:
        continue
      subprocess.run(command + ["-f", str(migration)], check=True, stdout=subprocess.DEVNULL)
    result = subprocess.run(command + ["-f", str(ROOT / "supabase/tests/registry_bootstrap.sql")], check=False)
    raise SystemExit(result.returncode)
  finally:
    subprocess.run([str(pg / "pg_ctl"), "-D", str(data), "-m", "immediate", "-w", "stop"], check=True, stdout=subprocess.DEVNULL)
