from __future__ import annotations

from typing import Any

from .codex_app_server import (
  CodexAppServer,
  CodexAppServerError,
  CodexAppServerUnavailable,
)
from .project import OpenAuthorError


SUPPORTED_AUTH_PROVIDERS = {"openai-codex"}


def _validate_provider(provider: str) -> None:
  if provider not in SUPPORTED_AUTH_PROVIDERS:
    raise OpenAuthorError(
      f"Unsupported auth provider '{provider}'. "
      f"Supported: {', '.join(sorted(SUPPORTED_AUTH_PROVIDERS))}"
    )


def get_auth_status() -> dict[str, Any]:
  try:
    with CodexAppServer() as server:
      status = server.account_status(refresh=True)
  except CodexAppServerUnavailable as error:
    status = {
      "authenticated": False,
      "available": False,
      "error": str(error),
    }
  except CodexAppServerError as error:
    status = {
      "authenticated": False,
      "available": True,
      "error": str(error),
    }
  return {"openai-codex": status}


def login(provider: str) -> dict[str, Any]:
  _validate_provider(provider)
  try:
    with CodexAppServer() as server:
      status = server.login_chatgpt()
  except CodexAppServerError as error:
    raise OpenAuthorError(f"ChatGPT sign-in failed: {error}") from error
  return {
    "provider": provider,
    **status,
    "message": "ChatGPT is connected through Codex app-server.",
  }


def logout(provider: str) -> dict[str, Any]:
  _validate_provider(provider)
  try:
    with CodexAppServer() as server:
      removed = server.logout()
  except CodexAppServerError as error:
    raise OpenAuthorError(f"ChatGPT sign-out failed: {error}") from error
  return {"provider": provider, "removed": removed}
