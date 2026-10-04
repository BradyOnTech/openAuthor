"""Validate retained packaged-runtime evidence; does not replay acceptance."""
import argparse
import hashlib
import io
import json
import tarfile
from datetime import datetime
from pathlib import Path, PurePosixPath


parser = argparse.ArgumentParser()
parser.add_argument("--seal", action="store_true")
parser.add_argument("--current", action="store_true")
args = parser.parse_args()
packet = Path(__file__).resolve().parent
repo = packet.parents[2]
manifest = packet / "evidence-sha256.json"


def digest(data):
  return hashlib.sha256(data).hexdigest()


def read(name):
  return json.loads((packet / name).read_bytes())


def archived(data):
  with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
    files = {}
    for member in archive.getmembers():
      if member.isfile():
        name = PurePosixPath(member.name)
        assert not name.is_absolute() and ".." not in name.parts, member.name
        assert member.name not in files, member.name
        files[member.name] = archive.extractfile(member).read()
    return files


files = {str(path.relative_to(packet)): digest(path.read_bytes())
  for path in packet.rglob("*") if path.is_file() and path != manifest}
if args.seal:
  manifest.write_text(json.dumps(files, indent=2, sort_keys=True) + "\n")
assert read("evidence-sha256.json") == files, "Packet evidence changed"
handoffs = read("handoffs.json")["handoffs"]
raw = {}
for name, count in (("build", 32), ("core", 26), ("inventory", 25)):
  handoff = handoffs[name]
  archive_bytes = (packet / handoff["archive"]).read_bytes()
  assert digest(archive_bytes) == handoff["archive_sha256"], name
  raw[name] = archived(archive_bytes)
  assert {key: digest(value) for key, value in raw[name].items()} == handoff["members_sha256"], name
  original_seal = raw[name]["evidence-sha256.json"]
  assert digest(original_seal) == handoff["original_seal_sha256"], name
  sealed_files = json.loads(original_seal)["files"]
  assert len(sealed_files) == handoff["sealed_file_count"] == count, name
  assert len(raw[name]) == handoff["archive_file_count"] == count + 1, name
  assert {key: digest(value) for key, value in raw[name].items()
    if key != "evidence-sha256.json"} == sealed_files, name


def receipt(scope, name):
  return json.loads(raw[scope][name])


for local, scope, original in (
  ("build-summary.json", "build", "build-summary.json"),
  ("core-acceptance-summary.json", "core", "acceptance-summary.json"),
  ("cli-guard-result.json", "core", "guarded-storyline-cli-result.json"),
  ("git-template-observation.json", "core", "git-template-observation.json"),
  ("release-inventory.json", "inventory", "results.json"),
):
  assert (packet / local).read_bytes() == raw[scope][original], local

build = receipt("build", "build-summary.json")
source = receipt("build", "source-hashes-before-build.json")
source_after = receipt("build", "source-hashes-after-build.json")
source_archive = archived(raw["build"]["source-inputs-before-build.tar.gz"])
assert digest(raw["build"]["source-inputs-before-build.tar.gz"]) == source["archive_sha256"]
assert {name: digest(data) for name, data in source_archive.items()} == source["files"]
assert len(source_archive) == build["source_input_count"] == 506
assert source["files"] == source_after["files"]
assert source["source_commit"] == build["source_commit"] == "36a40582bd4667440f5614c4f73141ea1bdaf51b"
assert source["head"] == source_after["head"] == build["head"] == "df780fb943026b0667cf18f1b34cf93ac4e2fb1c"
core_source = {name.removeprefix("openauthor/"): digest(data)
  for name, data in source_archive.items() if name.startswith("openauthor/") and name.endswith(".py")}
assert len(core_source) == 64
fingerprint = hashlib.sha256()
for name, sha in sorted(core_source.items()):
  fingerprint.update(name.encode() + b"\0" + bytes.fromhex(sha))
