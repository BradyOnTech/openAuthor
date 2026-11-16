from __future__ import annotations

import json
import os
import tempfile
import time
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from openauthor.cli import main
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.revisions import checkpointed_edit, get_revision, revision_head
from openauthor.scenes import add_scene, find_scene_file, get_scene, update_scene
from openauthor.story_memory import extract_memory_suggestions, list_memory_suggestions

SCENES = 40


class _SceneReadCounter:
  """Count how often each manuscript scene file is opened for reading."""

  def __init__(self, scenes_dir: Path) -> None:
    self.scenes_dir = scenes_dir.resolve()
    self.reads: dict[str, int] = {}
    self._read_text = Path.read_text
    self._read_bytes = Path.read_bytes

  def _note(self, path: Path) -> None:
    resolved = Path(path).resolve()
    if resolved.parent == self.scenes_dir and resolved.suffix == ".md":
      self.reads[resolved.name] = self.reads.get(resolved.name, 0) + 1

  def __enter__(self) -> "_SceneReadCounter":
    counter = self

    def read_text(path, *args, **kwargs):
      counter._note(path)
      return counter._read_text(path, *args, **kwargs)

    def read_bytes(path, *args, **kwargs):
      counter._note(path)
      return counter._read_bytes(path, *args, **kwargs)

    self._patches = [patch.object(Path, "read_text", read_text), patch.object(Path, "read_bytes", read_bytes)]
    for item in self._patches:
      item.start()
    return self

  def __exit__(self, *_: object) -> None:
    for item in self._patches:
      item.stop()

  @property
  def total(self) -> int:
    return sum(self.reads.values())


