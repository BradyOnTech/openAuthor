from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from openauthor import auth
from openauthor.codex_app_server import CodexAppServerUnavailable


class AuthModuleTests(unittest.TestCase):
  def test_status_reads_chatgpt_account_from_app_server(self) -> None:
    server = MagicMock()
    server.account_status.return_value = {
      "authenticated": True,
      "available": True,
      "email": "writer@example.com",
      "plan_type": "plus",
    }
    context = MagicMock()
    context.__enter__.return_value = server

    with patch.object(auth, "CodexAppServer", return_value=context):
      status = auth.get_auth_status()

    self.assertEqual(
      status["openai-codex"],
      {
        "authenticated": True,
        "available": True,
        "email": "writer@example.com",
        "plan_type": "plus",
      },
    )
    server.account_status.assert_called_once_with(refresh=True)

  def test_status_reports_missing_codex_runtime_without_raising(self) -> None:
    with patch.object(
      auth,
      "CodexAppServer",
      side_effect=CodexAppServerUnavailable("Codex runtime is unavailable."),
    ):
      status = auth.get_auth_status()["openai-codex"]

    self.assertFalse(status["authenticated"])
    self.assertFalse(status["available"])
    self.assertIn("unavailable", status["error"])

  def test_login_uses_app_server_managed_chatgpt_flow(self) -> None:
    server = MagicMock()
    server.login_chatgpt.return_value = {
      "authenticated": True,
      "available": True,
      "email": "writer@example.com",
      "plan_type": "pro",
    }
    context = MagicMock()
    context.__enter__.return_value = server

    with patch.object(auth, "CodexAppServer", return_value=context):
      result = auth.login("openai-codex")

    self.assertTrue(result["authenticated"])
    self.assertEqual(result["plan_type"], "pro")
    self.assertIn("app-server", result["message"])
    server.login_chatgpt.assert_called_once_with()

  def test_logout_clears_only_the_app_server_account(self) -> None:
    server = MagicMock()
    server.logout.return_value = True
    context = MagicMock()
    context.__enter__.return_value = server

    with patch.object(auth, "CodexAppServer", return_value=context):
      result = auth.logout("openai-codex")

    self.assertEqual(result, {"provider": "openai-codex", "removed": True})
    server.logout.assert_called_once_with()


if __name__ == "__main__":
  unittest.main()
