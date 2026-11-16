from __future__ import annotations

import hashlib
import json
import os
import random
import sys
import tempfile
import time
import unittest
import uuid
from contextlib import ExitStack, redirect_stdout
from io import StringIO
from pathlib import Path
from typing import Any
from unittest.mock import patch

from openauthor import revisions
from openauthor.backups import create_backup, restore_backup, verify_backup
from openauthor.cli import main
from openauthor.codex import add_entity
from openauthor.project import OpenAuthorError, ProjectPaths, atomic_write_json, atomic_write_text, initialize_project, resolve_project, utc_now
from openauthor.proposals import apply_proposal, apply_proposal_batch, create_proposal, set_proposal_draft, undo_proposal, undo_proposal_batch
from openauthor.revisions import (
  FULL_MANIFEST_INTERVAL,
  compare_revisions,
  create_revision,
  get_revision,
  list_revisions,
  read_file_at_revision,
  restore_revision,
  revision_head,
  verify_revision_store,
)
from openauthor.scenes import add_scene, find_scene_file, get_scene, update_scene

try:
  from retention_support import editor_saves, old_history, thin_today
except ImportError:
  from tests.retention_support import editor_saves, old_history, thin_today

_WORDS = (
  "the of and a to in is that it he was for on are as with his they at be this have from or one had by "
  "but not what all were we when your can said there use an each which she do how their if will up other "
  "about out many then them these so some her would make like him into time has look two more write go see "
  "harbor lantern river window courtyard letter promise winter kitchen silence garden station morning shadow "
  "stranger ledger candle bridge orchard ferry gravel whisper copper thimble quarrel almanac drizzle cellar"
).split()


def prose(seed: int, words: int) -> str:
  """Deterministic prose that does not compress better than real writing."""
  rng = random.Random(seed)
  parts = [rng.choice(_WORDS) + rng.choice(("", "", "", "s", "ed", "ing")) for _ in range(words)]
  for index in range(9, len(parts), 13):
    parts[index] += "."
  return " ".join(parts)


def legacy_create_revision(paths: ProjectPaths, message: str, *, kind: str = "manual", metadata: dict[str, Any] | None = None, **_: Any) -> str:
  """Write a Revision exactly as record format 1 did: full manifest, plain objects."""
  revisions.ensure_revision_store(paths)
  manifest: dict[str, str] = {}
  for file_path in revisions._book_files(paths):
    content = file_path.read_text(encoding="utf-8")
    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
    object_path = paths.revision_objects_dir / digest[:2] / digest[2:]
    if not object_path.exists():
      atomic_write_text(object_path, content)
    manifest[file_path.relative_to(paths.root).as_posix()] = digest
  parent = revision_head(paths)
  created_at = utc_now()
  identity = {"parent": parent, "created_at": created_at, "message": message.strip(), "kind": kind.strip() or "manual", "manifest": manifest, "nonce": uuid.uuid4().hex}
  revision_id = hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
  atomic_write_json(paths.revision_records_dir / f"{revision_id}.json", {
    "schema_version": 1, "id": revision_id, "parent": parent, "created_at": created_at,
    "message": message.strip(), "kind": kind.strip() or "manual", "manifest": manifest, "metadata": metadata or {},
  })
  atomic_write_text(paths.revision_head_file, f"{revision_id}\n")
  return revision_id


def book_state(paths: ProjectPaths) -> dict[str, str]:
  return {path.relative_to(paths.root).as_posix(): path.read_text(encoding="utf-8") for path in revisions._book_files(paths)}


def raw_record(paths: ProjectPaths, revision_id: str) -> dict[str, Any]:
  return json.loads((paths.revision_records_dir / f"{revision_id}.json").read_text(encoding="utf-8"))


def store_files(paths: ProjectPaths) -> dict[str, bytes]:
  return {path.relative_to(paths.revisions_dir).as_posix(): path.read_bytes() for path in sorted(paths.revisions_dir.rglob("*")) if path.is_file()}


def digests(state: dict[str, str]) -> dict[str, str]:
  return {relative: hashlib.sha256(content.encode("utf-8")).hexdigest() for relative, content in state.items()}


