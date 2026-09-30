from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any

from .codex import replace_runtime_codex_from_snapshot
from .git_ops import run_git
from .project import OpenAuthorError, ProjectPaths, get_project_paths, ensure_workspace_layout, utc_now
from .project_lock import project_write_lock
from .revisions import create_revision, recover_interrupted_edit, verify_revision_store

MANIFEST = "openauthor-backup.json"
BUNDLE = "storylines.bundle"
MAX_BYTES = 4 * 1024 * 1024 * 1024
MAX_FILES = 100_000
ROOT_FILES = {
  ".openauthor/project.json", ".openauthor/provider_pricing.json",
  ".openauthor/generation_budget_policy.json", ".openauthor/editorial_passes.json",
  ".openauthor/style_profile.json", ".openauthor/workspace/storylines.json",
  ".openauthor/last_import_report.json",
  ".gitignore",
}
PREFIXES = (
  "manuscript/", "codex/", ".openauthor/revisions/", ".openauthor/generations/",
  ".openauthor/workspace/proposals/", ".openauthor/workspace/chats/",
  ".openauthor/workspace/proposal-deliveries/",
)


def _allowed(name: str) -> bool:
  parts = PurePosixPath(name).parts
  return (
    bool(parts) and not name.startswith("/") and ".." not in parts and "\\" not in name
    and PurePosixPath(name).as_posix() == name and ":" not in name
    and (name == BUNDLE or name in ROOT_FILES or name.startswith(PREFIXES))
    and not any(part.startswith(".env") for part in parts)
    and not name.endswith((".sqlite3", ".sqlite3-wal", ".sqlite3-shm", ".tmp", ".lock"))
  )


def _digest(handle) -> str:
  digest = hashlib.sha256()
  for block in iter(lambda: handle.read(1024 * 1024), b""):
    digest.update(block)
  return digest.hexdigest()


def verify_backup(source: Path) -> dict[str, Any]:
  try:
    with zipfile.ZipFile(source) as archive:
      infos = archive.infolist()
      names = [info.filename for info in infos]
      if len(names) != len(set(names)) or len(names) > MAX_FILES:
        raise OpenAuthorError("Backup contains duplicate entries or too many files.")
      if sum(info.file_size for info in infos) > MAX_BYTES:
        raise OpenAuthorError("Backup exceeds the supported uncompressed size.")
      manifest_info = archive.getinfo(MANIFEST)
      if manifest_info.file_size > 32 * 1024 * 1024:
        raise OpenAuthorError("Backup manifest is too large.")
      manifest = json.loads(archive.read(MANIFEST))
      if manifest.get("schema_version") != 1 or not isinstance(manifest.get("files"), dict):
        raise OpenAuthorError("Unsupported backup manifest.")
      files = manifest["files"]
      if set(names) != set(files) | {MANIFEST} or ".openauthor/project.json" not in files:
        raise OpenAuthorError("Backup contents do not match the manifest.")
      git = manifest.get("git")
      if (BUNDLE in files) != isinstance(git, dict):
        raise OpenAuthorError("Backup Storyline history metadata is incomplete.")
      if git and (not isinstance(git.get("head"), str) or not git["head"].startswith("refs/heads/")):
        raise OpenAuthorError("Backup has an invalid Storyline head.")
      for name, expected in files.items():
        info = archive.getinfo(name)
        if not _allowed(name) or info.is_dir() or (info.external_attr >> 16) & 0o170000 == 0o120000:
          raise OpenAuthorError(f"Unsafe backup entry: {name}")
        with archive.open(info) as handle:
          if _digest(handle) != expected:
            raise OpenAuthorError(f"Backup integrity check failed: {name}")
      return {"verified": True, "file_count": len(files), "created_at": manifest.get("created_at", ""), "revision": manifest.get("revision", "")}
  except (OSError, zipfile.BadZipFile, KeyError, ValueError, AttributeError) as error:
    raise OpenAuthorError(f"Cannot verify backup: {error}") from error


