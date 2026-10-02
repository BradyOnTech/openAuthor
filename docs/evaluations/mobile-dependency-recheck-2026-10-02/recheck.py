#!/usr/bin/env python3
"""Read public upstream metadata and audit the existing mobile dependency tree."""
import base64
import hashlib
import io
import json
import subprocess
import tarfile
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
PACKET = Path(__file__).resolve().parent
MOBILE = ROOT / "mobile"
ADVISORY = "GHSA-86w9-cpqp-85rv"


def digest(path):
  return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(name, data):
  (PACKET / name).write_text(json.dumps(data, indent=2) + "\n")


def public_get(url):
  request = urllib.request.Request(url, headers={"User-Agent": "openAuthor-dependency-recheck", "Accept": "application/json"})
  with urllib.request.urlopen(request, timeout=60) as response:
    return response.read()


def latest_package(name):
  url = "https://registry.npmjs.org/" + name.replace("/", "%2F") + "/latest"
  document = json.loads(public_get(url))
  result = {
    "name": name,
    "version": document["version"],
    "registry_url": url,
    "dependencies": document.get("dependencies", {}),
    "git_head": document.get("gitHead"),
    "archive_url": document["dist"]["tarball"],
    "integrity": document["dist"].get("integrity"),
  }
  inspected = {
    "node-forge": ["package/lib/rsa.js"],
    "@expo/code-signing-certificates": ["package/build/main.js"],
    "@expo/cli": ["package/build/src/utils/codesigning.js"],
  }.get(name)
  if inspected:
    archive = public_get(result["archive_url"])
    algorithm, encoded = result["integrity"].split("-", 1)
    if algorithm != "sha512" or hashlib.sha512(archive).digest() != base64.b64decode(encoded):
      raise RuntimeError("Public package archive integrity verification failed")
    result["integrity_verified"] = True
    result["archive_sha256"] = hashlib.sha256(archive).hexdigest()
    result["inspected_files"] = {}
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as package:
      for source in inspected:
        member = package.getmember(source)
        if not member.isfile():
          raise RuntimeError("Inspected public source is not a regular file")
        content = package.extractfile(member).read()
        lines = content.decode("utf-8").splitlines()
        terms = ["node-forge", "certificate.verify", "publicKey.verify", "csr.verify", "DigestInfo", "obj.value.length", "obj.value[0].value.length"]
        matches = [{"line": number, "text": line.strip()} for number, line in enumerate(lines, 1) if any(term in line for term in terms)]
        result["inspected_files"][source] = {"sha256": hashlib.sha256(content).hexdigest(), "matches": matches}
  return result


def main():
  started = datetime.now(timezone.utc).isoformat()
  inputs = {str(path.relative_to(ROOT)): digest(path) for path in [MOBILE / "package.json", MOBILE / "package-lock.json", MOBILE / "scripts/build-security.mjs"]}
  head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
  tree = subprocess.run(["npm", "ls", "node-forge", "--all", "--json"], cwd=MOBILE, capture_output=True, text=True, check=True)
  write_json("installed-tree.json", json.loads(tree.stdout))
  with tempfile.TemporaryDirectory(prefix="openauthor-dependency-recheck-") as cache:
    user_config = Path(cache) / "empty-user-config"
    global_config = Path(cache) / "empty-global-config"
    user_config.write_text("")
    global_config.write_text("")
    command = ["npm", "audit", "--json", "--registry=https://registry.npmjs.org", "--userconfig=" + str(user_config), "--globalconfig=" + str(global_config), "--cache=" + cache]
    audit = subprocess.run(command, cwd=MOBILE, capture_output=True, text=True)
    if audit.returncode not in [0, 1]:
      raise RuntimeError("Fresh public dependency audit did not complete")
    audit_document = json.loads(audit.stdout)
    if "error" in audit_document or audit_document.get("auditReportVersion") != 2:
      raise RuntimeError("Fresh public dependency audit did not return a report")
    write_json("npm-audit.json", audit_document)
  packages = {name: latest_package(name) for name in ["node-forge", "@expo/code-signing-certificates", "@expo/cli", "expo"]}
  write_json("upstream-packages.json", packages)
  advisory_url = "https://api.github.com/advisories/" + ADVISORY
  advisory = json.loads(public_get(advisory_url))
  write_json("advisory.json", {key: advisory.get(key) for key in ["ghsa_id", "cve_id", "html_url", "summary", "severity", "published_at", "updated_at", "vulnerabilities"]})
  pull_url = "https://api.github.com/repos/digitalbazaar/forge/pulls/1152"
  pull = json.loads(public_get(pull_url))
  write_json("upstream-pull.json", {key: pull.get(key) for key in ["number", "html_url", "state", "merged", "merged_at", "created_at", "updated_at", "merge_commit_sha"]})
  after = {path: digest(ROOT / path) for path in inputs}
  if inputs != after:
    raise RuntimeError("Mobile source changed during dependency recheck")
  write_json("results.json", {
    "started_at": started,
    "finished_at": datetime.now(timezone.utc).isoformat(),
    "baseline_commit": head,
    "input_sha256": inputs,
    "input_hashes_unchanged": inputs == after,
    "audit_command": "npm audit --json --registry=https://registry.npmjs.org --userconfig=<empty-file> --globalconfig=<different-empty-file> --cache=<disposable-directory>",
    "audit_exit_code": audit.returncode,
    "audit_vulnerabilities": audit_document["metadata"]["vulnerabilities"],
    "advisory": ADVISORY,
    "sources": [advisory_url, pull_url] + [package["registry_url"] for package in packages.values()],
    "scope": "Public npm/GitHub metadata, integrity-verified public package source inspection, and read-only audit of the existing installed mobile tree. No dependency, cryptographic implementation, signing setting, deployment, account or provider operation was changed.",
    "artifact_sha256": {name: digest(PACKET / name) for name in ["installed-tree.json", "npm-audit.json", "upstream-packages.json", "advisory.json", "upstream-pull.json"]},
  })
  print(json.dumps({"audit_exit_code": audit.returncode, "vulnerabilities": audit_document["metadata"]["vulnerabilities"], "latest": {name: package["version"] for name, package in packages.items()}, "pull_state": pull["state"], "pull_merged": pull["merged"], "inputs_unchanged": inputs == after}))


if __name__ == "__main__":
  main()
