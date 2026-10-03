"""Validate retained Canon/export evidence; does not replay acceptance."""
import argparse
import gzip
import hashlib
import io
import json
import re
import subprocess
import tarfile
from pathlib import Path

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
  return json.loads((packet / name).read_text())

def archived(name):
  with tarfile.open(packet / name, "r:gz") as archive:
    return {member.name: archive.extractfile(member).read()
      for member in archive.getmembers() if member.isfile()}

files = {str(path.relative_to(packet)): digest(path.read_bytes())
  for path in packet.rglob("*") if path.is_file() and path != manifest}
if args.seal:
  manifest.write_text(json.dumps(files, indent=2, sort_keys=True) + "\n")
assert read("evidence-sha256.json") == files, "Packet evidence changed"
source = read("source-sha256.json")
actual = archived("tested-inputs.tar.gz")
assert {name: digest(data) for name, data in actual.items()} == source["broader_input_sha256"]
assert len(actual) == 538 and len(source["selected_sha256"]) == 13
standards = read("reviews/standards-source-sha256.json")
spec = read("reviews/spec-audited-sha256.json")
supplemental_standards = read("reviews/supplemental-standards-source-sha256.json")
supplemental_spec = read("reviews/supplemental-sha256.json")
assert standards == spec["files"] and len(standards) == 10
assert supplemental_standards == supplemental_spec["files"] and len(supplemental_standards) == 3
assert {**standards, **supplemental_standards} == source["selected_sha256"]
assert spec["base_commit"] == source["baseline"]
assert supplemental_spec["base_commit"] == source["baseline"]
for prefix in ("standards-", "supplemental-standards-"):
  metadata = read("reviews/" + prefix + "review-metadata.json")
  assert digest((packet / "reviews" / (prefix + "report.md")).read_bytes()) == metadata["report_sha256"]
  assert digest((packet / "reviews" / (prefix + "source-sha256.json")).read_bytes()) == metadata["manifest_sha256"]
  assert metadata["hard_violations"] == metadata["actionable_optional_heuristics"] == 0
initial = read("initial-source-sha256.json")
initial_archive = archived("initial-tested-inputs.tar.gz")
assert {name: digest(data) for name, data in initial_archive.items()} == initial["broader_input_sha256"]
assert len(initial_archive) == 537 and initial["selected_sha256"] == standards
initial_hashes = initial["broader_input_sha256"]
final_hashes = source["broader_input_sha256"]
changed = sorted(name for name in initial_hashes if initial_hashes[name] != final_hashes.get(name))
added = sorted(set(final_hashes) - set(initial_hashes))
assert changed == sorted(source["initial_changed"]) == ["tests/fixtures/canon_evaluation.json", "tests/test_canon_evaluation.py"]
assert added == source["added"] == ["scripts/evaluate_canon_diagnostics.py"]
assert all(initial_hashes[name] == final_hashes[name] for name in initial_hashes
  if name.startswith(("desktop/", "openauthor/", "mobile/", "contracts/")))
for name, expected in source["selected_sha256"].items():
  assert source["broader_input_sha256"][name] == expected, name
for name, expected in source["broader_input_sha256"].items():
  if args.current:
    assert digest((repo / name).read_bytes()) == expected, name
  if source["implementation_commit"]:
    committed = subprocess.check_output(["git", "show", f'{source["implementation_commit"]}:{name}'], cwd=repo)
    assert digest(committed) == expected, name
if source["implementation_commit"]:
  changed_paths = subprocess.check_output(["git", "diff", "--name-only", source["baseline"],
    source["implementation_commit"]], cwd=repo, text=True).splitlines()
  assert set(changed_paths) == set(source["selected_sha256"])

memory = archived("memory-handoff.tar.gz")
assert {name: digest(data) for name, data in memory.items()} == read("memory-handoff-sha256.json")
assert json.loads(memory["results.json"]) == read("memory-original-probe.json")
guarded = json.loads(memory["guarded-results.json"])
assert guarded == read("memory-guarded-probe.json")
assert guarded["failed_reviews_preserve_memory_bytes"] and guarded["prose_unchanged"]
assert guarded["legacy_timestamp_scope_protection_claimed"] is False
assert set(guarded["refusals"]) == {"accepted", "rejected", "inverted_validity"}
assert "Ran 26 tests" in memory["core-final-green.txt"].decode()
assert "OK" in memory["core-final-green.txt"].decode()
assert "12 passed (12)" in memory["desktop-final-green.txt"].decode()
assert "82 passed (82)" in memory["desktop-final-focused.txt"].decode()
assert "legacy_mutated_other_storyline" in memory["red-1.txt"].decode()
memory_supplement = archived("memory-supplement.tar.gz")
assert {name: digest(data) for name, data in memory_supplement.items()} == read("memory-supplement-sha256.json")
assert len(memory_supplement) == 6
assert "Ran 29 tests" in memory_supplement["evaluation-fixture-green.txt"].decode()
assert "OK" in memory_supplement["evaluation-fixture-green.txt"].decode()
metrics = json.loads(memory_supplement["evaluation-fixture-report.json"])
assert metrics == read("evaluation-fixture-report.json")
assert len(metrics["seeded_canon"]["cases"]) == 7 and len(metrics["unseeded_prose"]["cases"]) == 16
impossible = next(case for case in metrics["seeded_canon"]["cases"] if case["id"] == "impossible-timeline-range")
assert impossible["expected"] == impossible["actual"] == {"impossible_validity": 1}