def create_backup(paths: ProjectPaths, target: Path) -> dict[str, Any]:
  target = target.resolve()
  if target.exists():
    raise OpenAuthorError("Backup destination already exists. Choose a new filename.")
  for folder in (paths.scenes_dir.parent, paths.codex_db.parent, paths.project_dir):
    if target.is_relative_to(folder.resolve()):
      raise OpenAuthorError("Save backups outside the project's authoring data folders.")
  target.parent.mkdir(parents=True, exist_ok=True)
  with project_write_lock(paths):
    recover_interrupted_edit(paths)
    revision = create_revision(paths, "Portable backup", kind="backup", skip_unchanged=True)
    health = verify_revision_store(paths)
    if not health["ready"]:
      raise OpenAuthorError("Cannot back up damaged revision history: " + "; ".join(health["errors"]))
    with tempfile.TemporaryDirectory(prefix="openauthor-backup-", dir=target.parent) as temporary:
      staged = Path(temporary) / "backup.zip"
      manifest: dict[str, Any] = {"schema_version": 1, "created_at": utc_now(), "revision": revision, "files": {}}
      bundle = Path(temporary) / BUNDLE
      if (paths.root / ".git").exists():
        refs = run_git(paths, ["for-each-ref", "--format=%(refname)", "refs/heads"]).stdout.splitlines()
        if refs:
          head = run_git(paths, ["symbolic-ref", "HEAD"]).stdout.strip()
          run_git(paths, ["bundle", "create", str(bundle), *refs])
          manifest["git"] = {"head": head}
      elif (paths.workspace_dir / "storylines.json").exists():
        raise OpenAuthorError("Storyline metadata exists without its project Git history; repair before backup.")
      with zipfile.ZipFile(staged, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        if bundle.exists():
          with bundle.open("rb") as handle:
            manifest["files"][BUNDLE] = _digest(handle)
          archive.write(bundle, BUNDLE)
        candidates = set(paths.root / name for name in ROOT_FILES)
        for prefix in PREFIXES:
          folder = paths.root / prefix
          if folder.exists():
            candidates.update(folder.rglob("*"))
        for file in sorted(candidates):
          name = file.relative_to(paths.root).as_posix()
          if not file.is_file() or not _allowed(name):
            continue
          if file.is_symlink() or not file.resolve().is_relative_to(paths.root.resolve()):
            raise OpenAuthorError(f"Cannot back up linked authoring data: {name}")
          with file.open("rb") as handle:
            manifest["files"][name] = _digest(handle)
          archive.write(file, name)
        archive.writestr(MANIFEST, json.dumps(manifest, indent=2))
      report = verify_backup(staged)
      # Exclusive publication never overwrites a backup created concurrently.
      os.link(staged, target)
    return {**report, "path": str(target)}


def restore_backup(source: Path, target: Path) -> dict[str, Any]:
  target = target.resolve()
  if target.exists() and (not target.is_dir() or any(target.iterdir())):
    raise OpenAuthorError("Restore into a new or empty folder; existing projects are never overwritten.")
  target.parent.mkdir(parents=True, exist_ok=True)
  with tempfile.TemporaryDirectory(prefix="openauthor-recovery-", dir=target.parent) as temporary:
    # Verify and extract the same private copy even if the source is replaced.
    snapshot = Path(temporary) / "source.zip"
    shutil.copyfile(source, snapshot)
    report = verify_backup(snapshot)
    staged = Path(temporary) / "project"
    staged.mkdir()
    with zipfile.ZipFile(snapshot) as archive:
      manifest = json.loads(archive.read(MANIFEST))
      for info in archive.infolist():
        if info.filename == MANIFEST:
          continue
        destination = staged / info.filename
        destination.parent.mkdir(parents=True, exist_ok=True)
        with archive.open(info) as reader, destination.open("xb") as writer:
          shutil.copyfileobj(reader, writer)
    paths = get_project_paths(staged)
    ensure_workspace_layout(paths)
    for directory in (paths.codex_db.parent, paths.scenes_dir, paths.generations_dir, paths.retrieval_dir):
      directory.mkdir(parents=True, exist_ok=True)
    replace_runtime_codex_from_snapshot(paths)
    health = verify_revision_store(paths)
    if not health["ready"]:
      raise OpenAuthorError("Restored revision history failed verification: " + "; ".join(health["errors"]))
    if manifest.get("git"):
      head = manifest["git"]["head"]
      run_git(paths, ["check-ref-format", head])
      run_git(paths, ["init"])
      run_git(paths, ["bundle", "verify", str(staged / BUNDLE)])
      run_git(paths, ["fetch", "--update-head-ok", str(staged / BUNDLE), "refs/heads/*:refs/heads/*"])
      run_git(paths, ["symbolic-ref", "HEAD", head])
      # Rebuild the index, preserving the backed-up working prose exactly.
      run_git(paths, ["reset", "--mixed", "HEAD"])
      (staged / BUNDLE).unlink()
    from .hardening import collect_startup_health
    startup = collect_startup_health(paths)
    if not startup["ready"]:
      errors = [row["message"] for row in startup["checks"] if row["status"] == "error"]
      raise OpenAuthorError("Recovered book failed startup checks: " + "; ".join(errors))
    os.rename(staged, target)
  return {**report, "project_root": str(target), "restored": True}
