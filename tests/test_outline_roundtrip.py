from __future__ import annotations

import json
import select
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

from openauthor.book_transactions import transaction_recovery_status
from openauthor.manuscript_io import export_manuscript, import_manuscript, preview_manuscript_import
from openauthor.planning import add_act, add_chapter, assign_scene, get_plan, list_manuscript_scenes
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.revisions import revision_head
from openauthor.scenes import add_scene, list_scene_details


def outline(paths):
  titles = {scene["id"]: scene["title"] for scene in list_scene_details(paths)}
  return [(act["title"], [(chapter["title"], [titles[value] for value in chapter["scene_ids"]])
          for chapter in act["chapters"]]) for act in get_plan(paths, persist=False)["acts"]]


class OutlineRoundTripTests(unittest.TestCase):
  def _book(self, root):
    paths = initialize_project(root, name="Outline fidelity")
    add_act(paths, title="Unstarted  —  待写")
    journey = add_act(paths, title="Journey")
    add_chapter(paths, act_id=journey["id"], title="Unwritten")
    arrival = add_chapter(paths, act_id=journey["id"], title="Arrival")
    add_scene(paths, title="The gate", body="Mara opens the gate.\n\n# A literal sign stays in the prose.")
    assign_scene(paths, scene_id="scene-0001", chapter_id=arrival["id"])
    add_chapter(paths, act_id=journey["id"], title="Later  plans")
    closing = add_act(paths, title="Closing")
    add_chapter(paths, act_id=closing["id"], title="Unwritten")
    return paths

  def test_public_exports_preview_and_import_keep_empty_containers_in_order(self):
    with tempfile.TemporaryDirectory() as temporary:
      root = Path(temporary)
      original = self._book(root / "original")
      expected = outline(original)
      source_bytes = {file.name: file.read_bytes() for file in original.scenes_dir.glob("*.md")}
      for format in ["markdown", "docx"]:
        with self.subTest(format=format):
          target = root / ("export" if format == "markdown" else "export.docx")
          report = export_manuscript(original, target, format=format)
          preview = preview_manuscript_import(target)
          self.assertEqual(preview["chapter_count"], 4)
          self.assertEqual(preview["act_count"], 3)
          self.assertEqual(preview["scene_count"], 1)
          self.assertEqual([(item["title"], [chapter["title"] for chapter in item["chapters"]])
                           for item in preview["outline"]],
                           [(title, [chapter[0] for chapter in chapters]) for title, chapters in expected])
          restored = initialize_project(root / f"restored-{format}", name="Restored outline")
          imported = import_manuscript(restored, target, expected_fingerprint=preview["fingerprint"])
          self.assertEqual(outline(restored), expected)
          self.assertEqual(imported["chapter_count"], 4)
          self.assertEqual(imported["act_count"], 3)
          self.assertEqual(list_scene_details(restored)[0]["body"], list_scene_details(original)[0]["body"])
          self.assertTrue(any("empty" in value.lower() for value in report.get("preserves", [])))
      self.assertEqual({file.name: file.read_bytes() for file in original.scenes_dir.glob("*.md")}, source_bytes)

  def test_outline_only_round_trip_is_useful_without_creating_scenes_or_scanning_existing_prose(self):
    with tempfile.TemporaryDirectory() as temporary:
      root = Path(temporary)
      original = initialize_project(root / "original", name="Planned novel")
      first = add_act(original, title="Waiting")
      add_chapter(original, act_id=first["id"], title="Unwritten")
      add_act(original, title="Future")
      for format in ["markdown", "docx"]:
        with self.subTest(format=format):
          target = root / ("outline" if format == "markdown" else "outline.docx")
          export_manuscript(original, target, format=format)
          preview = preview_manuscript_import(target)
          self.assertEqual((preview["scene_count"], preview["word_count"], preview["chapter_count"]), (0, 0, 1))
          restored = initialize_project(root / f"restored-{format}", name="Restored")
          add_scene(restored, title="Existing", body="Mara owns a lantern. Mara owns a lantern.")
          report = import_manuscript(restored, target, expected_fingerprint=preview["fingerprint"])
          self.assertEqual(report["scene_ids"], [])
          self.assertNotIn("story_memory_suggestions", report)
          self.assertFalse((restored.root / "codex/suggestions.json").exists())
          self.assertEqual(outline(restored), [("Existing manuscript", [("Unassigned scenes", ["Existing"])])]
                           + outline(original))

  def test_author_corrections_retain_or_remove_empty_boundaries_and_change_fingerprint(self):
    with tempfile.TemporaryDirectory() as temporary:
      root = Path(temporary)
      source = root / "novel.md"
      source.write_text("# Part One\n\n## Unwritten\n\n## Chapter Two\n\n### Opening\n\nMara enters.\n\n# Part Two\n")
      initial = preview_manuscript_import(source)
      self.assertTrue(any("Empty heading 'Unwritten'" in warning for warning in initial["warnings"]))
      corrections = {"section-0002": {"role": "chapter", "title": "Planned opening"}}
      reviewed = preview_manuscript_import(source, corrections=corrections)
      self.assertNotEqual(initial["fingerprint"], reviewed["fingerprint"])
      self.assertEqual(reviewed["chapter_count"], 2)
      self.assertEqual(reviewed["outline"][0]["chapters"][0]["scene_positions"], [])
      restored = initialize_project(root / "restored", name="Reviewed")
      with self.assertRaisesRegex(OpenAuthorError, "changed.*preview"):
        import_manuscript(restored, source, corrections=corrections, expected_fingerprint=initial["fingerprint"])
      import_manuscript(restored, source, corrections=corrections, expected_fingerprint=reviewed["fingerprint"])
      self.assertEqual(outline(restored), [("Part One", [("Planned opening", []), ("Chapter Two", ["Opening"])]), ("Part Two", [])])
      text = preview_manuscript_import(source, corrections={"section-0002": {"role": "text"}})
      self.assertIn("Unwritten", text["scenes"][0]["excerpt"])
      self.assertEqual(text["scene_count"], 2)

  def test_manifest_empty_outline_changes_refuse_stale_import_before_writes(self):
    with tempfile.TemporaryDirectory() as temporary:
      root = Path(temporary)
      original = self._book(root / "original")
      target = root / "export"
      export_manuscript(original, target, format="markdown")
      preview = preview_manuscript_import(target)
      manifest = target / "openauthor-manuscript.json"
      payload = json.loads(manifest.read_text())
      payload["sections"][0]["title"] = "Changed outline"
      manifest.write_text(json.dumps(payload))
      restored = initialize_project(root / "restored", name="Untouched")
      before = restored.structure_file.read_bytes() if restored.structure_file.exists() else None
      with self.assertRaisesRegex(OpenAuthorError, "changed.*preview"):
        import_manuscript(restored, target, expected_fingerprint=preview["fingerprint"])
      self.assertEqual(restored.structure_file.read_bytes() if restored.structure_file.exists() else None, before)
      self.assertEqual(list_scene_details(restored), [])

  def test_flattening_strategy_discloses_outline_loss_and_keeps_literal_heading_text(self):
    with tempfile.TemporaryDirectory() as temporary:
      root = Path(temporary)
      source = root / "novel.md"
      source.write_text("# Part One\n\n## Chapter One\n\n## Chapter Two\n\nMara enters.")
      preview = preview_manuscript_import(source, strategy="single")
      self.assertTrue(any("flatten" in warning.lower() and "empty" in warning.lower() for warning in preview["warnings"]))
      self.assertEqual(preview["chapter_count"], 0)
      self.assertEqual(preview["scene_count"], 1)
      self.assertIn("## Chapter One", preview["scenes"][0]["excerpt"])

  def test_scrivener_empty_folders_keep_hierarchy_without_importing_excluded_subtrees(self):
    with tempfile.TemporaryDirectory() as temporary:
      root = Path(temporary)
      source = root / "Novel.scriv"
      source.mkdir()
      (source / "Novel.scrivx").write_text('''<ScrivenerProject><Binder><BinderItem Type="DraftFolder"><Children>
        <BinderItem UUID="part" Type="Folder"><Title>Future</Title><Children>
          <BinderItem UUID="empty" Type="Folder"><Title>Unwritten</Title></BinderItem>
        </Children></BinderItem>
        <BinderItem UUID="private" Type="Folder"><Title>PRIVATE_SENTINEL</Title><MetaData><IncludeInCompile>No</IncludeInCompile></MetaData><Children>
          <BinderItem UUID="secret" Type="Folder"><Title>Secret outline</Title></BinderItem>
        </Children></BinderItem>
      </Children></BinderItem></Binder></ScrivenerProject>''')
      preview = preview_manuscript_import(source)
      self.assertEqual((preview["scene_count"], preview["act_count"], preview["chapter_count"]), (0, 1, 1))
      self.assertTrue(any("Excluded binder item" in warning for warning in preview["warnings"]))
      self.assertNotIn("Secret outline", json.dumps(preview))
      restored = initialize_project(root / "restored", name="Binder outline")
      import_manuscript(restored, source, expected_fingerprint=preview["fingerprint"])
      self.assertEqual(outline(restored), [("Future", [("Unwritten", [])])])

  def test_unmarked_docx_empty_headings_warn_and_can_be_corrected_without_guessing_role(self):
    with tempfile.TemporaryDirectory() as temporary:
      source = Path(temporary) / "unmarked.docx"
      paragraphs = "".join(f'<w:p><w:pPr><w:pStyle w:val="{style}"/></w:pPr><w:r><w:t>{text}</w:t></w:r></w:p>'
        for style, text in [("Heading1", "Future"), ("Heading1", "Chapter One"), ("Heading2", "Opening"), ("Normal", "Mara enters.")])
      with zipfile.ZipFile(source, "w") as archive:
        archive.writestr("word/document.xml", f'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{paragraphs}</w:body></w:document>')
      initial = preview_manuscript_import(source)
      self.assertTrue(any("Empty heading 'Future'" in warning for warning in initial["warnings"]))
      corrected = preview_manuscript_import(source, corrections={"section-0001": {"role": "act"}})
      self.assertEqual(corrected["outline"][0], {"title": "Future", "chapters": []})
      self.assertEqual(corrected["scene_count"], 1)

  def test_nested_container_flattening_is_disclosed_and_retains_empty_parent(self):
    with tempfile.TemporaryDirectory() as temporary:
      source = Path(temporary) / "nested.md"
      source.write_text("# Part One\n\n## Chapter One\n\n### Nested group\n\n#### Opening\n\nMara enters.")
      preview = preview_manuscript_import(source)
      self.assertTrue(any("flattened" in warning for warning in preview["warnings"]))
      self.assertEqual(preview["outline"][0]["chapters"], [
        {"title": "Chapter One", "scene_positions": []}, {"title": "Nested group", "scene_positions": [1]}])

  def test_intentionally_empty_scenes_survive_exports_without_becoming_extra_containers(self):
    with tempfile.TemporaryDirectory() as temporary:
      root = Path(temporary)
      original = initialize_project(root / "original", name="Empty scene")
      add_scene(original, title="Chapter  is a scene title", body="")
      for format in ["markdown", "docx"]:
        with self.subTest(format=format):
          target = root / ("export" if format == "markdown" else "export.docx")
          export_manuscript(original, target, format=format)
          preview = preview_manuscript_import(target)
          self.assertEqual((preview["scene_count"], preview["chapter_count"], preview["act_count"]), (1, 0, 0))
          self.assertEqual(preview["scenes"][0]["title"], "Chapter  is a scene title")
          restored = initialize_project(root / f"restored-{format}", name="Empty scene restored")
          import_manuscript(restored, target, expected_fingerprint=preview["fingerprint"])
          self.assertEqual(list_scene_details(restored)[0]["body"], list_scene_details(original)[0]["body"])

  def test_killed_import_recovers_exact_plan_prose_and_head_before_retry(self):
    script = r'''
import sys
from pathlib import Path
import openauthor.book_transactions as transactions
from openauthor.manuscript_io import import_manuscript
from openauthor.project import resolve_project
paths = resolve_project(Path(sys.argv[1]))
replace = transactions._replace_bytes
def paused_replace(path, content, **kwargs):
  replace(path, content, **kwargs)
  if path == paths.structure_file:
    print("paused", flush=True)
    sys.stdin.readline()
transactions._replace_bytes = paused_replace
import_manuscript(paths, Path(sys.argv[2]))
'''
    with tempfile.TemporaryDirectory() as temporary:
      root = Path(temporary)
      original = self._book(root / "original")
      target = root / "export"
      export_manuscript(original, target, format="markdown")
      restored = initialize_project(root / "restored", name="Existing writing")
      add_scene(restored, title="Original", body="Original prose stays exact.\n")
      get_plan(restored)
      captured = [restored.structure_file, *restored.scenes_dir.glob("*.md")]
      before = {file: file.read_bytes() for file in captured}
      head = revision_head(restored)
      child = subprocess.Popen([sys.executable, "-c", script, str(restored.root), str(target)],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
      try:
        ready, _, _ = select.select([child.stdout], [], [], 15)
        self.assertTrue(ready, "Import did not reach its durable Plan write")
        self.assertEqual(child.stdout.readline(), "paused\n")
        child.kill()
        _, stderr = child.communicate(timeout=5)
        self.assertEqual(child.returncode, -9, stderr)
      finally:
        if child.poll() is None:
          child.kill()
          child.communicate(timeout=5)
      self.assertTrue(transaction_recovery_status(restored)["pending"])
      self.assertEqual([scene["title"] for scene in list_scene_details(restored)], ["Original"])
      self.assertEqual({file: file.read_bytes() for file in captured}, before)
      self.assertEqual(revision_head(restored), head)
      self.assertFalse(transaction_recovery_status(restored)["pending"])
      import_manuscript(restored, target)
      self.assertEqual(outline(restored)[1:], outline(original))
      self.assertEqual([scene["title"] for scene in list_manuscript_scenes(restored)], ["Original", "The gate"])
