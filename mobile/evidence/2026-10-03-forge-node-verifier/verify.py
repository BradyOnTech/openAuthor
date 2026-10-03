#!/usr/bin/env python3
"""Verify retained bytes/receipt correlations; never replay helpers or crypto."""
import argparse
from datetime import datetime
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import tarfile

PACKET = Path(__file__).resolve().parent


def require(ok, message):
  if not ok:
    raise ValueError(message)


def sha(data):
  return hashlib.sha256(data).hexdigest()


def obj(data):
  return json.loads(data)


def archive(data):
  files = {}
  with tarfile.open(fileobj=io.BytesIO(data), mode="r:*") as handle:
    for member in handle.getmembers():
      path = PurePosixPath(member.name)
      require(not path.is_absolute() and ".." not in path.parts, "Unsafe archive path")
      require(member.isfile() and member.name not in files, "Nonregular/duplicate archive member")
      files[member.name] = handle.extractfile(member).read()
  return files


def exact(files, expected, label):
  require(set(files) == set(expected), label + " file set differs")
  for name, digest in expected.items():
    require(sha(files[name]) == digest, label + " hash differs: " + name)


def terminal(files, name, code=0):
  receipt = obj(files[name + "-invocation.json"])
  require(receipt["exit_code"] == code and not receipt["timed_out"], name + " terminal receipt differs")
  require(receipt["finished_at"] >= receipt["started_at"], name + " timeline differs")
  return receipt


def test_count(files, name, passed, test_files=None, failed=None):
  text = re.sub(r"\x1b\[[0-9;]*m", "", files[name + ".stdout.txt"].decode())
  require(re.search(r"Tests\s+" + (str(failed) + r" failed \| " if failed else "") + str(passed) + r" passed", text), name + " test count differs")
  if test_files is not None:
    require(re.search(r"Test Files\s+" + str(test_files) + r" passed", text), name + " file count differs")


