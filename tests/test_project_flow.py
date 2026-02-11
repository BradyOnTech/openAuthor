from __future__ import annotations

import io
import json
import os
import re
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from openauthor.cli import main


class OpenAuthorFlowTests(unittest.TestCase):
  def run_cli(self, argv: list[str], cwd: Path) -> tuple[int, str, str]:
    old_cwd = Path.cwd()
    stdout = io.StringIO()
    stderr = io.StringIO()
    try:
      os.chdir(cwd)
      with redirect_stdout(stdout), redirect_stderr(stderr):
        code = main(argv)
    finally:
      os.chdir(old_cwd)
    return code, stdout.getvalue(), stderr.getvalue()

  def test_init_scene_codex_proposal_flow(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)

      code, out, err = self.run_cli(["init", "--name", "Demo"], root)
      self.assertEqual(code, 0, msg=err)
      self.assertIn("Initialized openAuthor project", out)
      self.assertTrue((root / ".openauthor" / "project.json").exists())
      self.assertTrue((root / "codex" / "codex.sqlite3").exists())

      code, out, err = self.run_cli(
        [
          "scene",
          "add",
          "--title",
          "Opening Scene",
          "--summary",
          "Introduce main character",
          "--pov",
          "Elara",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      self.assertIn("Created scene manuscript/scenes/0001-opening-scene.md", out)

      code, out, err = self.run_cli(["scene", "list"], root)
      self.assertEqual(code, 0, msg=err)
      self.assertIn("scene-0001", out)
      self.assertIn("Opening Scene", out)

      code, out, err = self.run_cli(["scene", "list", "--json"], root)
      self.assertEqual(code, 0, msg=err)
      scene_rows = json.loads(out)
      self.assertEqual(scene_rows[0]["id"], "scene-0001")
      self.assertIn("summary", scene_rows[0])
      self.assertIn("pov", scene_rows[0])
      self.assertIn("updated_at", scene_rows[0])

      code, out, err = self.run_cli(["scene", "get", "--id", "scene-0001", "--json"], root)
      self.assertEqual(code, 0, msg=err)
      scene = json.loads(out)
      self.assertEqual(scene["id"], "scene-0001")
      self.assertEqual(scene["title"], "Opening Scene")

      code, out, err = self.run_cli(
        [
          "scene",
          "update",
          "--id",
          "scene-0001",
          "--summary",
          "Opening is now tightened",
          "--body",
          "A tighter opening paragraph.",
          "--json",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      updated = json.loads(out)
      self.assertEqual(updated["summary"], "Opening is now tightened")
      self.assertIn("A tighter opening paragraph.", updated["body"])

      code, out, err = self.run_cli(
        [
          "codex",
          "add",
          "--type",
          "character",
          "--name",
          "Elara",
          "--description",
          "The protagonist.",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      self.assertIn("Created entity entity-", out)

      code, out, err = self.run_cli(["codex", "list", "--type", "character"], root)
      self.assertEqual(code, 0, msg=err)
      self.assertIn("character", out)
      self.assertIn("Elara", out)

      code, out, err = self.run_cli(["codex", "list", "--json"], root)
      self.assertEqual(code, 0, msg=err)
      codex_rows = json.loads(out)
      self.assertTrue(any(row["name"] == "Elara" for row in codex_rows))
      elara = next(row for row in codex_rows if row["name"] == "Elara")

      code, out, err = self.run_cli(["codex", "get", "--id", elara["id"], "--json"], root)
      self.assertEqual(code, 0, msg=err)
      codex_entity = json.loads(out)
      self.assertEqual(codex_entity["name"], "Elara")

      code, out, err = self.run_cli(
        [
          "codex",
          "update",
          "--id",
          elara["id"],
          "--description",
          "Updated protagonist profile.",
          "--json",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      updated_entity = json.loads(out)
      self.assertEqual(updated_entity["description"], "Updated protagonist profile.")

      code, out, err = self.run_cli(["check", "continuity", "--json"], root)
      self.assertEqual(code, 0, msg=err)
      continuity_rows = json.loads(out)
      self.assertTrue(any(row["code"] == "scene_body_short" for row in continuity_rows))

      code, out, err = self.run_cli(
        [
          "proposal",
          "add",
          "--title",
          "Tighten opening",
          "--instruction",
          "Make the opening paragraph more immediate.",
          "--scene",
          "scene-0001",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      match = re.search(r"(proposal-[a-z0-9]+)", out)
      self.assertIsNotNone(match)
      proposal_id = match.group(1)  # type: ignore[union-attr]

      code, out, err = self.run_cli(
        [
          "proposal",
          "generate",
          "--scene",
          "scene-0001",
          "--instruction",
          "Tighten scene rhythm while preserving voice.",
          "--provider",
          "local",
          "--json",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      generated_proposal = json.loads(out)
      self.assertEqual(generated_proposal["scene_id"], "scene-0001")
      self.assertEqual(generated_proposal["source"], "ai_generate")
      self.assertEqual(generated_proposal["generation"]["provider"], "local")
      self.assertTrue((root / generated_proposal["generation"]["log_path"]).exists())
      run_id = generated_proposal["generation"]["id"]

      code, out, err = self.run_cli(["generation", "list", "--json"], root)
      self.assertEqual(code, 0, msg=err)
      generation_rows = json.loads(out)
      self.assertTrue(any(row["run_id"] == run_id for row in generation_rows))

      code, out, err = self.run_cli(["generation", "get", "--id", run_id, "--json"], root)
      self.assertEqual(code, 0, msg=err)
      generation_run = json.loads(out)
      self.assertEqual(generation_run["run_id"], run_id)
      self.assertEqual(generation_run["status"], "succeeded")
      self.assertEqual(generation_run["proposal_id"], generated_proposal["id"])

      code, out, err = self.run_cli(["proposal", "apply", "--id", proposal_id], root)
      self.assertEqual(code, 0, msg=err)
      self.assertIn(f"Applied proposal {proposal_id}", out)

      code, out, err = self.run_cli(["proposal", "list", "--status", "applied"], root)
      self.assertEqual(code, 0, msg=err)
      self.assertIn(proposal_id, out)

      code, out, err = self.run_cli(["proposal", "get", "--id", proposal_id, "--json"], root)
      self.assertEqual(code, 0, msg=err)
      proposal = json.loads(out)
      self.assertEqual(proposal["id"], proposal_id)
      self.assertEqual(proposal["status"], "applied")

      code, out, err = self.run_cli(["proposal", "list", "--json"], root)
      self.assertEqual(code, 0, msg=err)
      proposals = json.loads(out)
      self.assertTrue(any(item["id"] == proposal_id for item in proposals))

  def test_snapshot_flow(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      code, _, err = self.run_cli(["init", "--name", "Snapshot Demo"], root)
      self.assertEqual(code, 0, msg=err)

      code, _, err = self.run_cli(
        ["scene", "add", "--title", "Snapshot Scene", "--summary", "snapshot test"],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      (root / "notes.txt").write_text("do not snapshot me\n", encoding="utf-8")

      code, out, err = self.run_cli(
        ["snapshot", "create", "-m", "Create first scene snapshot"],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      self.assertTrue("snapshot" in out.lower() or "files changed" in out.lower())

      code, out, err = self.run_cli(["snapshot", "log", "--limit", "1"], root)
      self.assertEqual(code, 0, msg=err)
      self.assertIn("Create first scene snapshot", out)

      status = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
      ).stdout
      self.assertIn("?? notes.txt", status)
      self.assertTrue((root / "codex" / "codex.json").exists())
      self.assertTrue((root / ".openauthor" / "provider_pricing.json").exists())


if __name__ == "__main__":
  unittest.main()
