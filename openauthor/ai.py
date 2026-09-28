from __future__ import annotations

import hashlib
import http.client
import json
import os
import re
import time
from pathlib import Path
from typing import Any
import urllib.error
import urllib.request
import uuid

from .checks import run_continuity_checks
from .codex import list_entities
from .budget import BudgetPolicyError, enforce_generation_budget
from .auth import get_auth_status
from .codex_app_server import (
  CodexAppServer,
  CodexAppServerError,
  CodexAppServerUnavailable,
)
from .project import OpenAuthorError, ProjectPaths, atomic_write_json, utc_now
from .proposals import create_proposal, edit_change_hunk, get_proposal, set_proposal_draft, _digest_scene_payload
from .proposal_delivery import current_proposal_delivery, recoverable_proposal
from .project_lock import project_write_lock
from .retrieval import get_retrieval_index_status, query_retrieval_index
from .scenes import get_scene, list_scenes

SUPPORTED_PROVIDERS = {"local", "openai", "anthropic", "openrouter", "openai-codex"}
SUPPORTED_RETRIEVAL_MODES = {"off", "auto", "required"}
DEFAULT_MODELS = {
  "local": "heuristic-v1",
  "openai": "gpt-4.1-mini",
  "anthropic": "claude-haiku-4-5",
  "openrouter": "openai/gpt-4.1-mini",
  "openai-codex": "codex-recommended",
}
PROPOSAL_SECTIONS = ("Intent", "Constraints", "Edit Plan", "Continuity Notes")
RETRYABLE_HTTP_STATUSES = {408, 409, 425, 429, 500, 502, 503, 504}


class ChatInterrupted(OpenAuthorError):
  """Raised from an on_delta callback to abort an in-flight chat turn."""


class ProviderExecutionError(OpenAuthorError):
  def __init__(
    self,
    message: str,
    *,
    category: str,
    retriable: bool,
    provider: str,
    http_status: int | None = None,
    attempts: int = 1,
  ) -> None:
    super().__init__(message)
    self.category = category
    self.retriable = retriable
    self.provider = provider
    self.http_status = http_status
    self.attempts = attempts


def _scene_number(scene_id: str) -> int:
  match = re.search(r"scene-(\d+)$", scene_id)
  if not match:
    return 999_999
  return int(match.group(1))


def _truncate(value: str, limit: int) -> str:
  clean = value.strip()
  if len(clean) <= limit:
    return clean
  return clean[: limit - 3].rstrip() + "..."


def _estimate_tokens(value: str) -> int:
  words = re.findall(r"\b\w+\b", value)
  if not words:
    return 0
  return max(1, int(len(words) * 1.35))


def _env_int(name: str, default: int, *, minimum: int) -> int:
  raw = os.getenv(name)
  if raw is None:
    return default
  try:
    value = int(raw)
  except ValueError:
    return default
  return max(minimum, value)


def _retry_settings() -> tuple[int, int]:
  max_retries = _env_int("OPENAUTHOR_PROVIDER_MAX_RETRIES", 2, minimum=0)
  base_ms = _env_int("OPENAUTHOR_PROVIDER_RETRY_BASE_MS", 350, minimum=1)
  return max_retries, base_ms


def get_provider_runtime_config() -> dict[str, Any]:
  max_retries, base_ms = _retry_settings()
  codex_auth = get_auth_status().get("openai-codex", {})
  return {
    "retry": {
      "max_retries": max_retries,
      "base_delay_ms": base_ms,
    },
    "providers": {
      "local": {
        "default_model": DEFAULT_MODELS["local"],
        "credential_present": True,
      },
      "openai": {
        "default_model": DEFAULT_MODELS["openai"],
        "credential_present": bool(os.getenv("OPENAI_API_KEY")),
        "base_url": os.getenv("OPENAUTHOR_OPENAI_BASE_URL", "https://api.openai.com/v1"),
      },
      "anthropic": {
        "default_model": DEFAULT_MODELS["anthropic"],
        "credential_present": bool(os.getenv("ANTHROPIC_API_KEY")),
        "base_url": os.getenv(
          "OPENAUTHOR_ANTHROPIC_BASE_URL",
          "https://api.anthropic.com/v1",
        ),
      },
      "openrouter": {
        "default_model": DEFAULT_MODELS["openrouter"],
        "credential_present": bool(os.getenv("OPENROUTER_API_KEY")),
        "base_url": os.getenv(
          "OPENAUTHOR_OPENROUTER_BASE_URL",
          "https://openrouter.ai/api/v1",
        ),
      },
      "openai-codex": {
        "default_model": DEFAULT_MODELS["openai-codex"],
        "credential_present": bool(codex_auth.get("authenticated", False)),
        "runtime_available": bool(codex_auth.get("available", False)),
        "auth_type": "codex_app_server",
        "email": str(codex_auth.get("email", "")),
        "plan_type": str(codex_auth.get("plan_type", "")),
        "error": str(codex_auth.get("error", "")),
      },
    },
  }


def _http_error_category(status_code: int, details: str) -> str:
  lowered = details.lower()
  if status_code == 429 or "rate limit" in lowered:
    return "rate_limited"
  if status_code in {401, 403}:
    return "auth_error"
  if status_code in {408, 504}:
    return "timeout"
  if 500 <= status_code <= 599:
    return "provider_server_error"
  return "provider_rejected"


def _is_retryable_http_status(status_code: int) -> bool:
  return status_code in RETRYABLE_HTTP_STATUSES


def _json_post(
  *,
  provider: str,
  url: str,
  headers: dict[str, str],
  payload: dict[str, Any],
) -> tuple[dict[str, Any], int]:
  max_retries, base_ms = _retry_settings()
  request = urllib.request.Request(
    url,
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json", **headers},
    method="POST",
  )
  attempts = 0
  while True:
    attempts += 1
    try:
      with urllib.request.urlopen(request, timeout=90) as response:
        body = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
      details = error.read().decode("utf-8", errors="replace")
      category = _http_error_category(error.code, details)
      retriable = _is_retryable_http_status(error.code)
      if retriable and attempts <= max_retries:
        time.sleep((base_ms * (2 ** (attempts - 1))) / 1000.0)
        continue
      raise ProviderExecutionError(
        f"Provider request failed with HTTP {error.code}: {_truncate(details, 280)}",
        category=category,
        retriable=retriable,
        provider=provider,
        http_status=error.code,
        attempts=attempts,
      ) from error
    except (OSError, http.client.HTTPException) as error:
      reason = str(getattr(error, "reason", error))
      category = "timeout" if "timed out" in reason.lower() else "network_error"
      retriable = True
      if retriable and attempts <= max_retries:
        time.sleep((base_ms * (2 ** (attempts - 1))) / 1000.0)
        continue
      raise ProviderExecutionError(
        f"Provider request failed: {reason}",
        category=category,
        retriable=retriable,
        provider=provider,
        attempts=attempts,
      ) from error

    try:
      return json.loads(body), attempts
    except json.JSONDecodeError as error:
      raise ProviderExecutionError(
        f"Provider returned non-JSON response: {_truncate(body, 220)}",
        category="invalid_provider_response",
        retriable=False,
        provider=provider,
        attempts=attempts,
      ) from error


def _sse_data_lines(response: Any) -> Any:
  for raw_line in response:
    line = raw_line.decode("utf-8").strip()
    if not line.startswith("data:"):
      continue
    data = line[len("data:") :].strip()
    if data == "":
      continue
    if data == "[DONE]":
      yield data
      return
    yield json.loads(data)


def _stream_post(
  *,
  provider: str,
  url: str,
  headers: dict[str, str],
  payload: dict[str, Any],
  consume: Any,
) -> tuple[dict[str, Any], int]:
  """POST an SSE request; `consume` reads parsed data frames and returns the
  final result. Connection failures retry like `_json_post`, but only while
  no stream data has been consumed (a partial stream is never replayed)."""
  max_retries, base_ms = _retry_settings()
  request = urllib.request.Request(
    url,
    data=json.dumps(payload).encode("utf-8"),
    headers={
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
      **headers,
    },
    method="POST",
  )
  attempts = 0
  while True:
    attempts += 1
    started = {"value": False}

    def _frames(response: Any) -> Any:
      for frame in _sse_data_lines(response):
        started["value"] = True
        if isinstance(frame, dict) and frame.get("error"):
          raise ProviderExecutionError(
            f"Provider stream failed: {_truncate(str(frame['error']), 280)}",
            category="provider_stream_error", retriable=False, provider=provider,
            attempts=attempts,
          )
        yield frame

    try:
      with urllib.request.urlopen(request, timeout=90) as response:
        return consume(_frames(response)), attempts
    except urllib.error.HTTPError as error:
      details = error.read().decode("utf-8", errors="replace")
      category = _http_error_category(error.code, details)
      retriable = _is_retryable_http_status(error.code) and not started["value"]
      if retriable and attempts <= max_retries:
        time.sleep((base_ms * (2 ** (attempts - 1))) / 1000.0)
        continue
      raise ProviderExecutionError(
        f"Provider stream failed with HTTP {error.code}: {_truncate(details, 280)}",
        category=category,
        retriable=retriable,
        provider=provider,
        http_status=error.code,
        attempts=attempts,
      ) from error
    except (OSError, http.client.HTTPException) as error:
      reason = str(getattr(error, "reason", error))
      category = "timeout" if "timed out" in reason.lower() else "network_error"
      retriable = not started["value"]
      if retriable and attempts <= max_retries:
        time.sleep((base_ms * (2 ** (attempts - 1))) / 1000.0)
        continue
      raise ProviderExecutionError(
        f"Provider stream failed: {reason}",
        category=category,
        retriable=retriable,
        provider=provider,
        attempts=attempts,
      ) from error
    except (ValueError, UnicodeError) as error:
      raise ProviderExecutionError(
        "Provider returned an invalid stream. Retry the request explicitly.",
        category="invalid_provider_response", retriable=False, provider=provider,
        attempts=attempts,
      ) from error
    except ProviderExecutionError as error:
      error.attempts = attempts
      raise


def _openai_style_stream(
  *,
  provider: str,
  url: str,
  headers: dict[str, str],
  payload: dict[str, Any],
  on_delta: Any,
) -> dict[str, Any]:
  request_payload = {
    **payload,
    "stream": True,
    "stream_options": {"include_usage": True},
  }

  def consume(frames: Any) -> dict[str, Any]:
    parts: list[str] = []
    usage: dict[str, Any] = {}
    completed = False
    for frame in frames:
      if frame == "[DONE]":
        completed = True
        break
      if not isinstance(frame, dict):
        continue
      frame_usage = frame.get("usage")
      if isinstance(frame_usage, dict):
        usage = frame_usage
      choices = frame.get("choices") or []
      if not choices or not isinstance(choices[0], dict):
        continue
      delta = choices[0].get("delta", {})
      content = delta.get("content") if isinstance(delta, dict) else None
      if isinstance(content, str) and content != "":
        parts.append(content)
        on_delta(content)
    if not completed:
      raise ProviderExecutionError(
        "Provider response was incomplete. Retry the request explicitly.",
        category="incomplete_stream", retriable=False, provider=provider,
      )
    return {"text": "".join(parts).strip(), "usage": usage}

  result, attempts = _stream_post(
    provider=provider,
    url=url,
    headers=headers,
    payload=request_payload,
    consume=consume,
  )
  usage = result["usage"]
  return {
    "text": result["text"],
    "input_tokens": int(usage.get("prompt_tokens", 0) or 0),
    "output_tokens": int(usage.get("completion_tokens", 0) or 0),
    "raw_usage": usage,
    "attempts": attempts,
  }