class MixedStore:
  """A book whose history starts in record format 1 and continues in format 2."""

  def __init__(self, root: Path) -> None:
    self.paths = initialize_project(root, name="Mixed history")
    self.history: list[tuple[str, dict[str, str]]] = []
    for index in range(1, 5):
      add_scene(self.paths, title=f"Chapter {index}", pov="Mara", body=prose(index, 300))
    self._record(legacy_create_revision, "Imported")
    update_scene(self.paths, scene_identifier="scene-0002", body=prose(20, 300))
    self._record(legacy_create_revision, "Second draft")
    update_scene(self.paths, scene_identifier="scene-0003", body=prose(30, 320))
    self._record(legacy_create_revision, "Third draft")
    self.legacy_ids = [revision_id for revision_id, _ in self.history]
    self.legacy_files = store_files(self.paths)

    body = get_scene(self.paths, "scene-0002")["body"]
    update_scene(self.paths, scene_identifier="scene-0002", body=body.rstrip("\n") + " Mara waited by the ferry.\n")
    self._record(create_revision, "Small edit")
    add_scene(self.paths, title="Chapter 5", body=prose(5, 280))
    self._record(create_revision, "Added a scene")
    find_scene_file(self.paths, "scene-0001").unlink()
    self._record(create_revision, "Deleted a scene")
    original = find_scene_file(self.paths, "scene-0004")
    original.rename(original.with_name("0004-the-crossing.md"))
    self._record(create_revision, "Renamed a scene file")
    add_entity(self.paths, kind="character", name="Mara", description="Ferry pilot")
    self._record(create_revision, "Story Memory entry")
    for step in range(6):
      body = get_scene(self.paths, "scene-0002")["body"]
      update_scene(self.paths, scene_identifier="scene-0002", body=body.rstrip("\n") + f" Then she counted {step} lanterns on the far bank.\n")
      self._record(create_revision, f"Autosave {step}")

  def _record(self, writer, message: str) -> None:
    self.history.append((writer(self.paths, message), book_state(self.paths)))


