from __future__ import annotations

import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from openauthor.manuscript_io import (
  export_manuscript,
  import_manuscript,
  preview_manuscript_import,
)
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.scenes import list_scene_details


class ManuscriptIOTests(unittest.TestCase):
  def test_preview_detects_markdown_heading_structure_without_writing(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      source = root / "novel.md"
      source.write_text(
        "# The Arrival\n\nMara reaches the silent city.\n\n"
        "# The Choice\n\nShe opens the forbidden gate.\n",
        encoding="utf-8",
      )

      report = preview_manuscript_import(source)
      self.assertEqual(report["scene_count"], 2)
      self.assertEqual([row["title"] for row in report["scenes"]], ["The Arrival", "The Choice"])
      self.assertFalse((root / ".openauthor").exists())

  def test_folder_import_is_ordered_and_failed_import_leaves_project_untouched(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      source = root / "source"
      source.mkdir()
      (source / "01-opening.md").write_text("Opening prose.", encoding="utf-8")
      (source / "02-crossroads.txt").write_text("Crossroads prose.", encoding="utf-8")
      paths = initialize_project(root / "project", name="Imported Novel")

      report = import_manuscript(paths, source)
      self.assertEqual(report["scene_count"], 2)
      scenes = list_scene_details(paths)
      self.assertEqual([row["title"] for row in scenes], ["01 opening", "02 crossroads"])
      self.assertIn("Opening prose.", scenes[0]["body"])

      unsupported = root / "bad.rtf"
      unsupported.write_text("not supported", encoding="utf-8")
      with self.assertRaises(OpenAuthorError):
        import_manuscript(paths, unsupported)
      self.assertEqual(len(list_scene_details(paths)), 2)

  def test_markdown_and_docx_exports_include_loss_reports_and_round_trip_prose(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      source = root / "novel.md"
      source.write_text(
        "# First Light\n\nThe harbor wakes under a red sky.\n\n"
        "# Night Crossing\n\nThe crew leaves without lanterns.\n",
        encoding="utf-8",
      )
      paths = initialize_project(root / "project", name="Export Novel")
      import_manuscript(paths, source)

      markdown_target = root / "markdown-export"
      markdown_report = export_manuscript(paths, markdown_target, format="markdown")
      self.assertEqual(markdown_report["scene_count"], 2)
      self.assertEqual(markdown_report["losses"], [])
      saved_report = json.loads((markdown_target / "openauthor-export-report.json").read_text())
      self.assertEqual(saved_report["scene_count"], 2)

      docx_target = root / "novel.docx"
      docx_report = export_manuscript(paths, docx_target, format="docx")
      self.assertTrue(docx_target.exists())
      self.assertTrue(docx_report["losses"])
      with zipfile.ZipFile(docx_target) as archive:
        document = archive.read("word/document.xml").decode("utf-8")
      self.assertIn("The harbor wakes under a red sky.", document)
      self.assertIn("The crew leaves without lanterns.", document)

      round_trip = preview_manuscript_import(docx_target)
      self.assertEqual(round_trip["scene_count"], 2)
      self.assertEqual([row["title"] for row in round_trip["scenes"]], ["First Light", "Night Crossing"])

  def test_scrivener_draft_binder_import_preserves_order_and_rtf_prose(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      scrivener = root / "Novel.scriv"
      scrivener.mkdir()
      (scrivener / "Novel.scrivx").write_text(
        """<?xml version="1.0" encoding="UTF-8"?>
<ScrivenerProject><Binder><BinderItem UUID="draft" Type="DraftFolder"><Title>Manuscript</Title><Children>
<BinderItem UUID="scene-b" Type="Text"><Title>The Arrival</Title><MetaData><IncludeInCompile>Yes</IncludeInCompile></MetaData></BinderItem>
<BinderItem UUID="scene-a" Type="Text"><Title>The Choice</Title><MetaData><IncludeInCompile>Yes</IncludeInCompile></MetaData></BinderItem>
<BinderItem UUID="notes" Type="Text"><Title>Private Notes</Title><MetaData><IncludeInCompile>No</IncludeInCompile></MetaData></BinderItem>
</Children></BinderItem></Binder></ScrivenerProject>""",
        encoding="utf-8",
      )
      for identifier, rtf in (
        ("scene-b", r"{\rtf1\ansi Mara reaches the \b silent\b0 city.\par The bells don\'92t ring.}"),
        ("scene-a", r"{\rtf1\ansi She opens the forbidden gate.}"),
        ("notes", r"{\rtf1\ansi This must not enter the manuscript.}"),
      ):
        content_dir = scrivener / "Files" / "Data" / identifier
        content_dir.mkdir(parents=True)
        (content_dir / "content.rtf").write_text(rtf, encoding="latin-1")

      preview = preview_manuscript_import(scrivener)
      self.assertEqual([row["title"] for row in preview["scenes"]], ["The Arrival", "The Choice"])
      self.assertIn("bells don’t ring", preview["scenes"][0]["excerpt"])

      paths = initialize_project(root / "project", name="Scrivener Import")
      report = import_manuscript(paths, scrivener)
      self.assertEqual(report["scene_count"], 2)
      imported = list_scene_details(paths)
      self.assertEqual([row["title"] for row in imported], ["The Arrival", "The Choice"])
      self.assertNotIn("Private Notes", "\n".join(row["body"] for row in imported))


if __name__ == "__main__":
  unittest.main()
