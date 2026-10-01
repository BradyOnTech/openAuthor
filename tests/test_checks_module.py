from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from openauthor.checks import run_continuity_checks
from openauthor.codex import add_entity
from openauthor.project import initialize_project
from openauthor.scenes import add_scene


class ContinuityChecksTests(unittest.TestCase):
  def test_pov_accepts_an_existing_character_alias(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Alias POV")
      add_entity(paths, kind="character", name="Élodie Marchand", aliases=["Élodie"])
      add_scene(paths, title="One", summary="Waiting", pov="Élodie", body="She walked through the empty station and waited by the door until morning.")
      self.assertEqual(run_continuity_checks(paths), [])

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

      add_scene(
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
      rows = run_continuity_checks(paths)

      self.assertEqual(len(rows), 6)
      self.assertTrue(all(row["severity"] == "warning" for row in rows))
      codes = {row["code"] for row in rows}
      self.assertEqual(
        codes,
        {
          "scene_summary_missing",
          "scene_body_short",
          "scene_status_length_mismatch",
          "pov_not_in_codex",
          "duplicate_scene_title",
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