core_fingerprint = fingerprint.hexdigest()
assert core_fingerprint == "fa60a9dc36ab214668688177b3a93283008701ce38c9b7f6ae9a0146868a5f46"
for name in ("installed-runtime", "installed-node-modules"):
  before = receipt("build", name + "-before-build.json")
  after = receipt("build", name + "-after-build.json")
  assert before["files"] == after["files"] and after["unchanged"], name
  assert after["excluded_cache_names"] == ["__pycache__", ".cache", ".vite"]
assert len(receipt("build", "installed-runtime-before-build.json")["files"]) == 2203
assert len(receipt("build", "installed-node-modules-before-build.json")["files"]) == 6079

for flavor in ("normal", "qa"):
  app = build["apps"][flavor]
  app_manifest = receipt("build", flavor + "-app-files.json")
  assert digest(raw["build"][flavor + "-app-files.json"]) == app["app_manifest_sha256"]
  assert app["app"] == app_manifest["app"] and len(app_manifest["files"]) == app["immutable_file_count"] == 2205
  assert app["core_source_sha256"] == core_fingerprint and app["core_py_files"] == 64
  prefix = "Contents/Resources/resources/runtime/python/lib/python3.11/site-packages/openauthor/"
  retained_core = {name.removeprefix(prefix): sha for name, sha in app_manifest["files"].items()
    if name.startswith(prefix) and name.endswith(".py")}
  assert retained_core == core_source
  for binary, relative in (
    ("application", "Contents/MacOS/openauthor-desktop"),
    ("python", "Contents/Resources/resources/runtime/python/bin/python3"),
    ("codex", "Contents/Resources/resources/runtime/codex/bin/codex"),
    ("git", "Contents/Resources/resources/runtime/git/bin/git"),
  ):
    assert app["binaries"][binary]["sha256"] == app_manifest["files"][relative]
    assert app["binaries"][binary]["architectures"] == ["arm64"]
  assert receipt("build", flavor + "-build-receipt.json")["exit_code"] == 0
  assert receipt("build", flavor + "-verification-receipt.json")["exit_code"] == 0
assert build["apps"]["normal"]["identifier"] == "com.openauthor.desktop"
assert build["apps"]["qa"]["identifier"] == receipt("build", "tauri.acceptance.json")["identifier"]
assert build["apps"]["qa"]["identifier"] != build["apps"]["normal"]["identifier"]
for binary in ("python", "codex", "git"):
  assert build["apps"]["normal"]["binaries"][binary] == build["apps"]["qa"]["binaries"][binary]
assert build["apps"]["normal"]["runtime_manifests"] == build["apps"]["qa"]["runtime_manifests"]
assert receipt("build", "normal-bundle-report.json")["core_source_sha256"] == core_fingerprint
assert receipt("build", "qa-core-verification.json")["core_source_sha256"] == core_fingerprint
assert receipt("build", "normal-verification-receipt.json")["canonical_identifier_guard_applied"] is True
assert receipt("build", "qa-verification-receipt.json")["canonical_identifier_guard_applied"] is False
assert receipt("build", "qa-build-receipt.json")["build_environment_overrides"] == {
  "VITE_PROJECT_REGISTRY": "local", "VITE_SUPABASE_URL": "", "VITE_SUPABASE_ANON_KEY": ""}
normal_log = raw["build"]["normal-verification.txt"].decode()
recovery = [json.loads(line) for line in normal_log.splitlines()
  if line.startswith("{") and "packaged_recovery" in line]
assert recovery == [build["normal_recovery"]]
assert recovery[0]["packaged_recovery"] == "passed" and recovery[0]["gui_acceptance"] == "not_observed"
assert [item["stage"] for item in recovery[0]["forced_termination"]] == [
  "scene", "head", "proposal", "before_commit", "committed"]
assert "Ran 1 test" in normal_log and "macOS bundle: OK" in normal_log

