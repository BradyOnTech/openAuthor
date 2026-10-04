#!/usr/bin/env python3
"""Check retained evidence and the exact current/committed tested inputs."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import tarfile

packet = Path(__file__).resolve().parent
root = packet.parents[3]
digest = lambda data: hashlib.sha256(data).hexdigest()
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--seal", action="store_true")
args = parser.parse_args()
files = {path.relative_to(packet).as_posix(): path for path in packet.rglob("*")
  if path.is_file() and "native" not in path.relative_to(packet).parts
  and "__pycache__" not in path.parts and path.name != "evidence-sha256.json"}
assert all(not path.is_symlink() for path in files.values())
if args.seal:
  (packet / "evidence-sha256.json").write_text(json.dumps(
    {name: digest(path.read_bytes()) for name, path in sorted(files.items())}, indent=2) + "\n")
manifest = json.loads((packet / "evidence-sha256.json").read_text())
assert set(files) == set(manifest)
for name, path in files.items():
  assert digest(path.read_bytes()) == manifest[name], name
results = json.loads((packet / "results.json").read_text())
source = json.loads((packet / "source-sha256.json").read_text())
assert results["implementation_commit"] == source["implementation_commit"]
assert len(source["selected_sha256"]) == results["selected_inputs"] == 8
assert len(source["broader_input_sha256"]) == results["broader_inputs"]
expected = source["broader_input_sha256"]
with tarfile.open(packet / "tested-inputs.tar.gz") as archive:
  members = archive.getmembers()
  assert len(members) == len(expected) and {member.name for member in members} == set(expected)
  for member in members:
    path = PurePosixPath(member.name)
    assert member.isfile() and not path.is_absolute() and ".." not in path.parts
    data = archive.extractfile(member).read()
    assert digest(data) == expected[member.name], member.name
    assert (root / member.name).read_bytes() == data, member.name
    committed = subprocess.check_output(["git", "show", f'{source["implementation_commit"]}:{member.name}'], cwd=root)
    assert committed == data, member.name
for name, expected_hash in source["selected_sha256"].items():
  assert source["broader_input_sha256"][name] == expected_hash
for name, entry in results["logs"].items():
  data = gzip.decompress((packet / name).read_bytes())
  assert len(data) == entry["raw_bytes"] and digest(data) == entry["raw_sha256"], name
for engine in ["chrome", "webkit"]:
  log = gzip.decompress((packet / f"{engine}.txt.gz").read_bytes()).decode()
  assert "11 passed" in log and " failed" not in log and " skipped" not in log
assert "677 passed (677)" in gzip.decompress((packet / "desktop.txt.gz").read_bytes()).decode()
assert "built in" in gzip.decompress((packet / "build.txt.gz").read_bytes()).decode()
guard = json.loads((packet / "author-artifacts.json").read_text())
assert guard["before_sha256"] == guard["after_sha256"] and guard["unchanged"]
assert results["release_certified"] is False and results["all_six_priorities"] == "in_progress"
print(f"{len(files)} retained files and {len(expected)} archived/current/committed inputs verified; native/ excluded.")
