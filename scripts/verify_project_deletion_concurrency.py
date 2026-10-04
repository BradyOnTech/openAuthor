#!/usr/bin/env python3
"""Bounded public-RPC races against an already bootstrapped disposable cluster.

Each control creates independent synthetic identities. Storage rows represent
metadata only: this script neither runs Storage HTTP nor certifies blob purge.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import queue
import subprocess
import threading
import time
import uuid


DEADLINE_SECONDS = 8


def literal(value: str) -> str:
  return "'" + value.replace("'", "''") + "'"


class Database:
  def __init__(self, pg_bin: Path, socket: Path):
    self.command = [str(pg_bin / "psql"), "-h", str(socket), "-d", "postgres",
      "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"]

  def sql(self, source: str) -> str:
    result = subprocess.run(self.command, input=source, text=True, capture_output=True,
      timeout=DEADLINE_SECONDS, check=False)
    if result.returncode:
      raise AssertionError(f"Fixture SQL failed: {result.stderr.strip()}")
    return result.stdout.strip()

  def waiting(self, session: Session) -> None:
    deadline = time.monotonic() + DEADLINE_SECONDS
    while time.monotonic() < deadline:
      if session.process.poll() is not None:
        raise AssertionError(f"Competing transaction exited before its lock wait: {session.output()}")
      if self.sql(f"select exists(select 1 from pg_stat_activity where pid={session.pid} and wait_event_type='Lock');") == "t":
        return
      time.sleep(0.025)
    raise AssertionError("Competing transaction never reached an actual database lock wait.")


class Session:
  def __init__(self, database: Database):
    self.process = subprocess.Popen(database.command, stdin=subprocess.PIPE,
      stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    self.lines: list[str] = []
    self.events: queue.Queue[str] = queue.Queue()
    self.reader = threading.Thread(target=self._read, daemon=True)
    self.reader.start()
    self.send("select 'BACKEND:' || pg_backend_pid();")
    self.pid = int(self.wait("BACKEND:").split("BACKEND:", 1)[1])

  def _read(self) -> None:
    assert self.process.stdout is not None
    for line in self.process.stdout:
      self.lines.append(line)
      self.events.put(line.rstrip())

  def send(self, source: str) -> None:
    assert self.process.stdin is not None
    self.process.stdin.write(source + "\n")
    self.process.stdin.flush()

  def wait(self, marker: str) -> str:
    deadline = time.monotonic() + DEADLINE_SECONDS
    while time.monotonic() < deadline:
      try:
        line = self.events.get(timeout=min(0.1, max(0.001, deadline - time.monotonic())))
      except queue.Empty:
        if self.process.poll() is not None:
          raise AssertionError(f"Transaction ended before {marker}: {self.output()}")
        continue
      if marker in line:
        return line
      if "ERROR:" in line:
        raise AssertionError(f"Transaction failed before {marker}: {line}")
    raise AssertionError(f"Transaction never signaled {marker}: {self.output()}")

  def output(self) -> str:
    return "".join(self.lines).strip()

  def finish(self, expected_state: str | tuple[str | None, ...] | None = None) -> str | None:
    assert self.process.stdin is not None
    self.process.stdin.close()
    result = self.process.wait(timeout=DEADLINE_SECONDS)
    self.reader.join(timeout=1)
    output = self.output()
    allowed = expected_state if isinstance(expected_state, tuple) else (expected_state,)
    if result == 0 and None in allowed:
      return None
    for state in allowed:
      if state is not None and result != 0 and f"ERROR:  {state}:" in output:
        return state
    raise AssertionError(f"Expected outcomes {allowed}, got exit {result}: {output}")

  def close(self) -> None:
    if self.process.poll() is None:
      self.process.kill()
      self.process.wait(timeout=DEADLINE_SECONDS)
    self.reader.join(timeout=1)

  def __enter__(self) -> Session:
    return self

  def __exit__(self, *_args: object) -> None:
    self.close()


@dataclass(frozen=True)
class Fixture:
  user: str
  workspace: str
  project: str
  session: str
  device: str
  key: str

  def auth(self) -> str:
    claims = json.dumps({"sub": self.user, "session_id": self.session, "device_id": self.device})
    return f"set role authenticated; select set_config('request.jwt.claims',{literal(claims)},false);"

  def deletion(self) -> str:
    return f"select public.mobile_begin_project_deletion('{self.device}','{self.project}');"

  def recovery(self) -> str:
    return "select public.mobile_recover_project_key_envelope(" + ",".join([
      literal(self.device), literal(self.project), "1", literal(self.key),
      literal(str(uuid.uuid4())), "repeat('cd',80)"]) + ");"

  def rotation(self) -> str:
    sealed = bytes.fromhex("cd" * 80)
    envelopes = json.dumps([{"algorithm": "x25519-xsalsa20-poly1305-sealedbox-v1",
      "envelope_id": str(uuid.uuid4()), "recipient_device_id": self.device,
      "recipient_key_id": self.key, "sealed_project_key_hex": sealed.hex(),
      "sealed_project_key_sha256": hashlib.sha256(sealed).hexdigest()}])
    return f"select public.mobile_rotate_project_key_with_envelopes('{self.device}','{self.project}',1,'concurrency-rotation',{literal(envelopes)}::jsonb);"


def fixture(database: Database) -> Fixture:
  value = Fixture(*(str(uuid.uuid4()) for _ in range(6)))
  public_key = hashlib.sha256(value.key.encode()).hexdigest()
  database.sql(f"""
    begin;
    insert into auth.users(id) values ('{value.user}');
    insert into auth.sessions(id,user_id) values ('{value.session}','{value.user}');
    insert into public.workspaces(id,name,slug) values ('{value.workspace}','Synthetic concurrency','race-{value.workspace}');
    insert into public.workspace_members(workspace_id,user_id,role) values ('{value.workspace}','{value.user}','owner');
    insert into public.projects(id,workspace_id,name,slug,created_by)
      values ('{value.project}','{value.workspace}','Synthetic concurrency','race-{value.project}','{value.user}');
    insert into public.mobile_devices(id,user_id,auth_session_id,platform,device_label)
      values ('{value.device}','{value.user}','{value.session}','desktop','Synthetic race desktop');
    insert into public.mobile_device_keys(id,device_id,key_version,algorithm,public_key,public_key_sha256)
      values ('{value.key}','{value.device}',1,'x25519-v1',decode('{public_key}','hex'),encode(digest(decode('{public_key}','hex'),'sha256'),'hex'));
    update public.mobile_devices set current_key_id='{value.key}' where id='{value.device}';
    insert into public.mobile_project_devices(project_id,device_id,enrolled_by_device_id)
      values ('{value.project}','{value.device}','{value.device}');
    insert into public.mobile_project_key_versions(project_id,key_version,created_by_device_id,rotation_reason_code)
      values ('{value.project}',1,'{value.device}','concurrency-control');
    commit;
  """)
  return value


def frozen(database: Database, value: Fixture) -> bool:
  return database.sql(f"select exists(select 1 from public.mobile_project_deletion_jobs where project_id='{value.project}');") == "t"


def insertion(value: Fixture) -> tuple[str, str]:
  path = f"projects/{value.project}/snapshots/{uuid.uuid4()}.bin"
  return path, f"insert into storage.objects(bucket_id,name) values ('mobile-encrypted-sync',{literal(path)});"


def late_upload(database: Database, isolation: str, expected_state: str) -> None:
  value = fixture(database)
  path, insert = insertion(value)
  with Session(database) as uploader:
    uploader.send(f"begin isolation level {isolation}; select count(*) from public.projects where id='{value.project}';\n\\echo SNAPSHOT_ESTABLISHED")
    uploader.wait("SNAPSHOT_ESTABLISHED")
    database.sql(value.auth() + value.deletion())
    uploader.send(insert)
    uploader.finish(expected_state)
  assert frozen(database, value), "Freeze must commit before the late write."
  assert database.sql(f"select exists(select 1 from storage.objects where name={literal(path)});") == "f", "Late elevated upload inserted metadata."
  print(f"PASS pre-freeze {isolation} uploader refused with SQLSTATE {expected_state}", flush=True)


def committed_writer(database: Database) -> None:
  value = fixture(database)
  path, insert = insertion(value)
  with Session(database) as uploader, Session(database) as deletion:
    uploader.send("begin; " + insert + "\n\\echo WRITE_HELD")
    uploader.wait("WRITE_HELD")
    deletion.send(value.auth() + value.deletion())
    database.waiting(deletion)
    assert not frozen(database, value), "Freeze bypassed a live write fence."
    uploader.send("commit;\n\\echo WRITE_COMMITTED")
    uploader.wait("WRITE_COMMITTED")
    uploader.finish()
    deletion.finish()
  assert frozen(database, value), "Queued freeze did not complete after writer commit."
  assert database.sql(f"select exists(select 1 from storage.objects where name={literal(path)});") == "t", "Committed ciphertext metadata must remain for cleanup."
  print("PASS freeze waits for real in-flight shared write and includes its commit", flush=True)


def revoked_owner(database: Database, authority: str) -> None:
  value = fixture(database)
  with Session(database) as holder, Session(database) as deletion:
    holder.send(f"begin; select public.mobile_lock_open_project('{value.project}');\n\\echo FENCE_HELD")
    holder.wait("FENCE_HELD")
    deletion.send(value.auth() + value.deletion())
    database.waiting(deletion)
    if authority == "owner":
      database.sql(f"update public.workspace_members set role='viewer' where workspace_id='{value.workspace}' and user_id='{value.user}';")
    else:
      database.sql(f"delete from auth.sessions where id='{value.session}';")
    holder.send("commit;")
    holder.finish()
    deletion.finish("42501")
  assert not frozen(database, value), "Queued deletion trusted revoked pre-wait authority."
  assert database.sql(f"select status from public.projects where id='{value.project}';") == "active", "Refused deletion changed the project."
  print(f"PASS queued owner deletion revalidates revoked {authority} after lock wait", flush=True)


def changed_recovery(database: Database, changed: str) -> None:
  value = fixture(database)
  with Session(database) as rotation, Session(database) as recovery:
    rotation.send(f"begin; select public.mobile_lock_open_project('{value.project}'); select id from public.projects where id='{value.project}' for update;\n\\echo ROTATION_HELD")
    rotation.wait("ROTATION_HELD")
    recovery.send(value.auth() + value.recovery())
    database.waiting(recovery)
    if changed == "project-version":
      rotation.send(f"update public.mobile_project_key_versions set retired_at=clock_timestamp() where project_id='{value.project}' and key_version=1; insert into public.mobile_project_key_versions(project_id,key_version,created_by_device_id,rotation_reason_code) values ('{value.project}',2,'{value.device}','concurrency-rotation');")
    else:
      next_key = str(uuid.uuid4())
      public_key = hashlib.sha256(next_key.encode()).hexdigest()
      rotation.send(f"insert into public.mobile_device_keys(id,device_id,key_version,algorithm,public_key,public_key_sha256) values ('{next_key}','{value.device}',2,'x25519-v1',decode('{public_key}','hex'),encode(digest(decode('{public_key}','hex'),'sha256'),'hex')); update public.mobile_device_keys set retired_at=clock_timestamp() where id='{value.key}'; update public.mobile_devices set current_key_id='{next_key}' where id='{value.device}';")
    rotation.send("commit;")
    rotation.finish()
    recovery.finish("40001")
  assert database.sql(f"select count(*) from public.mobile_project_key_envelopes where project_id='{value.project}';") == "0", "Stale recovery installed an envelope."
  print(f"PASS queued recovery refuses changed {changed} before envelope commit", flush=True)


def concurrent_rotations(database: Database) -> None:
  value = fixture(database)
  with Session(database) as first, Session(database) as second:
    for session in [first, second]:
      session.send(value.auth() + f"begin; select public.mobile_get_project_key_state('{value.device}','{value.project}');\n\\echo PREFLIGHT_HELD")
      session.wait("PREFLIGHT_HELD")
    # Both public preflights retain their transaction's shared namespace fence.
    # If they also retain project FOR SHARE, both upgrades deadlock (40P01).
    first.send(value.rotation() + "commit;")
    second.send(value.rotation() + "commit;")
    results = [first.finish((None, "40001")), second.finish((None, "40001"))]
  assert results.count(None) == 1 and results.count("40001") == 1, "Exactly one reviewed rotation must commit; the other must fail stale, never deadlock."
  assert database.sql(f"select count(*) from public.mobile_project_key_versions where project_id='{value.project}';") == "2", "Competing rotations created an extra project version."
  assert database.sql(f"select key_version from public.mobile_project_key_versions where project_id='{value.project}' and retired_at is null;") == "2", "The serialized winning rotation must become current."
  print("PASS two public preflight/rotation transactions serialize without lock-upgrade deadlock", flush=True)


def main() -> None:
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("--pg-bin", type=Path, required=True)
  parser.add_argument("--socket", type=Path, required=True, help="Existing disposable cluster Unix socket directory")
  args = parser.parse_args()
  if not (args.pg_bin / "psql").is_file() or not args.socket.is_dir():
    parser.error("An installed psql and existing disposable cluster socket directory are required.")
  database = Database(args.pg_bin, args.socket)
  for relation in ["auth.sessions", "storage.objects", "public.mobile_project_deletion_jobs"]:
    if database.sql(f"select to_regclass({literal(relation)}) is not null;") != "t":
      parser.error(f"Disposable cluster is not bootstrapped through the current migrations: {relation}")
  late_upload(database, "read committed", "42501")
  late_upload(database, "repeatable read", "25000")
  committed_writer(database)
  revoked_owner(database, "owner")
  revoked_owner(database, "Auth session")
  changed_recovery(database, "project-version")
  changed_recovery(database, "device-key")
  concurrent_rotations(database)
  print("8/8 real PostgreSQL concurrency controls passed; no Storage backend purge claim.", flush=True)


if __name__ == "__main__":
  main()
