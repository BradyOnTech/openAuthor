"""Prove bundled core freshness and record content-addressed build evidence."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import plistlib
import subprocess
from pathlib import Path

import openauthor


def verify_sources(repository: Path, installed: Path) -> str:
  source = repository / "openauthor"
  expected = {path.relative_to(source).as_posix(): path.read_bytes() for path in source.rglob("*.py")}
  if "__init__.py" not in expected:
    raise RuntimeError("Reviewed core source is missing.")
  actual = {path.relative_to(installed).as_posix(): path.read_bytes() for path in installed.rglob("*.py")}
  if expected != actual:
    different = sorted(name for name in set(expected) | set(actual) if expected.get(name) != actual.get(name))
    raise RuntimeError("Bundled core differs from reviewed source: " + ", ".join(different))
  digest = hashlib.sha256()
  for name, content in sorted(expected.items()):
    digest.update(name.encode("utf-8") + b"\0" + hashlib.sha256(content).digest())
  return digest.hexdigest()


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument("--app", type=Path)
  parser.add_argument("--report", type=Path)
  args = parser.parse_args()
  repository = Path(__file__).resolve().parents[1]
  installed = Path(openauthor.__file__).resolve().parent
  digest = verify_sources(repository, installed)
  record = {
    "schema_version": 1,
    "bundled_core_source": "exact_match",
    "core_source_sha256": digest,
    "architecture": platform.machine(),
    "python": platform.python_version(),
    "source_commit": os.environ.get("GITHUB_SHA", ""),
    "workflow_run_id": os.environ.get("GITHUB_RUN_ID", ""),
    "signed_bundle_required": os.environ.get("OPENAUTHOR_REQUIRE_SIGNED_BUNDLE") == "1",
    "verification_kind": "packaged_engine; no clean-machine GUI or accessibility certificate",
    "release_certified": False,
    "manual_gates": {
      "clean_machine_install": "not_observed",
      "packaged_gui_author_workflow": "not_observed",
      "signed_gui_forced_termination": "not_observed",
      "upgrade_from_released_version": "not_observed",
      "voiceover_keyboard_contrast": "not_observed",
    },
  }
  if not record["source_commit"]:
    record["source_commit"] = subprocess.check_output(["git", "-C", str(repository), "rev-parse", "HEAD"], text=True).strip()
  source_paths = ["openauthor", "desktop/src", "desktop/src-tauri", "pyproject.toml", "scripts", ".github/workflows", "contracts"]
  changed = subprocess.run(["git", "-C", str(repository), "diff", "--quiet", "HEAD", "--", *source_paths], check=False).returncode
  untracked = subprocess.check_output(["git", "-C", str(repository), "ls-files", "--others", "--exclude-standard", "--", *source_paths], text=True)
  record["source_checkout_clean"] = changed == 0 and not untracked.strip()
  if args.app:
    resources = args.app / "Contents/Resources/resources/runtime"
    info = plistlib.loads((args.app / "Contents/Info.plist").read_bytes())
    configuration = json.loads((repository / "desktop/src-tauri/tauri.conf.json").read_text())
    if info.get("CFBundleIdentifier") != configuration["identifier"] or info.get("CFBundleShortVersionString") != configuration["version"]:
      raise RuntimeError("Packaged application identity or version differs from reviewed configuration.")
    executable = info["CFBundleExecutable"]
    if not isinstance(executable, str) or not executable or Path(executable).name != executable:
      raise RuntimeError("Packaged executable name is invalid.")
    record["application"] = {"identifier": info["CFBundleIdentifier"], "version": info["CFBundleShortVersionString"]}
    record["runtime_manifests"] = {
      name: json.loads((resources / relative).read_text())
      for name, relative in {
        "python": "python/openauthor-runtime.json",
        "codex": "codex/openauthor-codex-runtime.json",
      }.items()
    }
    expected_arch = os.environ.get("OPENAUTHOR_EXPECT_ARCH", platform.machine())
    if platform.machine() != expected_arch:
      raise RuntimeError("Packaged Python architecture differs from the requested native build.")
    binary_names = {
      "application": args.app / "Contents/MacOS" / executable,
      "python": resources / "python/bin/python3",
      "codex": resources / "codex/bin/codex",
      "git": resources / "git/bin/git",
    }
    record["binaries"] = {}
    for name, path in binary_names.items():
      architecture = subprocess.check_output(["lipo", "-archs", str(path.resolve())], text=True).split()
      if expected_arch not in architecture:
        raise RuntimeError(f"Packaged {name} does not contain the requested {expected_arch} architecture.")
      record["binaries"][name] = {"architectures": architecture, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
  if args.report:
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(record, indent=2) + "\n")
  print(json.dumps(record))


if __name__ == "__main__":
  main()
