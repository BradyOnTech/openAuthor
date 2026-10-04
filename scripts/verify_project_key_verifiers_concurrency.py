#!/usr/bin/env python3
"""Actual queued verifier transactions against an already disposable cluster."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import uuid

from verify_account_deletion_concurrency import begin, preflight
from verify_project_deletion_concurrency import Database, Fixture, Session, fixture, literal


def verifier(value: Fixture, version: int = 2) -> dict[str, object]:
  ciphertext = bytes.fromhex("cd" * 57)
  return {"schema": "openauthor.mobile.project-key-verifier", "schema_version": 1,
    "project_id": value.project, "key_version": version, "algorithm": "aes-256-gcm-v1", "aad_version": 1,
    "nonce_hex": "01" * 12, "ciphertext_hex": ciphertext.hex(), "ciphertext_sha256": hashlib.sha256(ciphertext).hexdigest()}


def rotation(value: Fixture, previous: int = 1) -> str:
  sealed = bytes.fromhex("cd" * 80)
  envelopes = [{"algorithm": "x25519-xsalsa20-poly1305-sealedbox-v1", "envelope_id": str(uuid.uuid4()),
    "recipient_device_id": value.device, "recipient_key_id": value.key,
    "sealed_project_key_hex": sealed.hex(), "sealed_project_key_sha256": hashlib.sha256(sealed).hexdigest()}]
  return f"select public.mobile_rotate_project_key_with_verifier('{value.device}','{value.project}',{previous},'race-control',{literal(json.dumps(envelopes))}::jsonb,{literal(json.dumps(verifier(value, previous + 1)))}::jsonb);"


def proof(value: Fixture, version: int = 1) -> str:
  return f"select public.mobile_get_project_key_verifier('{value.device}','{value.project}',{version});"


def unchanged(database: Database, value: Fixture) -> None:
  assert database.sql(f"select count(*)||':'||max(key_version) from public.mobile_project_key_versions where project_id='{value.project}';") == "1:1"
  assert database.sql(f"select count(*) from public.mobile_project_key_verifiers where project_id='{value.project}';") == "0"
  assert database.sql(f"select count(*) from public.mobile_project_key_envelopes where project_id='{value.project}';") == "0"


def project_wait(database: Database, changed: str) -> None:
  value = fixture(database)
  adjacent = fixture(database) if changed == "workspace" else None
  with Session(database) as holding, Session(database) as rotating:
    holding.send(f"begin; select id from public.projects where id='{value.project}' for update;\n\\echo PROJECT_HELD")
    holding.wait("PROJECT_HELD")
    rotating.send(value.auth() + rotation(value))
    database.waiting(rotating)
    if changed == "workspace":
      assert adjacent is not None
      holding.send(f"update public.projects set workspace_id='{adjacent.workspace}' where id='{value.project}';")
    elif changed == "archive":
      holding.send(f"update public.projects set status='archived' where id='{value.project}';")
    elif changed == "session":
      database.sql(f"delete from auth.sessions where id='{value.session}';")
    elif changed == "enrollment":
      database.sql(f"update public.mobile_project_devices set revoked_at=clock_timestamp(),revoked_by_device_id='{value.device}',revocation_reason_code='race-control' where project_id='{value.project}' and device_id='{value.device}';")
    elif changed == "device":
      database.sql(f"update public.mobile_devices set revoked_at=clock_timestamp(),revocation_reason_code='race-control' where id='{value.device}';")
    else:
      next_key = str(uuid.uuid4())
      public_key = hashlib.sha256(next_key.encode()).hexdigest()
      database.sql(f"insert into public.mobile_device_keys(id,device_id,key_version,algorithm,public_key,public_key_sha256) values ('{next_key}','{value.device}',2,'x25519-v1',decode('{public_key}','hex'),encode(digest(decode('{public_key}','hex'),'sha256'),'hex')); update public.mobile_device_keys set retired_at=clock_timestamp() where id='{value.key}'; update public.mobile_devices set current_key_id='{next_key}' where id='{value.device}';")
    holding.send("commit;"); holding.finish()
    rotating.finish("42501")
  unchanged(database, value)
  print(f"PASS queued verifier rotation rechecks changed {changed}; no partial version, envelope or witness", flush=True)


def competing_rotations(database: Database, reviewed: bool = False) -> None:
  value = fixture(database)
  with Session(database) as first, Session(database) as second:
    if reviewed:
      for session in (first, second):
        session.send("begin; " + value.auth() + proof(value) + "\n\\echo REVIEW_HELD")
        session.wait("REVIEW_HELD")
    else:
      first.send("begin; " + value.auth())
      second.send(value.auth())
    first.send(rotation(value) + "\n\\echo ROTATION_HELD")
    first.wait("ROTATION_HELD")
    second.send(rotation(value))
    database.waiting(second)
    first.send("commit;"); first.finish()
    second.finish("40001")
  assert database.sql(f"select count(*)||':'||max(key_version) from public.mobile_project_key_versions where project_id='{value.project}';") == "2:2"
  assert database.sql(f"select count(*) from public.mobile_project_key_verifiers where project_id='{value.project}';") == "1"
  assert database.sql(f"select count(*) from public.mobile_project_key_envelopes where project_id='{value.project}';") == "1"
  returned = json.loads(database.sql(value.auth() + proof(value, 2)).splitlines()[-1])
  assert returned == verifier(value)
  print(f"PASS {'two held proof reviews' if reviewed else 'competing verifier rotations'} serialize without lock-upgrade deadlock; one exact receipt wins", flush=True)


def namespace_wait(database: Database, changed: str) -> None:
  value = fixture(database)
  database.sql(value.auth() + rotation(value))
  with Session(database) as holding, Session(database) as reading:
    holding.send(f"begin; select pg_advisory_xact_lock(hashtextextended('openauthor-mobile-project:{value.project}',0));\n\\echo NAMESPACE_HELD")
    holding.wait("NAMESPACE_HELD")
    reading.send(value.auth() + proof(value, 2))
    database.waiting(reading)
    if changed == "retirement":
      holding.send(f"update public.mobile_project_key_versions set retired_at=clock_timestamp() where project_id='{value.project}' and key_version=2;")
      expected = "40001"
    elif changed == "session":
      database.sql(f"delete from auth.sessions where id='{value.session}';")
      expected = "42501"
    else:
      holding.send(value.auth() + value.deletion())
      expected = "42501"
    holding.send("commit;"); holding.finish()
    reading.finish(expected)
  assert database.sql(f"select count(*) from public.mobile_project_key_verifiers where project_id='{value.project}';") == "1"
  print(f"PASS queued proof read refuses committed {changed} after namespace wait; historical witness never grants authority", flush=True)


def account_wait(database: Database) -> None:
  value = fixture(database)
  reviewed = preflight(database, value)
  with Session(database) as deleting, Session(database) as rotating:
    deleting.send("begin; " + value.auth() + begin(value, reviewed) + "\n\\echo ACCOUNT_INTENT_HELD")
    deleting.wait("ACCOUNT_INTENT_HELD")
    rotating.send(value.auth() + rotation(value))
    database.waiting(rotating)
    deleting.send("commit;"); deleting.finish()
    rotating.finish("42501")
  unchanged(database, value)
  print("PASS queued verifier rotation cannot reopen a committed account deletion intent", flush=True)


def stale_snapshot(database: Database) -> None:
  value = fixture(database)
  with Session(database) as stale:
    stale.send("begin isolation level repeatable read; " + value.auth() + proof(value))
    stale.finish("25000")
  unchanged(database, value)
  print("PASS repeatable-read verifier operations refuse stale lifecycle snapshots before mutation", flush=True)


def main() -> None:
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("--pg-bin", required=True, type=Path)
  parser.add_argument("--socket", required=True, type=Path)
  args = parser.parse_args()
  database = Database(args.pg_bin, args.socket)
  for changed in ("workspace", "archive", "session", "enrollment", "device", "recipient-key"):
    project_wait(database, changed)
  competing_rotations(database)
  competing_rotations(database, reviewed=True)
  for changed in ("retirement", "session", "project-deletion"):
    namespace_wait(database, changed)
  account_wait(database)
  stale_snapshot(database)


if __name__ == "__main__":
  main()
