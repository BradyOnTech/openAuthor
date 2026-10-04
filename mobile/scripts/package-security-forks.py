#!/usr/bin/env python3
"""Reproduce the repository's modified packages from pinned upstream archives."""
import base64
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import sys
import tarfile

MOBILE = Path(__file__).resolve().parent.parent


def digest(value):
  return hashlib.sha256(value).hexdigest()


def archive_files(path, integrity):
  raw = path.read_bytes()
  actual = "sha512-" + base64.b64encode(hashlib.sha512(raw).digest()).decode()
  if actual != integrity:
    raise ValueError("Upstream archive integrity changed")
  files = {}
  with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as archive:
    for item in archive.getmembers():
      parts = PurePosixPath(item.name).parts
      if (not item.isfile() or len(parts) < 2 or parts[0] != "package" or
          any(part in ("", ".", "..") for part in parts) or
          item.size > 4 * 1024 * 1024 or len(files) >= 1000):
        raise ValueError("Unexpected upstream archive member")
      name = "/".join(parts[1:])
      if name in files:
        raise ValueError("Duplicate upstream archive member")
      files[name] = archive.extractfile(item).read()
  return files


def tarball(files):
  raw = io.BytesIO()
  with tarfile.open(fileobj=raw, mode="w", format=tarfile.USTAR_FORMAT) as archive:
    for name, content in sorted(files.items()):
      item = tarfile.TarInfo("package/" + name)
      item.size = len(content)
      item.mode = 0o644
      item.mtime = 0
      archive.addfile(item, io.BytesIO(content))
  compressed = io.BytesIO()
  # GzipFile fixes the OS header across Python 3.11/3.13; gzip.compress with
  # mtime=0 has version-dependent header bytes.
  with gzip.GzipFile(fileobj=compressed, mode="wb", compresslevel=9, mtime=0, filename="") as archive:
    archive.write(raw.getvalue())
  return compressed.getvalue()


def package(spec):
  files = archive_files(MOBILE / spec["upstream_archive"], spec["upstream_integrity"])
  if {name: digest(value) for name, value in files.items()} != spec["upstream_files"]:
    raise ValueError("Upstream source inventory changed")
  if spec["upstream_name"] == "braces":
    manifest = json.loads((MOBILE / "security/braces-backport-3.0.3.json").read_text())
    for name, source in manifest["sources"].items():
      content = (MOBILE / source["path"]).read_bytes()
      if digest(content) != source["sha256"]:
        raise ValueError("Reviewed Braces implementation changed")
      files[name] = content
  elif spec["upstream_name"] == "node-forge":
    manifest = json.loads((MOBILE / "security/forge-backport-1.4.0.json").read_text())
    patch = manifest["forge"]["patch"]
    original = files[patch["path"]].decode()
    if digest(files[patch["path"]]) != patch["original_sha256"] or original.count(patch["before"]) != 1:
      raise ValueError("Reviewed Forge patch preimage changed")
    files[patch["path"]] = original.replace(patch["before"], patch["after"]).encode()
    if digest(files[patch["path"]]) != patch["patched_sha256"]:
      raise ValueError("Reviewed Forge patch postimage changed")
    # Expo uses the Node/lib implementation. Do not distribute the old,
    # unpatched browser bundles or the unrelated obsolete Flash binary.
    files = {name: value for name, value in files.items()
      if not name.startswith(("dist/", "flash/"))}
  else:
    raise ValueError("Unknown security fork")
  metadata = json.loads(files["package.json"])
  metadata.update(name=spec["name"], version=spec["version"], private=True,
    description=spec["description"], openauthorSecurityFork={
      "upstream": spec["upstream_name"], "version": spec["upstream_version"],
      "advisory": spec["advisory"], "source": "https://github.com/BradyOnTech/openAuthor/tree/main/mobile/security",
    })
  # Upstream development scripts are not available in this distribution.
  metadata.pop("scripts", None)
  metadata.pop("devDependencies", None)
  metadata.pop("nyc", None)
  if spec["upstream_name"] == "node-forge":
    metadata["files"] = ["lib/*.js", "LICENSE", "README.md", "SECURITY-FORK.md"]
  files["package.json"] = (json.dumps(metadata, indent=2, ensure_ascii=False) + "\n").encode()
  files["SECURITY-FORK.md"] = (MOBILE / spec["notice"]).read_bytes()
  return files, tarball(files)


def main():
  if sys.argv[1:] not in (["check"], ["build"]):
    raise ValueError("Use check or build")
  manifest = json.loads((MOBILE / "security/forks.json").read_text())
  for spec in manifest["packages"]:
    files, result = package(spec)
    if {name: digest(value) for name, value in files.items()} != spec["files"]:
      raise ValueError("Modified fork source inventory changed")
    if digest(result) != spec["archive_sha256"]:
      raise ValueError("Modified fork archive changed")
    destination = MOBILE / spec["archive"]
    if sys.argv[1] == "build":
      destination.write_bytes(result)
    elif destination.read_bytes() != result:
      raise ValueError("Committed fork differs from reproducible source")
    print(spec["name"] + ": exact modified sources and archive verified")


if __name__ == "__main__":
  main()