class SaveScalingTests(unittest.TestCase):
  def setUp(self) -> None:
    self.directory = tempfile.TemporaryDirectory()
    self.addCleanup(self.directory.cleanup)
    self.root = Path(self.directory.name)
    self.paths = initialize_project(self.root, name="Long book")
    for index in range(1, SCENES + 1):
      # A POV on every scene gives one suggestion evidence in every scene, the
      # shape that used to trigger a whole-manuscript lookup per evidence row.
      add_scene(
        self.paths,
        title=f"Chapter {index}",
        pov="Mara",
        body=f"Mara crossed the harbor with Idris on night {index}. Idris carried the lantern.",
      )
    extract_memory_suggestions(self.paths)
    # Files written moments ago are deliberately reread by the checkpoint, so
    # age them the way a real manuscript's untouched scenes are.
    aged = time.time() - 3600
    for scene_file in self.paths.scenes_dir.glob("*.md"):
      os.utime(scene_file, (aged, aged))
    self.previous = Path.cwd()
    os.chdir(self.root)
    self.addCleanup(os.chdir, self.previous)

  def _cli(self, *arguments: str) -> tuple[int, str]:
    output = StringIO()
    with redirect_stdout(output):
      code = main(list(arguments))
    return code, output.getvalue()

  def _editor_save(self, scene_identifier: str, body: str) -> dict:
    loaded = get_scene(self.paths, scene_identifier)
    code, output = self._cli(
      "scene", "update", "--id", scene_identifier,
      "--expected-version", json.dumps(loaded["edit_version"]),
      "--body", body, "--json",
    )
    self.assertEqual(code, 0)
    return json.loads(output)

  def test_editor_save_reads_each_scene_a_bounded_number_of_times(self) -> None:
    with _SceneReadCounter(self.paths.scenes_dir) as counter:
      saved = self._editor_save("scene-0020", "Mara crossed the harbor. Quillon Vance waited. Quillon Vance smiled.")
    self.assertEqual(saved["id"], "scene-0020")
    self.assertNotIn("save_warnings", saved)
    # One pass for the pre-edit checkpoint and one for manuscript-wide name
    # identity, plus a handful of lookups of the saved scene itself. Looking
    # every evidence scene up by scanning the manuscript costs hundreds here.
    self.assertLessEqual(counter.total, 2 * SCENES + 12, counter.reads)
    untouched = {name: count for name, count in counter.reads.items() if not name.startswith("0020-")}
    self.assertLessEqual(max(untouched.values()), 2, untouched)

  def test_save_cost_grows_linearly_with_scene_count(self) -> None:
    with _SceneReadCounter(self.paths.scenes_dir) as small:
      self._editor_save("scene-0020", "Mara waited by the harbor with Idris.")
    for index in range(SCENES + 1, 2 * SCENES + 1):
      add_scene(self.paths, title=f"Chapter {index}", pov="Mara", body=f"Mara and Idris walked on night {index}.")
    extract_memory_suggestions(self.paths)
    aged = time.time() - 3600
    for scene_file in self.paths.scenes_dir.glob("*.md"):
      os.utime(scene_file, (aged, aged))
    with _SceneReadCounter(self.paths.scenes_dir) as large:
      self._editor_save("scene-0020", "Mara waited by the harbor with Idris again.")
    self.assertLessEqual(large.total, 2 * small.total + 12, (small.total, large.total))

  def test_save_still_refreshes_the_saved_scenes_memory_suggestions(self) -> None:
    self._editor_save("scene-0020", "Quillon Vance waited at the gate. Quillon Vance smiled at Mara.")
    names = {row["name"]: row for row in list_memory_suggestions(self.paths)}
    self.assertIn("Quillon Vance", names)
    self.assertEqual({item["scene_id"] for item in names["Quillon Vance"]["evidence"]}, {"scene-0020"})
    self._editor_save("scene-0020", "Nobody waited at the gate.")
    self.assertNotIn("Quillon Vance", {row["name"] for row in list_memory_suggestions(self.paths)})

  def test_refresh_returns_the_same_review_versions_as_a_fresh_listing(self) -> None:
    refreshed = extract_memory_suggestions(self.paths, scene_ids=["scene-0003"])["suggestions"]
    self.assertTrue(refreshed)
    self.assertEqual(refreshed, list_memory_suggestions(self.paths))

  def test_scene_lookup_reads_only_the_named_file(self) -> None:
    with _SceneReadCounter(self.paths.scenes_dir) as counter:
      scene = get_scene(self.paths, "scene-0031")
      located = find_scene_file(self.paths, "scene-0031")
    self.assertEqual(scene["title"], "Chapter 31")
    self.assertEqual(located.name, "0031-chapter-31.md")
    self.assertEqual(counter.reads, {"0031-chapter-31.md": 2})

  def test_scene_lookup_still_finds_files_whose_name_does_not_match_the_id(self) -> None:
    original = find_scene_file(self.paths, "scene-0005")
    renamed = original.with_name("prologue.md")
    original.rename(renamed)
    self.assertEqual(find_scene_file(self.paths, "scene-0005"), renamed)
    self.assertEqual(get_scene(self.paths, "scene-0005")["path"], "manuscript/scenes/prologue.md")
    custom = self.paths.scenes_dir / "interlude.md"
    custom.write_text("---\nid: interlude-one\ntitle: Interlude\n---\n\nRain.\n", encoding="utf-8")
    self.assertEqual(get_scene(self.paths, "interlude-one")["body"], "Rain.\n")
    with self.assertRaises(OpenAuthorError):
      get_scene(self.paths, "scene-9999")

  def test_frontmatter_id_outranks_a_matching_filename(self) -> None:
    impostor = self.paths.scenes_dir / "0007-impostor.md"
    impostor.write_text("---\nid: scene-7000\ntitle: Elsewhere\n---\n\nElsewhere.\n", encoding="utf-8")
    self.assertEqual(get_scene(self.paths, "scene-0007")["title"], "Chapter 7")
    self.assertEqual(get_scene(self.paths, "scene-7000")["title"], "Elsewhere")

  def test_checkpoint_hashes_untouched_files_once_and_still_records_the_edit(self) -> None:
    with _SceneReadCounter(self.paths.scenes_dir) as counter:
      with checkpointed_edit(self.paths, "Edit one scene") as before:
        update_scene(self.paths, scene_identifier="scene-0002", body="Rewritten prose.")
    untouched = {name: count for name, count in counter.reads.items() if not name.startswith("0002-")}
    self.assertEqual(set(untouched.values()), {1}, untouched)
    after = get_revision(self.paths, revision_head(self.paths))
    earlier = get_revision(self.paths, before)
    changed = {path for path in after["manifest"] if after["manifest"][path] != earlier["manifest"].get(path)}
    self.assertEqual(changed, {"manuscript/scenes/0002-chapter-2.md"})
    self.assertEqual(after["metadata"]["before_revision"], before)

  def test_checkpoint_rereads_a_file_rewritten_in_place_during_the_edit(self) -> None:
    target = find_scene_file(self.paths, "scene-0009")
    with checkpointed_edit(self.paths, "In-place edit") as before:
      # Same length, same inode: only the timestamps reveal the change.
      text = target.read_text(encoding="utf-8")
      target.write_text(text.replace("harbor", "HARBOR"), encoding="utf-8")
    after = get_revision(self.paths, revision_head(self.paths))
    self.assertNotEqual(after["manifest"]["manuscript/scenes/0009-chapter-9.md"], get_revision(self.paths, before)["manifest"]["manuscript/scenes/0009-chapter-9.md"])

  def test_recently_written_files_are_never_trusted_from_the_stat_record(self) -> None:
    for scene_file in self.paths.scenes_dir.glob("*.md"):
      os.utime(scene_file)
    with _SceneReadCounter(self.paths.scenes_dir) as counter:
      with checkpointed_edit(self.paths, "Fresh files"):
        update_scene(self.paths, scene_identifier="scene-0002", body="Rewritten prose.")
    untouched = {name: count for name, count in counter.reads.items() if not name.startswith("0002-")}
    self.assertEqual(set(untouched.values()), {2}, untouched)


if __name__ == "__main__":
  unittest.main()
