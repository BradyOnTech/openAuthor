from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

from openauthor.hardening import collect_performance_baseline
from openauthor.project import resolve_project

ROOT = Path(__file__).resolve().parents[1]


def _load_script(name: str):
  path = ROOT / "scripts" / name
  spec = importlib.util.spec_from_file_location(path.stem, path)
  if spec is None or spec.loader is None:
    raise RuntimeError(f"Unable to load {path}")
  module = importlib.util.module_from_spec(spec)
  spec.loader.exec_module(module)
  return module


class ScaleFixtureTests(unittest.TestCase):
  def test_fixture_generator_creates_requested_artifacts(self) -> None:
    generator = _load_script("create_large_project_fixture.py")
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      manifest = generator.create_large_project_fixture(
        root,
        scenes=12,
        proposals=8,
        generation_runs=6,
        entities=5,
        build_index=True,
      )
      report = collect_performance_baseline(resolve_project(root), repeat=1)

      self.assertEqual(manifest["counts"]["scenes"], 12)
      self.assertTrue(manifest["retrieval"]["present"])
      self.assertEqual(report["counts"]["scenes"], 12)
      self.assertEqual(report["counts"]["proposals"], 8)
      self.assertEqual(report["counts"]["generation_runs"], 6)


if __name__ == "__main__":
  unittest.main()