core = receipt("core", "full-core-result.json")
core_summary = receipt("core", "acceptance-summary.json")
runtime = receipt("core", "runtime-before.json")
test_source = receipt("core", "source-before.json")
test_archive = archived(raw["core"]["original-check-inputs.tar.gz"])
assert {name: digest(data) for name, data in test_archive.items()} == test_source["input_sha256"]
assert len(test_archive) == 119
assert test_source["source_sha256"] == {"openauthor/" + name: sha for name, sha in core_source.items()}
assert runtime["source_modules"] == core_source and runtime["core_source_sha256"] == core_fingerprint
assert runtime["python_version"] == "3.11.15" and runtime["isolated"] == 1 and runtime["dont_write_bytecode"]
assert runtime["versions"] == {"git": "git version 2.55.0", "codex": "codex-cli 0.144.6"}
assert core["discovered"] == core["tests_run"] == 583
assert core["failures"] == core["errors"] == core["unexpected_successes"] == core["expected_failures"] == 0
assert core["skips"] == core["import_guard_errors"] == [] and core["successful"]
assert core["codex_contract_enabled"] and core["local_wire_test_only"]
assert len(core["imported_core_modules"]) == 63
for module in core["imported_core_modules"].values():
  relative = PurePosixPath(module["origin"]).relative_to(PurePosixPath(runtime["core_package"]))
  assert module["sha256"] == core_source[relative.as_posix()]
core_log = raw["core"]["full-core-tests.txt"].decode()
assert "Ran 583 tests" in core_log and core_log.endswith("\nOK\n")
assert "test_only_reviewed_content_reaches_local_responses_endpoint (test_codex_runtime_contract." in core_log
assert core_summary["tests"] == {"run": 583, "failures": 0, "errors": 0, "skips": 0,
  "codex_local_wire_contract_enabled": True}
assert raw["core"]["normal-bundle-before-manifest.json"] == raw["build"]["normal-app-files.json"]
post = receipt("core", "post-check-verification.json")
assert post["normal_bundle_file_count"] == 2205 and post["normal_bundle_files_unchanged"] and post["normal_bundle_symlinks_unchanged"]
assert post["normal_bundle_reference_sha256"] == digest(raw["build"]["normal-app-files.json"])
assert post["core_source_modules_unchanged"] == 64 and post["original_inputs_unchanged"] == 119
assert post["source_sha256"] == test_source["source_sha256"] and post["inputs_sha256"] == test_source["input_sha256"]
cli = receipt("core", "guarded-storyline-cli-result.json")
assert cli["updated_at_same_across_storylines"] and cli["edit_version_differs_across_storylines"]
assert [item["label"] for item in cli["actual_cli_refusals"]] == [
  "old-storyline-accepted", "old-storyline-rejected", "inverted-validity-restore"]
assert all(item["exit_code"] == 2 and item["memory_byte_exact"] for item in cli["actual_cli_refusals"])
assert cli["prose_unchanged"] and cli["provider_calls"] == 0
assert cli["legacy_timestamp_scope_protection_claimed"] is False
for item in cli["actual_cli_refusals"]:
  command = item["command"]
  assert "--expected-version" in command
  assert command[command.index("--expected-version") + 1] == item["original_version_sent"]
  assert raw["core"][item["label"] + ".stdout.txt"] == b""
  assert item["refusal_verified"] in raw["core"][item["label"] + ".stderr.txt"].decode()
assert raw["core"]["core-bootstrap.stderr.txt"].decode().count("warning: templates not found") == 2
assert receipt("core", "git-template-observation.json")["original_suite_stderr_warning_count"] == 2

inventory = receipt("inventory", "results.json")
configs = receipt("inventory", "config-hashes.json")
for name, sha in configs["files"].items():
  assert digest(raw["inventory"]["inspected-configs/" + name]) == sha
assert len(configs["files"]) == 15 and "after system inventory commands" in configs["capture_scope"]
assert receipt("inventory", "signing-identities.json")["valid_code_signing_identity_count"] == 0
assert receipt("inventory", "signing-identities-sandbox.json")["valid_code_signing_identity_count"] == 0
assert all(value == 0 for value in inventory["mutations"].values())
assert inventory["repository_head_at_start"] == inventory["repository_head_at_finish"] == build["head"]
author = receipt("build", "author-hashes-before.json")
assert len(author) == 4 and author == receipt("build", "author-hashes-after.json")
assert author == test_source["author_sha256"] == post["author_sha256"]
assert author == receipt("inventory", "before.json")["author_hashes"] == receipt("inventory", "after.json")["author_hashes"]

