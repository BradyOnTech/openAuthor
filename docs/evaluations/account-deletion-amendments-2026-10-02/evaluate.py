#!/usr/bin/env python3
"""Replay the archived synthetic SQL and concurrency controls, without services."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile


def main() -> None:
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("--pg-bin", required=True, type=Path)
  parser.add_argument("--baseline-only", action="store_true")
  args = parser.parse_args()
  packet = Path(__file__).resolve().parent
  expected = json.loads((packet / "source-sha256.json").read_text())
  archive = packet / "tested-source.tar.gz"
  result = json.loads((packet / "results.json").read_text())
  if hashlib.sha256(archive.read_bytes()).hexdigest() != result["artifacts"]["tested-source.tar.gz"]:
    raise SystemExit("Archived inputs changed; do not attribute a replay to this checkpoint.")
  with tempfile.TemporaryDirectory(prefix="openauthor-amendment-replay-", dir="/private/tmp") as directory:
    root = Path(directory)
    with tarfile.open(archive, "r:gz") as sources:
      for member in sources.getmembers():
        if member.name not in expected or not member.isfile() or Path(member.name).is_absolute() or ".." in Path(member.name).parts:
          raise SystemExit("Archive contains an input outside the recorded source manifest.")
        data = sources.extractfile(member)
        if data is None:
          raise SystemExit("Archive input cannot be read.")
        content = data.read()
        if hashlib.sha256(content).hexdigest() != expected[member.name]:
          raise SystemExit("Archive source fingerprint changed.")
        path = root / member.name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    if any(not (root / path).is_file() for path in expected):
      raise SystemExit("Archive does not contain all recorded inputs.")
    command=["python3", str(root / "scripts/verify_account_deletion_amendments.py"), "--pg-bin", str(args.pg_bin)]
    if args.baseline_only:
      command.append("--baseline-only")
    subprocess.run(command, check=True)


if __name__ == "__main__":
  main()
