"""Run with the packaged Python, with no Git or Python available on PATH."""
from __future__ import annotations

import json
import os
import platform
import select
import subprocess
import sys
import tempfile
from pathlib import Path

from openauthor.backups import create_backup, restore_backup
from openauthor.codex import add_entity, get_entity, update_entity
from openauthor.git_ops import resolve_git_binary
from openauthor.hardening import collect_startup_health
from openauthor.project import initialize_project, resolve_project
from openauthor.proposals import create_proposal, get_proposal, set_proposal_draft, undo_proposal_batch
from openauthor.revisions import create_revision, restore_revision
from openauthor.scenes import add_scene, get_scene, update_scene
from openauthor.storylines import compare_storyline, create_storyline, switch_storyline


_KILL_PROBE = r'''
import json, sys
from pathlib import Path
from openauthor.project import resolve_project
from openauthor.proposals import apply_proposal_batch
import openauthor.book_transactions as transactions
paths = resolve_project(Path(sys.argv[1]))
stage = sys.argv[2]
real_replace, real_retire = transactions._replace_bytes, transactions._retire
paused = False
def pause():
  global paused
  if not paused:
    paused = True
    print('ready-to-kill', flush=True)
    sys.stdin.readline()
def replace(path, content, **kwargs):
  if stage == 'before_commit' and path.name == 'book-transaction.json' and json.loads(content)['phase'] == 'committed':
    pause()
  real_replace(path, content, **kwargs)
  if stage == 'scene' and path.parent == paths.scenes_dir:
    pause()
  if stage == 'proposal' and path.parent == paths.proposals_dir:
    pause()
  if stage == 'head' and path == paths.revision_head_file:
    record = json.loads((paths.revision_records_dir / (content.decode().strip() + '.json')).read_text())
    if record['kind'] == 'change_group_apply':
      pause()
def retire(project):
  if stage == 'committed':
    pause()
  real_retire(project)
transactions._replace_bytes, transactions._retire = replace, retire
apply_proposal_batch(paths, proposal_ids=json.loads(sys.argv[3]))
'''


def verify_forced_termination(paths) -> list[dict[str, str]]:
  add_scene(paths, title="Return", body="Ivo waits beside the gate.")
  originals = {path: path.read_bytes() for path in paths.scenes_dir.glob("*.md")}
  results = []
  for stage in ("scene", "head", "proposal", "before_commit", "committed"):
    identifiers = []
    for scene_id, body in (("scene-0001", "Mara keeps the brass gate closed."), ("scene-0002", "Ivo waits beside the eastern gate.")):
      identifier = create_proposal(paths, title="Recovery probe", instruction="Clarify gate", scene_id=scene_id)
      set_proposal_draft(paths, proposal_id=identifier, proposed_body=body)
      identifiers.append(identifier)
    child = subprocess.Popen([sys.executable, "-I", "-c", _KILL_PROBE, str(paths.root), stage, json.dumps(identifiers)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
      ready, _, _ = select.select([child.stdout], [], [], 15)
      if not ready or child.stdout.readline() != "ready-to-kill\n":
        child.kill()
        _, error = child.communicate(timeout=5)
        raise RuntimeError(f"Packaged recovery probe did not reach {stage}: {error}")
      child.kill()
      _, error = child.communicate(timeout=5)
      if child.returncode != -9:
        raise RuntimeError(f"Packaged probe did not terminate with SIGKILL: {error}")
    finally:
      if child.poll() is None:
        child.kill()
        child.communicate(timeout=5)
    # A first normal engine read must recover; no explicit repair is invoked.
    get_scene(paths, "scene-0001")
    if stage == "committed":
      proposal = get_proposal(paths, identifiers[0])
      assert proposal["status"] == "applied"
      assert get_proposal(paths, identifiers[1])["applied_revision"] == proposal["applied_revision"]
      undo_proposal_batch(paths, applied_revision=proposal["applied_revision"])
    else:
      assert all(get_proposal(paths, identifier)["status"] == "pending" for identifier in identifiers)
    assert all(path.read_bytes() == content for path, content in originals.items())
    results.append({"stage": stage, "result": "preserved_commit" if stage == "committed" else "exact_original_restored"})
  return results


def main() -> None:
  runtime = Path(sys.executable).resolve().parents[2]
  expected_git = runtime / "git/bin/git"
  if Path(resolve_git_binary()).resolve() != expected_git.resolve() or not expected_git.is_file():
    raise RuntimeError("Recovery smoke must use packaged Python and its sibling embedded Git.")
  with tempfile.TemporaryDirectory(prefix="openauthor-packaged-recovery-") as temporary:
    root = Path(temporary)
    os.environ["PATH"] = str(root / "no-system-tools")
    # No inherited developer configuration or signing helpers in this probe.
    os.environ["GIT_CONFIG_GLOBAL"] = os.devnull
    os.environ["GIT_CONFIG_NOSYSTEM"] = "1"
    paths = initialize_project(root / "book", name="Packaged recovery probe")
    add_scene(paths, title="Opening", body="Mara keeps the gate closed.")
    entity = add_entity(paths, kind="character", name="Mara", description="Gatekeeper")
    original = create_revision(paths, "Before experiment")
    storyline = create_storyline(paths, name="Alternate", hypothesis="Let Mara leave")
    update_scene(paths, scene_identifier="scene-0001", body="Mara leaves the gate behind.")
    update_entity(paths, entity_id=entity, description="Former gatekeeper")
    assert compare_storyline(paths, storyline["id"])["scenes"]
    archive = root / "book.openauthor.zip"
    assert create_backup(paths, archive)["verified"]
    assert restore_backup(archive, root / "recovered")["verified"]
    recovered = resolve_project(root / "recovered")
    assert collect_startup_health(recovered)["ready"]
    assert "leaves the gate" in get_scene(recovered, "scene-0001")["body"]
    switch_storyline(recovered, primary=True)
    assert "keeps the gate" in get_scene(recovered, "scene-0001")["body"]
    switch_storyline(recovered, storyline["id"])
    assert get_entity(recovered, entity)["description"] == "Former gatekeeper"
    restore_revision(recovered, original)
    assert get_entity(recovered, entity)["description"] == "Gatekeeper"
    forced_termination = verify_forced_termination(recovered)
  print(json.dumps({"packaged_recovery": "passed", "forced_termination": forced_termination, "system_tools_on_path": False, "architecture": platform.machine(), "python": platform.python_version(), "gui_acceptance": "not_observed"}))


if __name__ == "__main__":
  main()
