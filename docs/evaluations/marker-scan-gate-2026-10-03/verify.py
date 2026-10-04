#!/usr/bin/env python3
"""Read-only packet integrity and receipt relations; no command execution."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import tarfile

PACKET_FILES = {"README.md", "results.json", "receipts.tar.gz", "receipt-index.json", "evidence-sha256.json", "verify.py"}
MAKEFILE_SHA = "bf11c9a4ee351eab9b761eaee15aee8be468b22ea688816f73e682438d73780e"
COMMIT = "2a561cc1edacc3117017ef5f39d2a5109b5b3181"

def require(condition, message):
  if not condition:
    raise ValueError(message)

def digest(data):
  return hashlib.sha256(data).hexdigest()

def read_regular(path):
  require(not path.is_symlink() and path.is_file(), "Nonregular packet or current source file")
  require(path.stat().st_size <= 8 * 1024 * 1024, "File size exceeds packet limit")
  return path.read_bytes()

def main():
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("--current-makefile", type=Path)
  args = parser.parse_args()
  root = Path(__file__).resolve().parent
  require({path.name for path in root.iterdir()} == PACKET_FILES, "Unexpected packet inventory")
  seal = json.loads(read_regular(root / "evidence-sha256.json"))
  require(set(seal["files"]) == PACKET_FILES - {"evidence-sha256.json"}, "Incomplete packet seal")
  for name, pin in seal["files"].items():
    require(digest(read_regular(root / name)) == pin, "Packet file hash mismatch")
  results = json.loads(read_regular(root / "results.json"))
  index = json.loads(read_regular(root / "receipt-index.json"))
  require(index["count"] == len(index["members"]) == results["archive_members"] == 44, "Archive count mismatch")
  data = {}
  with tarfile.open(root / "receipts.tar.gz", "r:gz") as archive:
    for item in archive:
      path = PurePosixPath(item.name)
      require(item.isfile() and not path.is_absolute() and ".." not in path.parts and str(path) == item.name, "Unsafe archive member")
      require(item.name in index["members"] and item.name not in data, "Unknown or duplicate archive member")
      pin = index["members"][item.name]
      require(item.size == pin["bytes"] and item.size <= 1024 * 1024, "Archive member size mismatch")
      stream = archive.extractfile(item)
      require(stream is not None, "Unreadable archive member")
      with stream:
        content = stream.read(item.size + 1)
      require(len(content) == item.size and digest(content) == pin["sha256"], "Archive member hash mismatch")
      data[item.name] = content
  require(set(data) == set(index["members"]), "Missing archive members")
  require(results["makefile_sha256"] == MAKEFILE_SHA and digest(data["source/Makefile"]) == MAKEFILE_SHA, "Makefile provenance mismatch")
  commit = json.loads(data["source-commit/source-commit.json"])
  require(commit["commit"] == results["source_commit"] == COMMIT and commit["files"] == {"Makefile": MAKEFILE_SHA}, "Source commit relation mismatch")
  original_seal = json.loads(data["fixtures/evidence-sha256.json"])
  require(len(original_seal["files"]) == results["original_fixture_seal_files"] == 29, "Original seal count mismatch")
  for name, pin in original_seal["files"].items():
    require(digest(data["fixtures/" + name]) == pin, "Original sealed receipt mismatch")
  expected = {"no-markers": 0, "marker": 2, "missing-rg": 2, "unavailable-input": 2}
  require(set(results["private_fixture_cases"]) == set(expected), "Fixture case inventory mismatch")
  for name, status in expected.items():
    case = results["private_fixture_cases"][name]
    receipt = json.loads(data[case["invocation"]])
    require(case["exit_code"] == receipt["exit_code"] == status and not receipt["timed_out"] and not case["timed_out"], "Fixture status mismatch")
    require(receipt["makefile_sha256"] == MAKEFILE_SHA and receipt["argv"][-1] == "audit-no-mocks", "Fixture source or command mismatch")
    require(digest(data[case["stdout"]]) == receipt["stdout_sha256"] and digest(data[case["stderr"]]) == receipt["stderr_sha256"], "Fixture log relation mismatch")
  require(b"Placeholder/stub markers found. Resolve before merge." in data["fixtures/marker.stdout.txt"], "Marker failure output absent")
  require(b"rg exited with status 127." in data["fixtures/missing-rg.stderr.txt"], "Missing executable failure absent")
  require(b"rg exited with status 2." in data["fixtures/unavailable-input.stderr.txt"], "Read failure absent")
  false_success = results["original_false_success"]
  receipt = json.loads(data[false_success["invocation"]])
  require(receipt["exit_code"] == false_success["exit_code"] == 0 and false_success["classification"] == "invalid_evidence", "False-success classification mismatch")
  require(b"command not found: rg" in data[false_success["stderr"]], "Original missing executable evidence absent")
  for name, status in {"repository-check-final": 0, "repository-check-final-missing-rg": 2}.items():
    case = results["root_final_repository_checks"][name]
    receipt = json.loads(data[case["invocation"]])
    require(receipt["exit_code"] == case["exit_code"] == status and receipt["makefile_sha256"] == MAKEFILE_SHA and receipt["argv"] == ["make", "check"], "Repository check relation mismatch")
    require(b"Scanning for placeholder/stub markers..." in data[case["stdout"]], "Final marker scan output absent")
  require(b"rg exited with status 127." in data["repository/repository-check-final-missing-rg.stderr.txt"], "Final missing-rg failure absent")
  require(b"command not found: rg" not in data["repository/repository-check-final.stderr.txt"], "Final pass still lacks executable")
  spec = json.loads(data["spec/findings.json"])
  require(spec["status"] == "PASS" and spec["open_findings"] == [] and spec["reviewed_source_sha256"] == {"Makefile": MAKEFILE_SHA}, "Independent Spec relation mismatch")
  require(json.loads(data["spec/reviewed-sha256.json"]) == {"Makefile": MAKEFILE_SHA}, "Independent source seal mismatch")
  if args.current_makefile:
    require(digest(read_regular(args.current_makefile)) == MAKEFILE_SHA, "Current Makefile differs from retained source")
  print(json.dumps({"status": "pass", "scope": "read-only packet integrity and receipt relations only", "archive_members": 44, "original_sealed_files": 29, "current_makefile_checked": bool(args.current_makefile)}))

if __name__ == "__main__":
  try:
    main()
  except (OSError, ValueError, KeyError, TypeError, tarfile.TarError) as error:
    raise SystemExit("Marker packet verification failed: " + str(error))
