from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from openauthor.ai import generate_proposal, generate_proposal_draft
from openauthor.chat import create_chat_thread, preview_chat_context
from openauthor.planning import add_act, add_beat, add_chapter, add_scene_note, assign_scene, update_brief
from openauthor.project import initialize_project
from openauthor.scenes import add_scene


class GroundedContextTests(unittest.TestCase):
  def test_large_guidance_reports_clipping_and_preview_does_not_create_a_plan(self) -> None:
    with tempfile.TemporaryDirectory() as folder:
      paths = initialize_project(Path(folder), name="Bounded guidance")
      thread = create_chat_thread(paths, title="Context", provider="local")
      existed = paths.structure_file.exists()
      preview_chat_context(paths, thread_id=thread["id"], message="Plan the novel.")
      self.assertEqual(paths.structure_file.exists(), existed)
      update_brief(paths, synopsis="S" * 50000, style_guide="G" * 50000, outline="O" * 50000, themes=["trust"])
      preview = preview_chat_context(paths, thread_id=thread["id"], message="Plan the novel.")
      story = preview["context"]["story_plan"]
      self.assertEqual(story["limits"]["clipped_fields"], ["brief.outline", "brief.style_guide", "brief.synopsis"])
      self.assertLessEqual(sum(len(value) for value in story["brief"].values()), 24000)
      self.assertEqual(len(story["brief"]["style_guide"]), 6000)

  def test_chat_generation_and_drafting_use_saved_story_guidance_without_private_notes(self) -> None:
    with tempfile.TemporaryDirectory() as folder:
      paths = initialize_project(Path(folder), name="Grounded synthetic story")
      add_scene(paths, title="Archive", body="Mara began to walk into the very quiet archive. The keeper waited for her by the door.")
      add_scene(paths, title="Elsewhere", body="A separate character waits outside the city walls.")
      update_brief(paths, synopsis="SYNOPSIS_ANCHOR", genre="GENRE_ANCHOR", themes=["THEME_ANCHOR"], style_guide="STYLE_ANCHOR", outline="OUTLINE_ANCHOR")
      act = add_act(paths, title="Act One", synopsis="ACT_ANCHOR")
      chapter = add_chapter(paths, act_id=act["id"], title="Chapter One", synopsis="CHAPTER_ANCHOR")
      assign_scene(paths, scene_id="scene-0001", chapter_id=chapter["id"])
      add_beat(paths, scene_id="scene-0001", summary="RELEVANT_BEAT")
      add_beat(paths, scene_id="scene-0002", summary="UNRELATED_BEAT")
      add_scene_note(paths, title="Private scratchpad", content="PRIVATE_NOTE_ANCHOR", scene_id="scene-0001")
      thread = create_chat_thread(paths, title="Context", provider="local")
      before = paths.structure_file.read_bytes()
      preview = preview_chat_context(paths, thread_id=thread["id"], message="What is the next beat?", current_scene_id="scene-0001", context_overrides={"include_recent_scenes_radius": 0})
      self.assertEqual(paths.structure_file.read_bytes(), before, "Preview must not rewrite the author's plan")
      proposal = generate_proposal(paths, scene_id="scene-0001", instruction="Use direct past tense.", provider="local", context_scene_radius=0)
      draft = generate_proposal_draft(paths, proposal_id=proposal["id"], provider="local")
      prompts = [preview["user_prompt"]]
      for result in (proposal, draft):
        prompts.append(json.loads((paths.root / result["generation"]["log_path"]).read_text())["user_prompt"])
      for prompt in prompts:
        for anchor in ("SYNOPSIS_ANCHOR", "GENRE_ANCHOR", "THEME_ANCHOR", "STYLE_ANCHOR", "OUTLINE_ANCHOR", "ACT_ANCHOR", "CHAPTER_ANCHOR", "RELEVANT_BEAT"):
          self.assertIn(anchor, prompt)
        self.assertNotIn("UNRELATED_BEAT", prompt)
        self.assertNotIn("PRIVATE_NOTE_ANCHOR", prompt)
