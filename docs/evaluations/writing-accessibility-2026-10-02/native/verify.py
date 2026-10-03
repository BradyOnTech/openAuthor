"""Verify retained native acceptance identities and bounded evidence."""
import argparse
import hashlib
import json
import pathlib
import plistlib

folder = pathlib.Path(__file__).resolve().parent
repository = folder.parents[3]
parser = argparse.ArgumentParser()
parser.add_argument("--seal", action="store_true")
parser.add_argument("--app", type=pathlib.Path)
args = parser.parse_args()
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
manifest_path = folder / "artifact-sha256.json"
if args.seal:
  manifest = {p.name: sha(p) for p in sorted(folder.iterdir()) if p.is_file() and p != manifest_path}
  manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
manifest = json.loads(manifest_path.read_text())
for name, expected in manifest.items():
  assert pathlib.Path(name).name == name
  assert sha(folder / name) == expected, name

read = lambda name: json.loads((folder / name).read_text())
base = read("base-tauri-config.json")
overlay = read("tauri.acceptance.json")
normal = read("default-bundle-report-96bd04d.json")
acceptance = read("acceptance-bundle-report.json")
observed = read("observations.json")
assert set(overlay) == {"identifier"}
assert normal["application"] == {"identifier": base["identifier"], "version": base["version"]}
assert acceptance["application"] == {"identifier": overlay["identifier"], "version": base["version"]}
assert observed["application_identifier"] == overlay["identifier"]
assert normal["source_commit"] == acceptance["source_commit"] == observed["source_commit"]
assert not normal["release_certified"] and not acceptance["release_certified"] and not observed["release_certified"]
assert acceptance["expected_configuration_sha256"] == sha(folder / "tauri.acceptance.json")
assert acceptance["launch_script_sha256"] == sha(folder / "launch-acceptance.sh")
for name in ["python", "codex", "git"]:
  assert acceptance["binaries"][name] == normal["binaries"][name]
assert read("author-artifact-sha256-before.json") == read("author-artifact-sha256-after.json")
assert read("saved-scene-after-termination.json")["body"] == "Leah still kept the ticket folded.\n"
assert read("saved-scene-final.json")["body"] == observed["restart_caret"]["observed"]
plan = read("saved-plan-after-termination.json")
assert not plan["brief"]["synopsis"] and not plan["acts"]
assert read("native-termination.json")["signal"] == "SIGKILL"

if args.app:
  info = plistlib.loads((args.app / "Contents/Info.plist").read_bytes())
  assert info["CFBundleIdentifier"] == overlay["identifier"]
  assert info["CFBundleShortVersionString"] == base["version"]
  runtime = args.app / "Contents/Resources/resources/runtime"
  files = {"application": args.app / "Contents/MacOS" / info["CFBundleExecutable"], "python": runtime / "python/bin/python3", "codex": runtime / "codex/bin/codex", "git": runtime / "git/bin/git"}
  for name, path in files.items():
    assert sha(path) == acceptance["binaries"][name]["sha256"], name
  source = repository / "openauthor"
  installed = runtime / "python/lib/python3.11/site-packages/openauthor"
  expected = {p.relative_to(source).as_posix(): p.read_bytes() for p in source.rglob("*.py")}
  actual = {p.relative_to(installed).as_posix(): p.read_bytes() for p in installed.rglob("*.py")}
  assert expected and expected == actual

print(f"Native retained evidence: {len(manifest)} hashes and scoped identity/recovery checks passed; GUI not rerun.")