def _anthropic_stream(
  *,
  url: str,
  headers: dict[str, str],
  payload: dict[str, Any],
  on_delta: Any,
) -> dict[str, Any]:
  request_payload = {**payload, "stream": True}

  def consume(frames: Any) -> dict[str, Any]:
    parts: list[str] = []
    input_tokens = 0
    output_tokens = 0
    completed = False
    for frame in frames:
      if not isinstance(frame, dict):
        continue
      frame_type = frame.get("type", "")
      if frame_type == "message_stop":
        completed = True
        break
      elif frame_type == "message_start":
        message_usage = frame.get("message", {}).get("usage", {})
        if isinstance(message_usage, dict):
          input_tokens = int(message_usage.get("input_tokens", 0) or 0)
      elif frame_type == "content_block_delta":
        delta = frame.get("delta", {})
        text = delta.get("text") if isinstance(delta, dict) else None
        if isinstance(text, str) and text != "":
          parts.append(text)
          on_delta(text)
      elif frame_type == "message_delta":
        delta_usage = frame.get("usage", {})
        if isinstance(delta_usage, dict):
          output_tokens = int(delta_usage.get("output_tokens", 0) or 0)
    if not completed:
      raise ProviderExecutionError(
        "Provider response was incomplete. Retry the request explicitly.",
        category="incomplete_stream", retriable=False, provider="anthropic",
      )
    return {
      "text": "".join(parts).strip(),
      "input_tokens": input_tokens,
      "output_tokens": output_tokens,
    }

  result, attempts = _stream_post(
    provider="anthropic",
    url=url,
    headers=headers,
    payload=request_payload,
    consume=consume,
  )
  return {
    "text": result["text"],
    "input_tokens": result["input_tokens"],
    "output_tokens": result["output_tokens"],
    "raw_usage": {
      "input_tokens": result["input_tokens"],
      "output_tokens": result["output_tokens"],
    },
    "attempts": attempts,
  }


def _stream_local_text(text: str, on_delta: Any) -> None:
  words = text.split(" ")
  chunk_size = 6
  for start in range(0, len(words), chunk_size):
    chunk = " ".join(words[start : start + chunk_size])
    if start + chunk_size < len(words):
      chunk += " "
    on_delta(chunk)


def _load_pricing(paths: ProjectPaths) -> dict[str, Any]:
  try:
    return json.loads(paths.pricing_file.read_text(encoding="utf-8"))
  except FileNotFoundError:
    return {}
  except json.JSONDecodeError as error:
    raise OpenAuthorError(
      f"Invalid provider pricing JSON at {paths.pricing_file}."
    ) from error


def _estimate_cost_usd(
  paths: ProjectPaths,
  *,
  provider: str,
  model: str,
  input_tokens: int,
  output_tokens: int,
) -> float | None:
  if provider == "openai-codex":
    return 0.0
  pricing = _load_pricing(paths)
  provider_block = pricing.get(provider, {})
  model_block = provider_block.get(model)
  if not isinstance(model_block, dict):
    return None

  input_rate = model_block.get("input_per_million")
  output_rate = model_block.get("output_per_million")
  if not isinstance(input_rate, (int, float)):
    return None
  if not isinstance(output_rate, (int, float)):
    return None

  cost = (input_tokens / 1_000_000) * float(input_rate) + (
    output_tokens / 1_000_000
  ) * float(output_rate)
  return round(cost, 8)


def _generate_local_text(context: dict[str, Any], instruction: str) -> str:
  scene = context["scene"]
  scene_title = scene["title"]
  scene_summary = scene["summary"] or "No summary provided"
  scene_pov = scene["pov"] or "No POV specified"
  continuity_issues = context["continuity_issues"]
  codex_entities = context["codex_entities"]

  focus = instruction.strip()
  if focus and focus[-1] not in ".!?":
    focus = f"{focus}."
  aligned_summary = scene_summary.rstrip()
  if aligned_summary and aligned_summary[-1] not in ".!?":
    aligned_summary = f"{aligned_summary}."

  constraint_lines = [
    f"Preserve POV voice: {scene_pov}.",
    f"Stay aligned with summary: {aligned_summary}",
  ]
  if codex_entities:
    anchors = ", ".join(entity["name"] for entity in codex_entities[:3])
    constraint_lines.append(f"Respect codex anchors: {anchors}.")

  continuity_lines = (
    [
      f"{issue['title']}: {issue['message']}"
      for issue in continuity_issues[:3]
    ]
    if continuity_issues
    else ["No blocking continuity issues detected for this scene."]
  )

  return (
    "Intent:\n"
    f"- Refine scene '{scene_title}' with focus on: {focus}\n\n"
    "Constraints:\n"
    + "\n".join(f"- {line}" for line in constraint_lines)
    + "\n\nEdit Plan:\n"
    "- Tighten sentence rhythm and reduce exposition where possible.\n"
    "- Keep motivations and timeline continuity explicit.\n"
    "- Preserve existing voice markers while improving clarity.\n\n"
    "Continuity Notes:\n"
    + "\n".join(f"- {line}" for line in continuity_lines)
  )


def _generate_local_draft_text(context: dict[str, Any], instruction: str) -> str:
  scene = context.get("scene", {})
  body = str(scene.get("body", "")).rstrip()
  if not body:
    return ""

  # The local provider is deliberately deterministic, but it must still
  # produce manuscript prose rather than leak an instruction receipt into the
  # novel. Prefer conservative line edits that preserve nouns and facts.
  heading = ""
  prose = body
  if body.lstrip().startswith("#") and "\n\n" in body:
    heading, prose = body.split("\n\n", 1)
  lowered = instruction.casefold()
  paragraphs = prose.split("\n\n")
  nonempty_paragraphs = [index for index, paragraph in enumerate(paragraphs) if paragraph.strip()]
  targets_ending = any(
    phrase in lowered
    for phrase in ("final paragraph", "last paragraph", "final sentence", "last sentence", "ending")
  )
  target_index = nonempty_paragraphs[-1] if targets_ending and nonempty_paragraphs else None
  working = paragraphs[target_index] if target_index is not None else prose
  def direct_past(match: re.Match[str]) -> str:
    verb = match.group(1)
    lowered_verb = verb.casefold()
    if lowered_verb.endswith("e"):
      return f"{verb}d"
    if lowered_verb.endswith("y") and len(verb) > 1 and lowered_verb[-2] not in "aeiou":
      return f"{verb[:-1]}ied"
    return f"{verb}ed"

  cleanup_patterns = [
    (r"\bbegan to\s+([A-Za-z'-]+)", direct_past),
    (r"\bstarted to\s+([A-Za-z'-]+)", direct_past),
    (r"\bin order to\b", "to"),
    (r"\bvery\s+", ""),
    (r"\breally\s+", ""),
  ]
  if any(word in lowered for word in ("tighten", "reduce", "concise", "clarity")):
    cleanup_patterns.append((r"\b(?:somewhat|rather|quite)\s+", ""))
  for pattern, replacement in cleanup_patterns:
    working = re.sub(pattern, replacement, working, count=1, flags=re.IGNORECASE)

  if any(word in lowered for word in ("pace", "pacing", "tension", "suspense", "urgent", "momentum")):
    working = re.sub(r"\bAt exactly\b", "At", working, count=1)
    working = re.sub(
      r"\b([A-Z][A-Za-z'-]*) alone ([a-z]+(?:ed|s))\b",
      lambda match: f"Only {match.group(1)} {match.group(2)}",
      working,
      count=1,
    )
  if any(word in lowered for word in ("ominous", "menace", "dread", "unease")):
    # A deliberately small, fact-preserving tonal shift for the offline
    # fallback. "Found" adds agency without inventing an event or entity.
    working = re.sub(r"\breached\b", "found", working, count=1, flags=re.IGNORECASE)
    working = re.sub(r"\barrived at\b", "found", working, count=1, flags=re.IGNORECASE)
  if "dialogue" in lowered:
    working = re.sub(r'([.!?])"\s+(?:he|she|they) (?:said|asked) ([a-z]+ly)\.', r'\1"', working, count=1, flags=re.IGNORECASE)

  if target_index is not None:
    paragraphs[target_index] = working
    revised = "\n\n".join(paragraphs)
  else:
    revised = working

  if revised == prose:
    # Last-resort punctuation tightening is still a prose edit. Never manufacture
    # a Change Set by changing paragraph whitespace alone.
    revised = re.sub(r",\s+(but|yet|though)\s+", lambda match: f". {match.group(1).capitalize()} ", revised, count=1, flags=re.IGNORECASE)
  revised = revised.strip()
  return f"{heading}\n\n{revised}".strip() if heading else revised


def _generate_local_merge_text(context: dict[str, Any], instruction: str) -> str:
  ours = str(context.get("ours_body", "")).strip()
  theirs = str(context.get("theirs_body", "")).strip()
  base = str(context.get("merge_base_label", "base"))
  head = str(context.get("merge_head_label", "head"))
  parts = [part for part in (ours, theirs) if part]
  combined = "\n\n".join(parts)
  return f"{combined}\n\n(Reconciled '{base}' and '{head}' revisions.)".strip()


def _generate_local_chat_result(
  user_prompt: str,
  *,
  tools_enabled: bool,
) -> tuple[str, list[dict[str, Any]]]:
  lowered = user_prompt.lower()
  if tools_enabled:
    if user_prompt.strip() == "":
      return (
        "I reviewed the tool results and folded them into my guidance:\n"
        "- Keep motivations and continuity anchors explicit.\n"
        "- Flag any conflicts for review before drafting.",
        [],
      )
    if "list scenes" in lowered:
      return (
        "I can help by listing scenes.",
        [{"id": "local-call-1", "name": "scene_list", "args": {}}],
      )
    if "continuity" in lowered and "check" in lowered:
      return (
        "I can run continuity checks.",
        [{"id": "local-call-1", "name": "check_continuity", "args": {}}],
      )
    if "create proposal" in lowered:
      return (
        "I can draft a proposal card.",
        [
          {
            "id": "local-call-1",
            "name": "proposal_add",
            "args": {
              "title": "Agent Draft",
              "instruction": "Intent:\n- Refine scene beats.",
              "scene_id": "scene-0001",
            },
          }
        ],
      )
  context: dict[str, Any] = {}
  marker = "\n\nContext JSON:\n"
  if marker in user_prompt:
    try:
      decoded = json.loads(user_prompt.split(marker, 1)[1].strip())
      if isinstance(decoded, dict):
        context = decoded
    except json.JSONDecodeError:
      context = {}

  scenes = context.get("current_scene", [])
  scene_rows = [row for row in scenes if isinstance(row, dict)] if isinstance(scenes, list) else []
  if scene_rows:
    scene = scene_rows[0]
    title = str(scene.get("title", "this scene")).strip() or "this scene"
    pov = str(scene.get("pov", "the protagonist")).strip() or "the protagonist"
    body = str(scene.get("body", ""))
    missing_matches = list(re.finditer(
      r"\bmissing\s+(?:[A-Za-z0-9'-]+\s+){0,2}(?:minutes?|hours?|days?|memory|time)\b",
      body,
      flags=re.IGNORECASE,
    ))
    missing = max(missing_matches, key=lambda match: len(match.group(0)), default=None)
    artifact = re.search(r"\b(?:a|the)\s+([a-z][a-z -]{0,24}\bkey)\b", body, flags=re.IGNORECASE)
    if any(term in lowered for term in ("unresolved", "story question", "develop next", "what question")):
      mystery = missing.group(0).lower() if missing else "central anomaly"
      artifact_text = artifact.group(1).lower() if artifact else "physical clue"
      return (
        f"The strongest unresolved question is: **Why is {pov} the only person tied to the {mystery}, "
        f"and how is the {artifact_text} connected?**\n\n"
        f"Why this one: it joins the character mystery, the event in **{title}**, and a concrete object the reader can track. "
        "The next scene should test one consequence of that connection without explaining it completely.",
        [],
      )
    return (
      f"I grounded this in **{title}** ({pov} POV). Focus the next decision on a consequence already present in the scene, "
      "then preserve its named people, objects, and timeline facts in any Change Set.",
      [],
    )

  return (
    "I do not have a scene passage in this turn yet. Open a scene, choose Scene or Book scope, or mention one with `@` "
    "so I can make a story-specific recommendation instead of guessing.",
    [],
  )


def _normalize_header(value: str) -> str:
  lowered = value.strip().lower()
  aliases = {
    "intent": "Intent",
    "constraints": "Constraints",
    "constraint": "Constraints",
    "edit plan": "Edit Plan",
    "plan": "Edit Plan",
    "continuity notes": "Continuity Notes",
    "continuity": "Continuity Notes",
    "notes": "Continuity Notes",
  }
  return aliases.get(lowered, "")


