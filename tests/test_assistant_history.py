from __future__ import annotations

import unittest

from openauthor.assistant.history import HistoryPolicy, build_history_window


class AssistantHistoryTests(unittest.TestCase):
  def test_history_window_preserves_recent_provider_compatible_conversation(self) -> None:
    window = build_history_window(
      [
        {"role": "user", "content": "First question."},
        {"role": "assistant", "content": "First answer."},
        {"role": "tool", "content": '{"tool":"scene.list","result":[]}'},
      ],
      HistoryPolicy(token_budget=4000),
    )

    self.assertEqual(
      window.messages,
      [
        {"role": "user", "content": "First question."},
        {"role": "assistant", "content": "First answer."},
        {
          "role": "user",
          "content": 'Tool result:\n{"tool":"scene.list","result":[]}',
        },
      ],
    )
    self.assertEqual(window.selected_source_count, 3)
    self.assertEqual(window.omitted_source_count, 0)
    self.assertGreater(window.estimated_tokens, 0)

  def test_history_trace_counts_provider_incompatible_leading_assistant_as_omitted(self) -> None:
    window = build_history_window(
      [
        {"role": "assistant", "content": "Orphaned answer."},
        {"role": "user", "content": "Follow-up one."},
        {"role": "user", "content": "Follow-up two."},
      ],
      HistoryPolicy(token_budget=4000),
    )

    self.assertEqual(
      window.messages,
      [{"role": "user", "content": "Follow-up one.\n\nFollow-up two."}],
    )
    self.assertEqual(window.selected_source_count, 2)
    self.assertEqual(window.omitted_source_count, 1)


if __name__ == "__main__":
  unittest.main()
