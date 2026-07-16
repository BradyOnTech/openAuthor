from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from openauthor.canon import (
  add_canon_fact,
  add_arc_state,
  add_open_question,
  add_setup,
  assess_story_memory_impact,
  disposition_diagnostic,
  resolve_setup,
  run_canon_diagnostics,
)
from openauthor.codex import add_entity
from openauthor.project import initialize_project
from openauthor.scenes import add_scene


class CanonMemoryTests(unittest.TestCase):
  def test_conflicts_knowledge_setup_and_dispositions_are_evidence_backed(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Canon")
      add_scene(paths, title="One", pov="Mara", body="Mara sees that the gate is blue.")
      for index in range(2, 8):
        add_scene(paths, title=f"Scene {index}", pov="Mara" if index == 3 else "Ivo", body="The gate is blue." if index == 3 else "A quiet interval.")
      gate = add_entity(paths, kind="location", name="The Gate")
      mara = add_entity(paths, kind="character", name="Mara")
      first = add_canon_fact(
        paths,
        subject_entity_id=gate,
        predicate="color",
        value="blue",
        evidence=[{"scene_id": "scene-0001", "excerpt": "the gate is blue"}],
        knowledge=[{"character_entity_id": mara, "state": "does_not_know", "from_scene_id": "scene-0001"}],
      )
      second = add_canon_fact(
        paths,
        subject_entity_id=gate,
        predicate="color",
        value="red",
        evidence=[{"scene_id": "scene-0002", "excerpt": "painted red"}],
      )
      setup = add_setup(paths, description="The brass key should open something.", setup_scene_id="scene-0001", excerpt="brass key")
      add_open_question(paths, question="Who built the gate?", scene_id="scene-0001", intentionally_unresolved=True)
      add_arc_state(paths, character_entity_id=mara, dimension="trust in Ivo", value="guarded", scene_id="scene-0002", excerpt="A quiet interval.")
      add_arc_state(paths, character_entity_id=mara, dimension="trust in Ivo", value="complete", scene_id="scene-0002", excerpt="A quiet interval.")

      report = run_canon_diagnostics(paths)
      codes = {row["code"] for row in report["diagnostics"]}
      self.assertIn("conflicting_facts", codes)
      self.assertIn("pov_knowledge_leak", codes)
      self.assertIn("unresolved_setup", codes)
      self.assertIn("arc_state_conflict", codes)
      conflict = next(row for row in report["diagnostics"] if row["code"] == "conflicting_facts")
      self.assertEqual(set(conflict["fact_ids"]), {first["id"], second["id"]})
      self.assertGreaterEqual(len(conflict["evidence"]), 2)

      impact = assess_story_memory_impact(
        paths,
        scene_id="scene-0001",
        before_body="Mara sees that the gate is blue.",
        after_body="Mara sees that the gate is colorless.",
      )
      self.assertEqual(impact["risk"], "high")
      self.assertIn(first["id"], {row["id"] for row in impact["affected"]})

      disposition_diagnostic(paths, conflict["id"], disposition="intentional", notes="Unreliable mural descriptions.")
      refreshed = run_canon_diagnostics(paths)
      disposed = next(row for row in refreshed["diagnostics"] if row["id"] == conflict["id"])
      self.assertEqual(disposed["disposition"]["disposition"], "intentional")
      paid = resolve_setup(paths, setup["id"], payoff_scene_id="scene-0007", excerpt="the key turns")
      self.assertEqual(paid["status"], "paid_off")


if __name__ == "__main__":
  unittest.main()
