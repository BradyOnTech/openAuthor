from __future__ import annotations

import unittest

from openauthor.assistant.references import (
  ContextReference,
  ReferencePolicy,
  resolve_context_references,
)


class AssistantReferenceTests(unittest.TestCase):
  def test_reference_resolution_is_bounded_deduplicated_and_value_free_in_trace(self) -> None:
    calls: list[str] = []

    def resolve_scene(reference_id: str) -> dict[str, str]:
      calls.append(reference_id)
      return {
        "id": reference_id,
        "title": "Opening",
        "source_path": "manuscript/scenes/scene-0001.md",
        "source_revision": "rev-1",
        "content": "Mara finds the brass key.",
      }

    result = resolve_context_references(
      [
        ContextReference(kind="scene", reference_id="scene-0001"),
        ContextReference(kind="scene", reference_id="scene-0001"),
      ],
      resolvers={"scene": resolve_scene},
      policy=ReferencePolicy(max_references=8, max_content_characters=4000),
    )

    self.assertEqual(calls, ["scene-0001"])
    self.assertEqual(len(result.references), 1)
    resolved = result.references[0]
    self.assertEqual(resolved.kind, "scene")
    self.assertEqual(resolved.reference_id, "scene-0001")
    self.assertEqual(resolved.content, "Mara finds the brass key.")
    self.assertEqual(len(resolved.content_digest), 64)
    self.assertEqual(
      result.trace,
      [
        {
          "kind": "scene",
          "reference_id": "scene-0001",
          "source_path": "manuscript/scenes/scene-0001.md",
          "source_revision": "rev-1",
          "content_digest": resolved.content_digest,
          "truncated": False,
        }
      ],
    )
    self.assertNotIn("content", result.trace[0])

  def test_reference_resolution_rejects_cross_project_results_all_or_nothing(self) -> None:
    def resolve_scene(reference_id: str) -> dict[str, str]:
      return {
        "id": reference_id,
        "project_id": "project-other",
        "content": "Evidence from the wrong project.",
      }

    with self.assertRaisesRegex(RuntimeError, "project identity"):
      resolve_context_references(
        [ContextReference(kind="scene", reference_id="scene-0001")],
        resolvers={"scene": resolve_scene},
        expected_project_id="project-current",
      )


if __name__ == "__main__":
  unittest.main()
