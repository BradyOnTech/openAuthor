from __future__ import annotations

import tempfile
import unittest
import zipfile
from xml.etree import ElementTree
from pathlib import Path

from openauthor.ai import build_generation_context
from openauthor.canon import add_canon_fact, run_canon_diagnostics
from openauthor.manuscript_io import export_manuscript
from openauthor.planning import add_act, add_chapter, assign_scene
from openauthor.project import OpenAuthorError, atomic_write_json, initialize_project
from openauthor.scenes import add_scene, list_scenes


class ReadingOrderTests(unittest.TestCase):
  def test_plan_order_drives_manuscript_export_and_ai_neighbors(self) -> None:
    with tempfile.TemporaryDirectory() as temporary:
      root = Path(temporary)
      paths = initialize_project(root / "book", name="Structural editing")
      for title in ("Opening", "Reveal", "Flashback", "Ending"):
        add_scene(paths, title=title, body=f"Synthetic prose for {title}.")
      act = add_act(paths, title="Act I")
      chapter = add_chapter(paths, act_id=act["id"], title="Chapter One")
      order = ["scene-0001", "scene-0003", "scene-0002", "scene-0004"]
      for scene_id in order:
        assign_scene(paths, scene_id=scene_id, chapter_id=chapter["id"])
      self.assertEqual([scene["id"] for scene in list_scenes(paths)], order)
      context = build_generation_context(paths, scene_id="scene-0002", context_scene_radius=1, codex_limit=5)
      self.assertEqual([scene["id"] for scene in context["nearby_scenes"]], ["scene-0003", "scene-0004"])
      report = export_manuscript(paths, root / "export", format="markdown")
      self.assertEqual(report["files"], ["0001-opening.md", "0002-flashback.md", "0003-reveal.md", "0004-ending.md", "openauthor-manuscript.json"])
      export_manuscript(paths, root / "manuscript.docx", format="docx")
      with zipfile.ZipFile(root / "manuscript.docx") as archive:
        document = ElementTree.fromstring(archive.read("word/document.xml"))
      ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
      headings = [
        "".join(paragraph.itertext()) for paragraph in document.findall(".//w:p", ns)
        if paragraph.find("w:pPr/w:pStyle", ns) is not None
      ]
      self.assertEqual(headings, ["Act I", "Chapter One", "Opening", "Flashback", "Reveal", "Ending"])
      add_canon_fact(paths, subject_entity_id="", predicate="draft status", value="synthetic", evidence=[{"scene_id": "scene-0003", "excerpt": "Synthetic prose for Flashback."}],
        valid_from_scene_id="scene-0003", valid_to_scene_id="scene-0002")
      self.assertNotIn("impossible_validity", [row["code"] for row in run_canon_diagnostics(paths)["diagnostics"]])

  def test_legacy_and_partially_planned_books_keep_every_scene_once(self) -> None:
    with tempfile.TemporaryDirectory() as temporary:
      paths = initialize_project(Path(temporary))
      for title in ("One", "Two", "Three"):
        add_scene(paths, title=title)
      self.assertEqual([row["id"] for row in list_scenes(paths)], ["scene-0001", "scene-0002", "scene-0003"])
      atomic_write_json(paths.structure_file, {
        "schema_version": 1,
        "acts": [{"chapters": [{"scene_ids": ["missing-scene", "scene-0003", "scene-0003"]}]}],
        "unassigned_scene_ids": ["scene-0001", "scene-0003"],
      })
      self.assertEqual([row["id"] for row in list_scenes(paths)], ["scene-0003", "scene-0001", "scene-0002"])

  def test_unreadable_structure_does_not_silently_export_the_wrong_order(self) -> None:
    with tempfile.TemporaryDirectory() as temporary:
      paths = initialize_project(Path(temporary))
      add_scene(paths, title="One")
      atomic_write_json(paths.structure_file, {"schema_version": 2, "acts": None})
      with self.assertRaisesRegex(OpenAuthorError, "structure is unreadable"):
        list_scenes(paths)