mobile = archived("mobile-handoff.tar.gz")
mobile_manifest = json.loads(mobile.pop("evidence-sha256.json"))
assert mobile_manifest == read("mobile-handoff-sha256.json")
assert {name: digest(data) for name, data in mobile.items()} == mobile_manifest
assert len(mobile_manifest) == 102
mobile_read = lambda name: json.loads(mobile[name])
assessment = mobile_read("assessment.json")
assert assessment == read("mobile-assessment.json")
assert mobile_read("upstream.json") == read("mobile-upstream.json")
advisories = ["GHSA-86w9-cpqp-85rv", "GHSA-vfj7-8cjw-p6xm"]
assert assessment["dependency_audit_gate"] == "open" and assessment["advisories"] == advisories
assert assessment["dependency_changes"] is False and assessment["audits_suppressed"] is False
for name, expected in assessment["owned_files"].items():
  assert source["selected_sha256"][name] == expected, name
export_inputs = mobile_read("export-source-sha256.json")
original_probes = mobile_read("results.json")
for archive_name, expected in (("export-tested-inputs.tar.gz", export_inputs),
  ("read-only-tested-sources.tar.gz", original_probes["source_sha256"])):
  with tarfile.open(fileobj=io.BytesIO(mobile[archive_name]), mode="r:gz") as archive:
    retained = {member.name: digest(archive.extractfile(member).read())
      for member in archive.getmembers() if member.isfile()}
  assert retained == expected, archive_name
assert len(export_inputs) == 93
for name, expected in export_inputs.items():
  if name in source["broader_input_sha256"]:
    assert source["broader_input_sha256"][name] == expected, name
  if args.current:
    assert digest((repo / name).read_bytes()) == expected, name
for record in mobile_read("upstream.json"):
  assert digest(mobile[record["file"]]) == record["sha256"], record["file"]
for prefix in ("", "observed-"):
  before = json.loads(gzip.decompress(mobile[prefix + "installed-source-sha256-before.json.gz"]))
  after = json.loads(gzip.decompress(mobile[prefix + "installed-source-sha256-after.json.gz"]))
  assert before == after and len(before) == 26518
  export = mobile_read(prefix + "export-acceptance.json")
  report = mobile_read(prefix + "all-platform-build.json")
  assert export["exit_code"] == 0 and export["input_hashes_unchanged"] and export["installed_file_hashes_unchanged"]
  assert report["map_count"] == 3 and report["dependency_audit_gate"] == "open"
  assert report["advisories"] == advisories
  for bundle in report["bundles"]:
    assert digest(mobile[prefix + "all-platform-export/" + bundle["file"]]) == bundle["bundle_sha256"]
observed = mobile_read("observed-all-platform-build.json")
inventory = mobile_read("observed-module-inventory.json")
for bundle in observed["bundles"]:
  name = bundle["file"] + ".map"
  raw = mobile["observed-retained-maps/" + name]
  assert gzip.decompress(mobile["observed-retained-maps/" + name + ".gz"]) == raw
  assert digest(raw) == bundle["map_sha256"]
  sources = json.loads(raw)["sources"]
  record = next(item for item in inventory if item["map"] == name)
  assert record["sources"] == sources and record["map_sha256"] == digest(raw)
  assert not [item for item in sources if re.search(r"(?:^|/)(?:node-forge|braces|micromatch|resolve-workspace-root|expo-doctor)(?:/|$)|(?:^|/)@expo/code-signing-certificates(?:/|$)", item.replace("\\", "/"))]
assert "11 failed | 14 passed (25)" in mobile["containment-red.stdout.txt"].decode()
assert "25 passed (25)" in mobile["containment-green.stdout.txt"].decode()
assert len(mobile_read("results.json")["probes"]) == 12
assert all(case["uncaught_stack_exhaustion"] for case in mobile_read("results.json")["probes"])

