from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from openauthor.assistant.runtime import AssistantRuntime
from openauthor.chat import create_chat_thread, list_chat_messages
from openauthor.project import initialize_project
from openauthor.scenes import add_scene


class AssistantRuntimeTests(unittest.TestCase):
  def test_prepare_and_record_voice_turn_use_shared_context_and_durable_turns(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Assistant Runtime")
      add_scene(paths, title="Opening", body="Mara finds the key.")
      thread = create_chat_thread(paths, title="Voice", provider="local", mode="agent")
      runtime = AssistantRuntime(paths)

      prepared = runtime.prepare(
        thread_id=thread["id"],
        channel="desktop_voice",
        utterance="What happens next?",
        current_scene_id="scene-0001",
      )
      self.assertEqual(prepared["context_pack"]["channel"], "desktop_voice")
      self.assertIn("scene_get", [tool["name"] for tool in prepared["tools"]])
      self.assertNotIn("merge_apply", [tool["name"] for tool in prepared["tools"]])

      recorded = runtime.record_voice_turn(
        thread_id=thread["id"],
        turn_id="turn-voice-one",
        voice_session_id="voice-session-one",
        user_transcript="What happens next?",
        assistant_transcript="Mara should test the key at the station.",
        context_pack_id=prepared["context_pack"]["pack_id"],
        provider_event_id="evt-final",
        model="gpt-realtime",
      )
      self.assertEqual(recorded["turn"]["status"], "completed")
      self.assertEqual(recorded["turn"]["channel"], "desktop_voice")
      messages = list_chat_messages(paths, thread_id=thread["id"])
      self.assertEqual([row["role"] for row in messages], ["user", "assistant"])
      self.assertTrue(all(row["channel"] == "desktop_voice" for row in messages))


if __name__ == "__main__":
  unittest.main()
