#!/usr/bin/env python3
"""Read-only retained integrity/receipt correlation; never replay tooling."""
import argparse
from datetime import datetime
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import posixpath
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
  require(datetime.fromisoformat(receipt["finished_at"]) >= datetime.fromisoformat(receipt["started_at"]), name + " timeline differs")
  return receipt


def test_count(files, name, passed, total_files, failed=0, failed_files=0):
  text = re.sub(r"\x1b\[[0-9;]*m", "", files[name + ".stdout.txt"].decode())
  failed_prefix = str(failed) + r" failed \| " if failed else ""
  file_prefix = str(failed_files) + r" failed \| " if failed_files else ""
  require(re.search(r"Tests\s+" + failed_prefix + str(passed) + r" passed \(" + str(passed + failed) + r"\)", text), name + " test counts differ")
  require(re.search(r"Test Files\s+" + file_prefix + str(total_files - failed_files) + r" passed \(" + str(total_files) + r"\)", text), name + " file counts differ")
  require(not re.search(r"\d+ skipped", text), name + " unexpected skips")


def json_blocks(data):
  text = data.decode()
  decoder = json.JSONDecoder()
  values = []
  for match in re.finditer(r"(?m)^\{", text):
    value, _ = decoder.raw_decode(text[match.start():])
    values.append(value)
  return values


def module_entry(name, text):
  ids = {"index.js": 610, "lib/compile.js": 9434, "lib/constants.js": 8774, "lib/expand.js": 5873, "lib/parse.js": 6477, "lib/stringify.js": 8750, "lib/utils.js": 5207}
  dependencies = {"fill-range": 6330}
  for source, number in ids.items():
    path = re.sub(r"\.js$", "", posixpath.relpath(source, posixpath.dirname(name) or "."))
    dependencies[path if path.startswith(".") else "./" + path] = number
  mapping = json.dumps(dependencies, ensure_ascii=False, separators=(",", ":"))
  return str(ids[name]) + ':(module,exports,__webpack_require__)=>{\n"use strict";\nconst dependencies = ' + mapping + ';\nconst require = name => {\n  if (!Object.hasOwn(dependencies, name)) throw new Error("Unsupported embedded Braces dependency");\n  return __webpack_require__(dependencies[name]);\n};\n' + text + '\n}'


def export(files, directory, expected_platforms, targets):
  report = obj(files[directory + "/security-build.json"])
  require(report["platforms"] == expected_platforms, directory + " platform scope differs")
  require(report["map_count"] == len(report["bundles"]) == len(expected_platforms), directory + " map count differs")
  require(report["signing_header_checks"] == 3 and report["network_attempts"] == 0, directory + " offline preflight differs")
  require(report["dependency_audit_gate"] == "open", directory + " audit gate differs")
  require(report["braces_backport"]["targets"] == targets, directory + " Braces pins differ")
  require(report["forge_backport"]["rsa_sha256"] == "3dde91b05b403e062e0c7c8e97e63e79337c651db59f18fa7c836d18b15697d5", directory + " Forge pin differs")
  require(not any(n.startswith(directory + "/") and n.endswith(".map") for n in files), directory + " unexpected retained map")
  for bundle in report["bundles"]:
    require(sha(files[directory + "/" + bundle["file"]]) == bundle["bundle_sha256"], directory + " bundle hash differs")
    require(re.fullmatch(r"[0-9a-f]{64}", bundle["map_sha256"]), directory + " map hash missing")