author_before = read("author-hashes-before.json")
author_after = read("author-hashes-after.json")
assert author_before == author_after and len(author_before) == 4
for name, expected in author_before.items():
  baseline = subprocess.check_output(["git", "show", f'{source["baseline"]}:docs/evaluations/keyboard-review-accessibility-2026-10-02/author-hashes-before.json'], cwd=repo)
  assert json.loads(baseline)[name] == expected
  if args.current:
    assert digest((repo / name).read_bytes()) == expected, name

results = read("results.json")
assert results["implementation_commit"] == source["implementation_commit"]
assert results["broader_inputs"] == 538 and results["selected_inputs"] == 13
assert results["dependency_audit_gate"] == "open" and results["dependency_advisories"] == advisories
assert results["legacy_timestamp_only_storyline_protection"] is False
assert results["native_evidence_in_packet"] is False and results["release_certified"] is False
assert results["all_six_priorities"] == "in_progress"
commit_receipt = read("root-checks/implementation-commit.json")
assert commit_receipt["commit"] == source["implementation_commit"]
assert set(commit_receipt["files"]) == set(source["selected_sha256"])
receipts = read("root-checks/root-check-receipts.json")
for name, receipt in receipts["checks"].items():
  log = gzip.decompress((packet / "root-checks" / (receipt["log"] + ".gz")).read_bytes())
  assert digest(log) == receipt["log_sha256"], name
  assert receipt["exit_code"] == 0 and results["root_checks"][name]["exit_code"] == 0
core = gzip.decompress((packet / "root-checks/core-final.txt.gz").read_bytes()).decode()
desktop = gzip.decompress((packet / "root-checks/desktop.txt.gz").read_bytes()).decode()
build = gzip.decompress((packet / "root-checks/build.txt.gz").read_bytes()).decode()
assert "Ran 583 tests" in core and "OK (skipped=1)" in core
assert results["python_tests_discovered"] == 583 and results["python_tests_skipped"] == 1
assert "92 passed (92)" in desktop and "710 passed (710)" in desktop
assert results["desktop_tests"] == 710 and results["desktop_files"] == 92
assert "tsc && vite build" in build and "built in" in build
for name, errors in (("core-sandbox-attempt.txt.gz", 7), ("core-approved.txt.gz", 1)):
  log = gzip.decompress((packet / "root-checks" / name).read_bytes()).decode()
  assert f"errors={errors}" in log and "Ran 583 tests" in log, name
browser = read("browser-results.json")
assert browser["stats"]["expected"] == 4 and browser["stats"]["unexpected"] == 0
assert browser["stats"]["skipped"] == 0 and browser["stats"]["flaky"] == 0
def browser_cases(suites):
  for suite in suites:
    for spec in suite.get("specs", []):
      for test in spec.get("tests", []):
        yield spec["title"], test
    yield from browser_cases(suite.get("suites", []))

cases = list(browser_cases(browser["suites"]))
assert len(cases) == 4 and len({title for title, _ in cases}) == 2
assert {engine: sum(test["projectName"] == engine for _, test in cases)
  for engine in ("chromium", "webkit")} == {"chromium": 2, "webkit": 2}
assert all(test["status"] == "expected" and len(test["results"]) == 1
  and test["results"][0]["status"] == "passed" and test["results"][0]["retry"] == 0
  for _, test in cases)
browser_receipt = read("root-checks/browser-receipt.json")
assert browser_receipt["exit_code"] == 0 and source["captured_at"] < browser_receipt["started_at"]
assert "4 passed" in gzip.decompress((packet / "root-checks/browser.txt.gz").read_bytes()).decode()
for name, check in results["root_checks"].items():
  if check.get("status") in {"passed", "failed"}:
    assert "exit_code" in check and "log" in check, name
    assert (check["exit_code"] == 0) == (check["status"] == "passed"), name
    assert (packet / check["log"]).is_file(), name
print(json.dumps({"evidence_files": len(files), "archived_inputs": len(actual),
  "current_source_checked": args.current, "committed_source_checked": bool(source["implementation_commit"]),
  "initial_archived_inputs": len(initial_archive), "reviewed_files": 13,
  "memory_handoff_files": len(memory), "memory_supplement_files": len(memory_supplement),
  "mobile_handoff_files": 102,
  "mobile_focused_tests": 25, "scoped_mobile_export_runs": 2,
  "root_checks": {name: check.get("status") for name, check in results["root_checks"].items()},
  "scope": "Retained evidence integrity/correlations, not replay, native or release acceptance."}))
