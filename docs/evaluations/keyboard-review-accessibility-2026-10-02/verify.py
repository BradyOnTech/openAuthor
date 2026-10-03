"""Verify retained evidence and source provenance; does not rerun acceptance."""
import argparse
import gzip
import hashlib
import json
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

files = {str(path.relative_to(packet)): digest(path.read_bytes()) for path in packet.rglob("*")
  if path.is_file() and path != manifest and "native" not in path.relative_to(packet).parts}
if args.seal:
  manifest.write_text(json.dumps(files, indent=2, sort_keys=True) + "\n")
assert json.loads(manifest.read_text()) == files, "Retained evidence changed"
sources = json.loads((packet / "source-sha256.json").read_text())
with tarfile.open(packet / "tested-inputs.tar.gz", "r:gz") as archive:
  actual = {member.name: digest(archive.extractfile(member).read()) for member in archive.getmembers() if member.isfile()}
assert actual == sources["broader_input_sha256"], "Archived source differs"
for name, expected in actual.items():
  committed = subprocess.check_output(["git", "show", f'{sources["implementation_commit"]}:{name}'], cwd=repo)
  assert digest(committed) == expected, f"Committed source differs: {name}"
  if args.current:
    assert digest((repo / name).read_bytes()) == expected, f"Current source differs: {name}"
result = json.loads((packet / "results.json").read_text())
desktop = gzip.open(packet / "logs/full-desktop.txt.gz", "rt").read()
assert "91 passed (91)" in desktop and "699 passed (699)" in desktop
browser = json.loads((packet / "browser-results.json").read_text())
assert browser["stats"]["expected"] == 26 and browser["stats"]["unexpected"] == 0
assert browser["stats"]["skipped"] == 0 and browser["stats"]["flaky"] == 0
assert result["all_six_priorities"] == "in_progress" and not result["release_certified"]
assert result["author_artifacts_unchanged"]
print(json.dumps({"evidence_files": len(files), "archived_and_committed_inputs": len(actual),
  "current_source_checked": args.current, "desktop_tests": 699, "browser_cases": 26,
  "scope": "Evidence integrity and source correlation; author/native/device/release acceptance remains separate."}))
