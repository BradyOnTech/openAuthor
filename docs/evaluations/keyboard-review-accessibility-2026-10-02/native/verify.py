"""Check retained native evidence integrity; does not replay GUI acceptance."""
import argparse
import gzip
import hashlib
import json
import zipfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--seal", action="store_true")
args = parser.parse_args()
packet = Path(__file__).resolve().parent
manifest = packet / "evidence-sha256.json"

def digest(data):
  return hashlib.sha256(data).hexdigest()

def read(name):
  return json.loads((packet / name).read_text())

files = {str(path.relative_to(packet)): digest(path.read_bytes())
  for path in packet.rglob("*") if path.is_file() and path != manifest}
if args.seal:
  manifest.write_text(json.dumps(files, indent=2, sort_keys=True) + "\n")
assert read("evidence-sha256.json") == files, "Native evidence changed"
fixture = read("fixture-preparation/manifest.json")
fixture_hashes = read("fixture-preparation/evidence-sha256.json")
for name, expected in fixture_hashes.items():
  source = packet / "fixture-preparation" / name
  raw = source.read_bytes() if source.exists() else gzip.decompress(Path(str(source) + ".gz").read_bytes())
  assert digest(raw) == expected, name
applied = read("applied-revision.stdout.json")
undone = read("undo-revision.stdout.json")
assert applied["kind"] == "change_group_apply"
assert undone["kind"] == "change_group_undo"
scene_ids = {spec["scene_id"] for spec in fixture["scenes"]}
proposal_ids = {spec["proposal_id"] for spec in fixture["scenes"]}
assert set(applied["metadata"]["scene_ids"]) == scene_ids
assert set(applied["metadata"]["proposal_ids"]) == proposal_ids
archive = packet / "synthetic-coordinated.openauthor.zip"
with zipfile.ZipFile(archive) as backup:
  for spec in fixture["scenes"]:
    scene_id, proposal_id = spec["scene_id"], spec["proposal_id"]
    assert read(f"applied-{scene_id}.stdout.json")["body"] == spec["proposed_body"]
    proposal = read(f"applied-{proposal_id}.stdout.json")
    assert proposal["status"] == "applied" and proposal["applied_revision"] == applied["id"]
    for stage in ("undone", "restored"):
      assert read(f"{stage}-{scene_id}.stdout.json")["body"] == spec["original_body"]
      proposal = read(f"{stage}-{proposal_id}.stdout.json")
      assert proposal["undone_at"] and proposal["undo_revision"] == undone["id"]
    initial = packet / "fixture-preparation/initial-scenes" / Path(spec["scene_path"]).name
    original = gzip.decompress(Path(str(initial) + ".gz").read_bytes())
    assert digest(original) == spec["original_file_sha256"]
    assert backup.read(spec["scene_path"]) == original
assert read("source-revisions.stdout.json") == read("restored-revisions.stdout.json")
assert len(read("restored-revisions.stdout.json")) == 7
backup_report = read("backup-verification.stdout.json")
assert backup_report["verified"] and backup_report["file_count"] == 41
assert backup_report["revision"] == undone["id"]
assert digest(archive.read_bytes()) == read("restore-validation.json")["archive_sha256"]
for stage in ("undo-validation.json", "restore-validation.json"):
  assert len(read(stage)["scenes"]) == 3
before, after = read("current-native-process.json"), read("restarted-native-process.json")
assert before["pid"] != after["pid"] and before["command"] == after["command"]
assert read("post-operation-kill.json")["active_mutation_workers"] == 0
observations = read("observations.json")
assert observations["gui_mid_transaction_interruption_observed"] is False
assert observations["release_certified"] is False
assert observations["native_screenshots_archived"] is False
print(json.dumps({"native_evidence_files": len(files), "scene_apply_undo_restore": 3,
  "backup_files": 41, "revisions": 7,
  "scope": "Retained evidence integrity and correlations; GUI observations are root transcriptions, not replayed tests or signed-release certification."}))
