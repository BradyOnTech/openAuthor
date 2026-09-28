from __future__ import annotations

import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from openauthor.git_ops import run_git
from openauthor.project import get_project_paths, initialize_project
from openauthor.scenes import add_scene, get_scene, update_scene
from openauthor.storylines import create_storyline, switch_storyline


class GitRuntimeTests(unittest.TestCase):
  def test_storylines_do_not_reuse_or_commit_an_enclosing_repository(self) -> None:
    with tempfile.TemporaryDirectory() as temporary:
      root = Path(temporary)
      outer = get_project_paths(root)
      run_git(outer, ["init"])
      paths = initialize_project(root / "novel", name="Nested Novel")
      add_scene(paths, title="Opening", body="Private prose")
      create_storyline(paths, name="Alternate", hypothesis="Try another ending")
      self.assertTrue((paths.root / ".git").is_dir())
      self.assertNotEqual(run_git(outer, ["rev-parse", "--verify", "HEAD"], check=False).returncode, 0)

  def test_explicit_embedded_git_works_without_system_git_on_path(self) -> None:
    git = shutil.which("git")
    if not git:
      self.skipTest("This source test requires Git to construct a runtime fixture")
    with tempfile.TemporaryDirectory() as temporary:
      root = Path(temporary)
      with patch.dict(os.environ, {"OPENAUTHOR_GIT_BIN": git, "PATH": str(root / "empty-path")}, clear=False):
        paths = initialize_project(root / "book", name="Isolated Runtime")
        add_scene(paths, title="Opening", body="Primary")
        storyline = create_storyline(paths, name="Alternate", hypothesis="New point of view")
        update_scene(paths, scene_identifier="scene-0001", body="Alternate")
        switch_storyline(paths, primary=True)
        self.assertEqual(get_scene(paths, "scene-0001")["body"].strip(), "Primary")
        switch_storyline(paths, storyline["id"])
        self.assertEqual(get_scene(paths, "scene-0001")["body"].strip(), "Alternate")

  def test_missing_explicit_runtime_fails_instead_of_silently_using_system_git(self) -> None:
    with tempfile.TemporaryDirectory() as temporary:
      with patch.dict(os.environ, {"OPENAUTHOR_GIT_BIN": str(Path(temporary) / "missing-git")}):
        result = run_git(get_project_paths(Path(temporary)), ["--version"], check=False)
      self.assertNotEqual(result.returncode, 0)
