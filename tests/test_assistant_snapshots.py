from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from openauthor.assistant.snapshots import (
  MobileSnapshotPolicy,
  load_mobile_snapshot,
  project_mobile_snapshot,
  write_mobile_snapshot_staging,
)
from openauthor.codex import add_entity
from openauthor.project import initialize_project
from openauthor.revisions import create_revision
from openauthor.scenes import add_scene


class AssistantSnapshotTests(unittest.TestCase):
  def test_projection_rejects_a_project_without_a_revision_anchor(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(
        Path(tmp),
        name="Unversioned Novel",
        project_id="project-unversioned",
      )
      add_scene(paths, title="Opening", body="An unversioned opening.")

      with self.assertRaisesRegex(RuntimeError, "revision anchor"):
        project_mobile_snapshot(
          paths,
          selected_project_id="project-unversioned",
        )

  def test_projection_is_canonical_and_deterministic_for_same_revision_and_content(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(
        Path(tmp),
        name="Mobile Novel",
        project_id="project-mobile",
      )
      add_scene(
        paths,
        title="Opening",
        summary="Mara finds the key.",
        body="Mara lifted the brass key from the snow.",
      )
      add_entity(
        paths,
        kind="character",
        name="Mara",
        description="A cautious cartographer.",
      )
      revision = create_revision(paths, "Mobile baseline")

      first = project_mobile_snapshot(
        paths,
        selected_project_id="project-mobile",
      )
      second = project_mobile_snapshot(
        paths,
        selected_project_id="project-mobile",
      )

      self.assertEqual(first.plaintext_bytes, second.plaintext_bytes)
      self.assertEqual(first.manifest, second.manifest)
      self.assertEqual(first.manifest["schema_version"], 1)
      self.assertEqual(first.manifest["project_id"], "project-mobile")
      self.assertEqual(first.manifest["revision"], revision)
      self.assertEqual(
        first.manifest["content_sha256"],
        hashlib.sha256(first.payload_bytes).hexdigest(),
      )
      self.assertEqual(
        first.plaintext_bytes,
        json.dumps(
          {"manifest": first.manifest, "snapshot": first.snapshot},
          ensure_ascii=False,
          sort_keys=True,
          separators=(",", ":"),
        ).encode("utf-8"),
      )
      self.assertEqual(first.snapshot["schema"], "openauthor.mobile.snapshot")
      self.assertEqual(first.snapshot["schema_version"], 1)
      self.assertEqual(first.snapshot["project_id"], "project-mobile")
      self.assertEqual(first.snapshot["revision"], revision)
      self.assertEqual(first.snapshot["scenes"][0]["id"], "scene-0001")
      self.assertEqual(first.snapshot["codex"]["entities"][0]["name"], "Mara")

  def test_evidence_is_normalized_ordered_and_bounded(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(
        Path(tmp),
        name="Evidence Novel",
        project_id="project-evidence",
      )
      add_scene(paths, title="Opening", body="A bell rings.")
      add_entity(
        paths,
        kind="location",
        name="Zeta Tower",
        description="A watchtower.",
      )
      create_revision(paths, "Evidence baseline")

      artifact = project_mobile_snapshot(
        paths,
        selected_project_id="project-evidence",
      )
      evidence = artifact.snapshot["evidence"]

      self.assertEqual(
        [item["reference"] for item in evidence],
        sorted(item["reference"] for item in evidence),
      )
      self.assertEqual(
        {item["kind"] for item in evidence},
        {"codex_entity", "scene"},
      )
      for item in evidence:
        self.assertLessEqual(len(item["reference"]), 256)
        self.assertRegex(item["reference"], r"^[a-z0-9._:-]+$")
        self.assertRegex(item["content_digest"], r"^[0-9a-f]{64}$")
        self.assertIsInstance(item["authority"], int)
        self.assertGreaterEqual(item["authority"], 0)
        self.assertLessEqual(item["authority"], 100)

      with self.assertRaisesRegex(RuntimeError, "evidence"):
        project_mobile_snapshot(
          paths,
          selected_project_id="project-evidence",
          policy=MobileSnapshotPolicy(max_evidence_items=1),
        )

  def test_projection_excludes_private_runtime_and_storage_data(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(
        Path(tmp),
        name="Private Novel",
        project_id="project-private",
      )
      add_scene(paths, title="Safe", body="Publishable manuscript text.")
      create_revision(paths, "Privacy baseline")

      config = json.loads(paths.config_file.read_text(encoding="utf-8"))
      config["provider_keys"] = {"openai": "provider-secret-123"}
      paths.config_file.write_text(json.dumps(config), encoding="utf-8")
      paths.generations_dir.mkdir(parents=True, exist_ok=True)
      (paths.generations_dir / "private.json").write_text(
        '{"prompt":"generation-prompt-secret"}',
        encoding="utf-8",
      )
      (paths.chat_threads_dir / "thread-private.jsonl").write_text(
        '{"role":"user","content":"chat-prompt-secret"}\n',
        encoding="utf-8",
      )
      lock_dir = paths.chats_dir / "locks" / "threads"
      lock_dir.mkdir(parents=True, exist_ok=True)
      (lock_dir / "private.lock").write_text("runtime-lock-secret", encoding="utf-8")
      tool_run_dir = paths.chats_dir / "tool-runs"
      tool_run_dir.mkdir(parents=True, exist_ok=True)
      (tool_run_dir / "private.json").write_text(
        '{"arguments":"tool-run-secret"}',
        encoding="utf-8",
      )

      plaintext = project_mobile_snapshot(
        paths,
        selected_project_id="project-private",
      ).plaintext_bytes.decode("utf-8")

      self.assertIn("Publishable manuscript text.", plaintext)
      for forbidden in (
        "provider-secret-123",
        "generation-prompt-secret",
        "chat-prompt-secret",
        "runtime-lock-secret",
        "tool-run-secret",
        str(paths.root),
      ):
        self.assertNotIn(forbidden, plaintext)
      self.assertNotIn('"path"', plaintext)

  def test_atomic_staging_write_round_trips_through_verified_loader(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(
        root / "project",
        name="Staged Novel",
        project_id="project-staged",
      )
      add_scene(paths, title="Opening", body="The door opens.")
      revision = create_revision(paths, "Staging baseline")
      artifact = project_mobile_snapshot(
        paths,
        selected_project_id="project-staged",
      )
      staging_path = root / "snapshot-staging" / "mobile.snapshot.json"

      written = write_mobile_snapshot_staging(artifact, staging_path)
      loaded = load_mobile_snapshot(
        written,
        expected_project_id="project-staged",
        expected_revision=revision,
      )

      self.assertEqual(written, staging_path)
      self.assertEqual(staging_path.read_bytes(), artifact.plaintext_bytes)
      self.assertEqual(loaded, artifact.snapshot)
      self.assertEqual(list(staging_path.parent.glob("*.tmp")), [])

  def test_loader_rejects_tampered_snapshot_payload(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(
        root / "project",
        name="Integrity Novel",
        project_id="project-integrity",
      )
      add_scene(paths, title="Opening", body="The original line.")
      create_revision(paths, "Integrity baseline")
      artifact = project_mobile_snapshot(
        paths,
        selected_project_id="project-integrity",
      )
      staging_path = write_mobile_snapshot_staging(
        artifact,
        root / "staging" / "mobile.snapshot.json",
      )
      envelope = json.loads(staging_path.read_text(encoding="utf-8"))
      envelope["snapshot"]["scenes"][0]["body"] = "Tampered line."
      staging_path.write_bytes(
        json.dumps(
          envelope,
          ensure_ascii=False,
          sort_keys=True,
          separators=(",", ":"),
        ).encode("utf-8")
      )

      with self.assertRaisesRegex(RuntimeError, "integrity"):
        load_mobile_snapshot(
          staging_path,
          expected_project_id="project-integrity",
        )

  def test_projection_and_loader_reject_project_identity_mismatch(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(
        root / "project",
        name="Identity Novel",
        project_id="project-expected",
      )
      add_scene(paths, title="Opening", body="Identity-bound prose.")
      create_revision(paths, "Identity baseline")

      with self.assertRaisesRegex(RuntimeError, "selected project id"):
        project_mobile_snapshot(paths, selected_project_id="  ")

      with self.assertRaisesRegex(RuntimeError, "Project id mismatch"):
        project_mobile_snapshot(
          paths,
          selected_project_id="project-other",
        )

      artifact = project_mobile_snapshot(
        paths,
        selected_project_id="project-expected",
      )
      staging_path = write_mobile_snapshot_staging(
        artifact,
        root / "staging" / "mobile.snapshot.json",
      )
      with self.assertRaisesRegex(RuntimeError, "project identity"):
        load_mobile_snapshot(
          staging_path,
          expected_project_id="project-other",
        )


if __name__ == "__main__":
  unittest.main()
