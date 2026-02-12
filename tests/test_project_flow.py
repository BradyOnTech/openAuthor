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


if __name__ == "__main__":
  unittest.main()
