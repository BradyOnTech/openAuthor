"""Replay exact-call recovery checks from retained inputs without external services."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile


def digest(path: Path) -> str:
  return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("--pg-bin", type=Path, required=True)
  parser.add_argument("--node-modules", type=Path, required=True)
  parser.add_argument("--mode", choices=("baseline", "final"), default="final")
  args = parser.parse_args()
  packet = Path(__file__).resolve().parent
  fingerprints = json.loads((packet / "source-sha256.json").read_text())
  with tempfile.TemporaryDirectory(prefix="openauthor-voice-recovery-replay-") as directory:
    root = Path(directory)
    for name in ("tested-source.tar.gz", *(["baseline-overrides.tar.gz"] if args.mode == "baseline" else [])):
      with tarfile.open(packet / name) as archive:
        for entry in archive.getmembers():
          if not entry.isfile() or entry.name.startswith("/") or ".." in Path(entry.name).parts:
            raise ValueError("Source archive contains an unsafe entry")
        archive.extractall(root, filter="data")
    expected = dict(fingerprints["final"])
    if args.mode == "baseline":
      expected.update(fingerprints["baseline_overrides"])
    actual = {name: digest(root / name) for name in expected}
    if actual != expected:
      raise ValueError("Archived inputs do not match their fingerprints")
    modules = args.node_modules.resolve()
    if not modules.is_dir():
      parser.error("An existing gateway node_modules directory is required; no installation is performed")
    (root / "gateway/node_modules").symlink_to(modules, target_is_directory=True)
    commands = [
      (["node", "--experimental-strip-types", "--test", "--test-concurrency=1", "test/sharedVoiceControl.test.ts", "test/sessionLeases.test.ts"], root / "gateway"),
      (["python3", "scripts/verify_voice_control.py", "--pg-bin", str(args.pg_bin.resolve())], root),
    ]
    if args.mode == "final":
      commands.extend((["npm", "run", name], root / "gateway") for name in ("typecheck", "build"))
    outcomes = []
    for index, (command, cwd) in enumerate(commands):
      result = subprocess.run(command, cwd=cwd, check=False, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
      sys.stdout.buffer.write(result.stdout)
      sys.stdout.flush()
      expected_exit = 1 if args.mode == "baseline" else 0
      if result.returncode != expected_exit:
        raise RuntimeError(f"Unexpected {args.mode} replay exit {result.returncode}: {command}")
      if index < 2:
        text = result.stdout.decode("utf-8")
        total = 29 if index == 0 else 9
        failed = (4 if index == 0 else 3) if args.mode == "baseline" else 0
        for marker in (f"# tests {total}\n", f"# pass {total-failed}\n", f"# fail {failed}\n", "# skipped 0\n"):
          if marker not in text:
            raise RuntimeError(f"Expected replay control counts missing: {marker.strip()}")
      outcomes.append({"command": command, "exit_code": result.returncode})
    if {name: digest(root / name) for name in expected} != expected:
      raise ValueError("A tested input changed during replay")
    print(json.dumps({"mode": args.mode, "unchanged_inputs": len(expected), "commands": outcomes}, indent=2), flush=True)


if __name__ == "__main__":
  main()
