from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from .codex import export_codex_json, replace_runtime_codex_from_snapshot
from .project import OpenAuthorError, ProjectPaths

BOOKSTATE_PATHSPEC = [
  "manuscript/scenes",
  ".openauthor/project.json",
  ".openauthor/provider_pricing.json",
  ".openauthor/generation_budget_policy.json",
  "codex/codex.json",
]


def _git_env() -> dict[str, str]:
  env = os.environ.copy()
  env.setdefault("GIT_AUTHOR_NAME", "openAuthor")
  env.setdefault("GIT_AUTHOR_EMAIL", "openauthor@local")
  env.setdefault("GIT_COMMITTER_NAME", "openAuthor")
  env.setdefault("GIT_COMMITTER_EMAIL", "openauthor@local")
  return env


def run_git(paths: ProjectPaths, args: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
  result = subprocess.run(
    ["git", *args],
    cwd=paths.root,
    capture_output=True,
    text=True,
    check=False,
    env=_git_env(),
  )
  if check and result.returncode != 0:
    stderr = result.stderr.strip() or result.stdout.strip() or "git command failed"
    raise OpenAuthorError(stderr)
  return result


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
  export_codex_json(paths)
  pathspec = BOOKSTATE_PATHSPEC
  status = run_git(paths, ["status", "--porcelain", "--", *pathspec], check=True).stdout.strip()
  if not status:
    return "No changes to snapshot."

  run_git(paths, ["add", "-A", "--", *pathspec], check=True)
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


def _require_branch_name(name: str) -> str:
  normalized = name.strip()
  if normalized == "":
    raise OpenAuthorError("Branch name cannot be empty.")
  if any(ch.isspace() for ch in normalized):
    raise OpenAuthorError("Branch name cannot contain whitespace.")
  if normalized.startswith("-"):
    raise OpenAuthorError("Branch name cannot start with '-'.")
  if normalized in {".", ".."}:
    raise OpenAuthorError(f"Invalid branch name '{name}'.")
  return normalized


def _ensure_clean_worktree(paths: ProjectPaths) -> None:
  status = run_git(
    paths,
    ["status", "--porcelain", "--untracked-files=no", "--", *BOOKSTATE_PATHSPEC],
    check=True,
  ).stdout.strip()
  if status:
    raise OpenAuthorError(
      "Book state has uncommitted changes. Create a snapshot before switching branches."
    )


def _ensure_ref_exists(paths: ProjectPaths, ref: str) -> None:
  normalized = ref.strip()
  if normalized == "":
    raise OpenAuthorError("Reference cannot be empty.")
  probe = run_git(paths, ["rev-parse", "--verify", normalized], check=False)
  if probe.returncode != 0:
    raise OpenAuthorError(f"Unknown git reference '{normalized}'.")


def _sync_codex_runtime(paths: ProjectPaths) -> None:
  try:
    replace_runtime_codex_from_snapshot(paths)
  except OpenAuthorError as error:
    raise OpenAuthorError(
      f"Codex runtime sync failed after git operation: {error}"
    ) from error


def current_branch(paths: ProjectPaths) -> str:
  ensure_git_repo(paths)
  result = run_git(paths, ["rev-parse", "--abbrev-ref", "HEAD"], check=True)
  return result.stdout.strip()


def get_branch_workspace_status(paths: ProjectPaths) -> dict[str, Any]:
  current = current_branch(paths)
  branches = list_branches(paths)
  current_marked = [row for row in branches if row.get("current")]
  detached_head = current == "HEAD"
  known_current_branch = any(row.get("name") == current for row in branches)

  drift_reasons: list[str] = []
  if detached_head:
    drift_reasons.append("detached_head")
  if not detached_head and not known_current_branch:
    drift_reasons.append("current_branch_not_listed")
  if len(current_marked) > 1:
    drift_reasons.append("multiple_current_markers")
  if not detached_head and len(current_marked) == 0:
    drift_reasons.append("missing_current_marker")

  recommendations: list[str] = []
  if detached_head:
    recommendations.append(
      "Switch to a local branch (`openauthor branch switch --name <branch>`)."
    )
  if "current_branch_not_listed" in drift_reasons:
    recommendations.append("Refresh local branch refs (`git fetch --all --prune`).")
  if "multiple_current_markers" in drift_reasons:
    recommendations.append("Inspect repository refs for branch metadata corruption.")

  return {
    "current_branch": current,
    "detached_head": detached_head,
    "local_branch_count": len(branches),
    "current_marked_count": len(current_marked),
    "known_current_branch": known_current_branch,
    "drift_detected": len(drift_reasons) > 0,
    "drift_reasons": drift_reasons,
    "recommendations": recommendations,
  }


def list_branches(paths: ProjectPaths) -> list[dict[str, Any]]:
  ensure_git_repo(paths)
  rows = run_git(
    paths,
    ["for-each-ref", "refs/heads", "--format=%(refname:short)\t%(HEAD)\t%(upstream:short)"],
    check=True,
  ).stdout.splitlines()
  items: list[dict[str, Any]] = []
  for line in rows:
    raw = line.rstrip("\r\n")
    if raw == "":
      continue
    parts = raw.split("\t")
    if len(parts) < 3:
      continue
    name, head_marker, upstream = parts[0], parts[1], parts[2]
    items.append(
      {
        "name": name,
        "current": head_marker.strip() == "*",
        "upstream": upstream.strip() or "",
      }
    )
  items.sort(key=lambda row: (0 if row["current"] else 1, row["name"]))
  return items


def create_branch(
  paths: ProjectPaths,
  *,
  name: str,
  from_ref: str | None = None,
  switch: bool = True,
) -> dict[str, Any]:
  ensure_git_repo(paths)
  branch_name = _require_branch_name(name)
  if switch:
    _ensure_clean_worktree(paths)
  args = ["branch", branch_name]
  if from_ref is not None:
    ref_name = from_ref.strip()
    _ensure_ref_exists(paths, ref_name)
    args.append(ref_name)
  run_git(paths, args, check=True)
  if switch:
    run_git(paths, ["checkout", branch_name], check=True)
    _sync_codex_runtime(paths)
  return {
    "name": branch_name,
    "current": current_branch(paths) == branch_name,
    "from_ref": (from_ref or "").strip(),
  }


def switch_branch(paths: ProjectPaths, *, name: str) -> dict[str, Any]:
  ensure_git_repo(paths)
  branch_name = _require_branch_name(name)
  _ensure_ref_exists(paths, branch_name)
  _ensure_clean_worktree(paths)
  run_git(paths, ["checkout", branch_name], check=True)
  _sync_codex_runtime(paths)
  return {
    "name": branch_name,
    "current": current_branch(paths) == branch_name,
  }


def diff_branches(paths: ProjectPaths, *, base: str, head: str) -> dict[str, Any]:
  ensure_git_repo(paths)
  base_ref = base.strip()
  head_ref = head.strip()
  _ensure_ref_exists(paths, base_ref)
  _ensure_ref_exists(paths, head_ref)

  status_lines = run_git(
    paths,
    ["diff", "--name-status", f"{base_ref}...{head_ref}", "--", *BOOKSTATE_PATHSPEC],
    check=True,
  ).stdout.splitlines()
  numstat_lines = run_git(
    paths,
    ["diff", "--numstat", f"{base_ref}...{head_ref}", "--", *BOOKSTATE_PATHSPEC],
    check=True,
  ).stdout.splitlines()

  stats_by_path: dict[str, tuple[int | None, int | None]] = {}
  for line in numstat_lines:
    parts = line.split("\t")
    if len(parts) < 3:
      continue
    added_raw, deleted_raw, path = parts[0], parts[1], parts[-1]
    added = None if added_raw == "-" else int(added_raw)
    deleted = None if deleted_raw == "-" else int(deleted_raw)
    stats_by_path[path] = (added, deleted)

  files: list[dict[str, Any]] = []
  for line in status_lines:
    parts = line.split("\t")
    if len(parts) < 2:
      continue
    status = parts[0]
    path = parts[-1]
    added, deleted = stats_by_path.get(path, (None, None))
    files.append(
      {
        "status": status,
        "path": path,
        "added": added,
        "deleted": deleted,
      }
    )

  ahead_by_raw = run_git(paths, ["rev-list", "--count", f"{base_ref}..{head_ref}"], check=True).stdout.strip()
  behind_by_raw = run_git(paths, ["rev-list", "--count", f"{head_ref}..{base_ref}"], check=True).stdout.strip()
  ahead_by = int(ahead_by_raw or "0")
  behind_by = int(behind_by_raw or "0")

  return {
    "base": base_ref,
    "head": head_ref,
    "ahead_by": ahead_by,
    "behind_by": behind_by,
    "files": files,
  }


def _classify_path(path: str) -> str:
  if path.startswith("manuscript/scenes/"):
    return "scene"
  if path == "codex/codex.json":
    return "codex"
  if path == ".openauthor/project.json":
    return "project"
  if path == ".openauthor/generation_budget_policy.json":
    return "budget"
  return "other"


def _changed_bookstate_paths(paths: ProjectPaths, merge_base: str, ref: str) -> set[str]:
  return {
    line.strip()
    for line in run_git(
      paths,
      ["diff", "--name-only", f"{merge_base}..{ref}", "--", *BOOKSTATE_PATHSPEC],
      check=True,
    ).stdout.splitlines()
    if line.strip()
  }


def show_file_at_ref(paths: ProjectPaths, ref: str, path: str) -> str | None:
  result = run_git(paths, ["show", f"{ref}:{path}"], check=False)
  if result.returncode != 0:
    return None
  return result.stdout


def scan_merge_conflicts(paths: ProjectPaths, *, base: str, head: str) -> dict[str, Any]:
  ensure_git_repo(paths)
  base_ref = base.strip()
  head_ref = head.strip()
  _ensure_ref_exists(paths, base_ref)
  _ensure_ref_exists(paths, head_ref)

  merge_base = run_git(paths, ["merge-base", base_ref, head_ref], check=True).stdout.strip()
  base_changed = _changed_bookstate_paths(paths, merge_base, base_ref)
  head_changed = _changed_bookstate_paths(paths, merge_base, head_ref)
  overlap_paths = sorted(base_changed.intersection(head_changed))

  conflicts: list[dict[str, Any]] = []
  auto_mergeable: list[str] = []
  for path in overlap_paths:
    ancestor_text = show_file_at_ref(paths, merge_base, path)
    ours_text = show_file_at_ref(paths, base_ref, path)
    theirs_text = show_file_at_ref(paths, head_ref, path)
    if ours_text is None or theirs_text is None:
      conflicts.append(
        {
          "path": path,
          "category": _classify_path(path),
          "kind": "delete_modify",
          "conflict_count": 1,
          "ours_text": ours_text,
          "theirs_text": theirs_text,
          "ancestor_text": ancestor_text or "",
        }
      )
      continue
    with tempfile.TemporaryDirectory(prefix="openauthor-merge-") as tmp:
      tmp_dir = Path(tmp)
      ours_file = tmp_dir / "ours"
      ancestor_file = tmp_dir / "ancestor"
      theirs_file = tmp_dir / "theirs"
      ours_file.write_text(ours_text, encoding="utf-8")
      ancestor_file.write_text(ancestor_text or "", encoding="utf-8")
      theirs_file.write_text(theirs_text, encoding="utf-8")
      merged = run_git(
        paths,
        [
          "merge-file",
          "-p",
          f"-L{base_ref}",
          "-Lancestor",
          f"-L{head_ref}",
          str(ours_file),
          str(ancestor_file),
          str(theirs_file),
        ],
        check=False,
      )
    if merged.returncode == 0:
      auto_mergeable.append(path)
      continue
    if merged.returncode < 0:
      raise OpenAuthorError(f"git merge-file failed for '{path}'.")
    conflicts.append(
      {
        "path": path,
        "category": _classify_path(path),
        "kind": "content",
        "conflict_count": merged.returncode,
        "ours_text": ours_text,
        "theirs_text": theirs_text,
        "ancestor_text": ancestor_text or "",
        "merged_with_markers": merged.stdout,
      }
    )

  return {
    "base": base_ref,
    "head": head_ref,
    "merge_base": merge_base,
    "overlap_count": len(overlap_paths),
    "auto_mergeable": auto_mergeable,
    "conflicts": conflicts,
    "conflict_count": len(conflicts),
  }


def preflight_merge(paths: ProjectPaths, *, base: str, head: str) -> dict[str, Any]:
  ensure_git_repo(paths)
  base_ref = base.strip()
  head_ref = head.strip()
  _ensure_ref_exists(paths, base_ref)
  _ensure_ref_exists(paths, head_ref)

  merge_base = run_git(paths, ["merge-base", base_ref, head_ref], check=True).stdout.strip()
  base_changed = _changed_bookstate_paths(paths, merge_base, base_ref)
  head_changed = _changed_bookstate_paths(paths, merge_base, head_ref)
  overlap_paths = sorted(base_changed.intersection(head_changed))
  overlap_by_category: dict[str, list[str]] = {
    "scene": [],
    "codex": [],
    "project": [],
    "budget": [],
    "other": [],
  }
  for path in overlap_paths:
    overlap_by_category[_classify_path(path)].append(path)

  overlap_total = len(overlap_paths)
  scene_overlap = len(overlap_by_category["scene"])
  codex_overlap = len(overlap_by_category["codex"])
  if scene_overlap > 0 or codex_overlap > 0:
    risk_level = "high"
  elif overlap_total > 0:
    risk_level = "medium"
  else:
    risk_level = "low"

  recommendations: list[str] = []
  if overlap_total == 0:
    recommendations.append("No overlapping authoring files detected; merge risk is low.")
  else:
    recommendations.append(
      "Overlapping files detected. Review branch diff before merge."
    )
    if scene_overlap > 0:
      recommendations.append(
        "Scene overlaps detected. Manually reconcile scene markdown changes first."
      )
    if codex_overlap > 0:
      recommendations.append(
        "Codex snapshot overlap detected. Re-export codex and re-run preflight after merge."
      )
  return {
    "base": base_ref,
    "head": head_ref,
    "merge_base": merge_base,
    "base_changed_count": len(base_changed),
    "head_changed_count": len(head_changed),
    "overlap_count": overlap_total,
    "overlap_by_category": overlap_by_category,
    "safe_to_merge": overlap_total == 0,
    "risk_level": risk_level,
    "recommendations": recommendations,
  }


def merge_branches(
  paths: ProjectPaths,
  *,
  base: str,
  head: str,
  resolutions: dict[str, str] | None = None,
) -> dict[str, Any]:
  ensure_git_repo(paths)
  base_ref = base.strip()
  head_ref = head.strip()
  if base_ref == head_ref:
    raise OpenAuthorError("base and head must be different branches.")
  _ensure_ref_exists(paths, base_ref)
  _ensure_ref_exists(paths, head_ref)
  _ensure_clean_worktree(paths)

  starting_branch = current_branch(paths)
  if starting_branch != base_ref:
    run_git(paths, ["checkout", base_ref], check=True)
    _sync_codex_runtime(paths)

  merge_result = run_git(
    paths,
    ["merge", "--no-ff", "--no-commit", "--no-edit", head_ref],
    check=False,
  )
  resolved_paths: list[str] = []
  if merge_result.returncode != 0:
    conflicted = [
      line.strip()
      for line in run_git(
        paths,
        ["diff", "--name-only", "--diff-filter=U"],
        check=False,
      ).stdout.splitlines()
      if line.strip()
    ]
    resolution_map = resolutions or {}
    missing = [path for path in conflicted if path not in resolution_map]
    if not conflicted or missing:
      run_git(paths, ["merge", "--abort"], check=False)
      if conflicted:
        listed = ", ".join(missing or conflicted)
        raise OpenAuthorError(
          "Merge conflicts detected and aborted. Conflicted files without a "
          f"resolution: {listed}. Use `branch conflicts` to inspect and "
          "`branch resolve` to draft reconciliations, then merge with "
          "--resolution."
        )
      stderr = merge_result.stderr.strip() or merge_result.stdout.strip()
      raise OpenAuthorError(
        "Merge failed and was aborted automatically. "
        + (stderr or "Resolve conflicts manually and retry.")
      )
    for path in conflicted:
      target = paths.root / path
      target.parent.mkdir(parents=True, exist_ok=True)
      target.write_text(resolution_map[path], encoding="utf-8")
      run_git(paths, ["add", "--", path], check=True)
      resolved_paths.append(path)

  merge_head = paths.root / ".git" / "MERGE_HEAD"
  if merge_head.exists():
    commit = run_git(paths, ["commit", "--no-edit"], check=False)
    if commit.returncode != 0:
      run_git(paths, ["merge", "--abort"], check=False)
      stderr = commit.stderr.strip() or commit.stdout.strip() or "git commit failed"
      raise OpenAuthorError(f"Merge commit failed and was aborted. {stderr}")

  merge_commit = run_git(paths, ["rev-parse", "HEAD"], check=True).stdout.strip()
  _sync_codex_runtime(paths)
  current = current_branch(paths)
  output = merge_result.stdout.strip()
  return {
    "base": base_ref,
    "head": head_ref,
    "merged": True,
    "merge_commit": merge_commit,
    "current_branch": current,
    "resolved_paths": resolved_paths,
    "merge_output": output,
  }
