from __future__ import annotations

import unittest

from openauthor.assistant.tools import DEFAULT_TOOL_REGISTRY


class AssistantToolRegistryTests(unittest.TestCase):
  def test_voice_catalog_exposes_only_read_and_review_first_proposal_tools(self) -> None:
    specs = DEFAULT_TOOL_REGISTRY.provider_specs(channel="desktop_voice")
    wire_names = [spec["name"] for spec in specs]

    self.assertIn("scene_get", wire_names)
    self.assertIn("retrieval_query", wire_names)
    self.assertIn("proposal_add", wire_names)
    self.assertNotIn("codex_add", wire_names)
    self.assertNotIn("branch_switch", wire_names)
    self.assertNotIn("merge_apply", wire_names)
    self.assertEqual(DEFAULT_TOOL_REGISTRY.effect("scene.get"), "read")
    self.assertEqual(DEFAULT_TOOL_REGISTRY.effect("proposal.add"), "propose")


if __name__ == "__main__":
  unittest.main()
