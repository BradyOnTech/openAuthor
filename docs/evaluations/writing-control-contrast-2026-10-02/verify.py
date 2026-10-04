#!/usr/bin/env python3
"""Verify retained writing-control evidence; --seal intentionally updates hashes."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import tarfile


packet = Path(__file__).resolve().parent
root = packet.parents[2]


def digest(data):
  return hashlib.sha256(data).hexdigest()


def packet_files():
  files = {}
  for path in packet.rglob("*"):
    relative = path.relative_to(packet)
    if relative.parts[0] == "native" or "__pycache__" in relative.parts:
      continue
    assert not path.is_symlink(), f"Unexpected packet symlink: {relative}"
    if path.is_file() and relative != Path("evidence-sha256.json"):
      files[relative.as_posix()] = path
  return files


def retained_path(name):
  relative = PurePosixPath(name)
  assert not relative.is_absolute() and ".." not in relative.parts, name
  return packet / relative


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--seal", action="store_true", help="Refresh hashes for intentional packet changes.")
args = parser.parse_args()
files = packet_files()
if args.seal:
  manifest = {name: digest(path.read_bytes()) for name, path in sorted(files.items())}
  (packet / "evidence-sha256.json").write_text(json.dumps(manifest, indent=2) + "\n")

manifest = json.loads((packet / "evidence-sha256.json").read_text())
assert set(manifest) == set(files), "Packet file set changed."
checks = 0
for name, expected in manifest.items():
  assert digest(retained_path(name).read_bytes()) == expected, name
  checks += 1

results = json.loads((packet / "results.json").read_text())
sources = json.loads((packet / "source-sha256.json").read_text())
assert len(sources["baseline"]) == results["source_provenance"]["baseline_production_files"] == 2
for name, entry in sources["baseline"].items():
  data = retained_path(name).read_bytes()
  assert len(data) == entry["bytes"] and digest(data) == entry["sha256"], name
  assert entry["commit"] == results["baseline_production_commit"], name
  committed = subprocess.check_output(["git", "show", f'{entry["commit"]}:{entry["repo_path"]}'], cwd=root)
  assert committed == data, name
  checks += 2

final = sources["final"]
assert len(final["files"]) == results["source_provenance"]["final_selected_source_files"]
if final["status"] == "pending_root_source_freeze":
  assert not final["files"], "Pending source must not imply a frozen snapshot."
else:
  assert final["status"] == "frozen", final["status"]
  expected_members = {entry["repo_path"]: entry for entry in final["files"].values()}
  with tarfile.open(retained_path(final["archive"])) as archive:
    members = archive.getmembers()
    assert len(members) == len(expected_members) and {member.name for member in members} == set(expected_members)
    for member in members:
      member_path = PurePosixPath(member.name)
      assert member.isfile() and not member_path.is_absolute() and ".." not in member_path.parts, member.name
      data = archive.extractfile(member).read()
      entry = expected_members[member.name]
      assert len(data) == entry["bytes"] and digest(data) == entry["sha256"], member.name
      checks += 1
  for name, entry in final["files"].items():
    data = retained_path(name).read_bytes()
    assert len(data) == entry["bytes"] and digest(data) == entry["sha256"], name
    repo_path = PurePosixPath(entry["repo_path"])
    assert not repo_path.is_absolute() and ".." not in repo_path.parts, repo_path
    assert (root / repo_path).read_bytes() == data, f"Current source differs: {repo_path}"
    checks += 2
    if final.get("commit"):
      committed = subprocess.check_output(["git", "show", f'{final["commit"]}:{repo_path}'], cwd=root)
      assert committed == data, f"Committed source differs: {repo_path}"
      checks += 1

for name, entry in results["logs"].items():
  raw = gzip.decompress(retained_path(name).read_bytes())
  assert len(raw) == entry["raw_bytes"] and digest(raw) == entry["raw_sha256"], name
  checks += 1
for name, entry in results["browser_artifacts"].items():
  raw = retained_path(name).read_bytes()
  assert len(raw) == entry["bytes"] and digest(raw) == entry["sha256"], name
  if name.endswith(".json"):
    json.loads(raw)
  elif name.endswith(".png"):
    assert raw.startswith(b"\x89PNG\r\n\x1a\n"), name
  elif name.endswith(".md"):
    raw.decode("utf-8")
  else:
    raise AssertionError(f"Unsupported browser artifact: {name}")
  checks += 1

for run in results["runs"].values():
  for entry in run["themed_observations"].values():
    observations = json.loads(retained_path(entry["artifact"]).read_text())
    assert len(observations) == entry["count"] and list(observations) == entry["names"], entry["artifact"]
    contrasts = {name: value["contrast"] for name, value in observations.items()}
    assert contrasts == entry["contrasts"], entry["artifact"]
    assert {name: value for name, value in contrasts.items() if value < 4.5} == entry["below_text_threshold"], entry["artifact"]
    checks += 1

for entry in results.get("final_gates", {}).values():
  raw = gzip.decompress(retained_path(entry["log"]).read_bytes()).decode("utf-8")
  assert entry["reported_exit_code"] == 0
  assert all(text in raw for text in entry["required_log_text"]), entry["log"]
  checks += 1

print(f"{checks} retained artifact, raw-log and source checks passed; source status={final['status']}; native/ excluded.")
