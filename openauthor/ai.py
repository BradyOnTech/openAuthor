from __future__ import annotations

import hashlib
import json
import os
import re
import time
from typing import Any
import urllib.error
import urllib.request
import uuid

from .checks import run_continuity_checks
from .codex import list_entities
from .project import OpenAuthorError, ProjectPaths, utc_now
from .proposals import create_proposal, get_proposal
from .scenes import get_scene, list_scenes

SUPPORTED_PROVIDERS = {"local", "openai", "anthropic"}
DEFAULT_MODELS = {
  "local": "heuristic-v1",
  "openai": "gpt-4.1-mini",
  "anthropic": "claude-3-5-haiku-latest",
}
PROPOSAL_SECTIONS = ("Intent", "Constraints", "Edit Plan", "Continuity Notes")
RETRYABLE_HTTP_STATUSES = {408, 409, 425, 429, 500, 502, 503, 504}


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
    except urllib.error.URLError as error:
      reason = str(error.reason)
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
  scene_summary = scene["summary"] or "No summary provided."
  scene_pov = scene["pov"] or "No POV specified."
  continuity_issues = context["continuity_issues"]
  codex_entities = context["codex_entities"]

  constraint_lines = [
    f"Preserve POV voice: {scene_pov}.",
    f"Stay aligned with summary: {scene_summary}.",
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
    f"- Refine scene '{scene_title}' with focus on: {instruction.strip()}.\n\n"
    "Constraints:\n"
    + "\n".join(f"- {line}" for line in constraint_lines)
    + "\n\nEdit Plan:\n"
    "- Tighten sentence rhythm and reduce exposition where possible.\n"
    "- Keep motivations and timeline continuity explicit.\n"
    "- Preserve existing voice markers while improving clarity.\n\n"
    "Continuity Notes:\n"
    + "\n".join(f"- {line}" for line in continuity_lines)
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


def _openai_chat_completion(
  *,
  model: str,
  system_prompt: str,
  user_prompt: str,
  temperature: float,
  max_output_tokens: int,
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
    "messages": [
      {"role": "system", "content": system_prompt},
      {"role": "user", "content": user_prompt},
    ],
    "temperature": temperature,
    "max_tokens": max_output_tokens,
  }
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
    "input_tokens": int(usage.get("prompt_tokens", 0) or 0),
    "output_tokens": int(usage.get("completion_tokens", 0) or 0),
    "raw_usage": usage,
    "attempts": attempts,
  }


