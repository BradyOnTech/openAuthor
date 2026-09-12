from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from openauthor.assistant.context import (
  ContextPolicy,
  ContextRequest,
  build_context_pack,
)
from openauthor.project import initialize_project
from openauthor.scenes import add_scene
from openauthor.planning import update_brief


class AssistantContextPackTests(unittest.TestCase):
  def test_chapter_scope_requires_an_explicit_nonempty_chapter_selection(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Choose Chapter")
      add_scene(paths, title="Other chapter", body="Not the selected chapter.")
      with self.assertRaisesRegex(RuntimeError, "Choose a chapter with at least one scene"):
        build_context_pack(paths, ContextRequest(
          thread_id="empty-chapter", channel="text", utterance="Discuss the ending.",
          scope="chapter", current_scene_id="scene-0001", explicit_scene_ids=(" ",),
        ), ContextPolicy(retrieval_mode="off"))

  def test_selected_chapter_is_the_focus_even_with_another_scene_open(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Chapter Focus")
      for title in ["Other chapter", "The choice", "The cost"]:
        add_scene(paths, title=title, body=f"Prose for {title}.")
      pack = build_context_pack(paths, ContextRequest(
        thread_id="chapter", channel="text", utterance="Discuss the ending.",
        scope="chapter", current_scene_id="scene-0001",
        explicit_scene_ids=("scene-0002", "scene-0003"),
      ), ContextPolicy(retrieval_mode="off", nearby_scene_radius=0))
      self.assertEqual([scene["id"] for scene in pack.provider_context["current_scene"]], ["scene-0002", "scene-0003"])

  def test_author_brief_and_style_guide_reach_text_and_voice_context(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Author Intent")
      update_brief(paths, synopsis="Mara accepts responsibility for the lost streets.", style_guide="Close third person. Keep Ivo's blind right eye consistent.")
      for channel in ["text", "desktop_voice"]:
        with self.subTest(channel=channel):
          pack = build_context_pack(paths, ContextRequest(thread_id="brief", channel=channel, utterance="How should this book end?", scope="project"), ContextPolicy(retrieval_mode="off"))
          self.assertIn("blind right eye", pack.provider_context.get("project_brief", {}).get("style_guide", ""))
          self.assertTrue(any(item.kind == "project_brief" for item in pack.items))

  def test_author_brief_is_budgeted_in_full_even_with_a_short_item_limit(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Required Author Intent")
      request = ContextRequest(thread_id="brief-budget", channel="text", utterance="Discuss the book.", scope="project")
      policy = ContextPolicy(retrieval_mode="off", input_token_ceiling=8000, max_item_characters=100)
      # Confirm that the non-brief overhead fits before adding the long brief.
      build_context_pack(paths, request, policy)
      update_brief(paths, style_guide="Preserve this author constraint. " * 2000)
      with self.assertRaisesRegex(RuntimeError, "Required Assistant input"):
        build_context_pack(paths, request, policy)

  def test_text_and_desktop_voice_share_evidence_selection_and_persist_manifest(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Context Pack Parity")
      add_scene(
        paths,
        title="Opening",
        summary="Mara finds the key.",
        pov="Mara",
        body="Mara finds a warm brass key at noon.",
      )
      policy = ContextPolicy(input_token_ceiling=8000, retrieval_mode="off")
      base = dict(
        thread_id="chat-context",
        utterance="What should Mara notice next?",
        scope="scene",
        current_scene_id="scene-0001",
      )

      text_pack = build_context_pack(
        paths,
        ContextRequest(channel="text", **base),
        policy,
      )
      voice_pack = build_context_pack(
        paths,
        ContextRequest(channel="desktop_voice", **base),
        policy,
      )

      text_sources = [(item.kind, item.source_ref) for item in text_pack.items]
      voice_sources = [(item.kind, item.source_ref) for item in voice_pack.items]
      self.assertEqual(text_sources, voice_sources)
      self.assertLessEqual(text_pack.budget["used"], text_pack.budget["ceiling"])
      self.assertEqual(text_pack.schema_version, 1)
      self.assertNotEqual(text_pack.pack_id, voice_pack.pack_id)
      self.assertTrue(
        (paths.chats_dir / "context-packs" / f"{text_pack.pack_id}.json").exists()
      )
      self.assertEqual(text_pack.provider_context["current_scene"][0]["id"], "scene-0001")

  def test_required_selected_text_fails_closed_when_total_budget_is_too_small(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Context Pack Budget")
      with self.assertRaisesRegex(RuntimeError, "Required Assistant input"):
        build_context_pack(
          paths,
          ContextRequest(
            thread_id="chat-budget",
            channel="mobile_voice",
            utterance="Help",
            scope="scene",
            selected_text="required manuscript evidence " * 100,
          ),
          ContextPolicy(input_token_ceiling=20, retrieval_mode="off"),
        )


if __name__ == "__main__":
  unittest.main()
