from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from openauthor.ai import _call_provider, build_generation_context, generate_proposal, generate_proposal_draft
from openauthor.assistant.context import ContextPolicy, ContextRequest, build_context_pack
from openauthor.assistant.runtime import AssistantRuntime
from openauthor.canon import add_canon_fact
from openauthor.chat import create_chat_thread, send_chat_message
from openauthor.codex import add_entity, update_entity
from openauthor.planning import add_act, add_chapter, assign_scene, update_scene_metadata
from openauthor.project import initialize_project
from openauthor.scenes import add_scene, update_scene
from openauthor.storylines import create_storyline, switch_storyline


class ReviewContextTests(unittest.TestCase):
  def pack(self, paths, **kwargs):
    return build_context_pack(paths, ContextRequest(
      thread_id="editorial-review", channel=kwargs.pop("channel", "text"),
      utterance="Review this choice without changing established facts.",
      current_scene_id="scene-0002", **kwargs,
    ), ContextPolicy(retrieval_mode="off"))

  def test_review_neighbors_follow_plan_order_for_chat_voice_and_generation(self):
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Out of order")
      for title in ["Aftermath", "Choice", "Discovery", "Unassigned"]:
        add_scene(paths, title=title, body=title)
      act = add_act(paths, title="The Return")
      chapter = add_chapter(paths, act_id=act["id"], title="A costly choice", synopsis="Mara chooses responsibility over escape.")
      for scene_id in ["scene-0003", "scene-0002", "scene-0001"]:
        assign_scene(paths, scene_id=scene_id, chapter_id=chapter["id"])
      update_scene_metadata(paths, scene_id="scene-0002", timeline_position="Before dawn")
      for channel in ["text", "desktop_voice"]:
        context = self.pack(paths, channel=channel).provider_context
        self.assertEqual([row["id"] for row in context["nearby_scenes"]], ["scene-0003", "scene-0001"])
        frame = context["narrative_frame"]
        self.assertEqual(frame["ordered_scene_ids"], ["scene-0003", "scene-0002", "scene-0001", "scene-0004"])
        self.assertEqual(frame["chapters"][0]["synopsis"], chapter["synopsis"])
        self.assertEqual(next(row for row in frame["scene_positions"] if row["scene_id"] == "scene-0002")["timeline_position"], "Before dawn")
      generated = build_generation_context(paths, scene_id="scene-0002", context_scene_radius=1, codex_limit=8)
      self.assertEqual([row["id"] for row in generated["nearby_scenes"]], ["scene-0003", "scene-0001"])
      self.assertEqual(generated["narrative_frame"], context["narrative_frame"])

  def test_accepted_canon_preserves_evidence_validity_and_character_knowledge(self):
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Evidence aware review")
      add_scene(paths, title="Discovery", body="Ivo's right eye was blind.")
      add_scene(paths, title="Choice", body="Mara took Ivo's hand.")
      ivo = add_entity(paths, kind="character", name="Ivo")
      mara = add_entity(paths, kind="character", name="Mara")
      private = add_entity(paths, kind="character", name="Hidden", ai_visibility="exclude")
      for status in ["accepted", "suggested", "rejected"]:
        fact = add_canon_fact(paths, subject_entity_id=ivo, predicate="right eye", value=f"blind-{status}",
          status=status, evidence=[{"scene_id": "scene-0001", "excerpt": "Ivo's right eye was blind."}],
          valid_from_scene_id="scene-0001", knowledge=[
            {"character_entity_id": mara, "state": "knows", "from_scene_id": "scene-0002"},
            {"character_entity_id": private, "state": "knows"},
          ])
        if status == "accepted":
          accepted_id = fact["id"]
      for visibility in ["ask", "exclude"]:
        subject = add_entity(paths, kind="character", name=visibility, ai_visibility=visibility)
        add_canon_fact(paths, subject_entity_id=subject, predicate="secret", value=f"PRIVATE-{visibility}",
          evidence=[{"scene_id": "scene-0002", "excerpt": "Mara took Ivo's hand."}])
      for context in [self.pack(paths).provider_context, build_generation_context(paths, scene_id="scene-0002", context_scene_radius=1, codex_limit=8)]:
        facts = context.get("accepted_canon", [])
        self.assertEqual([row["id"] for row in facts], [accepted_id])
        self.assertEqual(facts[0]["subject_name"], "Ivo")
        self.assertEqual(facts[0]["validity"]["from_scene_id"], "scene-0001")
        self.assertEqual(facts[0]["knowledge"], [{"character_entity_id": mara, "character_name": "Mara", "state": "knows", "from_scene_id": "scene-0002"}])
        self.assertEqual(facts[0]["evidence"][0]["verification"], "excerpt_present")
        self.assertNotIn("PRIVATE-", json.dumps(context))
        self.assertNotIn(private, json.dumps(context))
      update_scene(paths, scene_identifier="scene-0001", body="The old evidence has been revised.")
      context = self.pack(paths).provider_context
      self.assertEqual(context["accepted_canon"][0]["evidence"][0]["verification"], "excerpt_missing")
      self.assertTrue(context["review_warnings"])

  def test_only_the_active_storyline_intent_reaches_review_and_primary_clears_it(self):
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Storyline aware review")
      add_scene(paths, title="Discovery", body="The door opened.")
      add_scene(paths, title="Choice", body="Mara stayed.")
      storyline = create_storyline(paths, name="Chosen responsibility", hypothesis="Staying completes Mara's arc.",
        protected_constraints=["Seven families survive."], success_criteria="The choice has a visible cost.")
      for channel in ["text", "desktop_voice"]:
        context = self.pack(paths, channel=channel).provider_context
        self.assertEqual(context.get("active_storyline", {}).get("id"), storyline["id"])
        self.assertEqual(context["active_storyline"]["experiment_brief"]["protected_constraints"], ["Seven families survive."])
      generated = build_generation_context(paths, scene_id="scene-0002", context_scene_radius=0, codex_limit=8)
      self.assertEqual(generated["active_storyline"]["experiment_brief"]["success_criteria"], "The choice has a visible cost.")
      switch_storyline(paths, primary=True)
      self.assertEqual(self.pack(paths).provider_context.get("active_storyline"), {})

  def test_required_review_constraints_cannot_be_clipped_or_silently_dropped(self):
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Bounded review")
      add_scene(paths, title="Choice", body="Mara stays.")
      mara = add_entity(paths, kind="character", name="Mara")
      add_canon_fact(paths, subject_entity_id=mara, predicate="constraint", value="Keep this established fact. " * 3000,
        evidence=[{"scene_id": "scene-0001", "excerpt": "Mara stays."}])
      for policy in [ContextPolicy(retrieval_mode="off", input_token_ceiling=8000, max_item_characters=80), ContextPolicy(retrieval_mode="off", max_items=1)]:
        with self.assertRaisesRegex(RuntimeError, "Required Assistant"):
          build_context_pack(paths, ContextRequest(thread_id="bounded", channel="text", utterance="Review", explicit_scene_ids=("scene-0001",)), policy)

  def test_context_reaches_actual_chat_voice_and_prose_draft_prompts(self):
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Review through revision")
      add_scene(paths, title="Choice", body="Mara began to walk toward the door. Seven families survived.")
      mara = add_entity(paths, kind="character", name="Mara", notes="PRIVATE-AUTHOR-NOTE")
      fact = add_canon_fact(paths, subject_entity_id=mara, predicate="duty", value="PROTECTED-SEVEN-FAMILIES",
        evidence=[{"scene_id": "scene-0001", "excerpt": "Seven families survived."}])
      thread = create_chat_thread(paths, title="Discuss", provider="local", mode="chat")
      with patch("openauthor.chat.complete_chat", return_value={"text": "A review for the author."}) as chat:
        response = send_chat_message(paths, thread_id=thread["id"], message="Review Mara's choice.", current_scene_id="scene-0001")
      prepared = AssistantRuntime(paths).prepare(thread_id=thread["id"], channel="desktop_voice", utterance="Review Mara's choice.", current_scene_id="scene-0001")
      with patch("openauthor.ai._call_provider", wraps=_call_provider) as provider:
        proposal = generate_proposal(paths, scene_id="scene-0001", instruction="Tighten sentence rhythm.", provider="local", retrieval_mode="off")
        drafted = generate_proposal_draft(paths, proposal_id=proposal["id"], provider="local")
      self.assertEqual(provider.call_count, 2)
      for prompt in [chat.call_args.kwargs["user_prompt"], prepared["instructions"], *[call.kwargs["user_prompt"] for call in provider.call_args_list]]:
        self.assertIn("PROTECTED-SEVEN-FAMILIES", prompt)
        self.assertIn(fact["id"], prompt)
        self.assertNotIn("PRIVATE-AUTHOR-NOTE", prompt)
      self.assertEqual(response["assistant_message"]["context_used"]["review"]["canon_fact_ids"], [fact["id"]])
      log = json.loads((paths.root / drafted["draft"]["log_path"]).read_text())
      self.assertEqual((log["context_scene_radius"], log["codex_limit"]), (1, 8))

  def test_canon_for_ask_subjects_uses_only_current_request_approval(self):
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Canon permission")
      add_scene(paths, title="Choice", body="Mara kept the route.")
      mara = add_entity(paths, kind="character", name="Mara", ai_visibility="ask")
      fact = add_canon_fact(paths, subject_entity_id=mara, predicate="route", value="The northern road.",
        evidence=[{"scene_id": "scene-0001", "excerpt": "Mara kept the route."}])
      request = dict(thread_id="ask-canon", channel="text", utterance="Discuss Mara.", current_scene_id="scene-0001")
      policy = ContextPolicy(retrieval_mode="off")
      self.assertEqual(build_context_pack(paths, ContextRequest(**request), policy).provider_context["accepted_canon"], [])
      allowed = build_context_pack(paths, ContextRequest(**request, explicit_codex_ids=(mara,), approved_codex_ids=(mara,)), policy)
      self.assertEqual([row["id"] for row in allowed.provider_context["accepted_canon"]], [fact["id"]])
      self.assertEqual(build_context_pack(paths, ContextRequest(**request), policy).provider_context["accepted_canon"], [])
      update_entity(paths, entity_id=mara, ai_visibility="exclude")
      self.assertEqual(build_context_pack(paths, ContextRequest(**request, approved_codex_ids=(mara,)), policy).provider_context["accepted_canon"], [])


if __name__ == "__main__":
  unittest.main()
