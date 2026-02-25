from __future__ import annotations

import base64
import hashlib
import http.server
import json
import os
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path
from typing import Any

from .project import OpenAuthorError

# OpenAI Codex OAuth configuration (public, documented by OpenAI)
CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
CODEX_AUTH_ENDPOINT = "https://auth.openai.com/oauth/authorize"
CODEX_TOKEN_ENDPOINT = "https://auth.openai.com/oauth/token"
CODEX_REDIRECT_PORT = 1455
CODEX_REDIRECT_URI = f"http://localhost:{CODEX_REDIRECT_PORT}/auth/callback"
CODEX_SCOPES = "openid profile email offline_access"

AUTH_DIR = Path.home() / ".openauthor"
AUTH_FILE = AUTH_DIR / "auth.json"

SUPPORTED_AUTH_PROVIDERS = {"openai-codex"}


def _load_auth_store() -> dict[str, Any]:
  if not AUTH_FILE.exists():
    return {}
  try:
    return json.loads(AUTH_FILE.read_text(encoding="utf-8"))
  except (json.JSONDecodeError, OSError):
    return {}


def _save_auth_store(data: dict[str, Any]) -> None:
  AUTH_DIR.mkdir(parents=True, exist_ok=True)
  AUTH_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
  os.chmod(AUTH_FILE, 0o600)


def _generate_pkce() -> tuple[str, str]:
  verifier = secrets.token_urlsafe(64)[:128]
  digest = hashlib.sha256(verifier.encode("ascii")).digest()
  challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
  return verifier, challenge


def get_auth_status() -> dict[str, Any]:
  result: dict[str, Any] = {}
  for provider in SUPPORTED_AUTH_PROVIDERS:
    token = get_access_token(provider)
    if token:
      entry = _load_auth_store().get(provider, {})
      result[provider] = {
        "authenticated": True,
        "email": entry.get("email", ""),
        "expires_at": entry.get("expires_at", ""),
      }
    else:
      result[provider] = {"authenticated": False}
  return result


def get_access_token(provider: str) -> str | None:
  if provider not in SUPPORTED_AUTH_PROVIDERS:
    return None
  store = _load_auth_store()
  entry = store.get(provider)
  if not entry:
    return None

  access_token = entry.get("access_token")
  try:
    expires_at = float(entry.get("expires_at", 0) or 0)
  except (TypeError, ValueError):
    expires_at = 0.0
  refresh_token = entry.get("refresh_token")

  if access_token and time.time() < expires_at - 60:
    return access_token

  if refresh_token:
    try:
      refreshed = _refresh_token(provider, refresh_token)
      entry["access_token"] = refreshed["access_token"]
      entry["expires_at"] = time.time() + refreshed.get("expires_in", 3600)
      if refreshed.get("refresh_token"):
        entry["refresh_token"] = refreshed["refresh_token"]
      store[provider] = entry
      _save_auth_store(store)
      return entry["access_token"]
    except Exception:
      pass

  return None


