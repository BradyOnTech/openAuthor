from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from openauthor.checks import run_continuity_checks
from openauthor.codex import add_entity
from openauthor.project import initialize_project
from openauthor.scenes import add_scene


class ContinuityChecksTests(unittest.TestCase):
  def test_continuity_checks_detect_expected_issues(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Checks Demo")

      add_entity(paths, kind="character", name="Elara", description="Lead POV")

      add_scene(
        paths,
        title="Opening Scene",
        summary="",
        pov="Unknown Hero",
        status="final",
        body="Too short.",
      )

      second_scene = add_scene(
        paths,
        title="Opening Scene",
        summary="Second pass",
        pov="Elara",
        status="draft",
        body=(
          "This draft body has enough words to avoid the short-scene rule while "
          "still being easy to inspect in a test fixture."
        ),
      )
      content = second_scene.read_text(encoding="utf-8")
      second_scene.write_text(
        content.replace("# Opening Scene", "# A Different Heading", 1),
        encoding="utf-8",
      )

      rows = run_continuity_checks(paths)

      self.assertEqual(len(rows), 7)
      self.assertEqual(rows[-1]["severity"], "info")
      codes = {row["code"] for row in rows}
      self.assertEqual(
        codes,
        {
          "scene_summary_missing",
          "scene_body_short",
          "scene_status_length_mismatch",
          "pov_not_in_codex",
          "duplicate_scene_title",
          "scene_heading_title_mismatch",
        },
      )
      self.assertTrue(any(row["scene_id"] == "scene-0001" for row in rows))
      self.assertTrue(any(row["scene_id"] == "scene-0002" for row in rows))

  def test_continuity_checks_clean_scene(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Checks Clean")
      add_entity(paths, kind="character", name="Elara", description="Lead POV")

      add_scene(
        paths,
        title="Clean Scene",
        summary="A complete scene.",
        pov="Elara",
        status="draft",
        body=(
          "Elara crossed the observatory floor and checked each console twice before "
          "calling the crew to begin calibration for the long watch ahead."
        ),
      )

      rows = run_continuity_checks(paths)
      self.assertEqual(rows, [])


if __name__ == "__main__":
  unittest.main()
