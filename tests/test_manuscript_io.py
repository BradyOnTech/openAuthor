from __future__ import annotations

import json
import tempfile
import unittest
import zipfile
from unittest.mock import patch
from pathlib import Path

from openauthor.manuscript_io import (
  export_manuscript,
  import_manuscript,
  preview_manuscript_import,
)
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.planning import get_plan
from openauthor.scenes import add_scene, list_scene_details


class ManuscriptIOTests(unittest.TestCase):
  def test_import_rejects_invalid_corrections_and_manifest_paths_before_writing(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      source = root / "novel.md"
      source.write_text("# Opening\n\nSome prose.", encoding="utf-8")
      for change in ({"role": []}, {"title": ""}, {"body": "replacement"}):
        with self.subTest(change=change), self.assertRaises(OpenAuthorError):
          preview_manuscript_import(source, corrections={"section-0001": change})
      bundle = root / "bundle"
      bundle.mkdir()
      for relative in ("../novel.md", str(source)):
        (bundle / "openauthor-manuscript.json").write_text(json.dumps({"schema_version": 1, "sections": [{"role": "scene", "title": "Escape", "file": relative}]}), encoding="utf-8")
        with self.assertRaises(OpenAuthorError):
          preview_manuscript_import(bundle)

  def test_docx_export_never_strips_or_splits_heading_like_prose(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root / "book", name="Literal Novel")
      prose = "# A literal sign\n\n**Do not remove this.**\n\n## Another sign\n\nShe reads it."
      add_scene(paths, title="Opening", body=prose)
      target = root / "novel.docx"
      export_manuscript(paths, target, format="docx")
      preview = preview_manuscript_import(target)
      self.assertEqual(preview["scene_count"], 1)
      restored = initialize_project(root / "restored", name="Restored")
      import_manuscript(restored, target)
      self.assertEqual(list_scene_details(restored)[0]["body"].strip(), prose)
      with zipfile.ZipFile(target) as archive:
        self.assertIn("word/styles.xml", archive.namelist())
        self.assertIn("Heading1", archive.read("word/styles.xml").decode())

  def test_markdown_bundle_preserves_hierarchy_prose_and_metadata_without_claiming_full_backup(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      source = root / "novel.md"
      source.write_text("# Part One\n\n## Chapter One\n\n### The Gate\n\n**Mara** opens it.\n\n## Chapter Two\n\n### Home\n\nShe returns.", encoding="utf-8")
      paths = initialize_project(root / "book", name="Portable Novel")
      import_manuscript(paths, source)
      from openauthor.scenes import update_scene
      update_scene(paths, scene_identifier="scene-0001", summary="A threshold", pov="Mara", status="revised")
      destination = root / "markdown"
      report = export_manuscript(paths, destination, format="markdown")
      self.assertTrue(any("backup" in loss.lower() for loss in report["losses"]))
      self.assertTrue((destination / "openauthor-manuscript.json").is_file())
      preview = preview_manuscript_import(destination)
      self.assertEqual(preview["chapter_count"], 2)
      self.assertNotIn("updated_at:", preview["scenes"][0]["excerpt"])
      restored = initialize_project(root / "restored", name="Round trip")
      import_manuscript(restored, destination)
      restored_scenes = list_scene_details(restored)
      self.assertEqual([scene["body"] for scene in restored_scenes], [scene["body"] for scene in list_scene_details(paths)])
      self.assertEqual(restored_scenes[0]["summary"], "A threshold")
      self.assertEqual(restored_scenes[0]["pov"], "Mara")
      self.assertEqual(restored_scenes[0]["status"], "revised")
      chapters = get_plan(restored)["acts"][0]["chapters"]
      self.assertEqual([row["title"] for row in chapters], ["Chapter One", "Chapter Two"])
      docx = root / "novel.docx"
      export_manuscript(paths, docx, format="docx")
      docx_preview = preview_manuscript_import(docx)
      self.assertEqual(docx_preview["chapter_count"], 2)
      self.assertEqual([row["title"] for row in docx_preview["scenes"]], ["The Gate", "Home"])

  def test_import_failure_rolls_back_prose_and_plan_and_success_keeps_existing_order(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root / "book", name="Existing Novel")
      add_scene(paths, title="Original", body="Original prose.")
      before_plan = get_plan(paths)
      before_scenes = list_scene_details(paths)
      source = root / "new.md"
      source.write_text("# Chapter One\n\n## New Scene\n\nNew prose.", encoding="utf-8")
      # The report is written after scene/structure staging; failure must not leave a partial book.
      import os
      original_replace = os.replace
      def fail_report_replace(source_path, target_path):
        if Path(target_path).name == "last_import_report.json":
          raise OSError("Simulated full disk")
        return original_replace(source_path, target_path)
      with patch("os.replace", side_effect=fail_report_replace):
        with self.assertRaisesRegex(OSError, "full disk"):
          import_manuscript(paths, source)
      self.assertEqual(list_scene_details(paths), before_scenes)
      self.assertEqual(get_plan(paths), before_plan)
      report = import_manuscript(paths, source)
      self.assertEqual([row["title"] for row in list_scene_details(paths)], ["Original", "New Scene"])
      self.assertEqual(report["scene_ids"], ["scene-0002"])

  def test_scrivener_folders_preserve_hierarchy_and_excluded_subtrees_stay_out(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      source = root / "Novel.scriv"
      source.mkdir()
      (source / "Novel.scrivx").write_text('''<ScrivenerProject><Binder><BinderItem Type="DraftFolder"><Title>Manuscript</Title><Children>
        <BinderItem UUID="part" Type="Folder"><Title>The Journey</Title><Children>
          <BinderItem UUID="chapter" Type="Folder"><Title>Arrival</Title><Children>
            <BinderItem UUID="one" Type="Text"><Title>The Gate</Title></BinderItem>
          </Children></BinderItem>
        </Children></BinderItem>
        <BinderItem UUID="two" Type="Text"><Title>Epilogue</Title></BinderItem>
        <BinderItem UUID="private" Type="Folder"><Title>Private material</Title><MetaData><IncludeInCompile>No</IncludeInCompile></MetaData><Children>
          <BinderItem UUID="secret" Type="Text"><Title>Secret</Title></BinderItem>
        </Children></BinderItem>
      </Children></BinderItem></Binder></ScrivenerProject>''', encoding="utf-8")
      for identifier, prose in [("one", "Mara opens the gate."), ("two", "She returns home."), ("secret", "PRIVATE_SENTINEL")]:
        directory = source / "Files" / "Data" / identifier
        directory.mkdir(parents=True)
        (directory / "content.rtf").write_text(r"{\rtf1\ansi " + prose + "}", encoding="utf-8")
      preview = preview_manuscript_import(source)
      self.assertEqual([scene["title"] for scene in preview["scenes"]], ["The Gate", "Epilogue"])
      self.assertEqual(preview["scenes"][0]["chapter_title"], "Arrival")
      self.assertEqual(preview["scenes"][0]["act_title"], "The Journey")
      self.assertEqual(preview["scenes"][1]["chapter_title"], "Opening")
      self.assertNotIn("PRIVATE_SENTINEL", json.dumps(preview))
      paths = initialize_project(root / "book", name="Binder Novel")
      import_manuscript(paths, source)
      self.assertEqual([row["title"] for row in list_scene_details(paths)], ["The Gate", "Epilogue"])
      plan = get_plan(paths)
      self.assertEqual(plan["acts"][0]["chapters"][0]["scene_ids"], ["scene-0001"])
      self.assertEqual(preview["chapter_count"], sum(len(act["chapters"]) for act in plan["acts"]))

  def test_docx_heading_levels_and_markdown_fences_preserve_structure(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      source = root / "novel.docx"
      paragraphs = "".join(
        f'<w:p><w:pPr><w:pStyle w:val="{style}"/></w:pPr><w:r><w:t>{text}</w:t></w:r></w:p>'
        for style, text in [("Heading1", "Part One"), ("Heading2", "Chapter One"), ("Heading3", "Élodie's Promise"), ("Normal", "She promises to return."), ("Heading2", "Chapter Two"), ("Heading3", "The Return"), ("Normal", "She returns.")]
      )
      with zipfile.ZipFile(source, "w") as archive:
        archive.writestr("word/document.xml", f'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{paragraphs}</w:body></w:document>')
      preview = preview_manuscript_import(source)
      self.assertEqual(preview["scene_count"], 2)
      self.assertEqual([row["level"] for row in preview["sections"]], [1, 2, 3, 2, 3])
      self.assertEqual([row["chapter_title"] for row in preview["scenes"]], ["Chapter One", "Chapter Two"])
      self.assertTrue(all(row["act_title"] == "Part One" for row in preview["scenes"]))
      self.assertTrue(any("formatting" in warning for warning in preview["warnings"]))

      markdown = root / "fenced.md"
      markdown.write_text("# Opening\n\nShe reads:\n\n```\n# NOT A BOUNDARY\n```\n\n# Ending\n\nShe leaves.", encoding="utf-8")
      fenced = preview_manuscript_import(markdown)
      self.assertEqual(fenced["scene_count"], 2)
      self.assertIn("# NOT A BOUNDARY", fenced["scenes"][0]["excerpt"])

  def test_author_can_correct_boundaries_and_stale_preview_cannot_import(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      source = root / "novel.md"
      source.write_text("# Dawn\n\nFirst paragraph.\n\n## A sign\n\nNO ENTRY.\n\n# Dusk\n\nLast paragraph.", encoding="utf-8")
      initial = preview_manuscript_import(source)
      sections = initial["sections"]
      corrections = {
        sections[0]["id"]: {"role": "scene", "title": "First Light"},
        sections[1]["id"]: {"role": "text"},
      }
      reviewed = preview_manuscript_import(source, corrections=corrections)
      self.assertEqual([scene["title"] for scene in reviewed["scenes"]], ["First Light", "Dusk"])
      self.assertIn("A sign", reviewed["scenes"][0]["excerpt"])
      paths = initialize_project(root / "project", name="Corrected Novel")
      report = import_manuscript(paths, source, corrections=corrections, expected_fingerprint=reviewed["fingerprint"])
      self.assertEqual(report["scene_count"], 2)
      self.assertIn("NO ENTRY.", list_scene_details(paths)[0]["body"])

      source.write_text(source.read_text() + "\n\nNew paragraph.", encoding="utf-8")
      with self.assertRaisesRegex(OpenAuthorError, "changed.*preview"):
        import_manuscript(paths, source, corrections=corrections, expected_fingerprint=reviewed["fingerprint"])
      self.assertEqual(len(list_scene_details(paths)), 2)
      with self.assertRaises(OpenAuthorError):
        preview_manuscript_import(source, corrections={"missing": {"role": "scene"}})

  def test_nested_headings_import_as_chapters_not_empty_scenes(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      source = root / "novel.md"
      source.write_text(
        "# Chapter One\n\n## The Empty Hook\n\nMara enters.\n\n"
        "## The Key\n\nShe finds a key.\n\n"
        "# Chapter Two\n\n## The Other Bank\n\nShe crosses.\n",
        encoding="utf-8",
      )
      preview = preview_manuscript_import(source)
      self.assertEqual(preview["scene_count"], 3)
      self.assertEqual(preview["chapter_count"], 2)
      self.assertEqual([row["title"] for row in preview["scenes"]], ["The Empty Hook", "The Key", "The Other Bank"])
      self.assertFalse((root / ".openauthor").exists())

      paths = initialize_project(root / "project", name="Nested Novel")
      import_manuscript(paths, source)
      plan = get_plan(paths)
      chapters = [chapter for act in plan["acts"] for chapter in act["chapters"]]
      self.assertEqual([row["title"] for row in chapters], ["Chapter One", "Chapter Two"])
      self.assertEqual([row["scene_ids"] for row in chapters], [["scene-0001", "scene-0002"], ["scene-0003"]])
      self.assertTrue(all(row["body"].strip() for row in list_scene_details(paths)))

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
      self.assertTrue(any("backup" in loss.lower() for loss in markdown_report["losses"]))
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