def _clean_bullet_line(value: str) -> str:
  clean = re.sub(r"^\s*(?:[-*]|\d+[.)])\s*", "", value).strip()
  return re.sub(r"\s+", " ", clean)


def _normalize_proposal_text(
  raw_text: str,
  *,
  instruction: str,
  context: dict[str, Any],
) -> tuple[str, dict[str, Any]]:
  section_rows: dict[str, list[str]] = {name: [] for name in PROPOSAL_SECTIONS}
  preamble: list[str] = []
  preamble_count = 0
  current_section = ""
  detected_headers: set[str] = set()
  missing_sections_filled: list[str] = []
  raw_nonempty_line_count = 0

  header_pattern = re.compile(
    r"^\s*(?:#+\s*)?(intent|constraints?|edit plan|plan|continuity notes|continuity|notes)\s*:?\s*(.*)$",
    flags=re.IGNORECASE,
  )

  for line in raw_text.splitlines():
    stripped = line.strip()
    if not stripped:
      continue
    raw_nonempty_line_count += 1

    match = header_pattern.match(stripped)
    if match:
      current_section = _normalize_header(match.group(1))
      if current_section:
        detected_headers.add(current_section)
      trailing = _clean_bullet_line(match.group(2))
      if trailing:
        section_rows[current_section].append(_truncate(trailing, 220))
      continue

    clean = _clean_bullet_line(stripped)
    if not clean:
      continue
    if current_section:
      section_rows[current_section].append(_truncate(clean, 220))
    else:
      preamble.append(_truncate(clean, 220))
      preamble_count += 1

  if preamble and not section_rows["Intent"]:
    section_rows["Intent"].append(preamble[0])
    preamble = preamble[1:]
  if preamble:
    section_rows["Edit Plan"].extend(preamble)

  scene = context["scene"]
  if not section_rows["Intent"]:
    missing_sections_filled.append("Intent")
    section_rows["Intent"].append(
      _truncate(
        f"Apply requested change to scene '{scene['title']}': {instruction.strip()}",
        220,
      )
    )

  if not section_rows["Constraints"]:
    missing_sections_filled.append("Constraints")
    section_rows["Constraints"] = [
      _truncate(
        f"Preserve POV voice: {scene['pov'] or 'unspecified POV in metadata'}.",
        220,
      ),
      _truncate(
        f"Stay aligned with scene summary: {scene['summary'] or 'no summary provided'}.",
        220,
      ),
    ]

  if not section_rows["Edit Plan"]:
    missing_sections_filled.append("Edit Plan")
    section_rows["Edit Plan"] = [
      "Revise the scene opening for clearer momentum and stakes.",
      "Preserve established facts, motivations, and sequence continuity.",
    ]

  if not section_rows["Continuity Notes"]:
    missing_sections_filled.append("Continuity Notes")
    issues = context["continuity_issues"]
    if issues:
      section_rows["Continuity Notes"] = [
        _truncate(f"{issue['title']}: {issue['message']}", 220)
        for issue in issues[:3]
      ]
    else:
      section_rows["Continuity Notes"] = [
        "No blocking continuity issues detected for this scene."
      ]

  normalized_sections: list[str] = []
  for section_name in PROPOSAL_SECTIONS:
    items = section_rows[section_name][:5]
    normalized_sections.append(
      section_name + ":\n" + "\n".join(f"- {item}" for item in items)
    )
  normalized_text = "\n\n".join(normalized_sections)
  diagnostics = {
    "schema_version": 1,
    "raw_nonempty_line_count": raw_nonempty_line_count,
    "preamble_line_count": preamble_count,
    "detected_headers": sorted(detected_headers),
    "missing_sections_filled": missing_sections_filled,
    "normalization_changed": normalized_text.strip() != raw_text.strip(),
    "section_item_counts": {
      section_name: len(section_rows[section_name][:5])
      for section_name in PROPOSAL_SECTIONS
    },
  }
  return normalized_text, diagnostics


def _quality_from_normalization(diagnostics: dict[str, Any]) -> dict[str, Any]:
  score = 100
  flags: list[str] = []

  missing_sections = diagnostics.get("missing_sections_filled", [])
  if isinstance(missing_sections, list):
    missing_count = len(missing_sections)
  else:
    missing_count = 0
  if missing_count > 0:
    score -= min(60, 15 * missing_count)
    flags.append("missing_sections_filled")

  detected_headers = diagnostics.get("detected_headers", [])
  if isinstance(detected_headers, list) and len(detected_headers) == 0:
    score -= 15
    flags.append("no_headers_detected")

  preamble_line_count = diagnostics.get("preamble_line_count", 0)
  if isinstance(preamble_line_count, int) and preamble_line_count > 3:
    score -= min(15, (preamble_line_count - 3) * 2)
    flags.append("high_unstructured_preamble")

  raw_nonempty_line_count = diagnostics.get("raw_nonempty_line_count", 0)
  if isinstance(raw_nonempty_line_count, int) and raw_nonempty_line_count < 4:
    score -= 20
    flags.append("very_short_raw_output")

  if diagnostics.get("normalization_changed"):
    score -= 5
    flags.append("normalized_output_changed")

  score = max(0, min(100, score))
  if score >= 85:
    tier = "high"
  elif score >= 60:
    tier = "medium"
  else:
    tier = "low"

  return {
    "score": score,
    "tier": tier,
    "flags": flags,
  }


def _chat_completion_messages(
  *,
  system_prompt: str,
  history: list[dict[str, Any]],
  user_prompt: str,
) -> list[dict[str, Any]]:
  messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
  for entry in history:
    role = entry["role"]
    if role == "tool":
      messages.append(
        {
          "role": "tool",
          "tool_call_id": entry["tool_call_id"],
          "content": entry["content"],
        }
      )
      continue
    tool_calls = entry.get("tool_calls") or []
    if role == "assistant" and tool_calls:
      messages.append(
        {
          "role": "assistant",
          "content": entry.get("content") or None,
          "tool_calls": [
            {
              "id": call["id"],
              "type": "function",
              "function": {
                "name": call["name"],
                "arguments": json.dumps(call["args"]),
              },
            }
            for call in tool_calls
          ],
        }
      )
      continue
    messages.append({"role": role, "content": entry["content"]})
  if user_prompt.strip() != "":
    messages.append({"role": "user", "content": user_prompt})
  return messages


