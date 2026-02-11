from __future__ import annotations

import os
import subprocess

from .project import OpenAuthorError, ProjectPaths


def _git_env() -> dict[str, str]:
  env = os.environ.copy()
  env.setdefault("GIT_AUTHOR_NAME", "openAuthor")
  env.setdefault("GIT_AUTHOR_EMAIL", "openauthor@local")
  env.setdefault("GIT_COMMITTER_NAME", "openAuthor")
  env.setdefault("GIT_COMMITTER_EMAIL", "openauthor@local")
  return env


def run_git(paths: ProjectPaths, args: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
  return subprocess.run(
    ["git", *args],
    cwd=paths.root,
    capture_output=True,
    text=True,
    check=check,
    env=_git_env(),
  )


def ensure_git_repo(paths: ProjectPaths) -> None:
  result = run_git(paths, ["rev-parse", "--is-inside-work-tree"], check=False)
  if result.returncode != 0:
    raise OpenAuthorError("Project is not a git repository.")


def initialize_git(paths: ProjectPaths) -> None:
  result = run_git(paths, ["rev-parse", "--is-inside-work-tree"], check=False)
  if result.returncode == 0:
    return
  created = run_git(paths, ["init"], check=True)
  if created.returncode != 0:
    raise OpenAuthorError("Unable to initialize git repository.")


def create_snapshot(paths: ProjectPaths, message: str) -> str:
  ensure_git_repo(paths)
  status = run_git(paths, ["status", "--porcelain"], check=True).stdout.strip()
  if not status:
    return "No changes to snapshot."

  run_git(paths, ["add", "-A"], check=True)
  commit = run_git(paths, ["commit", "-m", message], check=False)
  if commit.returncode != 0:
    stderr = commit.stderr.strip() or "git commit failed"
    raise OpenAuthorError(stderr)
  return commit.stdout.strip() or "Snapshot created."


def list_snapshots(paths: ProjectPaths, *, limit: int = 10) -> list[str]:
  ensure_git_repo(paths)
  log = run_git(paths, ["log", "--oneline", f"-n{limit}"], check=False)
  if log.returncode != 0:
    return []
  return [line for line in log.stdout.splitlines() if line.strip()]
