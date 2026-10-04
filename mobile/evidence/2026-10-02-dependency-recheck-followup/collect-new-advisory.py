#!/usr/bin/env python3
"""Retain fresh official metadata for the additional advisory found by audit."""
import json
from datetime import datetime, timezone
from pathlib import Path

from collect import digest, latest_package, public_get


PACKET = Path(__file__).resolve().parent
ROOT = PACKET.parents[2]


def main():
  started = datetime.now(timezone.utc).isoformat()
  advisory_url = "https://api.github.com/advisories/GHSA-vfj7-8cjw-p6xm"
  advisory = json.loads(public_get(advisory_url))
  selected = {key: advisory.get(key) for key in ["ghsa_id", "cve_id", "html_url", "summary", "severity", "published_at", "updated_at", "vulnerabilities"]}
  packages = {name: latest_package(name) for name in ["braces", "micromatch", "@expo/metro"]}
  lock = json.loads((ROOT / "mobile/package-lock.json").read_text())
  installed = {path: {"version": item["version"], "dependencies": item.get("dependencies", {})} for path, item in lock["packages"].items() if any(path.endswith("node_modules/" + name) for name in ["braces", "micromatch", "metro", "metro-file-map", "@expo/metro", "@expo/metro-file-map"])}
  result = {
    "started_at": started,
    "finished_at": datetime.now(timezone.utc).isoformat(),
    "collector_sha256": digest(Path(__file__)),
    "source_url": advisory_url,
    "advisory": selected,
    "public_registry_latest": packages,
    "installed_from_lockfile": installed,
    "lockfile_sha256": digest(ROOT / "mobile/package-lock.json"),
    "scope": "Additional root advisory discovered by the fresh read-only audit. Official advisory and npm release metadata only; no package installation, dependency edits or exploit/runtime reachability claim.",
  }
  (PACKET / "additional-advisory.json").write_text(json.dumps(result, indent=2) + "\n")
  print(json.dumps({"advisory": selected["ghsa_id"], "vulnerabilities": selected["vulnerabilities"], "latest": {name: package["version"] for name, package in packages.items()}}))


if __name__ == "__main__":
  main()