def _refresh_token(provider: str, refresh_token: str) -> dict[str, Any]:
  if provider == "openai-codex":
    payload = urllib.parse.urlencode({
      "grant_type": "refresh_token",
      "client_id": CODEX_CLIENT_ID,
      "refresh_token": refresh_token,
    }).encode("utf-8")
    req = urllib.request.Request(
      CODEX_TOKEN_ENDPOINT,
      data=payload,
      headers={"Content-Type": "application/x-www-form-urlencoded"},
      method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
      return json.loads(resp.read().decode("utf-8"))
  raise OpenAuthorError(f"Unsupported auth provider: {provider}")


def login(provider: str) -> dict[str, Any]:
  if provider not in SUPPORTED_AUTH_PROVIDERS:
    raise OpenAuthorError(
      f"Unsupported auth provider '{provider}'. "
      f"Supported: {', '.join(sorted(SUPPORTED_AUTH_PROVIDERS))}"
    )

  if provider == "openai-codex":
    return _login_openai_codex()

  raise OpenAuthorError(f"Login not implemented for provider: {provider}")


def logout(provider: str) -> dict[str, Any]:
  store = _load_auth_store()
  removed = provider in store
  if removed:
    del store[provider]
    _save_auth_store(store)
  return {"provider": provider, "removed": removed}


def _login_openai_codex() -> dict[str, Any]:
  verifier, challenge = _generate_pkce()

  state = secrets.token_urlsafe(32)

  params = urllib.parse.urlencode({
    "response_type": "code",
    "client_id": CODEX_CLIENT_ID,
    "redirect_uri": CODEX_REDIRECT_URI,
    "scope": CODEX_SCOPES,
    "state": state,
    "code_challenge": challenge,
    "code_challenge_method": "S256",
  })
  auth_url = f"{CODEX_AUTH_ENDPOINT}?{params}"

  auth_code: str | None = None
  received_state: str | None = None
  server_error: str | None = None

  class CallbackHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:
      nonlocal auth_code, received_state, server_error
      parsed = urllib.parse.urlparse(self.path)
      query = urllib.parse.parse_qs(parsed.query)

      if parsed.path != "/auth/callback":
        self.send_response(404)
        self.end_headers()
        return

      if "error" in query:
        server_error = query["error"][0]
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(
          b"<html><body><h2>Authentication failed</h2>"
          b"<p>You can close this window.</p></body></html>"
        )
        return

      auth_code = query.get("code", [None])[0]
      received_state = query.get("state", [None])[0]

      self.send_response(200)
      self.send_header("Content-Type", "text/html")
      self.end_headers()
      self.wfile.write(
        b"<html><body>"
        b"<h2>Authentication successful</h2>"
        b"<p>You can close this window and return to openAuthor.</p>"
        b"</body></html>"
      )

    def log_message(self, format: str, *args: Any) -> None:
      pass  # Suppress HTTP logs

  server = http.server.HTTPServer(("127.0.0.1", CODEX_REDIRECT_PORT), CallbackHandler)
  server.timeout = 120

  server_thread = threading.Thread(target=lambda: server.handle_request(), daemon=True)
  server_thread.start()

  webbrowser.open(auth_url)

  server_thread.join(timeout=120)
  server.server_close()

  if server_error:
    raise OpenAuthorError(f"OAuth authentication failed: {server_error}")

  if not auth_code:
    raise OpenAuthorError(
      "Authentication timed out. No authorization code received. "
      "Please try again."
    )

  if received_state != state:
    raise OpenAuthorError(
      "OAuth state mismatch. This could indicate a security issue. "
      "Please try again."
    )

  token_data = _exchange_code(auth_code, verifier)

  store = _load_auth_store()
  store["openai-codex"] = {
    "type": "oauth",
    "access_token": token_data["access_token"],
    "refresh_token": token_data.get("refresh_token", ""),
    "expires_at": time.time() + token_data.get("expires_in", 3600),
    "email": "",
  }
  _save_auth_store(store)

  return {
    "provider": "openai-codex",
    "authenticated": True,
    "message": "Successfully authenticated with ChatGPT subscription.",
  }


def _exchange_code(code: str, verifier: str) -> dict[str, Any]:
  payload = urllib.parse.urlencode({
    "grant_type": "authorization_code",
    "client_id": CODEX_CLIENT_ID,
    "code": code,
    "redirect_uri": CODEX_REDIRECT_URI,
    "code_verifier": verifier,
  }).encode("utf-8")

  req = urllib.request.Request(
    CODEX_TOKEN_ENDPOINT,
    data=payload,
    headers={"Content-Type": "application/x-www-form-urlencoded"},
    method="POST",
  )

  try:
    with urllib.request.urlopen(req, timeout=30) as resp:
      return json.loads(resp.read().decode("utf-8"))
  except urllib.error.HTTPError as e:
    body = e.read().decode("utf-8", errors="replace")
    raise OpenAuthorError(
      f"Token exchange failed (HTTP {e.code}): {body}"
    ) from None
