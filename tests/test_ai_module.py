from __future__ import annotations

import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import urllib.error

from openauthor.ai import (
  ProviderExecutionError,
  _anthropic_content_blocks,
  _chat_completion_messages,
  _generate_local_draft_text,
  _normalize_chat_history,
  build_generation_context,
  complete_chat,
  generate_proposal,
  generate_proposal_draft,
  preview_proposal_generation,
  regenerate_change_hunk,
)
from openauthor.budget import update_generation_budget_policy
from openauthor.codex import add_entity
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.proposals import create_proposal, set_proposal_draft
from openauthor.retrieval import build_retrieval_index
from openauthor.scenes import add_scene


class AIModuleTests(unittest.TestCase):
  def test_complete_edit_plan_reaches_draft_without_losing_late_constraints(self) -> None:
    long_intent = (
      "Differentiate Tobin and Wren through immediate objectives: Wren tests the "
      "evidence and bargains for repair while Tobin responds with systems expertise "
      "and evades the moral cost of maintaining both factions; do not make either "
      "man disclose who renewed the rule."
    )
    constraints = [
      "Keep third-person past tense.",
      "Retain the order of events.",
      "Keep all narration unchanged.",
      "Do not add backstory.",
      "Preserve all technical facts.",
      "Wren controls the service credential; he is not seeking it from Tobin.",
      "Neither man knows who renewed the inherited rule.",
    ]
    raw_plan = (
      f"# Intent: {long_intent}\n\nConstraints:\n"
      + "\n".join(f"{i + 1}. {line}" for i, line in enumerate(constraints))
      + "\n\nEdit Plan:\n- Replace aphorisms with concrete bargaining."
      + "\n\nContinuity Notes:\n- Keep the renewal's author unknown."
    )
    requests = []

    def provider(**request):
      requests.append(request)
      return {
        "text": raw_plan if len(requests) == 1 else "Tobin put the paper beside the tablet.",
        "input_tokens": 30, "output_tokens": 20, "latency_ms": 1, "attempts": 1,
      }

    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Complete plan handoff")
      add_scene(paths, title="The Same Second", body="Tobin unfolded the paper.")
      with patch("openauthor.ai._call_provider", side_effect=provider):
        proposal = generate_proposal(paths, scene_id="scene-0001", instruction="Revise dialogue.")
        generate_proposal_draft(paths, proposal_id=proposal["id"])

      draft_request = requests[1]
      self.assertIn(long_intent, draft_request["context"]["proposal"]["instruction"])
      for line in constraints:
        self.assertIn(line, draft_request["context"]["proposal"]["instruction"])
        self.assertIn(line, draft_request["user_prompt"])
      log = json.loads((paths.root / proposal["generation"]["log_path"]).read_text())
      self.assertEqual(log["normalization"]["section_item_counts"]["Constraints"], 7)
      self.assertEqual(log["raw_response_text"], raw_plan)

  def test_local_line_edit_preserves_comparative_rather_than(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Preserve comparison")
      add_scene(paths, title="The survey", body="Mara began to trace the route rather than a conclusion.")
      proposal_id = create_proposal(paths, title="Tighten", instruction="Tighten the prose.", scene_id="scene-0001")
      draft = generate_proposal_draft(paths, proposal_id=proposal_id, provider="local")
      self.assertEqual(draft["proposed_body"].strip(), "Mara traced the route rather than a conclusion.")

  def test_chat_generation_log_is_metadata_only_by_default(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Private Chat Logs")
      provider_result = {
        "text": "RESPONSE_SECRET manuscript continuation",
        "tool_calls": [
          {
            "id": "call-private",
            "name": "scene_get",
            "args": {"scene_id": "TOOL_ARGUMENT_SECRET"},
          }
        ],
        "input_tokens": 17,
        "output_tokens": 9,
        "latency_ms": 12,
        "attempts": 1,
      }

      with patch("openauthor.ai._call_provider", return_value=provider_result):
        result = complete_chat(
          paths,
          provider="local",
          model="heuristic-v1",
          system_prompt="SYSTEM_SECRET full project context body",
          user_prompt="USER_SECRET write the next scene",
          history=[
            {
              "role": "tool",
              "tool_call_id": "prior-call",
              "name": "scene_get",
              "content": "TOOL_RESULT_SECRET full scene body",
            }
          ],
          thread_id="thread-private",
          turn_id="turn-private",
          round_index=2,
        )

      log_payload = json.loads((root / result["log_path"]).read_text(encoding="utf-8"))
      serialized = json.dumps(log_payload, sort_keys=True)
      for secret in (
        "SYSTEM_SECRET",
        "USER_SECRET",
        "RESPONSE_SECRET",
        "TOOL_ARGUMENT_SECRET",
        "TOOL_RESULT_SECRET",
      ):
        self.assertNotIn(secret, serialized)

      self.assertEqual(log_payload["content_logging"], "metadata_only")
      self.assertEqual(log_payload["thread_id"], "thread-private")
      self.assertEqual(log_payload["turn_id"], "turn-private")
      self.assertEqual(log_payload["round_index"], 2)
      self.assertEqual(log_payload["usage"]["input_tokens"], 17)
      self.assertEqual(log_payload["usage"]["output_tokens"], 9)
      self.assertEqual(log_payload["tool_call_count"], 1)
      self.assertEqual(log_payload["tool_call_provenance"][0]["name"], "scene_get")
      self.assertIn("arguments_sha256", log_payload["tool_call_provenance"][0])
      self.assertIn("prompt_sha256", log_payload)
      self.assertIn("system_prompt_sha256", log_payload)
      self.assertIn("user_prompt_sha256", log_payload)
      self.assertIn("response_sha256", log_payload)

  def test_chat_generation_log_full_content_requires_explicit_local_audit_opt_in(
    self,
  ) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Audited Chat Logs")
      provider_result = {
        "text": "audited response",
        "tool_calls": [
          {"id": "call-audit", "name": "scene_get", "args": {"scene_id": "scene-1"}}
        ],
        "input_tokens": 4,
        "output_tokens": 3,
        "latency_ms": 2,
        "attempts": 1,
      }

      with patch("openauthor.ai._call_provider", return_value=provider_result):
        result = complete_chat(
          paths,
          provider="local",
          model="heuristic-v1",
          system_prompt="audited system prompt",
          user_prompt="audited user prompt",
          local_audit_full_content=True,
        )

      log_payload = json.loads((root / result["log_path"]).read_text(encoding="utf-8"))
      self.assertEqual(log_payload["content_logging"], "local_audit_full_content")
      self.assertEqual(log_payload["system_prompt"], "audited system prompt")
      self.assertEqual(log_payload["user_prompt"], "audited user prompt")
      self.assertEqual(log_payload["response_text"], "audited response")
      self.assertEqual(log_payload["tool_calls"], provider_result["tool_calls"])

  def test_chat_generation_failure_log_keeps_safe_diagnostics_without_error_body(
    self,
  ) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Private Failure Logs")
      provider_error = ProviderExecutionError(
        "PROVIDER_ERROR_SECRET included a rejected manuscript excerpt",
        category="provider_request_failed",
        retriable=True,
        provider="openai",
        http_status=503,
        attempts=2,
      )

      with patch("openauthor.ai._call_provider", side_effect=provider_error):
        with self.assertRaises(OpenAuthorError):
          complete_chat(
            paths,
            provider="openai",
            model="gpt-test",
            system_prompt="SYSTEM_FAILURE_SECRET",
            user_prompt="USER_FAILURE_SECRET",
            turn_id="turn-failed",
            round_index=0,
          )

      log_path = next((root / ".openauthor" / "generations").glob("gen-*.json"))
      log_payload = json.loads(log_path.read_text(encoding="utf-8"))
      serialized = json.dumps(log_payload, sort_keys=True)
      self.assertNotIn("PROVIDER_ERROR_SECRET", serialized)
      self.assertNotIn("SYSTEM_FAILURE_SECRET", serialized)
      self.assertNotIn("USER_FAILURE_SECRET", serialized)
      self.assertEqual(log_payload["error"]["category"], "provider_request_failed")
      self.assertTrue(log_payload["error"]["retriable"])
      self.assertEqual(log_payload["error"]["http_status"], 503)
      self.assertEqual(log_payload["error"]["attempts"], 2)
      self.assertIn("message_sha256", log_payload["error"])
      self.assertEqual(log_payload["turn_id"], "turn-failed")
      self.assertEqual(log_payload["round_index"], 0)

  def test_local_draft_returns_manuscript_prose_without_instruction_receipt(self) -> None:
    original = (
      "# The Missing Minute\n\n"
      "At exactly noon, the archive clock skipped ahead. "
      "Mara alone remembered the missing thirteen minutes."
    )
    revised = _generate_local_draft_text(
      {"scene": {"body": original}},
      "Tighten pacing while preserving Mara, the archive clock, and all established facts.",
    )

    self.assertTrue(revised.startswith("# The Missing Minute\n\n"))
    self.assertIn("archive clock", revised)
    self.assertIn("Mara", revised)
    self.assertNotIn("Revised per", revised)
    self.assertNotIn("Intent:", revised)
    self.assertNotEqual(revised, original)

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
      self.assertEqual(generation["provider_attempts"], 1)
      self.assertIn("quality_score", generation)
      self.assertIn("quality_tier", generation)
      self.assertIn("quality_flags", generation)
      self.assertIn("Intent:", proposal["instruction"])
      self.assertIn("Constraints:", proposal["instruction"])
      self.assertIn("Edit Plan:", proposal["instruction"])
      self.assertIn("Continuity Notes:", proposal["instruction"])
      self.assertNotIn("..", proposal["instruction"])

      log_path = root / generation["log_path"]
      self.assertTrue(log_path.exists())
      log_payload = json.loads(log_path.read_text(encoding="utf-8"))
      self.assertEqual(log_payload["scene_id"], "scene-0002")
      self.assertEqual(log_payload["provider"], "local")
      self.assertEqual(log_payload["context"]["scene"]["id"], "scene-0002")
      self.assertEqual(log_payload["temperature"], 0.2)
      self.assertEqual(log_payload["max_output_tokens"], 700)
      self.assertEqual(log_payload["context_scene_radius"], 1)
      self.assertEqual(log_payload["codex_limit"], 5)
      self.assertIn("raw_response_text", log_payload)
      self.assertIn("normalized_instruction", log_payload)
      self.assertIn("Intent:", log_payload["normalized_instruction"])
      self.assertIn("normalization", log_payload)
      self.assertIn("normalization_changed", log_payload["normalization"])
      self.assertIn("quality", log_payload)
      self.assertIn("score", log_payload["quality"])
      self.assertIn("tier", log_payload["quality"])
      self.assertIn("flags", log_payload["quality"])
      self.assertEqual(log_payload["usage"]["provider_attempts"], 1)
      nearby_ids = [row["id"] for row in log_payload["context"]["nearby_scenes"]]
      self.assertEqual(nearby_ids, ["scene-0001", "scene-0003"])


  def test_regenerate_change_hunk_preserves_author_feedback(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Hunk Feedback")
      add_scene(
        paths,
        title="The Door",
        body="Elara opened the vault door and listened to the alarms.",
      )
      proposal_id = create_proposal(
        paths,
        title="Bring the danger forward",
        instruction="Tighten the moment without changing established facts.",
        scene_id="scene-0001",
      )
      proposal = set_proposal_draft(
        paths,
        proposal_id=proposal_id,
        proposed_body="Elara tore open the vault door as the alarms began to scream.",
      )
      hunk_id = proposal["change_set"]["hunks"][0]["id"]

      revised = regenerate_change_hunk(
        paths,
        proposal_id=proposal_id,
        hunk_id=hunk_id,
        provider="local",
        feedback="Make the danger arrive sooner without changing Elara's facts.",
      )

      hunk = next(row for row in revised["change_set"]["hunks"] if row["id"] == hunk_id)
      self.assertEqual(hunk["edited_by"], "ai")
      self.assertEqual(
        hunk["regeneration"]["author_feedback"],
        "Make the danger arrive sooner without changing Elara's facts.",
      )

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

  def test_generated_proposal_can_join_a_coordinated_multi_scene_group(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(Path(tmp), name="Coordinated AI")
      add_scene(
        paths,
        title="Approach",
        body="Mara began to cross the bridge toward the burning gate.",
      )

      proposal = generate_proposal(
        paths,
        scene_id="scene-0001",
        instruction="Tighten pacing across the alternate ending.",
        provider="local",
        change_group_id="ending-experiment",
      )

      self.assertEqual(proposal["change_group_id"], "ending-experiment")
      self.assertEqual(proposal["revision_intent"]["scope"], "multi_scene")

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
          expected_context_fingerprint=preview_proposal_generation(paths, scene_id="scene-0001", instruction="test remote provider", provider="openai")["fingerprint"],
        )

      with self.assertRaises(OpenAuthorError):
        generate_proposal(
          paths,
          scene_id="scene-0001",
          instruction="test remote provider",
          provider="anthropic",
          expected_context_fingerprint=preview_proposal_generation(paths, scene_id="scene-0001", instruction="test remote provider", provider="anthropic")["fingerprint"],
        )

      failure_logs = sorted((root / ".openauthor" / "generations").glob("*.json"))
      self.assertGreaterEqual(len(failure_logs), 2)
      payloads = [
        json.loads(path.read_text(encoding="utf-8"))
        for path in failure_logs
      ]
      self.assertTrue(any(item.get("status") == "failed" for item in payloads))
      self.assertTrue(
        all(
          item.get("error", {}).get("category") == "missing_credentials"
          for item in payloads
        )
      )
      self.assertTrue(
        all("temperature" in item and "max_output_tokens" in item for item in payloads)
      )

  def test_openai_retry_succeeds_after_rate_limit(self) -> None:
    class FakeResponse:
      def __init__(self, text: str):
        self._text = text

      def read(self) -> bytes:
        return self._text.encode("utf-8")

      def __enter__(self):
        return self

      def __exit__(self, exc_type, exc, tb) -> bool:
        return False

    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Retry Demo")
      add_scene(
        paths,
        title="Retry Scene",
        summary="",
        pov="",
        status="draft",
        body="Body text for retry flow test.",
      )

      rate_limit_error = urllib.error.HTTPError(
        url="https://api.openai.com/v1/chat/completions",
        code=429,
        msg="Too Many Requests",
        hdrs=None,
        fp=io.BytesIO(b'{"error":{"message":"rate limit"}}'),
      )
      success_payload = json.dumps(
        {
          "choices": [
            {"message": {"content": "Intent:\\n- keep voice\\n\\nEdit Plan:\\n- tighten"}}
          ],
          "usage": {"prompt_tokens": 22, "completion_tokens": 14},
        }
      )

      with patch.dict(
        os.environ,
        {
          "OPENAI_API_KEY": "test-key",
          "OPENAUTHOR_PROVIDER_MAX_RETRIES": "2",
          "OPENAUTHOR_PROVIDER_RETRY_BASE_MS": "1",
        },
        clear=False,
      ):
        with patch(
          "openauthor.ai.urllib.request.urlopen",
          side_effect=[rate_limit_error, FakeResponse(success_payload)],
        ):
          with patch("openauthor.ai.time.sleep", return_value=None):
            proposal = generate_proposal(
              paths,
              scene_id="scene-0001",
              instruction="tighten this scene",
              provider="openai",
              expected_context_fingerprint=preview_proposal_generation(paths, scene_id="scene-0001", instruction="tighten this scene", provider="openai")["fingerprint"],
            )

      self.assertEqual(proposal["generation"]["provider"], "openai")
      self.assertEqual(proposal["generation"]["provider_attempts"], 2)
      self.assertIn("Intent:", proposal["instruction"])
      self.assertIn("Constraints:", proposal["instruction"])
      self.assertIn("Edit Plan:", proposal["instruction"])
      self.assertIn("Continuity Notes:", proposal["instruction"])

  def test_budget_policy_blocks_generation_and_logs_failure(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Budget Block")
      add_scene(
        paths,
        title="Budget Scene",
        summary="",
        pov="",
        status="draft",
        body="Body text for budget policy enforcement checks.",
      )
      update_generation_budget_policy(paths, max_output_tokens=64)

      with self.assertRaises(OpenAuthorError):
        generate_proposal(
          paths,
          scene_id="scene-0001",
          instruction="tighten this scene with stronger transitions",
          provider="local",
          max_output_tokens=128,
        )

      logs = sorted((root / ".openauthor" / "generations").glob("gen-*.json"))
      self.assertGreaterEqual(len(logs), 1)
      payload = json.loads(logs[-1].read_text(encoding="utf-8"))
      self.assertEqual(payload["status"], "failed")
      self.assertEqual(payload["error"]["category"], "budget_policy_violation")
      self.assertIn("violations", payload["error"])

  def test_generation_with_required_retrieval_attaches_citations(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Retrieval Required")
      add_scene(
        paths,
        title="Dockside Signals",
        summary="Neris tracks encoded shipping signals.",
        pov="Neris",
        status="draft",
        body=(
          "Neris tracked ember cipher markers through the dockside manifests "
          "and mapped each route to a hidden vault."
        ),
      )
      add_entity(
        paths,
        kind="item",
        name="Ember Cipher",
        description="Marker key used for vault route manifests.",
      )
      build_retrieval_index(paths)

      proposal = generate_proposal(
        paths,
        scene_id="scene-0001",
        instruction="tighten ember cipher reasoning and route logic",
        provider="local",
        retrieval_mode="required",
        retrieval_limit=4,
      )

      retrieval = proposal["generation"]["retrieval"]
      self.assertEqual(retrieval["mode"], "required")
      self.assertTrue(retrieval["used"])
      self.assertGreaterEqual(retrieval["result_count"], 1)
      self.assertGreaterEqual(len(retrieval["citations"]), 1)
      first_citation = retrieval["citations"][0]
      self.assertIn("source_type", first_citation)
      self.assertIn("chunk_id", first_citation)
      self.assertIn("excerpt", first_citation)

      log_path = root / proposal["generation"]["log_path"]
      log_payload = json.loads(log_path.read_text(encoding="utf-8"))
      self.assertIn("retrieval", log_payload)
      self.assertEqual(log_payload["retrieval"]["mode"], "required")
      self.assertTrue(log_payload["retrieval"]["used"])
      self.assertIn("retrieval", log_payload["context"])

  def test_generation_with_auto_retrieval_degrades_when_index_missing(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Retrieval Auto")
      add_scene(
        paths,
        title="Fallback Scene",
        summary="",
        pov="",
        status="draft",
        body="Fallback generation should proceed without retrieval index.",
      )

      proposal = generate_proposal(
        paths,
        scene_id="scene-0001",
        instruction="tighten pacing with fallback retrieval behavior",
        provider="local",
        retrieval_mode="auto",
      )
      retrieval = proposal["generation"]["retrieval"]
      self.assertEqual(retrieval["mode"], "auto")
      self.assertFalse(retrieval["used"])
      self.assertTrue(retrieval["degraded"])
      self.assertIn("Retrieval index not found", retrieval["error"])

  def test_generation_with_required_retrieval_fails_without_index(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      paths = initialize_project(root, name="Retrieval Required Failure")
      add_scene(
        paths,
        title="No Index",
        summary="",
        pov="",
        status="draft",
        body="Required retrieval should fail without an index.",
      )
      with self.assertRaises(OpenAuthorError):
        generate_proposal(
          paths,
          scene_id="scene-0001",
          instruction="tighten this scene",
          provider="local",
          retrieval_mode="required",
        )

  def test_normalize_chat_history_keeps_structured_tool_entries(self) -> None:
    history = [
      {"role": "user", "content": "Check the scenes."},
      {
        "role": "assistant",
        "content": "Looking now.",
        "tool_calls": [{"id": "call-1", "name": "scene_list", "args": {}}],
      },
      {"role": "tool", "tool_call_id": "call-1", "name": "scene_list", "content": "{}"},
      {"role": "tool", "tool_call_id": "", "content": "dropped: no id"},
      {"role": "assistant", "content": ""},
    ]
    rows = _normalize_chat_history(history)
    self.assertEqual(len(rows), 3)
    self.assertEqual(rows[1]["tool_calls"][0]["id"], "call-1")
    self.assertEqual(rows[2]["role"], "tool")

  def test_chat_completion_messages_translate_tool_entries(self) -> None:
    history = _normalize_chat_history(
      [
        {"role": "user", "content": "Check the scenes."},
        {
          "role": "assistant",
          "content": "",
          "tool_calls": [{"id": "call-1", "name": "scene_list", "args": {"a": 1}}],
        },
        {"role": "tool", "tool_call_id": "call-1", "name": "scene_list", "content": "{}"},
      ]
    )
    messages = _chat_completion_messages(
      system_prompt="sys",
      history=history,
      user_prompt="",
    )
    self.assertEqual(messages[0], {"role": "system", "content": "sys"})
    assistant = messages[2]
    self.assertIsNone(assistant["content"])
    self.assertEqual(assistant["tool_calls"][0]["function"]["name"], "scene_list")
    self.assertEqual(
      json.loads(assistant["tool_calls"][0]["function"]["arguments"]),
      {"a": 1},
    )
    tool = messages[3]
    self.assertEqual(tool["role"], "tool")
    self.assertEqual(tool["tool_call_id"], "call-1")
    # Empty user prompt (a tool-loop continuation) appends no user message.
    self.assertEqual(messages[-1]["role"], "tool")

  def test_anthropic_content_blocks_translate_tool_entries(self) -> None:
    role, blocks = _anthropic_content_blocks(
      {
        "role": "assistant",
        "content": "Looking now.",
        "tool_calls": [{"id": "toolu-1", "name": "scene_list", "args": {}}],
      }
    )
    self.assertEqual(role, "assistant")
    self.assertEqual(blocks[0], {"type": "text", "text": "Looking now."})
    self.assertEqual(blocks[1]["type"], "tool_use")
    self.assertEqual(blocks[1]["id"], "toolu-1")

    role, blocks = _anthropic_content_blocks(
      {"role": "tool", "tool_call_id": "toolu-1", "name": "scene_list", "content": "{}"}
    )
    self.assertEqual(role, "user")
    self.assertEqual(blocks[0]["type"], "tool_result")
    self.assertEqual(blocks[0]["tool_use_id"], "toolu-1")


if __name__ == "__main__":
  unittest.main()
