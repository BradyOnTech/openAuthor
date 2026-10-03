#!/usr/bin/env python3
"""Verify retained writing-accessibility evidence without tests or external calls."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import tarfile

packet = Path(__file__).resolve().parent
root = packet.parents[2]
sha = lambda data: hashlib.sha256(data).hexdigest()
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--seal", action="store_true", help="Refresh declared packet hashes before verifying.")
args = parser.parse_args()

def packet_files():
  return {
    str(path.relative_to(packet)): path
    for path in packet.rglob("*")
    if path.is_file() and path.name != "evidence-sha256.json"
    and path.relative_to(packet).parts[0] != "native"
    and "__pycache__" not in path.parts
  }

if args.seal:
  manifest = {name: sha(path.read_bytes()) for name, path in sorted(packet_files().items())}
  (packet / "evidence-sha256.json").write_text(json.dumps(manifest, indent=2) + "\n")

checks = 0
manifest = json.loads((packet / "evidence-sha256.json").read_text())
assert set(manifest) == set(packet_files()), "Packet file set changed."
for name, digest in manifest.items():
  assert sha((packet / name).read_bytes()) == digest, name
  checks += 1

results = json.loads((packet / "results.json").read_text())
sources = json.loads((packet / "source-sha256.json").read_text())
assert len(sources) == results["source_inputs"] == results["committed_input_matches"] == 4
with tarfile.open(packet / "tested-source.tar.gz") as archive:
  members = archive.getmembers()
  assert len(members) == len(sources) and {member.name for member in members} == set(sources)
  for member in members:
    name = PurePosixPath(member.name)
    assert member.isfile() and not name.is_absolute() and ".." not in name.parts, member.name
    assert sha(archive.extractfile(member).read()) == sources[member.name], member.name
    assert sha((root / member.name).read_bytes()) == sources[member.name], member.name
    committed = subprocess.check_output(["git", "show", f'{results["implementation_commit"]}:{member.name}'], cwd=root)
    assert sha(committed) == sources[member.name], member.name
    checks += 3

for name, entry in json.loads((packet / "baseline-sha256.json").read_text()).items():
  assert entry["commit"] == results["baseline_commit"]
  assert sha((packet / name).read_bytes()) == entry["sha256"], name
  committed = subprocess.check_output(["git", "show", f'{entry["commit"]}:{entry["repo_path"]}'], cwd=root)
  assert sha(committed) == entry["sha256"], name
  checks += 2

for name, entry in results["logs"].items():
  raw = gzip.decompress((packet / name).read_bytes())
  assert len(raw) == entry["raw_bytes"] and sha(raw) == entry["raw_sha256"], name
  checks += 1
for name, entry in results["browser_artifacts"].items():
  raw = (packet / name).read_bytes()
  assert len(raw) == entry["bytes"] and sha(raw) == entry["sha256"], name
  if name.endswith(".json"):
    json.loads(raw)
  else:
    assert raw.startswith(b"\x89PNG\r\n\x1a\n"), name
  checks += 1
print(f"{checks} declared artifact, raw-log, archived/current/committed source and baseline checks passed; native/ excluded.")
