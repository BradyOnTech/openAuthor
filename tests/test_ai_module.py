from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from openauthor.ai import build_generation_context, generate_proposal
from openauthor.codex import add_entity
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.scenes import add_scene


class AIModuleTests(unittest.TestCase):
  def test_generate_local_proposal_with_log(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="AI Demo")

      add_entity(paths, kind="character", name="Elara", description="Main POV")
      add_entity(paths, kind="location", name="Rook Station", description="Orbital base")

      add_scene(
        paths,
        title="Arrival",
        summary="Arrival at station",
        pov="Elara",
        status="draft",
        body="Elara docked at Rook Station and checked the empty concourse.",
      )
      add_scene(
        paths,
        title="Concourse",
        summary="First contact",
        pov="Elara",
        status="draft",
        body=(
          "She crossed the concourse and counted maintenance drones while trying to "
          "ignore the alarms that kept strobing overhead."
        ),
      )
      add_scene(
        paths,
        title="Signal Room",
        summary="Decode the signal",
        pov="Elara",
        status="draft",
        body=(
          "In the signal room she replayed every burst and highlighted pattern shifts "
          "that might point to a hidden sender."
        ),
      )

      proposal = generate_proposal(
        paths,
        scene_id="scene-0002",
        instruction="tighten pacing and keep sensory details",
        provider="local",
        context_scene_radius=1,
        codex_limit=5,
      )

      self.assertEqual(proposal["status"], "pending")
      self.assertEqual(proposal["scene_id"], "scene-0002")
      self.assertEqual(proposal["source"], "ai_generate")
      generation = proposal["generation"]
      self.assertEqual(generation["provider"], "local")
      self.assertEqual(generation["model"], "heuristic-v1")
      self.assertIn("input_tokens", generation)
      self.assertIn("output_tokens", generation)
      self.assertIn("Intent:", proposal["instruction"])
      self.assertIn("Constraints:", proposal["instruction"])
      self.assertIn("Edit Plan:", proposal["instruction"])
      self.assertIn("Continuity Notes:", proposal["instruction"])

      log_path = root / generation["log_path"]
      self.assertTrue(log_path.exists())
      log_payload = json.loads(log_path.read_text(encoding="utf-8"))
      self.assertEqual(log_payload["scene_id"], "scene-0002")
      self.assertEqual(log_payload["provider"], "local")
      self.assertEqual(log_payload["context"]["scene"]["id"], "scene-0002")
      self.assertIn("raw_response_text", log_payload)
      self.assertIn("normalized_instruction", log_payload)
      self.assertIn("Intent:", log_payload["normalized_instruction"])
      nearby_ids = [row["id"] for row in log_payload["context"]["nearby_scenes"]]
      self.assertEqual(nearby_ids, ["scene-0001", "scene-0003"])

  def test_generation_context_validates_scene(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Context Demo")
      add_scene(
        paths,
        title="Only Scene",
        summary="One scene",
        pov="",
        status="draft",
        body="One scene body with enough words for a test case.",
      )

      with self.assertRaises(OpenAuthorError):
        build_generation_context(
          paths,
          scene_id="scene-9999",
          context_scene_radius=1,
          codex_limit=5,
        )

  def test_remote_provider_requires_credentials(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Credential Demo")
      add_scene(
        paths,
        title="Credential Scene",
        summary="",
        pov="",
        status="draft",
        body="Body text for credential guardrail test.",
      )

      with self.assertRaises(OpenAuthorError):
        generate_proposal(
          paths,
          scene_id="scene-0001",
          instruction="test remote provider",
          provider="openai",
        )

      with self.assertRaises(OpenAuthorError):
        generate_proposal(
          paths,
          scene_id="scene-0001",
          instruction="test remote provider",
          provider="anthropic",
        )


if __name__ == "__main__":
  unittest.main()