def _normalize_chat_history(
  history: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
  rows: list[dict[str, Any]] = []
  for item in history or []:
    if not isinstance(item, dict):
      continue
    role = str(item.get("role", "")).strip()
    content = str(item.get("content", ""))
    if role == "tool":
      tool_call_id = str(item.get("tool_call_id", "")).strip()
      if tool_call_id == "" or content.strip() == "":
        continue
      rows.append(
        {
          "role": "tool",
          "tool_call_id": tool_call_id,
          "name": str(item.get("name", "")).strip(),
          "content": content,
        }
      )
      continue
    if role not in {"user", "assistant"}:
      continue
    raw_tool_calls = item.get("tool_calls")
    tool_calls: list[dict[str, Any]] = []
    if role == "assistant" and isinstance(raw_tool_calls, list):
      for call in raw_tool_calls:
        if not isinstance(call, dict):
          continue
        name = str(call.get("name", "")).strip()
        args = call.get("args", {})
        if name == "" or not isinstance(args, dict):
          continue
        tool_calls.append(
          {
            "id": str(call.get("id", "")).strip() or f"call-{len(tool_calls) + 1}",
            "name": name,
            "args": args,
          }
        )
    if tool_calls:
      rows.append({"role": "assistant", "content": content, "tool_calls": tool_calls})
      continue
    if content.strip() == "":
      continue
    rows.append({"role": role, "content": content})
  return rows


def _openai_tools_payload(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
  return [
    {
      "type": "function",
      "function": {
        "name": tool["name"],
        "description": tool["description"],
        "parameters": tool["parameters"],
      },
    }
    for tool in tools
  ]


def _parse_openai_tool_calls(message: dict[str, Any]) -> list[dict[str, Any]]:
  rows: list[dict[str, Any]] = []
  for item in message.get("tool_calls") or []:
    if not isinstance(item, dict):
      continue
    function = item.get("function", {})
    if not isinstance(function, dict):
      continue
    name = str(function.get("name", "")).strip()
    if name == "":
      continue
    try:
      args = json.loads(function.get("arguments") or "{}")
    except json.JSONDecodeError:
      args = {}
    if not isinstance(args, dict):
      args = {}
    rows.append(
      {
        "id": str(item.get("id", "")) or f"call-{len(rows) + 1}",
        "name": name,
        "args": args,
      }
    )
  return rows


def _openai_chat_completion(
  *,
  model: str,
  system_prompt: str,
  history: list[dict[str, str]],
  user_prompt: str,
  temperature: float,
  max_output_tokens: int,
  on_delta: Any = None,
  tools: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
  api_key = os.getenv("OPENAI_API_KEY")
  if not api_key:
    raise ProviderExecutionError(
      "OPENAI_API_KEY is required for provider 'openai'.",
      category="missing_credentials",
      retriable=False,
      provider="openai",
    )
  base_url = os.getenv("OPENAUTHOR_OPENAI_BASE_URL", "https://api.openai.com/v1")
  payload: dict[str, Any] = {
    "model": model,
    "messages": _chat_completion_messages(
      system_prompt=system_prompt,
      history=history,
      user_prompt=user_prompt,
    ),
    "temperature": temperature,
    "max_tokens": max_output_tokens,
  }
  if tools:
    payload["tools"] = _openai_tools_payload(tools)
  if on_delta is not None and not tools:
    return _openai_style_stream(
      provider="openai",
      url=f"{base_url.rstrip('/')}/chat/completions",
      headers={"Authorization": f"Bearer {api_key}"},
      payload=payload,
      on_delta=on_delta,
    )
  response, attempts = _json_post(
    provider="openai",
    url=f"{base_url.rstrip('/')}/chat/completions",
    headers={"Authorization": f"Bearer {api_key}"},
    payload=payload,
  )
  choice = (response.get("choices") or [{}])[0]
  message = choice.get("message", {})
  content = message.get("content", "")
  if isinstance(content, list):
    text = "\n".join(
      part.get("text", "") if isinstance(part, dict) else str(part)
      for part in content
    ).strip()
  else:
    text = str(content).strip()

  usage = response.get("usage", {})
  return {
    "text": text,
    "tool_calls": _parse_openai_tool_calls(message),
    "input_tokens": int(usage.get("prompt_tokens", 0) or 0),
    "output_tokens": int(usage.get("completion_tokens", 0) or 0),
    "raw_usage": usage,
    "attempts": attempts,
  }


def _anthropic_tools_payload(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
  return [
    {
      "name": tool["name"],
      "description": tool["description"],
      "input_schema": tool["parameters"],
    }
    for tool in tools
  ]


def _anthropic_content_blocks(entry: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
  if entry["role"] == "tool":
    return (
      "user",
      [
        {
          "type": "tool_result",
          "tool_use_id": entry["tool_call_id"],
          "content": entry["content"],
        }
      ],
    )
  tool_calls = entry.get("tool_calls") or []
  if entry["role"] == "assistant" and tool_calls:
    blocks: list[dict[str, Any]] = []
    if str(entry.get("content", "")).strip():
      blocks.append({"type": "text", "text": entry["content"]})
    blocks.extend(
      {
        "type": "tool_use",
        "id": call["id"],
        "name": call["name"],
        "input": call["args"],
      }
      for call in tool_calls
    )
    return ("assistant", blocks)
  return (entry["role"], [{"type": "text", "text": entry["content"]}])


def _anthropic_model_accepts_temperature(model: str) -> bool:
  # Sampling params were removed on newer Anthropic models (Opus 4.7+,
  # Sonnet 5, Fable 5) and sending temperature returns a 400.
  normalized = model.lower()
  rejecting_prefixes = (
    "claude-opus-4-7",
    "claude-opus-4-8",
    "claude-sonnet-5",
    "claude-fable-5",
    "claude-mythos-5",
  )
  return not normalized.startswith(rejecting_prefixes)


def _anthropic_message(
  *,
  model: str,
  system_prompt: str,
  history: list[dict[str, Any]],
  user_prompt: str,
  temperature: float,
  max_output_tokens: int,
  on_delta: Any = None,
  tools: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
  api_key = os.getenv("ANTHROPIC_API_KEY")
  if not api_key:
    raise ProviderExecutionError(
      "ANTHROPIC_API_KEY is required for provider 'anthropic'.",
      category="missing_credentials",
      retriable=False,
      provider="anthropic",
    )
  base_url = os.getenv("OPENAUTHOR_ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1")
  entries: list[dict[str, Any]] = list(history)
  if user_prompt.strip() != "":
    entries.append({"role": "user", "content": user_prompt})
  # The Messages API requires alternating roles, so fold consecutive
  # same-role entries (e.g. a trailing tool-result plus the new user
  # message) into one message by concatenating their content blocks.
  messages: list[dict[str, Any]] = []
  for entry in entries:
    role, blocks = _anthropic_content_blocks(entry)
    if messages and messages[-1]["role"] == role:
      messages[-1]["content"].extend(blocks)
    else:
      messages.append({"role": role, "content": blocks})
  payload: dict[str, Any] = {
    "model": model,
    "system": system_prompt,
    "messages": messages,
    "max_tokens": max_output_tokens,
  }
  if _anthropic_model_accepts_temperature(model):
    payload["temperature"] = temperature
  if tools:
    payload["tools"] = _anthropic_tools_payload(tools)
  if on_delta is not None and not tools:
    return _anthropic_stream(
      url=f"{base_url.rstrip('/')}/messages",
      headers={
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
      },
      payload=payload,
      on_delta=on_delta,
    )
  response, attempts = _json_post(
    provider="anthropic",
    url=f"{base_url.rstrip('/')}/messages",
    headers={
      "x-api-key": api_key,
      "anthropic-version": "2023-06-01",
    },
    payload=payload,
  )
  content = response.get("content", [])
  text_parts = [
    part.get("text", "")
    for part in content
    if isinstance(part, dict) and part.get("type") == "text"
  ]
  tool_calls = [
    {
      "id": str(part.get("id", "")) or f"call-{index + 1}",
      "name": str(part.get("name", "")).strip(),
      "args": part.get("input", {}) if isinstance(part.get("input", {}), dict) else {},
    }
    for index, part in enumerate(content)
    if isinstance(part, dict) and part.get("type") == "tool_use" and str(part.get("name", "")).strip()
  ]
  usage = response.get("usage", {})
  return {
    "text": "\n".join(text_parts).strip(),
    "tool_calls": tool_calls,
    "input_tokens": int(usage.get("input_tokens", 0) or 0),
    "output_tokens": int(usage.get("output_tokens", 0) or 0),
    "raw_usage": usage,
    "attempts": attempts,
  }


def _openrouter_chat_completion(
  *,
  model: str,
  system_prompt: str,
  history: list[dict[str, str]],
  user_prompt: str,
  temperature: float,
  max_output_tokens: int,
  on_delta: Any = None,
  tools: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
  api_key = os.getenv("OPENROUTER_API_KEY")
  if not api_key:
    raise ProviderExecutionError(
      "OPENROUTER_API_KEY is required for provider 'openrouter'.",
      category="missing_credentials",
      retriable=False,
      provider="openrouter",
    )
  base_url = os.getenv("OPENAUTHOR_OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
  headers = {
    "Authorization": f"Bearer {api_key}",
    "HTTP-Referer": "https://openauthor.dev",
    "X-Title": "openAuthor",
  }
  payload: dict[str, Any] = {
    "model": model,
    "messages": _chat_completion_messages(
      system_prompt=system_prompt,
      history=history,
      user_prompt=user_prompt,
    ),
    "temperature": temperature,
    "max_tokens": max_output_tokens,
  }
  if tools:
    payload["tools"] = _openai_tools_payload(tools)
  if on_delta is not None and not tools:
    return _openai_style_stream(
      provider="openrouter",
      url=f"{base_url.rstrip('/')}/chat/completions",
      headers=headers,
      payload=payload,
      on_delta=on_delta,
    )
  response, attempts = _json_post(
    provider="openrouter",
    url=f"{base_url.rstrip('/')}/chat/completions",
    headers=headers,
    payload=payload,
  )
  choice = (response.get("choices") or [{}])[0]
  message = choice.get("message", {})
  content = message.get("content", "")
  if isinstance(content, list):
    text = "\n".join(
      part.get("text", "") if isinstance(part, dict) else str(part)
      for part in content
    ).strip()
  else:
    text = str(content).strip()

  usage = response.get("usage", {})
  return {
    "text": text,
    "tool_calls": _parse_openai_tool_calls(message),
    "input_tokens": int(usage.get("prompt_tokens", 0) or 0),
    "output_tokens": int(usage.get("completion_tokens", 0) or 0),
    "raw_usage": usage,
    "attempts": attempts,
  }


def _openai_codex_chat_completion(
  *,
  project_root: Path,
  model: str,
  system_prompt: str,
  history: list[dict[str, str]],
  user_prompt: str,
  temperature: float,
  max_output_tokens: int,
  on_delta: Any = None,
  tools: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
  del temperature
  try:
    with CodexAppServer() as server:
      status = server.account_status(refresh=True)
      if not status.get("authenticated"):
        raise ProviderExecutionError(
          "Not signed in to ChatGPT through Codex app-server. Open Settings and "
          "choose 'Sign in with ChatGPT'.",
          category="missing_credentials",
          retriable=False,
          provider="openai-codex",
        )
      return server.complete(
        project_root=project_root,
        model=model,
        system_prompt=system_prompt,
        history=history,
        user_prompt=user_prompt,
        max_output_tokens=max_output_tokens,
        on_delta=on_delta,
        tools=tools,
      )
  except ProviderExecutionError:
    raise
  except CodexAppServerUnavailable as error:
    raise ProviderExecutionError(
      str(error),
      category="runtime_unavailable",
      retriable=False,
      provider="openai-codex",
    ) from error
  except CodexAppServerError as error:
    message = str(error)
    runtime_outdated = "requires a newer version of Codex" in message
    raise ProviderExecutionError(
      message,
      category="runtime_outdated" if runtime_outdated else "provider_server_error",
      retriable=not runtime_outdated,
      provider="openai-codex",
    ) from error


def _call_provider(
  *,
  project_root: Path,
  provider: str,
  model: str,
  system_prompt: str,
  user_prompt: str,
  context: dict[str, Any],
  instruction: str,
  temperature: float,
  max_output_tokens: int,
  history: list[dict[str, Any]] | None = None,
  on_delta: Any = None,
  tools: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
  chat_history = _normalize_chat_history(history)
  tool_calls: list[dict[str, Any]] = []
  start = time.perf_counter()
  if provider == "local":
    if context.get("chat_mode"):
      text, tool_calls = _generate_local_chat_result(
        user_prompt,
        tools_enabled=bool(tools),
      )
    elif context.get("merge_mode"):
      text = _generate_local_merge_text(context, instruction)
    elif context.get("draft_mode"):
      text = _generate_local_draft_text(context, instruction)
    else:
      text = _generate_local_text(context, instruction)
    if on_delta is not None and not tools:
      _stream_local_text(text, on_delta)
    history_text = "\n".join(str(row.get("content", "")) for row in chat_history)
    input_tokens = _estimate_tokens(
      system_prompt + "\n" + history_text + "\n" + user_prompt
    )
    output_tokens = _estimate_tokens(text)
    attempts = 1
  elif provider == "openai":
    payload = _openai_chat_completion(
      model=model,
      system_prompt=system_prompt,
      history=chat_history,
      user_prompt=user_prompt,
      temperature=temperature,
      max_output_tokens=max_output_tokens,
      on_delta=on_delta,
      tools=tools,
    )
    text = payload["text"]
    tool_calls = payload.get("tool_calls", [])
    input_tokens = payload["input_tokens"]
    output_tokens = payload["output_tokens"]
    attempts = int(payload.get("attempts", 1) or 1)
  elif provider == "anthropic":
    payload = _anthropic_message(
      model=model,
      system_prompt=system_prompt,
      history=chat_history,
      user_prompt=user_prompt,
      temperature=temperature,
      max_output_tokens=max_output_tokens,
      on_delta=on_delta,
      tools=tools,
    )
    text = payload["text"]
    tool_calls = payload.get("tool_calls", [])
    input_tokens = payload["input_tokens"]
    output_tokens = payload["output_tokens"]
    attempts = int(payload.get("attempts", 1) or 1)
  elif provider == "openrouter":
    payload = _openrouter_chat_completion(
      model=model,
      system_prompt=system_prompt,
      history=chat_history,
      user_prompt=user_prompt,
      temperature=temperature,
      max_output_tokens=max_output_tokens,
      on_delta=on_delta,
      tools=tools,
    )
    text = payload["text"]
    tool_calls = payload.get("tool_calls", [])
    input_tokens = payload["input_tokens"]
    output_tokens = payload["output_tokens"]
    attempts = int(payload.get("attempts", 1) or 1)
  elif provider == "openai-codex":
    payload = _openai_codex_chat_completion(
      project_root=project_root,
      model=model,
      system_prompt=system_prompt,
      history=chat_history,
      user_prompt=user_prompt,
      temperature=temperature,
      max_output_tokens=max_output_tokens,
      on_delta=on_delta,
      tools=tools,
    )
    text = payload["text"]
    tool_calls = payload.get("tool_calls", [])
    input_tokens = payload["input_tokens"]
    output_tokens = payload["output_tokens"]
    attempts = int(payload.get("attempts", 1) or 1)
  else:
    raise OpenAuthorError(
      f"Invalid provider '{provider}'. Allowed: {', '.join(sorted(SUPPORTED_PROVIDERS))}."
    )

  latency_ms = int((time.perf_counter() - start) * 1000)
  if not text.strip() and not tool_calls:
    raise ProviderExecutionError(
      "Provider returned empty output.",
      category="invalid_provider_output",
      retriable=False,
      provider=provider,
      attempts=attempts,
    )

  return {
    "text": text.strip(),
    "tool_calls": tool_calls,
    "input_tokens": int(input_tokens),
    "output_tokens": int(output_tokens),
    "latency_ms": latency_ms,
    "attempts": attempts,
  }


def _write_chat_generation_log(
  paths: ProjectPaths,
  *,
  status: str,
  thread_id: str,
  provider: str,
  model: str,
  temperature: float,
  max_output_tokens: int,
  system_prompt: str,
  user_prompt: str,
  history_message_count: int,
  provider_result: dict[str, Any] | None = None,
  estimated_cost_usd: float | None = None,
  error: dict[str, Any] | None = None,
) -> tuple[str, str]:
  run_id = f"gen-{uuid.uuid4().hex[:12]}"
  log_file = paths.generations_dir / f"{run_id}.json"
  payload: dict[str, Any] = {
    "run_id": run_id,
    "kind": "chat",
    "status": status,
    "created_at": utc_now(),
    "thread_id": thread_id,
    "scene_id": "",
    "provider": provider,
    "model": model,
    "temperature": temperature,
    "max_output_tokens": max_output_tokens,
    "history_message_count": history_message_count,
    "prompt_sha256": hashlib.sha256(
      (system_prompt + "\n\n" + user_prompt).encode("utf-8")
    ).hexdigest(),
    "system_prompt": system_prompt,
    "user_prompt": user_prompt,
  }
  if provider_result is not None:
    payload["response_text"] = provider_result["text"]
    payload["tool_calls"] = provider_result.get("tool_calls", [])
    payload["usage"] = {
      "input_tokens": provider_result["input_tokens"],
      "output_tokens": provider_result["output_tokens"],
      "latency_ms": provider_result["latency_ms"],
      "provider_attempts": provider_result["attempts"],
      "estimated_cost_usd": estimated_cost_usd,
    }
  if error is not None:
    payload["error"] = error
  atomic_write_json(log_file, payload)
  return run_id, str(log_file.relative_to(paths.root))


def complete_chat(
  paths: ProjectPaths,
  *,
  provider: str,
  model: str,
  system_prompt: str,
  user_prompt: str,
  history: list[dict[str, Any]] | None = None,
  temperature: float = 0.2,
  max_output_tokens: int = 900,
  chat_mode: bool = True,
  thread_id: str = "",
  on_delta: Any = None,
  tools: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
  if provider not in SUPPORTED_PROVIDERS:
    allowed = ", ".join(sorted(SUPPORTED_PROVIDERS))
    raise OpenAuthorError(f"Invalid provider '{provider}'. Allowed: {allowed}.")
  if max_output_tokens < 64:
    raise OpenAuthorError("max_output_tokens must be >= 64.")

  selected_model = model or DEFAULT_MODELS[provider]
  chat_history = _normalize_chat_history(history)
  history_text = "\n".join(str(row.get("content", "")) for row in chat_history)
  projected_input_tokens = _estimate_tokens(
    system_prompt + "\n" + history_text + "\n" + user_prompt
  )
  projected_estimated_cost_usd = _estimate_cost_usd(
    paths,
    provider=provider,
    model=selected_model,
    input_tokens=projected_input_tokens,
    output_tokens=max_output_tokens,
  )
  try:
    enforce_generation_budget(
      paths,
      projected_input_tokens=projected_input_tokens,
      projected_output_tokens=max_output_tokens,
      projected_estimated_cost_usd=projected_estimated_cost_usd,
    )
  except BudgetPolicyError as error:
    _, log_path = _write_chat_generation_log(
      paths,
      status="failed",
      thread_id=thread_id,
      provider=provider,
      model=selected_model,
      temperature=temperature,
      max_output_tokens=max_output_tokens,
      system_prompt=system_prompt,
      user_prompt=user_prompt,
      history_message_count=len(chat_history),
      error={
        "message": str(error),
        "category": error.category,
        "retriable": False,
        "http_status": None,
        "attempts": 0,
        "provider": provider,
        "violations": error.violations,
        "budget_policy": error.policy,
        "budget_usage": error.usage,
        "budget_projected": error.projected,
      },
    )
    raise OpenAuthorError(
      f"Chat completion blocked by budget policy. See {log_path}."
    ) from error

  try:
    provider_result = _call_provider(
      project_root=paths.root,
      provider=provider,
      model=selected_model,
      system_prompt=system_prompt,
      user_prompt=user_prompt,
      context={"chat_mode": bool(chat_mode)},
      instruction=user_prompt,
      temperature=temperature,
      max_output_tokens=max_output_tokens,
      history=chat_history,
      on_delta=on_delta,
      tools=tools,
    )
  except ChatInterrupted:
    _write_chat_generation_log(
      paths,
      status="failed",
      thread_id=thread_id,
      provider=provider,
      model=selected_model,
      temperature=temperature,
      max_output_tokens=max_output_tokens,
      system_prompt=system_prompt,
      user_prompt=user_prompt,
      history_message_count=len(chat_history),
      error={
        "message": "Chat turn interrupted by user.",
        "category": "interrupted",
        "retriable": False,
        "http_status": None,
        "attempts": 1,
        "provider": provider,
      },
    )
    raise
  except ProviderExecutionError as error:
    _, log_path = _write_chat_generation_log(
      paths,
      status="failed",
      thread_id=thread_id,
      provider=provider,
      model=selected_model,
      temperature=temperature,
      max_output_tokens=max_output_tokens,
      system_prompt=system_prompt,
      user_prompt=user_prompt,
      history_message_count=len(chat_history),
      error={
        "message": str(error),
        "category": error.category,
        "retriable": error.retriable,
        "http_status": error.http_status,
        "attempts": error.attempts,
        "provider": error.provider,
      },
    )
    guidance = " Sign in again or update this provider's credentials in Settings." if error.category == "auth_error" else ""
    raise ProviderExecutionError(
      f"Chat completion failed ({error.category}).{guidance} See {log_path}.",
      category=error.category, retriable=error.retriable, provider=error.provider,
      http_status=error.http_status, attempts=error.attempts,
    ) from error

  estimated_cost_usd = _estimate_cost_usd(
    paths,
    provider=provider,
    model=selected_model,
    input_tokens=provider_result["input_tokens"],
    output_tokens=provider_result["output_tokens"],
  )
  generation_id, log_path = _write_chat_generation_log(
    paths,
    status="succeeded",
    thread_id=thread_id,
    provider=provider,
    model=selected_model,
    temperature=temperature,
    max_output_tokens=max_output_tokens,
    system_prompt=system_prompt,
    user_prompt=user_prompt,
    history_message_count=len(chat_history),
    provider_result=provider_result,
    estimated_cost_usd=estimated_cost_usd,
  )
  # Tool-enabled turns run buffered (no provider streaming), so surface the
  # round's text through on_delta once the spend is logged; an interrupt
  # raised here aborts the turn between tool rounds.
  if tools and on_delta is not None and provider_result["text"].strip():
    on_delta(provider_result["text"] + "\n\n")
  return {
    "text": provider_result["text"],
    "tool_calls": provider_result.get("tool_calls", []),
    "input_tokens": provider_result["input_tokens"],
    "output_tokens": provider_result["output_tokens"],
    "latency_ms": provider_result["latency_ms"],
    "provider_attempts": provider_result["attempts"],
    "estimated_cost_usd": estimated_cost_usd,
    "generation_id": generation_id,
    "log_path": log_path,
  }


def build_generation_context(
  paths: ProjectPaths,
  *,
  scene_id: str,
  context_scene_radius: int,
  codex_limit: int,
) -> dict[str, Any]:
  if context_scene_radius < 0:
    raise OpenAuthorError("context_scene_radius must be >= 0.")
  if codex_limit < 1:
    raise OpenAuthorError("codex_limit must be >= 1.")

  scene_rows = sorted(list_scenes(paths), key=lambda row: _scene_number(row["id"]))
  scene_ids = [row["id"] for row in scene_rows]
  if scene_id not in scene_ids:
    raise OpenAuthorError(f"Unknown scene id '{scene_id}'.")

  selected_scene = get_scene(paths, scene_id)
  selected_index = scene_ids.index(scene_id)
  start = max(0, selected_index - context_scene_radius)
  end = min(len(scene_rows), selected_index + context_scene_radius + 1)
  nearby_scene_ids = scene_ids[start:end]
  nearby_scenes = [get_scene(paths, item_id) for item_id in nearby_scene_ids if item_id != scene_id]

  all_entities = list_entities(paths)
  selected_text = " ".join(
    [
      selected_scene["title"],
      selected_scene["summary"],
      selected_scene["pov"],
      selected_scene["body"],
    ]
  ).lower()

  matched_entities: list[dict[str, str]] = []
  seen_ids: set[str] = set()
  for entity in all_entities:
    name = entity.get("name", "").strip()
    if name and name.lower() in selected_text:
      matched_entities.append(entity)
      seen_ids.add(entity["id"])

  if selected_scene["pov"]:
    normalized_pov = selected_scene["pov"].strip().lower()
    for entity in all_entities:
      if entity["type"] != "character":
        continue
      if entity["id"] in seen_ids:
        continue
      if entity["name"].strip().lower() == normalized_pov:
        matched_entities.insert(0, entity)
        seen_ids.add(entity["id"])
        break

  for entity in all_entities:
    if len(matched_entities) >= codex_limit:
      break
    if entity["id"] in seen_ids:
      continue
    matched_entities.append(entity)
    seen_ids.add(entity["id"])

  continuity_issues = [
    issue
    for issue in run_continuity_checks(paths)
    if issue["scene_id"] == scene_id
  ]

  return {
    "scene": selected_scene,
    "nearby_scenes": nearby_scenes,
    "codex_entities": matched_entities[:codex_limit],
    "continuity_issues": continuity_issues,
  }


def _normalize_retrieval_mode(mode: str) -> str:
  normalized = mode.strip().lower()
  if normalized not in SUPPORTED_RETRIEVAL_MODES:
    allowed = ", ".join(sorted(SUPPORTED_RETRIEVAL_MODES))
    raise OpenAuthorError(
      f"Invalid retrieval mode '{mode}'. Allowed: {allowed}."
    )
  return normalized


def _build_retrieval_query_text(context: dict[str, Any], instruction: str) -> str:
  scene = context.get("scene", {})
  if not isinstance(scene, dict):
    scene = {}
  parts = [
    str(instruction).strip(),
    str(scene.get("title", "")).strip(),
    str(scene.get("summary", "")).strip(),
    str(scene.get("pov", "")).strip(),
  ]
  return " ".join(part for part in parts if part)


def _resolve_retrieval_context(
  paths: ProjectPaths,
  *,
  context: dict[str, Any],
  instruction: str,
  mode: str,
  limit: int,
  min_score: float,
  require_fresh: bool,
) -> dict[str, Any]:
  retrieval_mode = _normalize_retrieval_mode(mode)
  if limit < 1:
    raise OpenAuthorError("retrieval_limit must be >= 1.")
  if min_score < 0:
    raise OpenAuthorError("retrieval_min_score must be >= 0.")

  query_text = _build_retrieval_query_text(context, instruction)
  base_payload = {
    "mode": retrieval_mode,
    "used": False,
    "query": query_text,
    "limit": limit,
    "min_score": min_score,
    "require_fresh": require_fresh,
    "result_count": 0,
    "citations": [],
    "index": {
      "path": "",
      "stale": False,
      "stale_reasons": [],
      "chunk_count": 0,
      "source_count": 0,
      "git_head": "",
      "indexed_git_head": "",
    },
    "degraded": False,
    "error": "",
  }
  if retrieval_mode == "off":
    return base_payload

  try:
    result = query_retrieval_index(
      paths,
      query=query_text,
      limit=limit,
      min_score=min_score,
      require_fresh=require_fresh,
    )
  except OpenAuthorError as error:
    if retrieval_mode == "required":
      raise
    status = get_retrieval_index_status(paths)
    return {
      **base_payload,
      "index": {
        "path": status.get("path", ""),
        "stale": bool(status.get("stale")),
        "stale_reasons": status.get("stale_reasons", []),
        "chunk_count": status.get("chunk_count", 0),
        "source_count": status.get("source_count", 0),
        "git_head": status.get("git_head", ""),
        "indexed_git_head": status.get("indexed_git_head", ""),
      },
      "degraded": True,
      "error": str(error),
    }

  citations: list[dict[str, Any]] = []
  for row in result.get("results", []):
    if not isinstance(row, dict):
      continue
    citation = row.get("citation", {})
    if not isinstance(citation, dict):
      citation = {}
    citations.append(
      {
        "source_type": citation.get("source_type", row.get("source_type", "")),
        "source_ref": citation.get("source_ref", row.get("source_ref", "")),
        "source_path": citation.get("source_path", row.get("source_path", "")),
        "source_title": citation.get("source_title", row.get("source_title", "")),
        "chunk_id": citation.get("chunk_id", row.get("chunk_id", "")),
        "chunk_position": citation.get("chunk_position", row.get("chunk_position", 0)),
        "score": row.get("score"),
        "coverage": row.get("coverage"),
        "matched_terms": row.get("matched_terms", []),
        "excerpt": _truncate(str(row.get("text", "")), 320),
      }
    )

  if retrieval_mode == "required" and not citations:
    raise OpenAuthorError(
      "Retrieval mode is 'required' but query returned no matching citations."
    )

  index_row = result.get("index", {})
  if not isinstance(index_row, dict):
    index_row = {}
  return {
    **base_payload,
    "used": bool(citations),
    "result_count": len(citations),
    "citations": citations,
    "index": {
      "path": index_row.get("path", ""),
      "stale": bool(index_row.get("stale")),
      "stale_reasons": index_row.get("stale_reasons", []),
      "chunk_count": index_row.get("chunk_count", 0),
      "source_count": index_row.get("source_count", 0),
      "git_head": index_row.get("git_head", ""),
      "indexed_git_head": index_row.get("indexed_git_head", ""),
    },
  }


def _with_retrieval_prompt_context(
  context: dict[str, Any],
  retrieval: dict[str, Any],
) -> dict[str, Any]:
  if not retrieval.get("used"):
    return context

  citations = retrieval.get("citations", [])
  prompt_citations: list[dict[str, Any]] = []
  for row in citations:
    if not isinstance(row, dict):
      continue
    prompt_citations.append(
      {
        "source_type": row.get("source_type", ""),
        "source_ref": row.get("source_ref", ""),
        "source_title": row.get("source_title", ""),
        "source_path": row.get("source_path", ""),
        "chunk_id": row.get("chunk_id", ""),
        "score": row.get("score"),
        "coverage": row.get("coverage"),
        "matched_terms": row.get("matched_terms", []),
        "excerpt": row.get("excerpt", ""),
      }
    )

  return {
    **context,
    "retrieval": {
      "query": retrieval.get("query", ""),
      "result_count": retrieval.get("result_count", 0),
      "citations": prompt_citations,
    },
  }


def _build_prompts(context: dict[str, Any], instruction: str) -> tuple[str, str]:
  system_prompt = (
    "You are an editorial assistant for a fiction project. "
    "Return one proposal instruction block that is actionable, "
    "scene-specific, and continuity-safe. "
    "Use exactly these section headers: Intent, Constraints, Edit Plan, Continuity Notes."
  )
  user_prompt = (
    f"User instruction:\n{instruction.strip()}\n\n"
    "Project context (JSON):\n"
    f"{json.dumps(context, indent=2)}\n\n"
    "Write a concise instruction that can be applied as a proposal card.\n"
    "Output must be plain text with these sections in order:\n"
    "Intent:\n- ...\n\nConstraints:\n- ...\n\nEdit Plan:\n- ...\n\nContinuity Notes:\n- ..."
  )
  return system_prompt, user_prompt


def _write_generation_log(
  paths: ProjectPaths,
  *,
  scene_id: str,
  provider: str,
  model: str,
  temperature: float,
  max_output_tokens: int,
  context_scene_radius: int,
  codex_limit: int,
  retrieval: dict[str, Any],
  instruction: str,
  context: dict[str, Any],
  system_prompt: str,
  user_prompt: str,
  provider_result: dict[str, Any],
  raw_provider_text: str,
  normalization: dict[str, Any],
  quality: dict[str, Any],
  estimated_cost_usd: float | None,
) -> tuple[str, str]:
  run_id = f"gen-{uuid.uuid4().hex[:12]}"
  log_file = paths.generations_dir / f"{run_id}.json"
  payload = {
    "run_id": run_id,
    "status": "succeeded",
    "created_at": utc_now(),
    "scene_id": scene_id,
    "provider": provider,
    "model": model,
    "temperature": temperature,
    "max_output_tokens": max_output_tokens,
    "context_scene_radius": context_scene_radius,
    "codex_limit": codex_limit,
    "retrieval": retrieval,
    "instruction": instruction,
    "prompt_sha256": hashlib.sha256(
      (system_prompt + "\n\n" + user_prompt).encode("utf-8")
    ).hexdigest(),
    "system_prompt": system_prompt,
    "user_prompt": user_prompt,
    "context": context,
    "raw_response_text": raw_provider_text,
    "normalized_instruction": provider_result["text"],
    "normalization": normalization,
    "quality": quality,
    "usage": {
      "input_tokens": provider_result["input_tokens"],
      "output_tokens": provider_result["output_tokens"],
      "latency_ms": provider_result["latency_ms"],
      "provider_attempts": provider_result["attempts"],
      "estimated_cost_usd": estimated_cost_usd,
    },
  }
  atomic_write_json(log_file, payload)
  return run_id, str(log_file.relative_to(paths.root))


def _write_generation_failure_log(
  paths: ProjectPaths,
  *,
  scene_id: str,
  provider: str,
  model: str,
  temperature: float,
  max_output_tokens: int,
  context_scene_radius: int,
  codex_limit: int,
  retrieval: dict[str, Any],
  instruction: str,
  context: dict[str, Any],
  system_prompt: str,
  user_prompt: str,
  error: ProviderExecutionError,
) -> tuple[str, str]:
  run_id = f"gen-{uuid.uuid4().hex[:12]}"
  log_file = paths.generations_dir / f"{run_id}.json"
  payload = {
    "run_id": run_id,
    "status": "failed",
    "created_at": utc_now(),
    "scene_id": scene_id,
    "provider": provider,
    "model": model,
    "temperature": temperature,
    "max_output_tokens": max_output_tokens,
    "context_scene_radius": context_scene_radius,
    "codex_limit": codex_limit,
    "retrieval": retrieval,
    "instruction": instruction,
    "prompt_sha256": hashlib.sha256(
      (system_prompt + "\n\n" + user_prompt).encode("utf-8")
    ).hexdigest(),
    "system_prompt": system_prompt,
    "user_prompt": user_prompt,
    "context": context,
    "error": {
      "message": str(error),
      "category": error.category,
      "retriable": error.retriable,
      "http_status": error.http_status,
      "attempts": error.attempts,
      "provider": error.provider,
    },
  }
  atomic_write_json(log_file, payload)
  return run_id, str(log_file.relative_to(paths.root))


def _write_generation_budget_failure_log(
  paths: ProjectPaths,
  *,
  scene_id: str,
  provider: str,
  model: str,
  temperature: float,
  max_output_tokens: int,
  context_scene_radius: int,
  codex_limit: int,
  retrieval: dict[str, Any],
  instruction: str,
  context: dict[str, Any],
  system_prompt: str,
  user_prompt: str,
  error: BudgetPolicyError,
) -> tuple[str, str]:
  run_id = f"gen-{uuid.uuid4().hex[:12]}"
  log_file = paths.generations_dir / f"{run_id}.json"
  payload = {
    "run_id": run_id,
    "status": "failed",
    "created_at": utc_now(),
    "scene_id": scene_id,
    "provider": provider,
    "model": model,
    "temperature": temperature,
    "max_output_tokens": max_output_tokens,
    "context_scene_radius": context_scene_radius,
    "codex_limit": codex_limit,
    "retrieval": retrieval,
    "instruction": instruction,
    "prompt_sha256": hashlib.sha256(
      (system_prompt + "\n\n" + user_prompt).encode("utf-8")
    ).hexdigest(),
    "system_prompt": system_prompt,
    "user_prompt": user_prompt,
    "context": context,
    "error": {
      "message": str(error),
      "category": error.category,
      "retriable": False,
      "http_status": None,
      "attempts": 0,
      "provider": provider,
      "violations": error.violations,
      "budget_policy": error.policy,
      "budget_usage": error.usage,
      "budget_projected": error.projected,
    },
  }
  atomic_write_json(log_file, payload)
  return run_id, str(log_file.relative_to(paths.root))


def _attach_proposal_to_generation_log(
  paths: ProjectPaths,
  *,
  run_id: str,
  proposal_id: str,
) -> None:
  log_file = paths.generations_dir / f"{run_id}.json"
  if not log_file.exists():
    raise OpenAuthorError(f"Missing generation log for run '{run_id}'.")
  payload = json.loads(log_file.read_text(encoding="utf-8"))
  payload["proposal_id"] = proposal_id
  atomic_write_json(log_file, payload)


def _default_title(scene_title: str, instruction: str) -> str:
  short_instruction = _truncate(instruction, 48)
  return _truncate(f"{scene_title}: {short_instruction}", 72)


@recoverable_proposal("generate")
def generate_proposal(
  paths: ProjectPaths,
  *,
  scene_id: str,
  instruction: str,
  title: str = "",
  provider: str = "local",
  model: str | None = None,
  temperature: float = 0.2,
  max_output_tokens: int = 700,
  context_scene_radius: int = 1,
  codex_limit: int = 20,
  retrieval_mode: str = "off",
  retrieval_limit: int = 5,
  retrieval_min_score: float = 0.0,
  retrieval_require_fresh: bool = False,
  constraints: list[str] | None = None,
  protected_elements: list[str] | None = None,
  change_group_id: str = "",
) -> dict[str, Any]:
  if provider not in SUPPORTED_PROVIDERS:
    raise OpenAuthorError(
      f"Invalid provider '{provider}'. Allowed: {', '.join(sorted(SUPPORTED_PROVIDERS))}."
    )
  if max_output_tokens < 64:
    raise OpenAuthorError("max_output_tokens must be >= 64.")
  if retrieval_limit < 1:
    raise OpenAuthorError("retrieval_limit must be >= 1.")
  if retrieval_min_score < 0:
    raise OpenAuthorError("retrieval_min_score must be >= 0.")

  constraints = [value.strip() for value in (constraints or []) if value.strip()]
  protected_elements = [value.strip() for value in (protected_elements or []) if value.strip()]
  effective_instruction = instruction.strip()
  if constraints:
    effective_instruction += "\n\nConstraints:\n- " + "\n- ".join(constraints)
  if protected_elements:
    effective_instruction += "\n\nProtected elements that must remain unchanged:\n- " + "\n- ".join(protected_elements)

  selected_model = model or DEFAULT_MODELS[provider]
  base_context = build_generation_context(
    paths,
    scene_id=scene_id,
    context_scene_radius=context_scene_radius,
    codex_limit=codex_limit,
  )
  from .style_profile import get_style_profile
  style_profile = get_style_profile(paths)
  if style_profile is not None:
    base_context["author_selected_style_profile"] = {
      "exemplar_scene_ids": style_profile["exemplar_scene_ids"],
      "metrics": style_profile["metrics"],
      "guidance": style_profile["guidance"],
    }
  retrieval = _resolve_retrieval_context(
    paths,
    context=base_context,
    instruction=effective_instruction,
    mode=retrieval_mode,
    limit=retrieval_limit,
    min_score=retrieval_min_score,
    require_fresh=retrieval_require_fresh,
  )
  context = _with_retrieval_prompt_context(base_context, retrieval)
  system_prompt, user_prompt = _build_prompts(context, effective_instruction)
  projected_input_tokens = _estimate_tokens(system_prompt + "\n" + user_prompt)
  projected_output_tokens = max_output_tokens
  projected_estimated_cost_usd = _estimate_cost_usd(
    paths,
    provider=provider,
    model=selected_model,
    input_tokens=projected_input_tokens,
    output_tokens=projected_output_tokens,
  )
  try:
    enforce_generation_budget(
      paths,
      projected_input_tokens=projected_input_tokens,
      projected_output_tokens=projected_output_tokens,
      projected_estimated_cost_usd=projected_estimated_cost_usd,
    )
  except BudgetPolicyError as error:
    _, failure_log_path = _write_generation_budget_failure_log(
      paths,
      scene_id=scene_id,
      provider=provider,
      model=selected_model,
      temperature=temperature,
      max_output_tokens=max_output_tokens,
      context_scene_radius=context_scene_radius,
      codex_limit=codex_limit,
      retrieval=retrieval,
      instruction=effective_instruction,
      context=context,
      system_prompt=system_prompt,
      user_prompt=user_prompt,
      error=error,
    )
    raise OpenAuthorError(
      f"Proposal generation blocked by budget policy. See {failure_log_path}."
    ) from error
  try:
    provider_result = _call_provider(
      project_root=paths.root,
      provider=provider,
      model=selected_model,
      system_prompt=system_prompt,
      user_prompt=user_prompt,
      context=context,
      instruction=effective_instruction,
      temperature=temperature,
      max_output_tokens=max_output_tokens,
    )
  except ProviderExecutionError as error:
    _, failure_log_path = _write_generation_failure_log(
      paths,
      scene_id=scene_id,
      provider=provider,
      model=selected_model,
      temperature=temperature,
      max_output_tokens=max_output_tokens,
      context_scene_radius=context_scene_radius,
      codex_limit=codex_limit,
      retrieval=retrieval,
      instruction=effective_instruction,
      context=context,
      system_prompt=system_prompt,
      user_prompt=user_prompt,
      error=error,
    )
    raise OpenAuthorError(
      f"Proposal generation failed ({error.category}). See {failure_log_path}."
    ) from error
  raw_provider_text = provider_result["text"]
  normalized_text, normalization_diagnostics = _normalize_proposal_text(
    raw_provider_text,
    instruction=effective_instruction,
    context=context,
  )
  quality = _quality_from_normalization(normalization_diagnostics)
  provider_result["text"] = normalized_text

  estimated_cost_usd = _estimate_cost_usd(
    paths,
    provider=provider,
    model=selected_model,
    input_tokens=provider_result["input_tokens"],
    output_tokens=provider_result["output_tokens"],
  )

  generation_id, log_path = _write_generation_log(
    paths,
    scene_id=scene_id,
    provider=provider,
    model=selected_model,
    temperature=temperature,
    max_output_tokens=max_output_tokens,
    context_scene_radius=context_scene_radius,
    codex_limit=codex_limit,
    retrieval=retrieval,
    instruction=effective_instruction,
    context=context,
    system_prompt=system_prompt,
    user_prompt=user_prompt,
    provider_result=provider_result,
    raw_provider_text=raw_provider_text,
    normalization=normalization_diagnostics,
    quality=quality,
    estimated_cost_usd=estimated_cost_usd,
  )

  final_title = title.strip() or _default_title(context["scene"]["title"], instruction)
  proposal_id = create_proposal(
    paths,
    proposal_id=current_proposal_delivery().get("proposal_id"),
    title=final_title,
    instruction=provider_result["text"],
    scene_id=scene_id,
    source="ai_generate",
    revision_intent={
      "goal": instruction.strip(),
      "constraints": constraints,
      "protected_elements": protected_elements,
      "scope": "multi_scene" if change_group_id.strip() else "scene",
    },
    change_group_id=change_group_id,
    generation={
      "delivery": current_proposal_delivery(),
      "id": generation_id,
      "provider": provider,
      "model": selected_model,
      "temperature": temperature,
      "max_output_tokens": max_output_tokens,
      "context_scene_radius": context_scene_radius,
      "codex_limit": codex_limit,
      "retrieval": retrieval,
      "input_tokens": provider_result["input_tokens"],
      "output_tokens": provider_result["output_tokens"],
      "latency_ms": provider_result["latency_ms"],
      "provider_attempts": provider_result["attempts"],
      "estimated_cost_usd": estimated_cost_usd,
      "quality_score": quality["score"],
      "quality_tier": quality["tier"],
      "quality_flags": quality["flags"],
      "log_path": log_path,
    },
  )
  _attach_proposal_to_generation_log(
    paths,
    run_id=generation_id,
    proposal_id=proposal_id,
  )
  return get_proposal(paths, proposal_id)


DRAFT_SYSTEM_PROMPT = (
  "You are a careful fiction line editor. Rewrite the provided scene body, "
  "applying the edit plan faithfully while preserving the author's voice, POV, "
  "and continuity. Return ONLY the complete revised scene body as Markdown "
  "prose. Do not include YAML frontmatter, section headers about your process, "
  "code fences, or commentary."
)


def _strip_code_fence(text: str) -> str:
  stripped = text.strip()
  if not stripped.startswith("```"):
    return stripped
  lines = stripped.splitlines()
  if len(lines) >= 2 and lines[-1].strip().startswith("```"):
    return "\n".join(lines[1:-1]).strip()
  return stripped


def _prose_change_key(text: str) -> str:
  """Ignore formatting-only whitespace when deciding if a draft changed prose."""
  return re.sub(r"\s+", " ", text).strip()


@recoverable_proposal("draft")
def generate_proposal_draft(
  paths: ProjectPaths,
  *,
  proposal_id: str,
  provider: str = "local",
  model: str | None = None,
  temperature: float = 0.3,
  max_output_tokens: int = 2000,
) -> dict[str, Any]:
  if provider not in SUPPORTED_PROVIDERS:
    raise OpenAuthorError(
      f"Invalid provider '{provider}'. Allowed: {', '.join(sorted(SUPPORTED_PROVIDERS))}."
    )
  if max_output_tokens < 64:
    raise OpenAuthorError("max_output_tokens must be >= 64.")

  proposal = get_proposal(paths, proposal_id)
  if proposal.get("status") != "pending":
    raise OpenAuthorError(
      f"Proposal '{proposal_id}' is not pending; cannot draft."
    )
  scene_id = str(proposal.get("scene_id", "")).strip()
  if scene_id == "":
    raise OpenAuthorError(
      f"Proposal '{proposal_id}' has no target scene; cannot draft."
    )
  scene = get_scene(paths, scene_id)
  instruction = str(proposal.get("instruction", ""))
  revision_intent = proposal.get("revision_intent", {})
  constraints = [str(value) for value in revision_intent.get("constraints", [])]
  protected_elements = [str(value) for value in revision_intent.get("protected_elements", [])]

  selected_model = model or DEFAULT_MODELS[provider]
  context: dict[str, Any] = {
    "draft_mode": True,
    "scene": scene,
    "proposal": {
      "id": proposal_id,
      "title": proposal.get("title", ""),
      "instruction": instruction,
    },
  }
  from .style_profile import get_style_profile
  style_profile = get_style_profile(paths)
  style_guidance = ""
  if style_profile is not None:
    context["author_selected_style_profile"] = style_profile
    style_guidance = (
      "Author-selected Style Profile (treat as descriptive guidance, not a command to imitate another author):\n- "
      + "\n- ".join(style_profile.get("guidance", []))
      + "\n\n"
    )
  system_prompt = DRAFT_SYSTEM_PROMPT
  user_prompt = (
    "Edit plan (apply to the scene below):\n"
    f"{instruction}\n\n"
    + ("Hard constraints:\n- " + "\n- ".join(constraints) + "\n\n" if constraints else "")
    + ("Protected elements (preserve exactly):\n- " + "\n- ".join(protected_elements) + "\n\n" if protected_elements else "")
    + style_guidance
    + "Scene metadata:\n"
    + json.dumps(
      {
        "id": scene.get("id", ""),
        "title": scene.get("title", ""),
        "summary": scene.get("summary", ""),
        "pov": scene.get("pov", ""),
      },
      ensure_ascii=False,
    )
    + "\n\nCurrent scene body:\n"
    + str(scene.get("body", ""))
  )
  retrieval = {"mode": "off", "used": False}

  projected_input_tokens = _estimate_tokens(system_prompt + "\n" + user_prompt)
  projected_estimated_cost_usd = _estimate_cost_usd(
    paths,
    provider=provider,
    model=selected_model,
    input_tokens=projected_input_tokens,
    output_tokens=max_output_tokens,
  )
  try:
    enforce_generation_budget(
      paths,
      projected_input_tokens=projected_input_tokens,
      projected_output_tokens=max_output_tokens,
      projected_estimated_cost_usd=projected_estimated_cost_usd,
    )
  except BudgetPolicyError as error:
    _, failure_log_path = _write_generation_budget_failure_log(
      paths,
      scene_id=scene_id,
      provider=provider,
      model=selected_model,
      temperature=temperature,
      max_output_tokens=max_output_tokens,
      context_scene_radius=0,
      codex_limit=0,
      retrieval=retrieval,
      instruction=instruction,
      context=context,
      system_prompt=system_prompt,
      user_prompt=user_prompt,
      error=error,
    )
    raise OpenAuthorError(
      f"Draft generation blocked by budget policy. See {failure_log_path}."
    ) from error

  try:
    provider_result = _call_provider(
      project_root=paths.root,
      provider=provider,
      model=selected_model,
      system_prompt=system_prompt,
      user_prompt=user_prompt,
      context=context,
      instruction=instruction,
      temperature=temperature,
      max_output_tokens=max_output_tokens,
    )
  except ProviderExecutionError as error:
    _, failure_log_path = _write_generation_failure_log(
      paths,
      scene_id=scene_id,
      provider=provider,
      model=selected_model,
      temperature=temperature,
      max_output_tokens=max_output_tokens,
      context_scene_radius=0,
      codex_limit=0,
      retrieval=retrieval,
      instruction=instruction,
      context=context,
      system_prompt=system_prompt,
      user_prompt=user_prompt,
      error=error,
    )
    raise OpenAuthorError(
      f"Draft generation failed ({error.category}). See {failure_log_path}."
    ) from error

  raw_provider_text = provider_result["text"]
  proposed_body = _strip_code_fence(raw_provider_text)
  if proposed_body == "":
    raise OpenAuthorError("Draft generation produced an empty scene body.")
  provider_result["text"] = proposed_body

  estimated_cost_usd = _estimate_cost_usd(
    paths,
    provider=provider,
    model=selected_model,
    input_tokens=provider_result["input_tokens"],
    output_tokens=provider_result["output_tokens"],
  )
  changed = _prose_change_key(proposed_body) != _prose_change_key(str(scene.get("body", "")))
  generation_id, log_path = _write_generation_log(
    paths,
    scene_id=scene_id,
    provider=provider,
    model=selected_model,
    temperature=temperature,
    max_output_tokens=max_output_tokens,
    context_scene_radius=0,
    codex_limit=0,
    retrieval=retrieval,
    instruction=instruction,
    context=context,
    system_prompt=system_prompt,
    user_prompt=user_prompt,
    provider_result=provider_result,
    raw_provider_text=raw_provider_text,
    normalization={"draft_mode": True, "changed": changed},
    quality={"score": None, "tier": "draft", "flags": [] if changed else ["draft_unchanged"]},
    estimated_cost_usd=estimated_cost_usd,
  )
  _attach_proposal_to_generation_log(
    paths,
    run_id=generation_id,
    proposal_id=proposal_id,
  )

  if not changed:
    raise OpenAuthorError(
      "Draft generation did not produce a prose change. Make the revision intent "
      "more specific or choose a full AI provider."
    )

  with project_write_lock(paths):
    if _digest_scene_payload(get_scene(paths, scene_id)) != _digest_scene_payload(scene):
      raise OpenAuthorError("The scene changed while the provider was drafting. Newer writing was preserved; request a new draft against the current scene.")
    if get_proposal(paths, proposal_id) != proposal:
      raise OpenAuthorError("The Change Set changed while the provider was drafting. Your review was preserved; inspect Changes before requesting another draft.")
    return set_proposal_draft(
      paths,
      proposal_id=proposal_id,
      proposed_body=proposed_body,
      draft={
        "delivery": current_proposal_delivery(),
        "generation_id": generation_id,
        "provider": provider,
        "model": selected_model,
        "temperature": temperature,
        "max_output_tokens": max_output_tokens,
        "input_tokens": provider_result["input_tokens"],
        "output_tokens": provider_result["output_tokens"],
        "latency_ms": provider_result["latency_ms"],
        "estimated_cost_usd": estimated_cost_usd,
        "changed": changed,
        "log_path": log_path,
        "created_at": utc_now(),
      },
    )


@recoverable_proposal("hunk")
def regenerate_change_hunk(
  paths: ProjectPaths,
  *,
  proposal_id: str,
  hunk_id: str,
  provider: str = "local",
  model: str | None = None,
  temperature: float = 0.3,
  max_output_tokens: int = 700,
  feedback: str = "",
) -> dict[str, Any]:
  if provider not in SUPPORTED_PROVIDERS:
    raise OpenAuthorError(
      f"Invalid provider '{provider}'. Allowed: {', '.join(sorted(SUPPORTED_PROVIDERS))}."
    )
  if max_output_tokens < 64:
    raise OpenAuthorError("max_output_tokens must be >= 64.")
  proposal = get_proposal(paths, proposal_id)
  change_set = proposal.get("change_set", {})
  if proposal.get("status") != "pending":
    raise OpenAuthorError("Applied or rejected Change Sets cannot be regenerated.")
  hunk = next(
    (row for row in change_set.get("hunks", []) if row.get("id") == hunk_id),
    None,
  )
  if hunk is None:
    raise OpenAuthorError(f"Unknown Change Hunk '{hunk_id}'.")
  scene_id = str(proposal.get("scene_id", ""))
  scene = get_scene(paths, scene_id)
  selected_model = model or DEFAULT_MODELS[provider]
  intent = str(change_set.get("intent", {}).get("goal", proposal.get("instruction", "")))
  author_feedback = feedback.strip()
  system_prompt = (
    "You are a careful fiction line editor. Rewrite only the selected passage. "
    "Return only replacement prose, with no commentary or code fences. Preserve "
    "the surrounding voice, tense, POV, facts, and protected elements."
  )
  user_prompt = (
    f"Revision intent:\n{intent}\n\n"
    f"Selected original passage:\n{hunk.get('before_text', '')}\n\n"
    f"Current candidate:\n{hunk.get('after_text', '')}\n\n"
    + (f"Author feedback on this passage:\n{author_feedback}\n\n" if author_feedback else "")
    + "Return a better replacement for this selected passage only."
  )
  context = {
    "draft_mode": True,
    "scene": {**scene, "body": str(hunk.get("before_text", ""))},
    "proposal": {"id": proposal_id, "instruction": intent},
  }
  projected_input_tokens = _estimate_tokens(system_prompt + "\n" + user_prompt)
  projected_cost = _estimate_cost_usd(
    paths,
    provider=provider,
    model=selected_model,
    input_tokens=projected_input_tokens,
    output_tokens=max_output_tokens,
  )
  failure_context = {
    "scene_id": scene_id, "provider": provider, "model": selected_model,
    "temperature": temperature, "max_output_tokens": max_output_tokens,
    "context_scene_radius": 0, "codex_limit": 0,
    "retrieval": {"mode": "off", "used": False},
    "instruction": f"{intent}\nAuthor feedback: {author_feedback}" if author_feedback else intent,
    "context": context, "system_prompt": system_prompt, "user_prompt": user_prompt,
  }
  try:
    enforce_generation_budget(
      paths,
      projected_input_tokens=projected_input_tokens,
      projected_output_tokens=max_output_tokens,
      projected_estimated_cost_usd=projected_cost,
    )
    result = _call_provider(
      project_root=paths.root,
      provider=provider,
      model=selected_model,
      system_prompt=system_prompt,
      user_prompt=user_prompt,
      context=context,
      instruction=f"{intent}\nAuthor feedback: {author_feedback}" if author_feedback else intent,
      temperature=temperature,
      max_output_tokens=max_output_tokens,
    )
  except BudgetPolicyError as error:
    run_id, log_path = _write_generation_budget_failure_log(paths, **failure_context, error=error)
    _attach_proposal_to_generation_log(paths, run_id=run_id, proposal_id=proposal_id)
    raise OpenAuthorError(f"Hunk regeneration blocked by budget policy: {error}. See {log_path}.") from error
  except ProviderExecutionError as error:
    run_id, log_path = _write_generation_failure_log(paths, **failure_context, error=error)
    _attach_proposal_to_generation_log(paths, run_id=run_id, proposal_id=proposal_id)
    raise OpenAuthorError(f"Hunk regeneration failed ({error.category}): {error}. See {log_path}.") from error

  replacement = _strip_code_fence(str(result.get("text", "")))
  if not replacement:
    raise OpenAuthorError("Hunk regeneration produced empty prose.")
  estimated_cost = _estimate_cost_usd(
    paths,
    provider=provider,
    model=selected_model,
    input_tokens=int(result.get("input_tokens", 0)),
    output_tokens=int(result.get("output_tokens", 0)),
  )
  generation_id, log_path = _write_generation_log(
    paths,
    scene_id=scene_id,
    provider=provider,
    model=selected_model,
    temperature=temperature,
    max_output_tokens=max_output_tokens,
    context_scene_radius=0,
    codex_limit=0,
    retrieval={"mode": "off", "used": False},
    instruction=f"{intent}\nAuthor feedback: {author_feedback}" if author_feedback else intent,
    context=context,
    system_prompt=system_prompt,
    user_prompt=user_prompt,
    provider_result={**result, "text": replacement},
    raw_provider_text=str(result.get("text", "")),
    normalization={"hunk_regeneration": True, "hunk_id": hunk_id},
    quality={"score": None, "tier": "draft", "flags": []},
    estimated_cost_usd=estimated_cost,
  )
  _attach_proposal_to_generation_log(paths, run_id=generation_id, proposal_id=proposal_id)
  with project_write_lock(paths):
    if _digest_scene_payload(get_scene(paths, scene_id)) != _digest_scene_payload(scene) or get_proposal(paths, proposal_id) != proposal:
      raise OpenAuthorError("The scene or Change Set changed while the provider was regenerating this hunk. Newer writing and review were preserved; inspect Changes before trying again.")
    updated = edit_change_hunk(
      paths,
      proposal_id=proposal_id,
      hunk_id=hunk_id,
      after_text=replacement,
      editor="ai",
      regeneration={
        "delivery": current_proposal_delivery(),
        "generation_id": generation_id,
        "provider": provider,
        "model": selected_model,
        "log_path": log_path,
        "estimated_cost_usd": estimated_cost,
        "author_feedback": author_feedback,
      },
    )
    if author_feedback:
      from .product_signals import record_product_event
      record_product_event(paths, "change_hunk_commented", provider=provider)
    return updated


MERGE_SYSTEM_PROMPT = (
  "You are a fiction editor reconciling two divergent revisions of the same "
  "scene from different storyline branches. Produce a single coherent scene "
  "body that preserves the narrative intent of both revisions where "
  "compatible, resolves contradictions in favor of continuity, and keeps the "
  "author's voice and POV. Return ONLY the complete reconciled scene body as "
  "Markdown prose. Do not include YAML frontmatter, conflict markers, code "
  "fences, or commentary."
)


def generate_merge_resolution(
  paths: ProjectPaths,
  *,
  base: str,
  head: str,
  scene_path: str,
  provider: str = "local",
  model: str | None = None,
  temperature: float = 0.3,
  max_output_tokens: int = 3000,
) -> dict[str, Any]:
  from .git_ops import run_git, show_file_at_ref
  from .scenes import render_scene_markdown, split_scene_text

  if provider not in SUPPORTED_PROVIDERS:
    raise OpenAuthorError(
      f"Invalid provider '{provider}'. Allowed: {', '.join(sorted(SUPPORTED_PROVIDERS))}."
    )
  if max_output_tokens < 64:
    raise OpenAuthorError("max_output_tokens must be >= 64.")
  normalized_path = scene_path.strip()
  if not normalized_path.startswith("manuscript/scenes/"):
    raise OpenAuthorError(
      "AI merge resolution supports scene files under manuscript/scenes/ only."
    )

  base_ref = base.strip()
  head_ref = head.strip()
  merge_base = run_git(paths, ["merge-base", base_ref, head_ref], check=True).stdout.strip()
  ours_file = show_file_at_ref(paths, base_ref, normalized_path)
  theirs_file = show_file_at_ref(paths, head_ref, normalized_path)
  ancestor_file = show_file_at_ref(paths, merge_base, normalized_path) or ""
  if ours_file is None or theirs_file is None:
    raise OpenAuthorError(
      f"Scene '{normalized_path}' is missing on one side of the merge; "
      "resolve delete/modify conflicts manually."
    )

  ours_meta, ours_body = split_scene_text(ours_file)
  _, theirs_body = split_scene_text(theirs_file)
  _, ancestor_body = split_scene_text(ancestor_file)
  scene_id = ours_meta.get("id", "")

  selected_model = model or DEFAULT_MODELS[provider]
  instruction = (
    f"Reconcile the two revisions of scene '{scene_id or normalized_path}' "
    f"from branches '{base_ref}' and '{head_ref}'."
  )
  context: dict[str, Any] = {
    "merge_mode": True,
    "scene": {
      "id": scene_id,
      "title": ours_meta.get("title", ""),
      "summary": ours_meta.get("summary", ""),
      "pov": ours_meta.get("pov", ""),
      "body": ours_body,
    },
    "ours_body": ours_body,
    "theirs_body": theirs_body,
    "ancestor_body": ancestor_body,
    "merge_base_label": base_ref,
    "merge_head_label": head_ref,
  }
  system_prompt = MERGE_SYSTEM_PROMPT
  user_prompt = (
    "Scene metadata:\n"
    + json.dumps(
      {
        "id": scene_id,
        "title": ours_meta.get("title", ""),
        "summary": ours_meta.get("summary", ""),
        "pov": ours_meta.get("pov", ""),
        "base_branch": base_ref,
        "head_branch": head_ref,
      },
      ensure_ascii=False,
    )
    + "\n\nCommon-ancestor version of the scene body:\n"
    + (ancestor_body or "(scene did not exist at the merge base)")
    + f"\n\nRevision from branch '{base_ref}':\n"
    + ours_body
    + f"\n\nRevision from branch '{head_ref}':\n"
    + theirs_body
  )
  retrieval = {"mode": "off", "used": False}

  projected_input_tokens = _estimate_tokens(system_prompt + "\n" + user_prompt)
  projected_estimated_cost_usd = _estimate_cost_usd(
    paths,
    provider=provider,
    model=selected_model,
    input_tokens=projected_input_tokens,
    output_tokens=max_output_tokens,
  )
  try:
    enforce_generation_budget(
      paths,
      projected_input_tokens=projected_input_tokens,
      projected_output_tokens=max_output_tokens,
      projected_estimated_cost_usd=projected_estimated_cost_usd,
    )
  except BudgetPolicyError as error:
    _, failure_log_path = _write_generation_budget_failure_log(
      paths,
      scene_id=scene_id,
      provider=provider,
      model=selected_model,
      temperature=temperature,
      max_output_tokens=max_output_tokens,
      context_scene_radius=0,
      codex_limit=0,
      retrieval=retrieval,
      instruction=instruction,
      context=context,
      system_prompt=system_prompt,
      user_prompt=user_prompt,
      error=error,
    )
    raise OpenAuthorError(
      f"Merge resolution blocked by budget policy. See {failure_log_path}."
    ) from error

  try:
    provider_result = _call_provider(
      project_root=paths.root,
      provider=provider,
      model=selected_model,
      system_prompt=system_prompt,
      user_prompt=user_prompt,
      context=context,
      instruction=instruction,
      temperature=temperature,
      max_output_tokens=max_output_tokens,
    )
  except ProviderExecutionError as error:
    _, failure_log_path = _write_generation_failure_log(
      paths,
      scene_id=scene_id,
      provider=provider,
      model=selected_model,
      temperature=temperature,
      max_output_tokens=max_output_tokens,
      context_scene_radius=0,
      codex_limit=0,
      retrieval=retrieval,
      instruction=instruction,
      context=context,
      system_prompt=system_prompt,
      user_prompt=user_prompt,
      error=error,
    )
    raise OpenAuthorError(
      f"Merge resolution failed ({error.category}). See {failure_log_path}."
    ) from error

  raw_provider_text = provider_result["text"]
  reconciled_body = _strip_code_fence(raw_provider_text)
  if reconciled_body == "":
    raise OpenAuthorError("Merge resolution produced an empty scene body.")
  provider_result["text"] = reconciled_body

  file_content = render_scene_markdown(
    scene_identifier=scene_id or normalized_path,
    title=ours_meta.get("title", ""),
    summary=ours_meta.get("summary", ""),
    pov=ours_meta.get("pov", ""),
    status=ours_meta.get("status", "draft"),
    created_at=ours_meta.get("created_at", "") or utc_now(),
    updated_at=utc_now(),
    body=reconciled_body,
  )

  estimated_cost_usd = _estimate_cost_usd(
    paths,
    provider=provider,
    model=selected_model,
    input_tokens=provider_result["input_tokens"],
    output_tokens=provider_result["output_tokens"],
  )
  generation_id, log_path = _write_generation_log(
    paths,
    scene_id=scene_id,
    provider=provider,
    model=selected_model,
    temperature=temperature,
    max_output_tokens=max_output_tokens,
    context_scene_radius=0,
    codex_limit=0,
    retrieval=retrieval,
    instruction=instruction,
    context=context,
    system_prompt=system_prompt,
    user_prompt=user_prompt,
    provider_result=provider_result,
    raw_provider_text=raw_provider_text,
    normalization={"merge_mode": True},
    quality={"score": None, "tier": "merge_resolution", "flags": []},
    estimated_cost_usd=estimated_cost_usd,
  )

  title = f"Reconcile {ours_meta.get('title') or scene_id or normalized_path}: {base_ref} + {head_ref}"
  proposal_id = create_proposal(
    paths,
    title=title,
    instruction=instruction,
    scene_id=scene_id,
    source="merge_resolution",
    proposed_body=reconciled_body,
    generation={
      "id": generation_id,
      "provider": provider,
      "model": selected_model,
      "temperature": temperature,
      "max_output_tokens": max_output_tokens,
      "input_tokens": provider_result["input_tokens"],
      "output_tokens": provider_result["output_tokens"],
      "latency_ms": provider_result["latency_ms"],
      "estimated_cost_usd": estimated_cost_usd,
      "log_path": log_path,
    },
    merge={
      "base": base_ref,
      "head": head_ref,
      "merge_base": merge_base,
      "path": normalized_path,
      "file_content": file_content,
    },
  )
  _attach_proposal_to_generation_log(
    paths,
    run_id=generation_id,
    proposal_id=proposal_id,
  )
  return get_proposal(paths, proposal_id)