def _anthropic_message(
  *,
  model: str,
  system_prompt: str,
  user_prompt: str,
  temperature: float,
  max_output_tokens: int,
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
  payload: dict[str, Any] = {
    "model": model,
    "system": system_prompt,
    "messages": [{"role": "user", "content": user_prompt}],
    "temperature": temperature,
    "max_tokens": max_output_tokens,
  }
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
  usage = response.get("usage", {})
  return {
    "text": "\n".join(text_parts).strip(),
    "input_tokens": int(usage.get("input_tokens", 0) or 0),
    "output_tokens": int(usage.get("output_tokens", 0) or 0),
    "raw_usage": usage,
    "attempts": attempts,
  }


def _call_provider(
  *,
  provider: str,
  model: str,
  system_prompt: str,
  user_prompt: str,
  context: dict[str, Any],
  instruction: str,
  temperature: float,
  max_output_tokens: int,
) -> dict[str, Any]:
  start = time.perf_counter()
  if provider == "local":
    text = _generate_local_text(context, instruction)
    input_tokens = _estimate_tokens(system_prompt + "\n" + user_prompt)
    output_tokens = _estimate_tokens(text)
    attempts = 1
  elif provider == "openai":
    payload = _openai_chat_completion(
      model=model,
      system_prompt=system_prompt,
      user_prompt=user_prompt,
      temperature=temperature,
      max_output_tokens=max_output_tokens,
    )
    text = payload["text"]
    input_tokens = payload["input_tokens"]
    output_tokens = payload["output_tokens"]
    attempts = int(payload.get("attempts", 1) or 1)
  elif provider == "anthropic":
    payload = _anthropic_message(
      model=model,
      system_prompt=system_prompt,
      user_prompt=user_prompt,
      temperature=temperature,
      max_output_tokens=max_output_tokens,
    )
    text = payload["text"]
    input_tokens = payload["input_tokens"]
    output_tokens = payload["output_tokens"]
    attempts = int(payload.get("attempts", 1) or 1)
  else:
    raise OpenAuthorError(
      f"Invalid provider '{provider}'. Allowed: {', '.join(sorted(SUPPORTED_PROVIDERS))}."
    )

  latency_ms = int((time.perf_counter() - start) * 1000)
  if not text.strip():
    raise ProviderExecutionError(
      "Provider returned empty output.",
      category="invalid_provider_output",
      retriable=False,
      provider=provider,
      attempts=attempts,
    )

  return {
    "text": text.strip(),
    "input_tokens": int(input_tokens),
    "output_tokens": int(output_tokens),
    "latency_ms": latency_ms,
    "attempts": attempts,
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
  instruction: str,
  context: dict[str, Any],
  system_prompt: str,
  user_prompt: str,
  provider_result: dict[str, Any],
  raw_provider_text: str,
  normalization: dict[str, Any],
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
    "usage": {
      "input_tokens": provider_result["input_tokens"],
      "output_tokens": provider_result["output_tokens"],
      "latency_ms": provider_result["latency_ms"],
      "provider_attempts": provider_result["attempts"],
      "estimated_cost_usd": estimated_cost_usd,
    },
  }
  log_file.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
  return run_id, str(log_file.relative_to(paths.root))


def _write_generation_failure_log(
  paths: ProjectPaths,
  *,
  scene_id: str,
  provider: str,
  model: str,
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
  log_file.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
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
  log_file.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _default_title(scene_title: str, instruction: str) -> str:
  short_instruction = _truncate(instruction, 48)
  return _truncate(f"{scene_title}: {short_instruction}", 72)


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
) -> dict[str, Any]:
  if provider not in SUPPORTED_PROVIDERS:
    raise OpenAuthorError(
      f"Invalid provider '{provider}'. Allowed: {', '.join(sorted(SUPPORTED_PROVIDERS))}."
    )
  if max_output_tokens < 64:
    raise OpenAuthorError("max_output_tokens must be >= 64.")

  selected_model = model or DEFAULT_MODELS[provider]
  context = build_generation_context(
    paths,
    scene_id=scene_id,
    context_scene_radius=context_scene_radius,
    codex_limit=codex_limit,
  )
  system_prompt, user_prompt = _build_prompts(context, instruction)
  try:
    provider_result = _call_provider(
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
      instruction=instruction,
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
    instruction=instruction,
    context=context,
  )
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
    instruction=instruction,
    context=context,
    system_prompt=system_prompt,
    user_prompt=user_prompt,
    provider_result=provider_result,
    raw_provider_text=raw_provider_text,
    normalization=normalization_diagnostics,
    estimated_cost_usd=estimated_cost_usd,
  )

  final_title = title.strip() or _default_title(context["scene"]["title"], instruction)
  proposal_id = create_proposal(
    paths,
    title=final_title,
    instruction=provider_result["text"],
    scene_id=scene_id,
    source="ai_generate",
    generation={
      "id": generation_id,
      "provider": provider,
      "model": selected_model,
      "temperature": temperature,
      "max_output_tokens": max_output_tokens,
      "context_scene_radius": context_scene_radius,
      "codex_limit": codex_limit,
      "input_tokens": provider_result["input_tokens"],
      "output_tokens": provider_result["output_tokens"],
      "latency_ms": provider_result["latency_ms"],
      "provider_attempts": provider_result["attempts"],
      "estimated_cost_usd": estimated_cost_usd,
      "log_path": log_path,
    },
  )
  _attach_proposal_to_generation_log(
    paths,
    run_id=generation_id,
    proposal_id=proposal_id,
  )
  return get_proposal(paths, proposal_id)
