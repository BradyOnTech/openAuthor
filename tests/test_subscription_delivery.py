from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from openauthor.ai import complete_chat, ProviderExecutionError
from openauthor.project import initialize_project
from openauthor.scenes import add_scene, get_scene
from openauthor.selection_editing import preview_selection, generate_selection
from openauthor.budget import summarize_generation_usage, update_generation_budget_policy


class SubscriptionDeliveryTests(unittest.TestCase):
  def setUp(self):
    temporary = tempfile.TemporaryDirectory()
    self.addCleanup(temporary.cleanup)
    self.root = Path(temporary.name)
    self.paths = initialize_project(self.root / "book", name="Subscription delivery")
    binary = self.root / "codex-contract"
    shutil.copyfile(Path(__file__).parent / "fixtures" / "codex_contract_runtime.py", binary)
    binary.chmod(0o700)
    environment = patch.dict(os.environ, {"OPENAUTHOR_CODEX_BIN": str(binary), "OPENAUTHOR_CODEX_HOME": str(self.root / "auth")})
    environment.start()
    self.addCleanup(environment.stop)

  def test_requested_and_resolved_models_survive_into_result_and_run_log(self):
    result = complete_chat(self.paths, provider="openai-codex", model="codex-recommended", system_prompt="Help write.", user_prompt="Shorten this sentence.")
    log = json.loads((self.paths.root / result["log_path"]).read_text())
    self.assertEqual(log["model"], "codex-recommended")
    self.assertEqual(log["resolved_model"], "resolved-contract-model")
    self.assertEqual(result["resolved_model"], "resolved-contract-model")
    self.assertEqual(log["usage"]["input_tokens"], 230)
    self.assertEqual(log["usage"]["output_tokens"], 15)

  def test_interruption_records_failure_without_a_usable_selection_proposal(self):
    text = "Mara began to count the lights."
    add_scene(self.paths, title="Gate", body=text)
    before = get_scene(self.paths, "scene-0001")["body"]
    args = dict(scene_id="scene-0001", start=0, end=len(text), selected_text=text, action="shorten", provider="openai-codex")
    preview = preview_selection(self.paths, **args)
    with patch.dict(os.environ, {"OPENAUTHOR_TEST_CODEX_STATUS": "interrupted"}):
      with self.assertRaises(ProviderExecutionError):
        generate_selection(self.paths, **args, expected_fingerprint=preview["fingerprint"])
    self.assertEqual(list(self.paths.proposals_dir.glob("*.json")), [])
    self.assertEqual(get_scene(self.paths, "scene-0001")["body"], before)
    logs = list(self.paths.generations_dir.glob("*.json"))
    self.assertEqual(len(logs), 1)
    log = json.loads(logs[0].read_text())
    self.assertEqual(log["status"], "failed")
    self.assertEqual(log["error"]["category"], "incomplete_turn")
    self.assertFalse(log["error"]["retriable"])
    self.assertEqual(log["resolved_model"], "resolved-contract-model")
    self.assertEqual(summarize_generation_usage(self.paths)["daily"]["total_tokens"], 245)
    update_generation_budget_policy(self.paths, daily_tokens=245)
    with self.assertRaisesRegex(Exception, "blocked by budget"):
      complete_chat(self.paths, provider="openai-codex", model="codex-recommended", system_prompt="Help write.", user_prompt="Try again.")