def main():
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("--current", action="store_true", help="Also hash current source and nine installed target files")
  parser.add_argument("--repo", type=Path, default=PACKET.parents[2], help="Repository path for optional current comparison")
  args = parser.parse_args()
  packet = {p.name: p.read_bytes() for p in PACKET.iterdir() if p.is_file() and p.name != "evidence-sha256.json"}
  exact(packet, obj((PACKET / "evidence-sha256.json").read_bytes())["files"], "Packet seal")
  receipts = obj(packet["receipts.json"])
  results = obj(packet["results.json"])
  phases = {}
  for name, receipt in receipts["archives"].items():
    require(sha(packet[name]) == receipt["archive_sha256"] and len(packet[name]) == receipt["bytes"], name + " archive differs")
    data = archive(packet[name])
    require(len(data) == receipt["file_count"], name + " member count differs")
    exact(data, {n: v["sha256"] for n, v in receipt["members"].items()}, name)
    for n, info in receipt["members"].items():
      require(len(data[n]) == info["bytes"], name + " member size differs")
    phases[name] = data
  root = phases["root-validation.tar.gz"]
  design = phases["original-design.tar.gz"]
  reviews = phases["source-reviews.tar.gz"]
  fresh = phases["fresh-mobile-only.tar.gz"]
  before = obj(root["before.json"])
  intermediate = obj(root["intermediate-green-inputs.json"])
  green = obj(root["green-inputs.json"])
  source = archive(root["green-inputs.tar.gz"])
  for data, manifest, key, label in [(root["inputs-before.tar.gz"], before, "source", "Initial113"), (root["intermediate-green-inputs.tar.gz"], intermediate, "files", "Intermediate113"), (root["green-inputs.tar.gz"], green, "files", "Final113")]:
    capture = archive(data)
    exact(capture, manifest[key], label)
    require(len(capture) == 113 and len(manifest["selected"]) == 17, label + " source count differs")
  for name, manifest in [("initial-focused", before), ("intermediate-focused", intermediate), ("focused", green), ("full", green), ("typecheck", green), ("export", green), ("export-all", green)]:
    require(datetime.fromisoformat(obj(root[name + "-invocation.json"])["started_at"]) > datetime.fromisoformat(manifest["at"]), name + " capture timing differs")
  terminal(root, "original-check", 1)
  terminal(root, "initial-focused", 1)
  terminal(root, "intermediate-focused", 1)
  for name in ("apply", "focused", "full", "typecheck", "check", "forge-check", "preflight", "export", "export-all"):
    terminal(root, name)
  test_count(root, "initial-focused", 262, 4, 5, 2)
  test_count(root, "intermediate-focused", 271, 4, 1, 1)
  test_count(root, "focused", 272, 4)
  test_count(root, "full", 501, 37)
  exact(archive(design["originals.tar.gz"]), obj(design["original-source-sha256.json"]), "Independent94 originals")
  originals = archive(design["originals.tar.gz"])
  require(len(originals) == 94, "Independent original source count differs")
  for n, digest in obj(design["review-sha256.json"]).items():
    require(sha(design[n]) == digest, "Independent original seal differs")
  standard = obj(reviews["standards/findings.json"])
  spec = obj(reviews["spec/findings.json"])
  standard_sources = {n: v["sha256"] for n, v in obj(reviews["standards/reviewed-sha256.json"])["files"].items()}
  spec_sources = obj(reviews["spec/reviewed-sha256.json"])
  selected = {n: green["files"][n] for n in green["selected"]}
  require(standard_sources == spec_sources == spec["reviewed_source_sha256"] == selected, "Final17 review/input correlation differs")
  exact({n.removeprefix("standards/inputs/"): b for n, b in reviews.items() if n.startswith("standards/inputs/")}, selected, "Final Standards17 snapshots")
  require(not standard["findings"] and not spec["open_findings"], "Independent open findings differ")
  require(standard["static_pin_checks"] == standard["static_pin_checks_passed"] == 314, "Static relationship checks differ")
  validation = obj(reviews["standards/static-validation.json"])
  require(validation["total"] == validation["passed"] == 314 and not validation["failures"], "Static validation receipt differs")
  manifest = obj(source["mobile/security/braces-backport-3.0.3.json"])
  expected_targets = {}
  require(len(manifest["patches"]) == 9 and [len(p["files"]) for p in manifest["packages"]] == [10, 5, 65], "Patch/copy inventory differs")
  for package in manifest["packages"]:
    for name, digest in package["files"].items():
      require(sha(originals["mobile/" + package["path"] + "/" + name]) == digest, "Owner original inventory differs")
  for patch in manifest["patches"]:
    original = originals["mobile/" + patch["path"]]
    require(sha(original) == patch["original_sha256"], "Target preimage differs")
    if "source" in patch:
      expected = source["mobile/" + manifest["sources"][patch["source"]]["path"]]
      require(original.decode() == patch["original_text"], "Standalone original text differs")
    else:
      text = original.decode()
      require(len(patch["modules"]) == 7, "Embedded module count differs")
      for item in patch["modules"]:
        old = item["original_entry"]
        require(sha(old.encode()) == item["original_entry_sha256"] and text.count(old) == 1, "Embedded original entry differs")
        new = module_entry(item["source"], source["mobile/" + manifest["sources"][item["source"]]["path"]].decode())
        require(sha(new.encode()) == item["patched_entry_sha256"], "Embedded generated entry differs")
        text = text.replace(old, new)
      expected = text.encode()
    require(sha(expected) == patch["patched_sha256"], "Reconstructed target postimage differs")
    expected_targets[patch["path"]] = sha(expected)
  require(expected_targets == results["installed_braces_target_sha256"] == spec["installed_target_sha256"], "Nine final target correlations differ")
  export(root, "export", ["web"], expected_targets)
  export(root, "export-all", ["web", "ios", "android"], expected_targets)
  for name in ("ci", "forge-check", "braces-check", "preflight", "focused"):
    terminal(fresh, name)
  terminal(fresh, "typecheck", 2)
  test_count(fresh, "focused", 272, 4)
  require("TS2307" in fresh["typecheck.stdout.txt"].decode() and "ajv/dist/2020.js" in fresh["typecheck.stdout.txt"].decode(), "Original fresh typecheck failure differs")
  install = terminal(fresh, "ci")
  require("--offline" in install["argv"] and "--no-audit" in install["argv"] and "--ignore-scripts" not in install["argv"], "Fresh install flags differ")
  blocks = json_blocks(fresh["ci.stdout.txt"])
  require(len(blocks) == 2 and blocks[1]["targets"] == expected_targets and len(blocks[1]["applied"]) == 8, "Fresh lifecycle target/application differs")
  require(blocks[0]["rsa_sha256"] == results["forge_rsa_sha256"], "Fresh Forge lifecycle pin differs")
  require("added 561 packages" in fresh["ci.stdout.txt"].decode(), "Fresh install package count differs")
  source_receipt = obj(fresh["source-receipt.json"])
  fresh_sources = {**source_receipt["files"], **source_receipt["contracts_files"]}
  require(len(fresh_sources) == 143, "Fresh original source count differs")
  exact({n.removeprefix("project/"): b for n, b in fresh.items() if n.startswith("project/")}, fresh_sources, "Fresh143 sources")
  require(source_receipt["files"] == green["files"], "Fresh/root113 correlation differs")
  require(sha(fresh["source-snapshot.json"]) == source_receipt["snapshot_json_sha256"] and sha(root["green-inputs.tar.gz"]) == source_receipt["snapshot_tar_sha256"], "Fresh source preparation correlation differs")
  plan = obj(fresh["run-plan.json"])
  require(plan["state"] == "prepared_not_executed" and plan["no_install_executed"], "Historical preparation labels changed")
  require(plan["environment"]["NPM_CONFIG_IGNORE_SCRIPTS"] == "false" and len(obj(fresh["prepared-files-sha256.json"])["files"]) == 688, "Original fresh preparation scope differs")
  bootstrap = phases.get("fresh-contracts-bootstrap.tar.gz")
  if bootstrap is not None:
    bootstrap_sources = obj(bootstrap["contracts-bootstrap-final-sources.json"])
    require(bootstrap_sources["count"] == len(bootstrap_sources["files"]) == 144, "Bootstrap144 count differs")
    require({n: bootstrap_sources["files"]["project/" + n] for n in fresh_sources} == fresh_sources, "Historical143 bootstrap source changed")
    lock_name = "contracts/package-lock.json"
    require(sha(bootstrap["project/" + lock_name]) == bootstrap_sources["files"]["project/" + lock_name], "Bootstrap sibling lock differs")
    for n, digest in obj(bootstrap["contracts-bootstrap-final-seal.json"])["files"].items():
      data = bootstrap[n] if n in bootstrap else fresh[n]
      require(sha(data) == digest, "Bootstrap execution seal differs")
    for n, digest in obj(bootstrap["contracts-bootstrap-source.json"])["historical_file_preservation"].items():
      require(sha(fresh[n]) == digest, "Historical fresh receipt changed")
    for name in ("contracts-bootstrap-ci", "typecheck-after-bootstrap", "forge-apply", "braces-apply", "export-all"):
      invocation = terminal(bootstrap, name)
      require(invocation["verified_source_files"] == 144 and sha(bootstrap["finish-fresh.py"]) == invocation["driver_sha256"], "Bootstrap driver/source receipt differs")
    require(obj(bootstrap["forge-apply.stdout.txt"])["applied"] is False and obj(bootstrap["braces-apply.stdout.txt"])["applied"] == [], "Fresh idempotent application differs")
    export(bootstrap, "export-all", ["web", "ios", "android"], expected_targets)
    require(results["phases"]["fresh_contracts_bootstrap"]["typecheck"] == "passed", "Bootstrap result scope differs")
  commit = phases.get("source-commit.tar.gz")
  if commit is not None:
    receipt = obj(commit["source-commit.json"])
    require(receipt["commit"] == results["source_commit"] and receipt["files"] == selected, "Source commit correlation differs")
    post = obj(commit["post-validation.json"])
    require(post["root_source_files_verified"] == 113 and post["fresh_source_files_verified"] == 144 and post["selected_files"] == selected, "Post-terminal source verification differs")
    require(post["installed_targets"]["root"] == post["installed_targets"]["fresh"] == expected_targets, "Post-terminal installed target readbacks differ")
    for axis in ("standards", "spec"):
      require(post["reviews"][axis]["matched_selected"] == 17 and post["reviews"][axis]["manifest_sha256"] == sha(reviews[axis + "/reviewed-sha256.json"]), "Final review manifest correlation differs")
    require(receipt["author_files_unchanged"] == post["author_files_unchanged"] and len(receipt["author_files_unchanged"]) == 4, "Author preservation receipts differ")
    require(obj(commit["repository-check-invocation.json"])["exit_code"] == 0 and "command not found: rg" in commit["repository-check.stderr.txt"].decode(), "Original false-success marker receipt differs")
    require(obj(commit["repository-check-with-rg-invocation.json"])["exit_code"] == 0 and "command not found: rg" not in commit["repository-check-with-rg.stderr.txt"].decode(), "Corrected-PATH marker receipt differs")
    require(results["repository_marker_checks"]["original_valid"] is False, "Invalid marker receipt counted as passing")
  require(not results["fresh_dependency_audit_run"] and not results["release_certified"] and not results["actual_devices_tested"], "Acceptance scope overstated")
  require(results["raw_dependency_audit_gate"] == "open" and results["all_six_priorities"] == "in_progress", "Release gates overstated")
  if args.current:
    for n, digest in green["files"].items():
      require(sha((args.repo / n).read_bytes()) == digest, "Current source differs: " + n)
    for n, digest in expected_targets.items():
      require(sha((args.repo / "mobile" / n).read_bytes()) == digest, "Current installed target differs: " + n)
  print(json.dumps({"result": "passed", "archive_members": {n: len(d) for n, d in phases.items()}, "source_captures": "three113 captures; independent94 originals; fresh143", "historical_focused": "5 failed/262 passed; then1 failed/271 passed", "final_root": "272 focused/501 full in37 files", "fresh_mobile_only": "CI +272 focused pass; original sibling-Ajv typecheck failure retained", "bootstrap": "passed" if bootstrap else "pending", "source_commit_correlated": commit is not None, "current_comparison": args.current, "scope": "Integrity/receipt correlation only; no dependency/module/test/install/export/source-map replay", "release_certified": False, "all_six_priorities": "in_progress"}, indent=2))


if __name__ == "__main__":
  main()
