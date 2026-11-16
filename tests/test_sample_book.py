import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from openauthor.project import OpenAuthorError
from openauthor.sample_book import create_sample_book, suggest_project_root

REPO_ROOT = Path(__file__).resolve().parents[1]


class SampleBookTests(unittest.TestCase):
  def setUp(self) -> None:
    self._tmp = tempfile.TemporaryDirectory()
    self.base = Path(self._tmp.name).resolve()
    self._previous = os.environ.get("OPENAUTHOR_PROJECTS_DIR")
    os.environ["OPENAUTHOR_PROJECTS_DIR"] = str(self.base / "books")

  def tearDown(self) -> None:
    if self._previous is None:
      os.environ.pop("OPENAUTHOR_PROJECTS_DIR", None)
    else:
      os.environ["OPENAUTHOR_PROJECTS_DIR"] = self._previous
    self._tmp.cleanup()

  def _cli(self, cwd: Path, *args: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "PYTHONPATH": str(REPO_ROOT)}
    return subprocess.run([sys.executable, "-m", "openauthor", *args], cwd=cwd, env=env, capture_output=True, text=True)

  def test_suggested_folder_is_named_for_the_title_and_never_reuses_a_book(self) -> None:
    first = suggest_project_root('The Salt Road: "A Novel"/draft?')
    self.assertEqual(first, self.base / "books" / "The Salt Road A Novel draft")
    first.mkdir(parents=True)
    self.assertEqual(suggest_project_root('The Salt Road: "A Novel"/draft?'), first)
    (first / "notes.txt").write_text("already in use", encoding="utf-8")
    self.assertEqual(suggest_project_root('The Salt Road: "A Novel"/draft?').name, "The Salt Road A Novel draft 2")
    self.assertEqual(suggest_project_root(" ... ").name, "Untitled Novel")

  def test_sample_is_an_ordinary_book_with_a_change_set_and_a_planted_slip(self) -> None:
    from openauthor.canon import run_canon_diagnostics
    from openauthor.planning import get_plan
    from openauthor.proposals import apply_proposal, list_proposals, undo_proposal
    from openauthor.scenes import get_scene, list_scenes

    paths = create_sample_book(suggest_project_root("The Tide Clock (sample)"))
    scenes = list_scenes(paths)
    self.assertEqual([row["title"] for row in scenes], ["The Clock Runs Ahead", "The Early Tide", "What Odile Knew", "The Bell"])
    chapters = get_plan(paths)["acts"][0]["chapters"]
    self.assertEqual([chapter["scene_ids"] for chapter in chapters], [["scene-0001", "scene-0002"], ["scene-0003", "scene-0004"]])

    diagnostics = run_canon_diagnostics(paths)["diagnostics"]
    self.assertTrue(any("finger count" in str(row.get("message", "")) for row in diagnostics), diagnostics)

    [proposal] = list_proposals(paths)
    self.assertEqual(proposal["status"], "pending")
    self.assertEqual(len(proposal["change_set"]["hunks"]), 1)
    before = get_scene(paths, "scene-0002")["body"]
    apply_proposal(paths, proposal_id=proposal["id"])
    self.assertIn("counting as she went because counting steadied her", get_scene(paths, "scene-0002")["body"])
    undo_proposal(paths, proposal_id=proposal["id"])
    self.assertEqual(get_scene(paths, "scene-0002")["body"], before)

  def test_sample_refuses_a_folder_that_already_has_files(self) -> None:
    target = self.base / "occupied"
    target.mkdir()
    (target / "chapter-one.txt").write_text("Someone else's writing.", encoding="utf-8")
    with self.assertRaises(OpenAuthorError):
      create_sample_book(target)
    self.assertEqual(sorted(path.name for path in target.iterdir()), ["chapter-one.txt"])

  def test_cli_commands_work_before_any_book_exists(self) -> None:
    suggested = self._cli(self.base, "project", "suggest-root", "--name", "The Tide Clock (sample)", "--json")
    self.assertEqual(suggested.returncode, 0, suggested.stderr)
    target = json.loads(suggested.stdout)["path"]
    self.assertEqual(target, str(self.base / "books" / "The Tide Clock (sample)"))
    created = self._cli(self.base, "project", "sample", "--target", target, "--json")
    self.assertEqual(created.returncode, 0, created.stderr)
    row = json.loads(created.stdout)
    self.assertTrue(row["sample"])
    self.assertEqual(row["project_root"], target)
    again = self._cli(self.base, "project", "sample", "--target", target, "--json")
    self.assertNotEqual(again.returncode, 0)
    self.assertIn("already has files", again.stderr)
    self.assertNotIn("Traceback", again.stderr)


if __name__ == "__main__":
  unittest.main()
