"""Server-side OpenAI Realtime WebRTC negotiation."""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import urllib.error
import urllib.request
from typing import Any

from ..project import OpenAuthorError, ProjectPaths, ensure_project_identity
from .tools import DEFAULT_TOOL_REGISTRY


REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls"


def build_realtime_session_config(
  *,
  model: str,
  voice: str,
  instructions: str,
  channel: str,
  max_output_tokens: int = 1200,
) -> dict[str, Any]:
  if channel not in {"desktop_voice", "mobile_voice"}:
    raise OpenAuthorError(f"Unsupported Realtime channel '{channel}'.")
  if not 1 <= max_output_tokens <= 4096:
    raise OpenAuthorError("Realtime max_output_tokens must be between 1 and 4096.")
  return {
    "type": "realtime",
    "model": model,
    "instructions": instructions,
    "max_output_tokens": max_output_tokens,
    "truncation": "disabled",
    "audio": {
      "input": {
        "transcription": {"model": "gpt-4o-mini-transcribe"},
        "turn_detection": {
          "type": "semantic_vad",
          "eagerness": "low",
          "create_response": True,
          "interrupt_response": True,
        },
      },
      "output": {"voice": voice},
    },
    "tools": DEFAULT_TOOL_REGISTRY.realtime_specs(channel=channel),
    "tool_choice": "auto",
  }


def _multipart_body(*, offer_sdp: str, session: dict[str, Any]) -> tuple[bytes, str]:
  boundary = f"openauthor-{secrets.token_hex(16)}"
  chunks = [
    f"--{boundary}\r\nContent-Disposition: form-data; name=\"sdp\"\r\n\r\n",
    offer_sdp,
    f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"session\"\r\n",
    "Content-Type: application/json\r\n\r\n",
    json.dumps(session, separators=(",", ":")),
    f"\r\n--{boundary}--\r\n",
  ]
  return "".join(chunks).encode("utf-8"), boundary


class RealtimeSessionBroker:
  """Keeps the permanent API key behind the trusted local/hosted runtime."""

  def __init__(self, paths: ProjectPaths) -> None:
    self._paths = paths

  def negotiate(
    self,
    *,
    offer_sdp: str,
    context_pack_id: str,
    instructions: str,
    channel: str = "desktop_voice",
    model: str = "",
    voice: str = "",
    max_output_tokens: int = 1200,
  ) -> dict[str, Any]:
    normalized_offer = offer_sdp.strip()
    if normalized_offer == "":
      raise OpenAuthorError("A WebRTC SDP offer is required.")
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if api_key == "":
      raise OpenAuthorError(
        "OPENAI_API_KEY is required to start an OpenAI Realtime session."
      )
    selected_model = model.strip() or os.getenv(
      "OPENAUTHOR_REALTIME_MODEL", "gpt-realtime"
    ).strip()
    selected_voice = voice.strip() or os.getenv(
      "OPENAUTHOR_REALTIME_VOICE", "marin"
    ).strip()
    session = build_realtime_session_config(
      model=selected_model,
      voice=selected_voice,
      instructions=instructions,
      channel=channel,
      max_output_tokens=max_output_tokens,
    )
    body, boundary = _multipart_body(offer_sdp=normalized_offer, session=session)
    project_id = str(ensure_project_identity(self._paths).get("project_id", ""))
    safety_identifier = hashlib.sha256(project_id.encode("utf-8")).hexdigest()
    request = urllib.request.Request(
      REALTIME_CALLS_URL,
      data=body,
      method="POST",
      headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "OpenAI-Safety-Identifier": safety_identifier,
      },
    )
    try:
      with urllib.request.urlopen(request, timeout=30) as response:
        answer_sdp = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
      raise OpenAuthorError(
        f"OpenAI Realtime session negotiation failed with HTTP {error.code}."
      ) from error
    except urllib.error.URLError as error:
      raise OpenAuthorError("OpenAI Realtime session negotiation was unavailable.") from error
    return {
      "answer_sdp": answer_sdp,
      "context_pack_id": context_pack_id,
      "model": selected_model,
      "voice": selected_voice,
      "channel": channel,
    }