def main():
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("--current", action="store_true", help="Also hash current 100 source inputs and installed RSA file")
  args = parser.parse_args()
  packet = {p.name: p.read_bytes() for p in PACKET.iterdir() if p.is_file() and p.name != "evidence-sha256.json"}
  exact(packet, obj((PACKET / "evidence-sha256.json").read_bytes())["files"], "Packet seal")
  receipt_map = obj(packet["receipts.json"])
  results = obj(packet["results.json"])
  phases = {}
  for name, receipt in receipt_map["archives"].items():
    require(sha(packet[name]) == receipt["archive_sha256"], name + " archive hash differs")
    data = archive(packet[name])
    require(len(data) == receipt["file_count"], name + " member count differs")
    exact(data, {n: v["sha256"] for n, v in receipt["members"].items()}, name)
    for n, info in receipt["members"].items():
      require(len(data[n]) == info["bytes"], name + " member size differs")
    phases[name] = data
  initial = phases["initial-node-backport.tar.gz"]
  canonical = phases["canonical-node-verifier.tar.gz"]
  reviews = phases["source-reviews.tar.gz"]
  before = obj(initial["before.json"])
  first_inputs = archive(initial["inputs-before.tar.gz"])
  initial_hashes = {**before["broader_mobile_inputs"], **before["selected"]}
  exact(first_inputs, initial_hashes, "Initial 99 input capture")
  require(len(first_inputs) == 99, "Initial source input count differs")
  final_inputs = archive(initial["inputs-final.tar.gz"])
  final_hashes = obj(initial["final-inputs.json"])["source"]
  exact(final_inputs, final_hashes, "Initial final focused input capture")
  require(len(final_inputs) == 100, "Initial final capture count differs")
  initial_commit = obj(initial["source-commit.json"])
  require(initial_commit["commit"] == results["historical_cardinality_source_commit"], "Historical source commit differs")
  final_seven = obj(initial["final-seven.json"])["final_seven"]
  require(initial_commit["source_files"] == final_seven, "Historical final seven correlation differs")
  red_inputs = archive(canonical["red-inputs.tar.gz"])
  red = obj(canonical["red-inputs.json"])
  exact(red_inputs, red["source_sha256"], "Red source capture")
  require(len(red_inputs) == 7 and red["base_source_commit"] == initial_commit["commit"], "Red control source scope differs")
  green_inputs = archive(canonical["green-inputs.tar.gz"])
  green = obj(canonical["green-inputs.json"])
  exact(green_inputs, green["files"], "Green source capture")
  require(len(green_inputs) == 100, "Green source input count differs")
  canonical_commit = obj(canonical["source-commit.json"])
  require(canonical_commit["commit"] == results["source_commit"], "Canonical commit differs")
  for n, digest in canonical_commit["files"].items():
    require(green["files"][n] == digest, "Canonical reviewed commit/input correlation differs")
  require(len(canonical_commit["files"]) == 3, "Canonical source change count differs")
  green_review = obj(canonical["green-review-hashes.json"])
  require(green_review["three_files"] == canonical_commit["files"], "Green review hashes differ")
  manifest_path = "mobile/security/forge-backport-1.4.0.json"
  initial_manifest = obj(final_inputs[manifest_path])
  strict_manifest = obj(green_inputs[manifest_path])
  original_rsa = initial["original-installed-rsa.js"]
  for manifest in [initial_manifest, strict_manifest]:
    patch = manifest["forge"]["patch"]
    require(sha(original_rsa) == patch["original_sha256"], "RSA preimage differs")
    text = original_rsa.decode()
    require(text.count(patch["before"]) == 1, "RSA preimage anchor count differs")
    require(sha(text.replace(patch["before"], patch["after"]).encode()) == patch["patched_sha256"], "Reconstructed RSA postimage differs")
  require(initial_manifest["forge"]["patch"]["patched_sha256"] == red["installed_rsa_sha256"], "Red cardinality control differs")
  require(strict_manifest["forge"]["patch"]["patched_sha256"] == green["installed_rsa_sha256"] == results["phases"]["canonical_green"]["rsa_postimage_sha256"], "Canonical postimage differs")
  for key in set(initial_manifest) - {"scope", "forge"}:
    require(initial_manifest[key] == strict_manifest[key], "Unchanged manifest pin differs: " + key)
  for key in set(initial_manifest["forge"]) - {"patch"}:
    require(initial_manifest["forge"][key] == strict_manifest["forge"][key], "Unchanged Forge inventory differs")
  for n in ["mobile/scripts/forge-backport.mjs", "mobile/scripts/build-security.mjs", "mobile/package.json", "mobile/package-lock.json"]:
    require(red_inputs[n] == green_inputs[n] == final_inputs[n], "Guard/lifecycle/lock source changed")
  initial_standard = obj(reviews["initial/standards/findings.json"])
  initial_spec = obj(reviews["initial/spec/findings.json"])
  strict_standard = obj(reviews["canonical/standards/findings.json"])
  strict_spec = obj(reviews["canonical/spec/findings.json"])
  require(initial_standard["source_sha256"] == final_seven and initial_spec["final_seven_sha256"] == final_seven, "Initial review/source correlation differs")
  require(strict_standard["reviewed_source_sha256"] == strict_spec["reviewed_source_sha256"] == canonical_commit["files"], "Strict review/source correlation differs")
  require(not initial_standard["blocking_findings"] and not initial_spec["blocking_spec_findings"] and not strict_standard["blocking_findings"] and not strict_spec["open_findings"], "Open review findings differ")
  for name in ["apply", "focused", "full", "typecheck", "check", "preflight", "export", "final-focused", "final-check"]:
    terminal(initial, name)
  test_count(initial, "focused", 48, 2)
  test_count(initial, "final-focused", 48, 2)
  test_count(initial, "full", 277, 35)
  terminal(canonical, "focused", 1)
  test_count(canonical, "focused", 23, failed=3)
  for name in ["focused", "full", "typecheck", "check", "preflight", "export"]:
    invocation = terminal(canonical, "green-" + name)
    require(datetime.fromisoformat(invocation["started_at"]) > datetime.fromisoformat(green["at"]), "Green capture did not precede invocation")
  test_count(canonical, "green-focused", 52, 2)
  test_count(canonical, "green-full", 281, 35)
  green_results = obj(canonical["green-results.json"])
  require(green_results["green_source_unchanged"] == 100 and green_results["focused_tests"] == 52 and green_results["full_mobile_tests"] == 281 and green_results["mobile_files"] == 35, "Green outcome counts differ")
  require(green_results["failures"] == green_results["skips"] == 0, "Green failure/skip counts differ")
  for phase, postimage in [(initial, initial_manifest["forge"]["patch"]["patched_sha256"]), (canonical, strict_manifest["forge"]["patch"]["patched_sha256"])]:
    report = obj(phase["export/security-build.json"])
    require(report["forge_backport"]["rsa_sha256"] == postimage and report["dependency_audit_gate"] == "open", "Export postimage/gate differs")
    require(report["platforms"] == ["web", "ios", "android"] and report["map_count"] == len(report["bundles"]) == 3, "Export platform/map count differs")
    require(report["network_attempts"] == 0 and report["signing_header_checks"] == 3, "Offline signing preflight receipt differs")
    require(not any(n.startswith("export/") and n.endswith(".map") for n in phase), "Unexpected retained normal export source map")
    for bundle in report["bundles"]:
      require(sha(phase["export/" + bundle["file"]]) == bundle["bundle_sha256"], "Export raw bundle hash differs")
      require(re.fullmatch(r"[0-9a-f]{64}", bundle["map_sha256"]), "Invalid retained map hash")
  require(not results["export_evidence"]["source_maps_archived"] and not results["export_evidence"]["map_inspection_replay"], "Map scope overstated")
  require(not results["fresh_install_tested"] and not results["fresh_dependency_audit_run"] and not results["release_certified"], "Install/audit/release scope overstated")
  require(results["raw_dependency_audit_gate"] == results["braces_gate"] == "open" and results["all_six_priorities"] == "in_progress", "Release gates overstated")
  if args.current:
    repo = PACKET.parents[2]
    for n, digest in green["files"].items():
      require(sha((repo / n).read_bytes()) == digest, "Current source differs: " + n)
    require(sha((repo / "mobile/node_modules/node-forge/lib/rsa.js").read_bytes()) == green["installed_rsa_sha256"], "Current installed RSA differs")
  print(json.dumps({"result": "passed", "archive_members": {n: len(d) for n, d in phases.items()}, "source_captures": {"initial": 99, "initial_final": 100, "red": 7, "green": 100}, "red": "3 failed/23 prior passed", "green": "52 focused/281 full in35 files", "normal_exports": "three exact artifacts per phase; map hashes only", "current_comparison": args.current, "scope": "Integrity/receipt correlation only; no helper, crypto, test, install, source-map or export replay", "release_certified": False, "all_six_priorities": "in_progress"}, indent=2))


if __name__ == "__main__":
  main()
