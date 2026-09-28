from __future__ import annotations

import io
import json
import os
import re
import subprocess
import tempfile
import unittest
import zipfile
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from openauthor.cli import main


class OpenAuthorFlowTests(unittest.TestCase):
  def test_backup_cli_restores_from_outside_a_project(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      project = root / "original"
      project.mkdir()
      for args in (["init", str(project)], ["scene", "add", "--title", "Opening", "--body", "Portable words"], ["backup", "create", "--target", str(root / "novel.zip"), "--json"]):
        code, _, error = self.run_cli(args, project)
        self.assertEqual(code, 0, error)
      for args in (["backup", "verify", "--source", str(root / "novel.zip"), "--json"], ["backup", "restore", "--source", str(root / "novel.zip"), "--target", str(root / "restored"), "--json"]):
        code, out, error = self.run_cli(args, root)
        self.assertEqual(code, 0, error)
        self.assertTrue(json.loads(out)["verified"])
      code, out, error = self.run_cli(["scene", "get", "--id", "scene-0001", "--json"], root / "restored")
      self.assertEqual(code, 0, error)
      self.assertIn("Portable words", json.loads(out)["body"])

  def test_named_version_captures_prose_plan_and_story_memory(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      commands = [
        ["init", str(root)],
        ["scene", "add", "--title", "Opening", "--body", "Mara guards the gate."],
        ["plan", "brief", "--synopsis", "Original premise"],
        ["codex", "add", "--type", "character", "--name", "Mara", "--description", "Gatekeeper"],
        ["revision", "save", "--message", "Before the alternate ending", "--json"],
      ]
      for args in commands:
        code, out, err = self.run_cli(args, root)
        self.assertEqual(code, 0, err)
      version = json.loads(out)
      self.assertEqual(version["message"], "Before the alternate ending")
      self.assertEqual(version["kind"], "manual")
      self.assertIn("manuscript/structure.json", version["manifest"])
      self.assertIn("codex/codex.json", version["manifest"])
      self.assertTrue(any(path.startswith("manuscript/scenes/") for path in version["manifest"]))

  def test_manual_scene_saves_create_recoverable_versions(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      for args in [
        ["init", str(root)],
        ["scene", "add", "--title", "Opening", "--body", "First draft"],
        ["scene", "update", "--id", "scene-0001", "--body", "Second draft"],
        ["scene", "update", "--id", "scene-0001", "--body", "Third draft"],
      ]:
        code, out, err = self.run_cli(args, root)
        self.assertEqual(code, 0, err)
      code, out, err = self.run_cli(["revision", "list", "--json"], root)
      rows = json.loads(out)
      self.assertGreaterEqual(len(rows), 3)
      from openauthor.project import resolve_project
      from openauthor.revisions import get_revision, read_file_at_revision
      paths = resolve_project(root)
      versions = []
      for row in rows:
        for path in get_revision(paths, row["id"])["manifest"]:
          if path.startswith("manuscript/scenes/"):
            versions.append(read_file_at_revision(paths, row["id"], path))
      for prose in ("First draft", "Second draft", "Third draft"):
        self.assertTrue(any(prose in version for version in versions), prose)
      code, _, err = self.run_cli(["scene", "update", "--id", "scene-0001", "--body", "Third draft"], root)
      self.assertEqual(code, 0, err)
      _, unchanged, _ = self.run_cli(["revision", "list", "--json"], root)
      self.assertEqual([row["id"] for row in json.loads(unchanged)], [row["id"] for row in rows])

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

  def test_init_supports_explicit_project_id(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      project_root = root / "book-alpha"
      project_id = "project-explicit-001"

      code, out, err = self.run_cli(
        [
          "init",
          str(project_root),
          "--name",
          "Book Alpha",
          "--project-id",
          project_id,
          "--json",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      payload = json.loads(out)
      self.assertEqual(payload["project_id"], project_id)
      self.assertEqual(payload["name"], "Book Alpha")
      self.assertTrue(payload["initialized"])
      self.assertIsNone(payload["import_summary"])

  def test_init_from_zip_imports_scaffold_and_codex_snapshot(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      archive_input = root / "archive-input"
      archive_input.mkdir(parents=True, exist_ok=True)
      (archive_input / "scenes").mkdir(parents=True, exist_ok=True)
      (archive_input / "scenes" / "0001-opening.md").write_text(
        "---\n"
        "id: scene-0001\n"
        "title: Opening\n"
        "summary: Imported scene\n"
        "pov: Maia\n"
        "status: draft\n"
        "created_at: 2026-02-26T00:00:00+00:00\n"
        "updated_at: 2026-02-26T00:00:00+00:00\n"
        "---\n\n"
        "Imported manuscript body.\n",
        encoding="utf-8",
      )
      (archive_input / "codex").mkdir(parents=True, exist_ok=True)
      (archive_input / "codex" / "codex.json").write_text(
        json.dumps(
          {
            "entities": [
              {
                "id": "entity-hero",
                "type": "character",
                "name": "Maia",
                "description": "Imported protagonist.",
              }
            ],
            "relationships": [],
          }
        ),
        encoding="utf-8",
      )

      archive_path = root / "import-source.zip"
      with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for source in archive_input.rglob("*"):
          if not source.is_file():
            continue
          archive.write(source, source.relative_to(archive_input).as_posix())

      destination_root = root / "book-imported"
      code, out, err = self.run_cli(
        [
          "init",
          str(destination_root),
          "--name",
          "Imported Book",
          "--from-zip",
          str(archive_path),
          "--json",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      payload = json.loads(out)
      self.assertTrue(payload["initialized"])
      self.assertEqual(payload["name"], "Imported Book")
      self.assertEqual(payload["import_summary"]["mode"], "scaffold")
      self.assertTrue(payload["import_summary"]["imported"]["manuscript"])
      self.assertTrue(payload["import_summary"]["imported"]["codex_snapshot"])

      code, out, err = self.run_cli(["scene", "list", "--json"], destination_root)
      self.assertEqual(code, 0, msg=err)
      scene_rows = json.loads(out)
      self.assertEqual(scene_rows[0]["id"], "scene-0001")

      code, out, err = self.run_cli(["codex", "list", "--json"], destination_root)
      self.assertEqual(code, 0, msg=err)
      codex_rows = json.loads(out)
      self.assertTrue(any(row["name"] == "Maia" for row in codex_rows))

  def test_init_from_zip_imports_folder_codex_directories(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      archive_input = root / "archive-codex-folders"
      (archive_input / "characters").mkdir(parents=True, exist_ok=True)
      (archive_input / "locations").mkdir(parents=True, exist_ok=True)
      (archive_input / "lore").mkdir(parents=True, exist_ok=True)

      (archive_input / "characters" / "rowan.md").write_text(
        "Rowan is a former navigator with a scarred map memory.",
        encoding="utf-8",
      )
      (archive_input / "locations" / "glass-harbor.txt").write_text(
        "Glass Harbor is a storm-lit trade city built on mirrored cliffs.",
        encoding="utf-8",
      )
      (archive_input / "lore" / "customs.json").write_text(
        json.dumps(
          [
            {
              "name": "Ash Oath",
              "description": "An oath sworn over ceremonial ash before departures.",
            }
          ]
        ),
        encoding="utf-8",
      )

      archive_path = root / "import-codex-folders.zip"
      with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for source in archive_input.rglob("*"):
          if source.is_file():
            archive.write(source, source.relative_to(archive_input).as_posix())

      destination_root = root / "book-codex-import"
      code, out, err = self.run_cli(
        [
          "init",
          str(destination_root),
          "--name",
          "Folder Codex Import",
          "--from-zip",
          str(archive_path),
          "--json",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      payload = json.loads(out)
      self.assertTrue(payload["initialized"])
      self.assertTrue(payload["import_summary"]["imported"]["codex_folder"])
      self.assertGreaterEqual(payload["import_summary"]["imported"]["codex_folder_entities"], 3)

      code, out, err = self.run_cli(["codex", "list", "--json"], destination_root)
      self.assertEqual(code, 0, msg=err)
      codex_rows = json.loads(out)
      names = {row["name"] for row in codex_rows}
      self.assertIn("rowan", {name.lower() for name in names})
      self.assertIn("glass harbor", {name.lower() for name in names})
      self.assertIn("ash oath", {name.lower() for name in names})

  def test_init_from_zip_ignores_macosx_wrapper_folder(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      archive_path = root / "macosx-wrapper.zip"
      with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("__MACOSX/._test-book", "")
        archive.writestr(
          "test-book/characters/rowan.md",
          "Rowan is a former navigator with a scarred map memory.\n",
        )
        archive.writestr(
          "test-book/locations/glass-harbor.txt",
          "Glass Harbor is a storm-lit trade city built on mirrored cliffs.\n",
        )

      destination_root = root / "book-codex-import-macosx"
      code, out, err = self.run_cli(
        [
          "init",
          str(destination_root),
          "--name",
          "Folder Codex Import",
          "--from-zip",
          str(archive_path),
          "--json",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      payload = json.loads(out)
      self.assertTrue(payload["initialized"])
      self.assertTrue(payload["import_summary"]["imported"]["codex_folder"])
      self.assertGreaterEqual(payload["import_summary"]["imported"]["codex_folder_entities"], 2)

      code, out, err = self.run_cli(["codex", "list", "--json"], destination_root)
      self.assertEqual(code, 0, msg=err)
      codex_rows = json.loads(out)
      names = {row["name"].lower() for row in codex_rows}
      self.assertIn("rowan", names)
      self.assertIn("glass harbor", names)

  def test_init_from_folder_imports_in_place(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      source = root / "folder-source"
      source.mkdir(parents=True, exist_ok=True)
      (source / "scenes").mkdir(parents=True, exist_ok=True)
      (source / "scenes" / "0001-arrival.md").write_text(
        "---\n"
        "id: scene-0001\n"
        "title: Arrival\n"
        "summary: Imported from folder\n"
        "pov: Rowan\n"
        "status: draft\n"
        "created_at: 2026-02-26T00:00:00+00:00\n"
        "updated_at: 2026-02-26T00:00:00+00:00\n"
        "---\n\n"
        "Arrival scene body.\n",
        encoding="utf-8",
      )

      code, out, err = self.run_cli(
        [
          "init",
          str(source),
          "--name",
          "Folder Imported",
          "--from-folder",
          str(source),
          "--json",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      payload = json.loads(out)
      self.assertTrue(payload["initialized"])
      self.assertEqual(payload["name"], "Folder Imported")
      self.assertEqual(payload["import_summary"]["mode"], "scaffold")
      self.assertTrue(payload["import_summary"]["imported"]["manuscript"])

      code, out, err = self.run_cli(["scene", "list", "--json"], source)
      self.assertEqual(code, 0, msg=err)
      scene_rows = json.loads(out)
      self.assertEqual(scene_rows[0]["id"], "scene-0001")

  def test_init_scene_codex_proposal_flow(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)

      code, out, err = self.run_cli(["init", "--name", "Demo"], root)
      self.assertEqual(code, 0, msg=err)
      self.assertIn("Initialized openAuthor project", out)
      self.assertTrue((root / ".openauthor" / "project.json").exists())
      self.assertTrue((root / "codex" / "codex.sqlite3").exists())

      code, out, err = self.run_cli(["project", "inspect", "--json"], root)
      self.assertEqual(code, 0, msg=err)
      project_metadata = json.loads(out)
      self.assertIn("project_id", project_metadata)
      self.assertEqual(project_metadata["name"], "Demo")

      code, out, err = self.run_cli(
        [
          "project",
          "ensure-id",
          "--id",
          project_metadata["project_id"],
          "--json",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      ensured = json.loads(out)
      self.assertEqual(ensured["project_id"], project_metadata["project_id"])

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
        ["scene", "add", "--title", "Second Scene", "--body", "A second scene.", "--json"],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      created_scene = json.loads(out)
      self.assertEqual(created_scene["id"], "scene-0002")
      self.assertEqual(created_scene["title"], "Second Scene")
      self.assertEqual(created_scene["body"], "A second scene.\n")

      code, out, err = self.run_cli(
        [
          "scene",
          "update",
          "--id",
          "scene-0001",
          "--summary",
          "Opening is now tightened",
            "--body",
            "An initial, very slow opening paragraph, but Elara keeps moving.",
          "--json",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      updated = json.loads(out)
      self.assertEqual(updated["summary"], "Opening is now tightened")
      self.assertIn("Elara keeps moving.", updated["body"])

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
      run_summary = next(row for row in generation_rows if row["run_id"] == run_id)
      self.assertIn("quality_score", run_summary)
      self.assertIn("quality_tier", run_summary)
      self.assertIn("quality_flags", run_summary)
      self.assertIn("preferred_for_scene", run_summary)
      self.assertFalse(run_summary["preferred_for_scene"])

      code, out, err = self.run_cli(
        ["generation", "list", "--quality", run_summary["quality_tier"], "--json"],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      quality_filtered_rows = json.loads(out)
      self.assertTrue(any(row["run_id"] == run_id for row in quality_filtered_rows))

      code, out, err = self.run_cli(["generation", "get", "--id", run_id, "--json"], root)
      self.assertEqual(code, 0, msg=err)
      generation_run = json.loads(out)
      self.assertEqual(generation_run["run_id"], run_id)
      self.assertEqual(generation_run["status"], "succeeded")
      self.assertEqual(generation_run["proposal_id"], generated_proposal["id"])
      self.assertEqual(generation_run["temperature"], 0.2)
      self.assertEqual(generation_run["max_output_tokens"], 700)
      self.assertEqual(generation_run["context_scene_radius"], 1)
      self.assertEqual(generation_run["codex_limit"], 20)
      self.assertFalse(generation_run["preferred_for_scene"])

      code, out, err = self.run_cli(
        ["generation", "pin", "--scene", "scene-0001", "--run", run_id, "--json"],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      pin_row = json.loads(out)
      self.assertEqual(pin_row, {"scene_id": "scene-0001", "run_id": run_id})

      code, out, err = self.run_cli(["generation", "pins", "--json"], root)
      self.assertEqual(code, 0, msg=err)
      pin_rows = json.loads(out)
      self.assertEqual(pin_rows, [{"scene_id": "scene-0001", "run_id": run_id}])

      code, out, err = self.run_cli(["generation", "get", "--id", run_id, "--json"], root)
      self.assertEqual(code, 0, msg=err)
      pinned_run = json.loads(out)
      self.assertTrue(pinned_run["preferred_for_scene"])

      code, out, err = self.run_cli(["generation", "rerun", "--id", run_id, "--json"], root)
      self.assertEqual(code, 0, msg=err)
      rerun_proposal = json.loads(out)
      self.assertEqual(rerun_proposal["scene_id"], "scene-0001")
      self.assertEqual(rerun_proposal["source"], "ai_generate")
      self.assertNotEqual(rerun_proposal["id"], generated_proposal["id"])
      self.assertNotEqual(
        rerun_proposal["generation"]["id"], generated_proposal["generation"]["id"]
      )

      code, out, err = self.run_cli(["generation", "unpin", "--scene", "scene-0001", "--json"], root)
      self.assertEqual(code, 0, msg=err)
      unpin_row = json.loads(out)
      self.assertTrue(unpin_row["cleared"])
      self.assertEqual(unpin_row["scene_id"], "scene-0001")

      code, out, err = self.run_cli(
        ["generation", "pins", "--scene", "scene-0001", "--json"],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      self.assertEqual(json.loads(out), [])

      code, out, err = self.run_cli(["generation", "config", "--json"], root)
      self.assertEqual(code, 0, msg=err)
      generation_config = json.loads(out)
      self.assertIn("retry", generation_config)
      self.assertIn("providers", generation_config)
      self.assertIn("openai", generation_config["providers"])
      self.assertIn("budget", generation_config)

      code, out, err = self.run_cli(["generation", "budget", "--json"], root)
      self.assertEqual(code, 0, msg=err)
      budget_report = json.loads(out)
      self.assertIn("policy", budget_report)
      self.assertIn("usage", budget_report)

      code, out, err = self.run_cli(
        [
          "generation",
          "budget",
          "--max-output-tokens",
          "700",
          "--daily-tokens",
          "200000",
          "--json",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      updated_budget = json.loads(out)
      self.assertEqual(updated_budget["policy"]["per_run"]["max_output_tokens"], 700)
      self.assertEqual(updated_budget["policy"]["rolling"]["daily_tokens"], 200000)

      code, out, err = self.run_cli(
        [
          "proposal", "draft", "--id", proposal_id, "--provider", "local",
          "--max-output-tokens", "700", "--json",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      self.assertTrue(json.loads(out)["proposed_body"].strip())

      code, out, err = self.run_cli(["proposal", "apply", "--id", proposal_id], root)
      self.assertEqual(code, 0, msg=err)
      self.assertIn(f"Applied proposal {proposal_id}", out)

      code, out, err = self.run_cli(["proposal", "undo", "--id", proposal_id, "--json"], root)
      self.assertEqual(code, 0, msg=err)
      self.assertTrue(json.loads(out)["undo_revision"])

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

  def test_generation_stale_pin_cleanup_and_unpin_idempotency(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      code, _, err = self.run_cli(["init", "--name", "Stale Pin"], root)
      self.assertEqual(code, 0, msg=err)

      code, _, err = self.run_cli(
        [
          "scene",
          "add",
          "--title",
          "Pin Scene",
          "--summary",
          "pin flow",
          "--pov",
          "narrator",
          "--body",
          "Scene body for generation pin cleanup checks.",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)

      code, out, err = self.run_cli(
        [
          "proposal",
          "generate",
          "--scene",
          "scene-0001",
          "--instruction",
          "tighten pacing",
          "--provider",
          "local",
          "--json",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      proposal = json.loads(out)
      run_id = proposal["generation"]["id"]

      code, _, err = self.run_cli(
        ["generation", "pin", "--scene", "scene-0001", "--run", run_id, "--json"],
        root,
      )
      self.assertEqual(code, 0, msg=err)

      generation_log_path = root / ".openauthor" / "generations" / f"{run_id}.json"
      generation_log_path.unlink()

      code, _, err = self.run_cli(["generation", "get", "--id", run_id, "--json"], root)
      self.assertNotEqual(code, 0)
      self.assertIn("unknown generation run id", err.lower())

      code, out, err = self.run_cli(
        ["generation", "unpin", "--scene", "scene-0001", "--json"],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      first_unpin = json.loads(out)
      self.assertTrue(first_unpin["cleared"])
      self.assertEqual(first_unpin["run_id"], run_id)

      code, out, err = self.run_cli(
        ["generation", "unpin", "--scene", "scene-0001", "--json"],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      second_unpin = json.loads(out)
      self.assertFalse(second_unpin["cleared"])
      self.assertEqual(second_unpin["run_id"], "")

  def test_branch_workspace_flow_with_diff_and_preflight(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      code, _, err = self.run_cli(["init", "--name", "Branch Demo"], root)
      self.assertEqual(code, 0, msg=err)

      code, _, err = self.run_cli(
        [
          "scene",
          "add",
          "--title",
          "Branch Scene",
          "--summary",
          "branch testing",
          "--pov",
          "narrator",
          "--body",
          "Initial branch scene body for branch flow checks.",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      code, _, err = self.run_cli(
        ["snapshot", "create", "-m", "baseline snapshot"],
        root,
      )
      self.assertEqual(code, 0, msg=err)

      code, out, err = self.run_cli(["branch", "list", "--json"], root)
      self.assertEqual(code, 0, msg=err)
      branch_rows = json.loads(out)
      current_row = next(row for row in branch_rows if row["current"])
      base_branch = current_row["name"]

      code, out, err = self.run_cli(
        ["branch", "create", "--name", "exp-one", "--json"],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      created_one = json.loads(out)
      self.assertEqual(created_one["name"], "exp-one")
      self.assertTrue(created_one["current"])

      code, _, err = self.run_cli(
        [
          "scene",
          "update",
          "--id",
          "scene-0001",
          "--body",
          "Branch one edits scene body for overlap checks.",
          "--json",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      code, _, err = self.run_cli(
        ["snapshot", "create", "-m", "exp-one scene edit"],
        root,
      )
      self.assertEqual(code, 0, msg=err)

      code, _, err = self.run_cli(
        ["branch", "switch", "--name", base_branch, "--json"],
        root,
      )
      self.assertEqual(code, 0, msg=err)

      code, out, err = self.run_cli(
        ["branch", "create", "--name", "exp-two", "--from", base_branch, "--json"],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      created_two = json.loads(out)
      self.assertEqual(created_two["name"], "exp-two")
      self.assertTrue(created_two["current"])

      code, _, err = self.run_cli(
        [
          "scene",
          "update",
          "--id",
          "scene-0001",
          "--body",
          "Branch two also edits scene body for conflict preflight.",
          "--json",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      code, _, err = self.run_cli(
        ["snapshot", "create", "-m", "exp-two scene edit"],
        root,
      )
      self.assertEqual(code, 0, msg=err)

      code, out, err = self.run_cli(
        ["branch", "diff", "--base", base_branch, "--head", "exp-one", "--json"],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      diff_row = json.loads(out)
      self.assertEqual(diff_row["base"], base_branch)
      self.assertEqual(diff_row["head"], "exp-one")
      self.assertTrue(any(item["path"].startswith("manuscript/scenes/") for item in diff_row["files"]))

      code, out, err = self.run_cli(
        ["branch", "preflight", "--base", "exp-one", "--head", "exp-two", "--json"],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      preflight = json.loads(out)
      self.assertFalse(preflight["safe_to_merge"])
      self.assertEqual(preflight["risk_level"], "high")
      self.assertGreaterEqual(len(preflight["overlap_by_category"]["scene"]), 1)

      code, _, err = self.run_cli(
        ["branch", "merge", "--base", "exp-one", "--head", "exp-two", "--json"],
        root,
      )
      self.assertNotEqual(code, 0)
      self.assertIn("aborted", err.lower())

      code, _, err = self.run_cli(
        ["branch", "switch", "--name", base_branch, "--json"],
        root,
      )
      self.assertEqual(code, 0, msg=err)

      code, _, err = self.run_cli(
        ["branch", "create", "--name", "exp-clean", "--from", base_branch, "--json"],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      code, _, err = self.run_cli(
        [
          "scene",
          "add",
          "--title",
          "Branch Clean Scene",
          "--summary",
          "clean merge path",
          "--pov",
          "narrator",
          "--body",
          "New scene only on clean branch.",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      code, _, err = self.run_cli(
        ["snapshot", "create", "-m", "exp-clean adds new scene"],
        root,
      )
      self.assertEqual(code, 0, msg=err)

      code, out, err = self.run_cli(
        ["branch", "preflight", "--base", base_branch, "--head", "exp-clean", "--json"],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      preflight_clean = json.loads(out)
      self.assertTrue(preflight_clean["safe_to_merge"])
      self.assertEqual(preflight_clean["risk_level"], "low")

      code, out, err = self.run_cli(
        ["branch", "merge", "--base", base_branch, "--head", "exp-clean", "--json"],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      merge_row = json.loads(out)
      self.assertTrue(merge_row["merged"])
      self.assertEqual(merge_row["base"], base_branch)
      self.assertEqual(merge_row["head"], "exp-clean")
      self.assertTrue(merge_row["merge_commit"])

      scene_file = next((root / "manuscript" / "scenes").glob("*.md"))
      scene_file.write_text(
        scene_file.read_text(encoding="utf-8") + "\nUncommitted line.\n",
        encoding="utf-8",
      )
      code, _, err = self.run_cli(["branch", "switch", "--name", base_branch], root)
      self.assertNotEqual(code, 0)
      self.assertIn("uncommitted changes", err.lower())

  def test_branch_switch_resyncs_codex_runtime(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      code, _, err = self.run_cli(["init", "--name", "Codex Branch Sync"], root)
      self.assertEqual(code, 0, msg=err)

      code, _, err = self.run_cli(
        [
          "codex",
          "add",
          "--type",
          "character",
          "--name",
          "Mainline Character",
          "--description",
          "Entity on base branch.",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      code, _, err = self.run_cli(
        ["snapshot", "create", "-m", "baseline codex entity"],
        root,
      )
      self.assertEqual(code, 0, msg=err)

      code, out, err = self.run_cli(["branch", "list", "--json"], root)
      self.assertEqual(code, 0, msg=err)
      base_branch = next(row["name"] for row in json.loads(out) if row["current"])

      code, _, err = self.run_cli(
        ["branch", "create", "--name", "exp-codex", "--json"],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      code, _, err = self.run_cli(
        [
          "codex",
          "add",
          "--type",
          "item",
          "--name",
          "Branch Relic",
          "--description",
          "Entity only on exp-codex branch.",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      code, _, err = self.run_cli(
        ["snapshot", "create", "-m", "exp codex entity"],
        root,
      )
      self.assertEqual(code, 0, msg=err)

      code, out, err = self.run_cli(["codex", "list", "--json"], root)
      self.assertEqual(code, 0, msg=err)
      exp_names = {row["name"] for row in json.loads(out)}
      self.assertIn("Branch Relic", exp_names)
      self.assertIn("Mainline Character", exp_names)

      code, _, err = self.run_cli(
        ["branch", "switch", "--name", base_branch, "--json"],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      code, out, err = self.run_cli(["codex", "list", "--json"], root)
      self.assertEqual(code, 0, msg=err)
      base_names = {row["name"] for row in json.loads(out)}
      self.assertIn("Mainline Character", base_names)
      self.assertNotIn("Branch Relic", base_names)

  def test_branch_switch_ignores_workspace_artifact_changes(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      code, _, err = self.run_cli(["init", "--name", "Branch Workspace Scope"], root)
      self.assertEqual(code, 0, msg=err)
      code, _, err = self.run_cli(
        [
          "scene",
          "add",
          "--title",
          "Scope Scene",
          "--summary",
          "scope test",
          "--body",
          "Initial body",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      code, _, err = self.run_cli(["snapshot", "create", "-m", "baseline"], root)
      self.assertEqual(code, 0, msg=err)

      code, out, err = self.run_cli(["branch", "list", "--json"], root)
      self.assertEqual(code, 0, msg=err)
      base_branch = next(row["name"] for row in json.loads(out) if row["current"])
      code, _, err = self.run_cli(
        ["branch", "create", "--name", "exp-workspace", "--json"],
        root,
      )
      self.assertEqual(code, 0, msg=err)

      code, _, err = self.run_cli(
        [
          "proposal",
          "add",
          "--title",
          "Workspace Only",
          "--instruction",
          "Do not block branch switch",
          "--scene",
          "scene-0001",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)

      code, _, err = self.run_cli(["branch", "switch", "--name", base_branch], root)
      self.assertEqual(code, 0, msg=err)

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
      self.assertTrue((root / ".openauthor" / "generation_budget_policy.json").exists())

  def test_retrieval_cli_flow(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      code, _, err = self.run_cli(["init", "--name", "Retrieval CLI"], root)
      self.assertEqual(code, 0, msg=err)

      code, _, err = self.run_cli(
        [
          "scene",
          "add",
          "--title",
          "Signal Vault",
          "--summary",
          "Crack the hidden signal key.",
          "--pov",
          "Neris",
          "--body",
          (
            "Neris mapped the ember cipher and tracked vault routes "
            "through the signal archive."
          ),
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)

      code, _, err = self.run_cli(
        [
          "codex",
          "add",
          "--type",
          "item",
          "--name",
          "Signal Key",
          "--description",
          "Reference key for archive routes.",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)

      code, out, err = self.run_cli(["retrieval", "status", "--json"], root)
      self.assertEqual(code, 0, msg=err)
      status_before = json.loads(out)
      self.assertFalse(status_before["present"])

      code, out, err = self.run_cli(
        [
          "retrieval",
          "build",
          "--chunk-words",
          "60",
          "--overlap-words",
          "10",
          "--json",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      build_row = json.loads(out)
      self.assertTrue(build_row["present"])
      self.assertFalse(build_row["stale"])
      self.assertGreaterEqual(build_row["source_count"], 2)
      self.assertGreaterEqual(build_row["chunk_count"], 2)

      code, out, err = self.run_cli(
        [
          "retrieval",
          "query",
          "--text",
          "ember cipher vault routes",
          "--limit",
          "2",
          "--json",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      query_row = json.loads(out)
      self.assertEqual(query_row["result_count"], 2)
      self.assertTrue(
        any(result["source_ref"] == "scene-0001" for result in query_row["results"])
      )

      code, out, err = self.run_cli(
        [
          "proposal",
          "generate",
          "--scene",
          "scene-0001",
          "--instruction",
          "tighten ember cipher logic and route clarity",
          "--provider",
          "local",
          "--retrieval-mode",
          "required",
          "--retrieval-limit",
          "3",
          "--json",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      generated = json.loads(out)
      self.assertEqual(generated["generation"]["retrieval"]["mode"], "required")
      self.assertGreaterEqual(generated["generation"]["retrieval"]["result_count"], 1)

      code, _, err = self.run_cli(
        [
          "scene",
          "update",
          "--id",
          "scene-0001",
          "--summary",
          "Summary changed post-index",
          "--json",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)

      code, out, err = self.run_cli(["retrieval", "status", "--json"], root)
      self.assertEqual(code, 0, msg=err)
      status_after = json.loads(out)
      self.assertTrue(status_after["stale"])
      self.assertIn("source_digest_changed", status_after["stale_reasons"])

      code, _, err = self.run_cli(
        [
          "retrieval",
          "query",
          "--text",
          "ember cipher",
          "--require-fresh",
          "--json",
        ],
        root,
      )
      self.assertNotEqual(code, 0)
      self.assertIn("stale", err.lower())

  def test_check_workspace_and_performance_cli_flow(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      code, _, err = self.run_cli(["init", "--name", "Hardening CLI"], root)
      self.assertEqual(code, 0, msg=err)

      code, _, err = self.run_cli(
        [
          "scene",
          "add",
          "--title",
          "Hardening Scene",
          "--summary",
          "hardening setup",
          "--pov",
          "narrator",
          "--body",
          "Scene body for workspace audit + performance CLI checks.",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)

      code, out, err = self.run_cli(["check", "workspace", "--json"], root)
      self.assertEqual(code, 0, msg=err)
      workspace_report = json.loads(out)
      self.assertIn("issues", workspace_report)
      self.assertIn("retrieval", workspace_report)
      self.assertIn("generation_pins", workspace_report)

      code, out, err = self.run_cli(
        ["check", "performance", "--repeat", "2", "--json"],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      perf_report = json.loads(out)
      self.assertEqual(perf_report["repeat"], 2)
      metric_names = {row["name"] for row in perf_report["metrics"]}
      self.assertIn("scene_list", metric_names)
      self.assertIn("proposal_list", metric_names)
      self.assertIn("generation_list", metric_names)
      self.assertIn("retrieval_status", metric_names)

  def test_chat_cli_flow(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      code, _, err = self.run_cli(["init", "--name", "Chat CLI"], root)
      self.assertEqual(code, 0, msg=err)

      code, _, err = self.run_cli(
        [
          "scene",
          "add",
          "--title",
          "Chat Scene",
          "--summary",
          "chat setup",
          "--pov",
          "narrator",
          "--body",
          "Scene body for chat command testing.",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      code, _, err = self.run_cli(
        [
          "scene",
          "add",
          "--title",
          "Chat Scene Two",
          "--summary",
          "chat setup two",
          "--pov",
          "narrator",
          "--body",
          "Second scene body for explicit scene mentions.",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)

      code, out, err = self.run_cli(
        [
          "chat",
          "thread",
          "create",
          "--title",
          "General Chat",
          "--provider",
          "local",
          "--mode",
          "agent",
          "--json",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      thread = json.loads(out)
      self.assertEqual(thread["title"], "General Chat")
      thread_id = thread["id"]

      code, out, err = self.run_cli(
        [
          "chat",
          "send",
          "--thread",
          thread_id,
          "--message",
          "please list scenes",
          "--current-scene",
          "scene-0001",
          "--scene-id",
          "scene-0002",
          "--json",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      send_result = json.loads(out)
      self.assertIn("assistant_message", send_result)
      self.assertIn("pending_tool_calls", send_result)
      self.assertEqual(
        send_result["user_message"]["context_used"]["scene_ids"],
        ["scene-0001", "scene-0002"],
      )

      code, out, err = self.run_cli(
        ["chat", "message", "list", "--thread", thread_id, "--json"],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      rows = json.loads(out)
      self.assertTrue(any(row["role"] == "assistant" for row in rows))
      self.assertTrue(any(row["role"] == "tool" for row in rows))

  def test_merge_conflict_scan_resolve_and_guided_merge(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      code, _, err = self.run_cli(["init", "--name", "Conflict Demo"], root)
      self.assertEqual(code, 0, msg=err)
      code, _, err = self.run_cli(
        [
          "scene", "add",
          "--title", "Vault",
          "--summary", "heist",
          "--pov", "Elara",
          "--body", "Elara studied the vault door.",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      code, _, err = self.run_cli(["snapshot", "create", "-m", "seed"], root)
      self.assertEqual(code, 0, msg=err)

      code, out, err = self.run_cli(["branch", "list", "--json"], root)
      self.assertEqual(code, 0, msg=err)
      base_branch = next(row for row in json.loads(out) if row["current"])["name"]

      code, _, err = self.run_cli(
        ["branch", "create", "--name", "storyline-b", "--json"], root
      )
      self.assertEqual(code, 0, msg=err)
      code, _, err = self.run_cli(
        ["scene", "update", "--id", "scene-0001", "--body", "She chose betrayal."],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      code, _, err = self.run_cli(["snapshot", "create", "-m", "storyline b"], root)
      self.assertEqual(code, 0, msg=err)
      code, _, err = self.run_cli(
        ["branch", "switch", "--name", base_branch, "--json"], root
      )
      self.assertEqual(code, 0, msg=err)
      code, _, err = self.run_cli(
        ["scene", "update", "--id", "scene-0001", "--body", "She chose loyalty."],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      code, _, err = self.run_cli(["snapshot", "create", "-m", "base revision"], root)
      self.assertEqual(code, 0, msg=err)

      code, out, err = self.run_cli(
        ["branch", "conflicts", "--base", base_branch, "--head", "storyline-b", "--json"],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      scan = json.loads(out)
      self.assertEqual(scan["conflict_count"], 1)
      conflict = scan["conflicts"][0]
      self.assertEqual(conflict["category"], "scene")
      self.assertIn("loyalty", conflict["ours_text"])
      self.assertIn("betrayal", conflict["theirs_text"])

      code, _, err = self.run_cli(
        ["branch", "merge", "--base", base_branch, "--head", "storyline-b"],
        root,
      )
      self.assertNotEqual(code, 0)
      self.assertIn("aborted", err.lower())

      code, out, err = self.run_cli(
        [
          "branch", "resolve",
          "--base", base_branch,
          "--head", "storyline-b",
          "--path", conflict["path"],
          "--provider", "local",
          "--json",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      resolution = json.loads(out)
      self.assertEqual(resolution["source"], "merge_resolution")
      self.assertIn("loyalty", resolution["proposed_body"])
      self.assertIn("betrayal", resolution["proposed_body"])
      self.assertEqual(resolution["merge"]["path"], conflict["path"])

      code, out, err = self.run_cli(
        [
          "branch", "merge",
          "--base", base_branch,
          "--head", "storyline-b",
          "--resolution", resolution["id"],
          "--json",
        ],
        root,
      )
      self.assertEqual(code, 0, msg=err)
      merged = json.loads(out)
      self.assertTrue(merged["merged"])
      self.assertEqual(merged["resolved_paths"], [conflict["path"]])
      self.assertEqual(merged["applied_resolutions"], [resolution["id"]])

      code, out, err = self.run_cli(["scene", "get", "--id", "scene-0001", "--json"], root)
      self.assertEqual(code, 0, msg=err)
      body = json.loads(out)["body"]
      self.assertIn("loyalty", body)
      self.assertIn("betrayal", body)

      code, out, err = self.run_cli(
        ["proposal", "get", "--id", resolution["id"], "--json"], root
      )
      self.assertEqual(code, 0, msg=err)
      self.assertEqual(json.loads(out)["status"], "applied")


if __name__ == "__main__":
  unittest.main()