stamp = datetime.fromisoformat
assert stamp(source["captured_at_utc"]) < stamp(receipt("build", "runtime-refresh.json")["started_at_utc"])
assert stamp(source["captured_at_utc"]) < stamp(receipt("build", "normal-build-receipt.json")["started_at_utc"])
assert stamp(receipt("build", "normal-verification-receipt.json")["completed_at_utc"]) < stamp(receipt("build", "normal-app-files.json")["captured_at_utc"])
core_started = stamp(receipt("core", "core-invocation.json")["started_at"])
assert stamp(test_source["captured_at"]) < core_started
assert stamp(receipt("build", "normal-app-files.json")["captured_at_utc"]) < core_started
assert stamp(receipt("build", "qa-app-files.json")["captured_at_utc"]) < core_started
assert stamp(receipt("build", "evidence-sha256.json")["sealed_at_utc"]) > core_started

results = read("results.json")
assert results["source_commit"] == build["source_commit"] and results["reviewed_head"] == build["head"]
assert results["core_source_sha256"] == core_fingerprint
assert results["full_bundled_core_tests"] == core_summary["tests"]
assert results["independent_raw_sealed_file_counts"] == {"build": 32, "core": 26, "inventory": 25}
assert results["legacy_timestamp_only_storyline_protection"] is False
assert results["native_gui_acceptance_in_packet"] is results["physical_device_acceptance_in_packet"] is False
assert results["signing_or_deployment_performed"] is results["release_certified"] is False
assert results["all_six_priorities"] == "in_progress"
timing_fields = {
  "source_archive_captured_at_utc": ("build", "source-hashes-before-build.json", "captured_at_utc"),
  "runtime_refresh_started_at_utc": ("build", "runtime-refresh.json", "started_at_utc"),
  "normal_build_started_at_utc": ("build", "normal-build-receipt.json", "started_at_utc"),
  "normal_build_finished_at_utc": ("build", "normal-build-receipt.json", "completed_at_utc"),
  "canonical_verification_finished_at_utc": ("build", "normal-verification-receipt.json", "completed_at_utc"),
  "qa_build_started_at_utc": ("build", "qa-build-receipt.json", "started_at_utc"),
  "qa_build_finished_at_utc": ("build", "qa-build-receipt.json", "completed_at_utc"),
  "normal_app_manifest_captured_at_utc": ("build", "normal-app-files.json", "captured_at_utc"),
  "qa_app_manifest_captured_at_utc": ("build", "qa-app-files.json", "captured_at_utc"),
  "test_input_snapshot_captured_at_utc": ("core", "source-before.json", "captured_at"),
  "full_core_started_at_utc": ("core", "core-invocation.json", "started_at"),
  "full_core_finished_at_utc": ("core", "core-invocation.json", "finished_at"),
  "final_build_evidence_sealed_at_utc": ("build", "evidence-sha256.json", "sealed_at_utc"),
  "final_core_evidence_sealed_at_utc": ("core", "evidence-sha256.json", "captured_at"),
  "inventory_configuration_captured_at_utc": ("inventory", "config-hashes.json", "captured_at_utc"),
  "inventory_configuration_capture_scope": ("inventory", "config-hashes.json", "capture_scope"),
}
assert results["capture_timing"] == {name: receipt(scope, file)[key]
  for name, (scope, file, key) in timing_fields.items()}
if args.current:
  current = {}
  for group in (source["files"], test_source["input_sha256"], configs["files"], author):
    for name, sha in group.items():
      assert name not in current or current[name] == sha, name
      current[name] = sha
  for name, sha in current.items():
    assert digest((repo / name).read_bytes()) == sha, name
print(json.dumps({"packet_integrity": "passed", "original_sealed_receipts": 83,
  "source_archive_inputs": 506, "original_test_inputs": 119,
  "current_checkout_integrity": "passed" if args.current else "not checked",
  "scope": "Receipt/archive integrity only; acceptance and absent app binaries are not replayed or verified."}))
