from __future__ import annotations

import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from openauthor import auth


class AuthModuleTests(unittest.TestCase):
  def test_status_ignores_expired_token_without_refresh(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      auth_dir = Path(tmp) / ".openauthor"
      auth_file = auth_dir / "auth.json"
      auth_dir.mkdir(parents=True, exist_ok=True)
      auth_file.write_text(
        json.dumps(
          {
            "openai-codex": {
              "access_token": "stale-token",
              "refresh_token": "",
              "expires_at": time.time() - 3600,
              "email": "writer@example.com",
            }
          }
        ),
        encoding="utf-8",
      )

      with patch.object(auth, "AUTH_DIR", auth_dir), patch.object(auth, "AUTH_FILE", auth_file):
        status = auth.get_auth_status()

      self.assertIn("openai-codex", status)
      self.assertFalse(status["openai-codex"]["authenticated"])

  def test_status_refreshes_expired_token_when_refresh_token_exists(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      auth_dir = Path(tmp) / ".openauthor"
      auth_file = auth_dir / "auth.json"
      auth_dir.mkdir(parents=True, exist_ok=True)
      auth_file.write_text(
        json.dumps(
          {
            "openai-codex": {
              "access_token": "expired-token",
              "refresh_token": "refresh-token",
              "expires_at": time.time() - 60,
              "email": "writer@example.com",
            }
          }
        ),
        encoding="utf-8",
      )

      with patch.object(auth, "AUTH_DIR", auth_dir), patch.object(auth, "AUTH_FILE", auth_file):
        with patch.object(
          auth,
          "_refresh_token",
          return_value={"access_token": "fresh-token", "expires_in": 1800},
        ) as refresh_mock:
          status = auth.get_auth_status()
          refresh_mock.assert_called_once_with("openai-codex", "refresh-token")

      self.assertTrue(status["openai-codex"]["authenticated"])
      self.assertEqual(status["openai-codex"]["email"], "writer@example.com")
      stored = json.loads(auth_file.read_text(encoding="utf-8"))
      self.assertEqual(stored["openai-codex"]["access_token"], "fresh-token")
      self.assertGreater(float(stored["openai-codex"]["expires_at"]), time.time())


if __name__ == "__main__":
  unittest.main()
