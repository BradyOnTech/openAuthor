"""Run with the packaged Python, with no Git or Python available on PATH."""
from __future__ import annotations

import json
import os
import platform
import sys
import tempfile
from pathlib import Path

from openauthor.backups import create_backup, restore_backup
from openauthor.codex import add_entity, get_entity, update_entity
from openauthor.git_ops import resolve_git_binary
from openauthor.hardening import collect_startup_health
from openauthor.project import initialize_project, resolve_project
from openauthor.revisions import create_revision, restore_revision
from openauthor.scenes import add_scene, get_scene, update_scene
from openauthor.storylines import compare_storyline, create_storyline, switch_storyline


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
  print(json.dumps({"packaged_recovery": "passed", "system_tools_on_path": False, "architecture": platform.machine(), "python": platform.python_version()}))


if __name__ == "__main__":
  main()