class RevisionStoreFormatTests(unittest.TestCase):
  def setUp(self) -> None:
    directory = tempfile.TemporaryDirectory()
    self.addCleanup(directory.cleanup)
    self.root = Path(directory.name)

  def assert_history_intact(self, paths: ProjectPaths, history: list[tuple[str, dict[str, str]]]) -> None:
    rows = list_revisions(paths, limit=len(history) + 50)
    known = {revision_id for revision_id, _ in history}
    self.assertEqual([row["id"] for row in rows if row["id"] in known], [revision_id for revision_id, _ in reversed(history)])
    counts = {row["id"]: row["file_count"] for row in rows}
    for revision_id, state in history:
      record = get_revision(paths, revision_id)
      self.assertEqual(record["manifest"], digests(state), revision_id)
      self.assertEqual(counts[revision_id], len(state))
      for relative, content in state.items():
        self.assertEqual(read_file_at_revision(paths, revision_id, relative), content)

  def test_mixed_store_lists_diffs_and_restores_every_revision(self) -> None:
    store = MixedStore(self.root / "book")
    paths, history = store.paths, store.history

    versions = [raw_record(paths, revision_id)["schema_version"] for revision_id, _ in history]
    self.assertEqual(versions, [1, 1, 1] + [2] * (len(history) - 3))
    stored = [raw_record(paths, revision_id) for revision_id, _ in history[3:]]
    self.assertTrue(all("manifest_delta" in record and "manifest" not in record for record in stored))
    # The first new record is a difference against a format-1 parent.
    self.assertEqual(stored[0]["manifest_delta"]["distance"], 1)
    packed = [name for name in store_files(paths) if name.endswith(".z")]
    self.assertTrue(any(store_files(paths)[name].startswith(b"openauthor-object 2 zlib-dict ") for name in packed))
    self.assertTrue(any(store_files(paths)[name].startswith(b"openauthor-object 2 zlib\n") for name in packed))

    self.assert_history_intact(paths, history)
    for (base_id, base), (head_id, head) in zip(history, history[1:]):
      comparison = compare_revisions(paths, base_id, head_id)
      expected = {
        relative: "added" if relative not in base else "deleted" if relative not in head else "modified"
        for relative in set(base) | set(head) if base.get(relative) != head.get(relative)
      }
      self.assertEqual({row["path"]: row["status"] for row in comparison["files"]}, expected)
      self.assertEqual(comparison["changed_file_count"], len(expected))
      for row in comparison["files"]:
        self.assertEqual(row["before"], base.get(row["path"], ""))
        self.assertEqual(row["after"], head.get(row["path"], ""))
    # Comparing across the format boundary and across many records works too.
    first, last = history[0], history[-1]
    self.assertEqual(
      {row["path"] for row in compare_revisions(paths, first[0], last[0])["files"]},
      {relative for relative in set(first[1]) | set(last[1]) if first[1].get(relative) != last[1].get(relative)},
    )

    for revision_id, state in history:
      restored = restore_revision(paths, revision_id)
      self.assertEqual(restored["restored_from"], revision_id)
      self.assertEqual(restored["restored_paths"], sorted(state))
      for relative, content in state.items():
        self.assertEqual((paths.root / relative).read_bytes(), content.encode("utf-8"), (revision_id, relative))
    self.assert_history_intact(paths, history)
    health = verify_revision_store(paths)
    self.assertEqual(health["errors"], [])
    self.assertGreaterEqual(health["revision_count"], len(history))
    # Old records and objects are read in place, never rewritten or migrated.
    current = store_files(paths)
    for name, content in store.legacy_files.items():
      if name != "HEAD":
        self.assertEqual(current[name], content, name)

  def test_cli_json_keeps_its_shape_for_both_forms(self) -> None:
    store = MixedStore(self.root / "book")
    previous = Path.cwd()
    os.chdir(store.paths.root)
    self.addCleanup(os.chdir, previous)

    def cli(*arguments: str) -> Any:
      output = StringIO()
      with redirect_stdout(output):
        self.assertEqual(main(list(arguments)), 0)
      return json.loads(output.getvalue())

    rows = cli("revision", "list", "--limit", "50", "--json")
    self.assertEqual(len(rows), len(store.history))
    for row in rows:
      self.assertEqual(list(row), ["id", "parent", "created_at", "message", "kind", "file_count", "metadata"])
    record_keys = ["schema_version", "id", "parent", "created_at", "message", "kind", "manifest", "metadata"]
    for revision_id, state in (store.history[0], store.history[-1]):
      record = cli("revision", "get", "--id", revision_id, "--json")
      self.assertEqual(list(record), record_keys)
      self.assertEqual(record["manifest"], digests(state))
    comparison = cli("revision", "diff", "--base", store.history[2][0], "--head", store.history[3][0], "--json")
    self.assertEqual(list(comparison), ["base_revision", "head_revision", "changed_file_count", "files"])
    self.assertEqual(list(comparison["files"][0]), ["path", "status", "before", "after", "diff"])

  def test_reconstructed_manifests_equal_full_snapshots(self) -> None:
    paths = initialize_project(self.root / "book", name="Differences")
    history: list[tuple[str, dict[str, str]]] = []

    def record(message: str) -> None:
      history.append((create_revision(paths, message), book_state(paths)))

    with patch.object(revisions, "FULL_MANIFEST_INTERVAL", 4):
      for index in range(1, 4):
        add_scene(paths, title=f"Chapter {index}", body=prose(index, 120))
      record("Three scenes")
      for step in range(18):
        action = step % 6
        if action == 0:
          add_scene(paths, title=f"Extra {step}", body=prose(100 + step, 90))
        elif action == 1:
          update_scene(paths, scene_identifier="scene-0002", body=prose(200 + step, 130))
        elif action == 2:
          sorted(paths.scenes_dir.glob("*-extra-*.md"))[0].unlink()
        elif action == 3:
          target = find_scene_file(paths, "scene-0003")
          target.rename(target.with_name(f"0003-renamed-{step}.md"))
        elif action == 4:
          add_entity(paths, kind="location", name=f"Harbor {step}", description="A quay.")
        else:
          # Remove one file and add another in the same Revision.
          find_scene_file(paths, "scene-0001").unlink()
          (paths.scenes_dir / "0001-chapter-1.md").write_text(f"---\nid: scene-0001\ntitle: Chapter 1\n---\n\n{prose(300 + step, 60)}\n", encoding="utf-8")
          add_scene(paths, title=f"Coda {step}", body=prose(400 + step, 40))
        record(f"Step {step}")
        # Each manifest is checked as soon as it is written and again below,
        # after later Revisions have been stacked on top of it.
        self.assertEqual(get_revision(paths, history[-1][0])["manifest"], digests(history[-1][1]))

    for revision_id, state in history:
      self.assertEqual(get_revision(paths, revision_id)["manifest"], digests(state))
      self.assertEqual(raw_record(paths, revision_id)["file_count"], len(state))
    distances = [raw_record(paths, revision_id).get("manifest_delta", {}).get("distance", 0) for revision_id, _ in history]
    # A full manifest, then at most four differences, repeatedly.
    self.assertEqual(distances[:11], [0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0])
    self.assertLessEqual(max(distances), 4)
    self.assertEqual(verify_revision_store(paths)["errors"], [])
    self.assertEqual(verify_revision_store(paths)["revision_count"], len(history))

  def test_full_manifest_is_written_at_the_default_interval(self) -> None:
    paths = initialize_project(self.root / "book", name="Interval")
    add_scene(paths, title="Opening", body="First line.")
    ids = [create_revision(paths, "Start")]
    for step in range(FULL_MANIFEST_INTERVAL + 3):
      update_scene(paths, scene_identifier="scene-0001", body=f"Line {step}.")
      ids.append(create_revision(paths, f"Save {step}"))
    distances = [raw_record(paths, revision_id).get("manifest_delta", {}).get("distance", 0) for revision_id in ids]
    self.assertEqual(distances, [0, *range(1, FULL_MANIFEST_INTERVAL + 1), 0, 1, 2])
    self.assertEqual(read_file_at_revision(paths, ids[FULL_MANIFEST_INTERVAL], get_scene(paths, "scene-0001")["path"]).split("\n\n")[-1].strip(), f"Line {FULL_MANIFEST_INTERVAL - 1}.")

  def _chain(self) -> tuple[ProjectPaths, list[str], dict[str, str]]:
    paths = initialize_project(self.root / "book", name="Damage")
    add_scene(paths, title="One", body=prose(1, 200))
    add_scene(paths, title="Two", body=prose(2, 200))
    ids = [create_revision(paths, "Start")]
    update_scene(paths, scene_identifier="scene-0001", body=prose(3, 200))
    ids.append(create_revision(paths, "Edit one"))
    for step in range(3):
      update_scene(paths, scene_identifier="scene-0002", body=prose(10 + step, 200))
      ids.append(create_revision(paths, f"Edit two {step}"))
    return paths, ids, book_state(paths)

  def assert_unreadable(self, paths: ProjectPaths, revision_id: str, pattern: str) -> None:
    working = book_state(paths)
    head = revision_head(paths)
    for operation in (
      lambda: get_revision(paths, revision_id),
      lambda: read_file_at_revision(paths, revision_id, "manuscript/scenes/0001-one.md"),
      lambda: compare_revisions(paths, revision_id, revision_id, include_unchanged=True),
      lambda: restore_revision(paths, revision_id),
    ):
      with self.assertRaisesRegex(OpenAuthorError, pattern):
        operation()
    self.assertEqual(book_state(paths), working)
    self.assertEqual(revision_head(paths), head)
    health = verify_revision_store(paths)
    self.assertFalse(health["ready"])
    self.assertRegex("; ".join(health["errors"]), pattern)

  def test_missing_ancestor_fails_with_a_clear_error(self) -> None:
    paths, ids, _ = self._chain()
    ancestor = paths.revision_records_dir / f"{ids[2]}.json"
    ancestor.unlink()
    self.assert_unreadable(paths, ids[-1], rf"Revision '{ids[-1]}' cannot be read because an earlier revision it depends on, '{ids[2]}', is missing or damaged")
    # Revisions that do not depend on the missing record stay readable.
    self.assertEqual(len(get_revision(paths, ids[1])["manifest"]), len(get_revision(paths, ids[0])["manifest"]))
    with self.assertRaises(OpenAuthorError):
      list_revisions(paths)

  def test_unparseable_ancestor_fails_with_a_clear_error(self) -> None:
    paths, ids, _ = self._chain()
    (paths.revision_records_dir / f"{ids[1]}.json").write_text("{not json", encoding="utf-8")
    self.assert_unreadable(paths, ids[-1], rf"Revision '{ids[-1]}' cannot be read because an earlier revision it depends on, '{ids[1]}', is missing or damaged")

  def test_altered_ancestor_never_yields_a_wrong_manifest(self) -> None:
    paths, ids, state = self._chain()
    expected = get_revision(paths, ids[-1])["manifest"]
    self.assertEqual(expected, digests(state))
    location = paths.revision_records_dir / f"{ids[1]}.json"
    original = location.read_text(encoding="utf-8")
    record = json.loads(original)
    path_one = "manuscript/scenes/0001-one.md"
    self.assertIn(path_one, record["manifest_delta"]["changed"])

    # A well-formed but different digest for a path no later record touches.
    other = get_revision(paths, ids[0])["manifest"]["manuscript/scenes/0002-two.md"]
    altered = json.loads(original)
    altered["manifest_delta"]["changed"][path_one] = other
    location.write_text(json.dumps(altered), encoding="utf-8")
    self.assert_unreadable(paths, ids[-1], rf"Revision '{ids[-1]}' failed its integrity check")

    # A dropped change, with the file count adjusted to hide it.
    altered = json.loads(original)
    altered["manifest_delta"]["removed"] = [path_one]
    altered["manifest_delta"]["changed"] = {}
    location.write_text(json.dumps(altered), encoding="utf-8")
    self.assert_unreadable(paths, ids[-1], rf"Revision '{ids[-1]}' failed its integrity check")

    # A record whose position in the chain was changed.
    altered = json.loads(original)
    altered["manifest_delta"]["distance"] = 3
    location.write_text(json.dumps(altered), encoding="utf-8")
    self.assert_unreadable(paths, ids[-1], rf"Revision '{ids[-1]}' cannot be read because its recorded changes do not line up")

    location.write_text(original, encoding="utf-8")
    self.assertEqual(get_revision(paths, ids[-1])["manifest"], expected)
    self.assertEqual(verify_revision_store(paths)["errors"], [])

  def test_object_stored_against_a_damaged_object_fails_clearly(self) -> None:
    paths, ids, _ = self._chain()
    scene_two = "manuscript/scenes/0002-two.md"
    body = get_scene(paths, "scene-0002")["body"]
    update_scene(paths, scene_identifier="scene-0002", body=body.rstrip("\n") + " One more sentence.\n")
    latest = create_revision(paths, "Autosave")
    digest = get_revision(paths, latest)["manifest"][scene_two]
    stored = paths.revision_objects_dir / digest[:2] / f"{digest[2:]}.z"
    header = stored.read_bytes().split(b"\n", 1)[0].decode("ascii").split(" ")
    self.assertEqual(header[:3], ["openauthor-object", "2", "zlib-dict"])
    base = header[3]
    self.assertEqual(base, get_revision(paths, ids[-1])["manifest"][scene_two])
    base_file = paths.revision_objects_dir / base[:2] / f"{base[2:]}.z"
    saved = base_file.read_bytes()

    base_file.unlink()
    with self.assertRaisesRegex(OpenAuthorError, rf"Revision object '{digest}' failed its integrity check: object '{base}'"):
      read_file_at_revision(paths, latest, scene_two)
    self.assertFalse(verify_revision_store(paths)["ready"])
    # Other files of the same Revision do not depend on it.
    self.assertTrue(read_file_at_revision(paths, latest, "manuscript/scenes/0001-one.md"))
    # Saving continues: new content is stored self-contained when the earlier
    # version cannot be read.
    update_scene(paths, scene_identifier="scene-0002", body="A fresh start.")
    newest = create_revision(paths, "After damage")
    self.assertIn("A fresh start.", read_file_at_revision(paths, newest, scene_two))

    base_file.write_bytes(saved[:-4] + b"\x00\x00\x00\x00")
    with self.assertRaisesRegex(OpenAuthorError, "integrity check"):
      read_file_at_revision(paths, latest, scene_two)
    base_file.write_bytes(saved)
    self.assertIn("One more sentence.", read_file_at_revision(paths, latest, scene_two))
    self.assertEqual(verify_revision_store(paths)["errors"], [])

  def test_formats_from_a_newer_version_are_refused_not_misread(self) -> None:
    paths, ids, _ = self._chain()
    location = paths.revision_records_dir / f"{ids[-1]}.json"
    original = location.read_text(encoding="utf-8")
    # Format 3 is a record relinked by retention; 4 is the first unknown one.
    location.write_text(json.dumps({**json.loads(original), "schema_version": 4}), encoding="utf-8")
    with self.assertRaisesRegex(OpenAuthorError, rf"Revision '{ids[-1]}' was written in record format 4.*Update openAuthor"):
      get_revision(paths, ids[-1])
    self.assertFalse(verify_revision_store(paths)["ready"])
    location.write_text(original, encoding="utf-8")

    scene_one = "manuscript/scenes/0001-one.md"
    digest = get_revision(paths, ids[-1])["manifest"][scene_one]
    stored = paths.revision_objects_dir / digest[:2] / f"{digest[2:]}.z"
    stored.write_bytes(b"openauthor-object 3 zstd\n" + stored.read_bytes().split(b"\n", 1)[1])
    with self.assertRaisesRegex(OpenAuthorError, rf"Revision object '{digest}' is stored in a form this version of openAuthor cannot read"):
      read_file_at_revision(paths, ids[-1], scene_one)

  def test_new_data_cannot_be_misread_by_a_format_1_reader(self) -> None:
    store = MixedStore(self.root / "book")
    after = store_files(store.paths)
    added = sorted(set(after) - set(store.legacy_files))
    self.assertTrue(added)
    for name in added:
      if name.startswith("records/"):
        # Format-1 readers accept only schema_version 1 and report anything
        # else as invalid Revision metadata.
        self.assertEqual(json.loads(after[name])["schema_version"], 2)
      else:
        # Format-1 readers open "<digest>" as text. Packed data never takes
        # that name, so it is reported missing instead of decoded as prose.
        self.assertTrue(name.startswith("objects/") and name.endswith(".z"), name)

  def test_identical_content_is_stored_once_across_both_forms(self) -> None:
    paths = initialize_project(self.root / "book", name="Deduplication")
    add_scene(paths, title="Opening", body=prose(1, 150))
    legacy = legacy_create_revision(paths, "Format 1")
    before = set(store_files(paths))
    current = create_revision(paths, "Format 2, nothing changed")
    self.assertEqual({name for name in set(store_files(paths)) - before if name.startswith("objects/")}, set())
    self.assertEqual(get_revision(paths, current)["manifest"], get_revision(paths, legacy)["manifest"])
    self.assertEqual(raw_record(paths, current)["manifest_delta"], {"distance": 1, "changed": {}, "removed": []})

  def test_format_1_record_written_on_top_of_format_2_is_read_in_place(self) -> None:
    # An older openAuthor can still record a named version (it does not read
    # the parent to do so). The history then alternates between formats.
    store = MixedStore(self.root / "book")
    paths, history = store.paths, list(store.history)
    update_scene(paths, scene_identifier="scene-0003", body=prose(77, 250))
    history.append((legacy_create_revision(paths, "Named by an older version"), book_state(paths)))
    update_scene(paths, scene_identifier="scene-0003", body=prose(78, 250))
    history.append((create_revision(paths, "Back on the current version"), book_state(paths)))
    self.assertEqual([raw_record(paths, revision_id)["schema_version"] for revision_id, _ in history[-3:]], [2, 1, 2])
    self.assertEqual(raw_record(paths, history[-1][0])["manifest_delta"]["distance"], 1)
    self.assert_history_intact(paths, history)
    health = verify_revision_store(paths)
    self.assertEqual((health["errors"], health["revision_count"]), ([], len(history)))

  def test_editor_saves_stay_small(self) -> None:
    scenes, saves = 40, 12
    paths = initialize_project(self.root / "book", name="Long book")
    for index in range(1, scenes + 1):
      add_scene(paths, title=f"Chapter {index}", pov="Mara", body=prose(index, 600))
    aged = time.time() - 3600
    for scene_file in paths.scenes_dir.glob("*.md"):
      os.utime(scene_file, (aged, aged))
    previous = Path.cwd()
    os.chdir(paths.root)
    self.addCleanup(os.chdir, previous)

    def save(body: str) -> None:
      loaded = get_scene(paths, "scene-0020")
      with redirect_stdout(StringIO()):
        code = main(["scene", "update", "--id", "scene-0020", "--expected-version", json.dumps(loaded["edit_version"]), "--body", body, "--json"])
      self.assertEqual(code, 0)

    body = get_scene(paths, "scene-0020")["body"].rstrip("\n")
    body += " Idris Vale kept the ledger."
    save(body)
    before = store_files(paths)
    for step in range(saves):
      body += " " + prose(900 + step, 14) + " Mara answered him."
      save(body)
    after = store_files(paths)
    added = {name: len(content) for name, content in after.items() if name not in before}
    records = [size for name, size in added.items() if name.startswith("records/")]
    objects = [size for name, size in added.items() if name.startswith("objects/")]
    scene_bytes = len(find_scene_file(paths, "scene-0020").read_bytes())
    self.assertEqual(len(records), saves)
    self.assertGreaterEqual(len(objects), saves)
    # Measured when written: about 650 bytes of record and 150 to 600 bytes of
    # objects per save. A record that repeats the whole manifest is about
    # 4,000 bytes here; a scene stored whole is about 4,000 bytes plain and
    # 1,700 compressed. The limits leave headroom but catch each of those.
    self.assertLessEqual(max(records), 1_200, records)
    self.assertLessEqual(sum(objects), saves * 1_000, objects)
    self.assertLessEqual(sum(added.values()), saves * 1_800, added)
    self.assertLess(sum(added.values()) / saves, scene_bytes / 2)
    # Nothing was thinned to get there: every save is still a readable Revision.
    rows = [row for row in list_revisions(paths, limit=100) if row["kind"] == "author_edit"]
    self.assertGreaterEqual(len(rows), saves)
    relative = find_scene_file(paths, "scene-0020").relative_to(paths.root).as_posix()
    texts = [read_file_at_revision(paths, row["id"], relative) for row in rows[:saves]]
    self.assertEqual(len(set(texts)), saves)
    self.assertEqual(texts[0], (paths.root / relative).read_text(encoding="utf-8"))
    self.assertEqual(verify_revision_store(paths)["errors"], [])

  def _aged(self, thinned: bool) -> ExitStack:
    """Record history weeks ago when the case goes on to thin it."""
    stack = ExitStack()
    if thinned:
      clock = stack.enter_context(old_history())
      # Format-1 records in these tests are stamped by this module's clock.
      stack.enter_context(patch.object(sys.modules[__name__], "utc_now", clock))
    return stack

  def test_backup_round_trips_a_mixed_store_with_history_intact(self) -> None:
    for thinned in (False, True):
      with self.subTest(thinned=thinned):
        root = self.root / ("thinned" if thinned else "plain")
        with self._aged(thinned):
          store = MixedStore(root / "book")
          paths, history = store.paths, store.history
          if thinned:
            editor_saves(paths, "scene-0002", 4, "aside")
        if thinned:
          # The backup is of a store that holds relinked records.
          self.assertEqual(thin_today(paths)["removed_revisions"], 3)
          self.assertIn(3, {raw_record(paths, row["id"])["schema_version"] for row in list_revisions(paths, limit=100)})
        else:
          self.assertEqual(revision_head(paths), history[-1][0])
        head, state, count = revision_head(paths), book_state(paths), len(list_revisions(paths, limit=100))
        archive = root / "book.zip"
        report = create_backup(paths, archive)
        self.assertEqual(report["revision"], head)
        self.assertTrue(verify_backup(archive)["verified"])
        restore_backup(archive, root / "recovered")
        recovered = resolve_project(root / "recovered")

        self.assertEqual(store_files(recovered), {name: content for name, content in store_files(paths).items() if name != "retention.lock"})
        self.assertEqual(revision_head(recovered), head)
        self.assert_history_intact(recovered, history)
        health = verify_revision_store(recovered)
        self.assertEqual((health["errors"], health["revision_count"]), ([], count))
        self.assertEqual(book_state(recovered), state)

        # The recovered book keeps writing on top of every form and can go back.
        update_scene(recovered, scene_identifier="scene-0002", body="Rewritten after recovery.")
        newer = create_revision(recovered, "After recovery")
        self.assertEqual(get_revision(recovered, newer)["manifest"], digests(book_state(recovered)))
        restore_revision(recovered, history[0][0])
        for relative, content in history[0][1].items():
          self.assertEqual((recovered.root / relative).read_bytes(), content.encode("utf-8"))

  def _proposal(self, paths: ProjectPaths, scene_id: str, body: str, **extra: Any) -> str:
    proposal = create_proposal(paths, title=f"Revise {scene_id}", instruction="Tighten", scene_id=scene_id, **extra)
    set_proposal_draft(paths, proposal_id=proposal, proposed_body=body)
    return proposal

  def test_undo_of_an_applied_change_set_restores_exact_bytes(self) -> None:
    for writer, thinned in (("format 2", False), ("format 1", False), ("format 2", True), ("format 1", True)):
      with self.subTest(applied_with=writer, thinned=thinned), self._aged(thinned) as aged:
        store = MixedStore(self.root / f"{writer.replace(' ', '-')}-{thinned}")
        paths = store.paths
        scene_file = find_scene_file(paths, "scene-0003")
        original = scene_file.read_bytes()
        proposal = self._proposal(paths, "scene-0003", "A rewritten scene.\n\nWith two paragraphs.")
        if thinned:
          editor_saves(paths, "scene-0002", 3, "before")
        if writer == "format 1":
          # A Change Set applied before this format existed is undone by the
          # current code from format-1 records and plain objects.
          with patch("openauthor.proposals.create_revision", side_effect=legacy_create_revision):
            applied = apply_proposal(paths, proposal_id=proposal)
          self.assertEqual(raw_record(paths, applied["applied_revision"])["schema_version"], 1)
        else:
          applied = apply_proposal(paths, proposal_id=proposal)
          self.assertEqual(raw_record(paths, applied["applied_revision"])["schema_version"], 2)
        self.assertNotEqual(scene_file.read_bytes(), original)
        if thinned:
          # Weeks pass, with editor saves on both sides of the apply, and
          # most of those saves are thinned before the author undoes it.
          editor_saves(paths, "scene-0002", 3, "after")
          aged.close()
          self.assertEqual(thin_today(paths)["removed_revisions"], 4)
        undone = undo_proposal(paths, proposal_id=proposal)
        self.assertEqual(scene_file.read_bytes(), original)
        self.assertEqual(get_revision(paths, undone["undo_revision"])["kind"], "change_set_undo")
        self.assertEqual(get_revision(paths, revision_head(paths))["manifest"], digests(book_state(paths)))
        self.assertEqual(verify_revision_store(paths)["errors"], [])
        self.assert_history_intact(paths, store.history)

  def test_coordinated_undo_restores_exact_bytes_in_every_scene(self) -> None:
    for writer, thinned in (("format 2", False), ("format 1", False), ("format 2", True), ("format 1", True)):
      with self.subTest(applied_with=writer, thinned=thinned), self._aged(thinned) as aged:
        store = MixedStore(self.root / f"{writer.replace(' ', '-')}-{thinned}")
        paths = store.paths
        files = [find_scene_file(paths, scene_id) for scene_id in ("scene-0002", "scene-0003", "scene-0005")]
        originals = [path.read_bytes() for path in files]
        ids = [
          self._proposal(paths, "scene-0002", "Second scene, revised.", change_group_id="arc"),
          self._proposal(paths, "scene-0005", "Fifth scene, revised.", change_group_id="arc"),
        ]
        if thinned:
          editor_saves(paths, "scene-0003", 3, "before")
        if writer == "format 1":
          with patch("openauthor.proposals.create_revision", side_effect=legacy_create_revision):
            applied = apply_proposal_batch(paths, proposal_ids=ids)
        else:
          applied = apply_proposal_batch(paths, proposal_ids=ids)
        self.assertNotEqual(files[0].read_bytes(), originals[0])
        self.assertNotEqual(files[2].read_bytes(), originals[2])
        if thinned:
          editor_saves(paths, "scene-0003", 3, "after")
          aged.close()
          self.assertEqual(thin_today(paths)["removed_revisions"], 4)
        # Unrelated newer writing in another scene is kept.
        update_scene(paths, scene_identifier="scene-0003", body="Unrelated newer writing.")
        create_revision(paths, "Unrelated work")
        unrelated = files[1].read_bytes()
        result = undo_proposal_batch(paths, applied_revision=applied["applied_revision"])
        self.assertEqual([files[0].read_bytes(), files[2].read_bytes()], [originals[0], originals[2]])
        self.assertEqual(files[1].read_bytes(), unrelated)
        self.assertEqual(get_revision(paths, result["undo_revision"])["kind"], "change_group_undo")
        self.assertEqual(revision_head(paths), result["undo_revision"])
        self.assertEqual(get_revision(paths, result["undo_revision"])["manifest"], digests(book_state(paths)))
        self.assertEqual(verify_revision_store(paths)["errors"], [])
        self.assert_history_intact(paths, store.history)


if __name__ == "__main__":
  unittest.main()
