from __future__ import annotations

import json
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
  def test_unspaced_chapters_return_bounded_original_quotes(self) -> None:
    with tempfile.TemporaryDirectory() as folder:
      paths = initialize_project(Path(folder), name="Long Unicode chapter")
      body = "风吹过城墙。" * 200 + "夜雨落在长街。" + "小林没有回头。" * 200
      add_scene(paths, title="Chapter", body=body)
      build_retrieval_index(paths, chunk_words=20, overlap_words=5)
      result = query_retrieval_index(paths, query="夜雨")
      self.assertTrue(result["results"])
      for row in result["results"]:
        self.assertLessEqual(len(row["text"]), 640)
        self.assertIn("夜雨", row["text"])
        self.assertIn(row["text"], body)

  def test_legacy_tokenization_requires_rebuild_even_when_stale_reads_are_allowed(self) -> None:
    with tempfile.TemporaryDirectory() as folder:
      paths = self._seed_project(Path(folder))
      build_retrieval_index(paths)
      # Reproduce the on-disk format produced before Unicode indexing.
      payload = json.loads(paths.retrieval_index_file.read_text())
      payload.pop("tokenizer_version", None)
      paths.retrieval_index_file.write_text(json.dumps(payload))
      self.assertIn("tokenizer_changed", get_retrieval_index_status(paths)["stale_reasons"])
      with self.assertRaisesRegex(OpenAuthorError, "Rebuild"):
        query_retrieval_index(paths, query="cipher", require_fresh=False)
      build_retrieval_index(paths)
      self.assertFalse(get_retrieval_index_status(paths)["stale"])
      self.assertGreater(query_retrieval_index(paths, query="cipher")["result_count"], 0)

  def test_unicode_queries_find_original_passages_without_ascii_fallback(self) -> None:
    with tempfile.TemporaryDirectory() as folder:
      paths = initialize_project(Path(folder), name="Unicode retrieval")
      passages = [
        ("夜雨", "夜雨落在长街。小林看见蓝色的灯。她没有回头。"),
        ("ÉLODIE", "Élodie attend près du café."),
        ("разговор", "Анна помнила разговор у ворот."),
        ("المدينة", "سلمى تنتظر عند بوابة المدينة."),
        ("étoile", "L'e\u0301toile brille."),
        ("雨", "雨。"),
      ]
      for index, (_query, body) in enumerate(passages):
        add_scene(paths, title=f"Excerpt {index + 1}", body=body)
      build_retrieval_index(paths)
      for index, (query, body) in enumerate(passages):
        with self.subTest(query=query):
          result = query_retrieval_index(paths, query=query)
          self.assertGreater(result["result_count"], 0)
          self.assertEqual(result["results"][0]["source_ref"], f"scene-{index + 1:04d}")
          self.assertIn(body, result["results"][0]["text"])

  def test_cached_scene_facts_are_not_returned_after_a_revision(self) -> None:
    with tempfile.TemporaryDirectory() as folder:
      paths = initialize_project(Path(folder), name="Current facts only")
      add_scene(paths, title="Archive", body="The gate was cobalt.")
      add_scene(paths, title="Harbor", body="The sea was cobalt.")
      build_retrieval_index(paths)
      update_scene(paths, scene_identifier="scene-0001", body="The gate was red.")
      result = query_retrieval_index(paths, query="cobalt", require_fresh=False)
      self.assertEqual([row["source_ref"] for row in result["results"]], ["scene-0002"])
      self.assertTrue(result["index"]["stale"])

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
