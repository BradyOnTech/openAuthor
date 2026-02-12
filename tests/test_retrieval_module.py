from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from openauthor.codex import add_entity
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.retrieval import (
  build_retrieval_index,
  get_retrieval_index_status,
  query_retrieval_index,
)
from openauthor.scenes import add_scene, update_scene


class RetrievalModuleTests(unittest.TestCase):
  def _seed_project(self, root: Path):
    paths = initialize_project(root, name="Retrieval Demo")
    add_scene(
      paths,
      title="Dockside Arrival",
      summary="Arrival at the station docks.",
      pov="Neris",
      status="draft",
      body=(
        "Neris arrived at the dock and tracked cargo lifts while rain hammered "
        "the station canopy."
      ),
    )
    add_scene(
      paths,
      title="Cipher Vault",
      summary="Decode a hidden message.",
      pov="Neris",
      status="draft",
      body=(
        "In the vault room Neris discovered the ember cipher key. "
        "The ember cipher marked every route to the hidden archive."
      ),
    )
    add_scene(
      paths,
      title="Engine Crawl",
      summary="Repair sequence under pressure.",
      pov="Iven",
      status="draft",
      body=(
        "Iven crawled through the engine duct and replaced fractured conduits "
        "before coolant pressure collapsed."
      ),
    )
    add_entity(
      paths,
      kind="item",
      name="Ember Cipher",
      description="A key phrase used to unlock vault routes and archive markers.",
    )
    return paths

  def test_build_and_status_detect_source_drift(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = self._seed_project(root)

      built = build_retrieval_index(paths, chunk_words=60, overlap_words=15)
      self.assertTrue(built["present"])
      self.assertFalse(built["stale"])
      self.assertGreaterEqual(built["source_count"], 4)
      self.assertGreaterEqual(built["chunk_count"], 4)
      self.assertTrue(paths.retrieval_index_file.exists())

      update_scene(
        paths,
        scene_identifier="scene-0001",
        body=(
          "Neris returned to the dock and noticed a second shipment manifest "
          "hidden under rusted clamps."
        ),
      )
      status = get_retrieval_index_status(paths)
      self.assertTrue(status["present"])
      self.assertTrue(status["stale"])
      self.assertIn("source_digest_changed", status["stale_reasons"])

  def test_query_ranks_scene_with_highest_term_overlap(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = self._seed_project(root)
      build_retrieval_index(paths, chunk_words=80, overlap_words=20)

      result = query_retrieval_index(
        paths,
        query="neris discovered ember cipher key vault room",
        limit=3,
      )
      self.assertEqual(result["query"], "neris discovered ember cipher key vault room")
      self.assertGreaterEqual(result["result_count"], 2)
      top = result["results"][0]
      self.assertEqual(top["source_type"], "scene")
      self.assertEqual(top["source_ref"], "scene-0002")
      self.assertIn("ember", top["matched_terms"])
      self.assertIn("cipher", top["matched_terms"])

  def test_query_require_fresh_blocks_stale_index(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = self._seed_project(root)
      build_retrieval_index(paths)
      update_scene(
        paths,
        scene_identifier="scene-0002",
        summary="Updated summary after indexing.",
      )

      with self.assertRaises(OpenAuthorError):
        query_retrieval_index(
          paths,
          query="ember cipher",
          require_fresh=True,
        )

  def test_query_without_index_raises(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = self._seed_project(root)
      with self.assertRaises(OpenAuthorError):
        query_retrieval_index(paths, query="cipher")


if __name__ == "__main__":
  unittest.main()
