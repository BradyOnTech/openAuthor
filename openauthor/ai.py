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


def _json_post(url: str, headers: dict[str, str], payload: dict[str, Any]) -> dict[str, Any]:
  request = urllib.request.Request(
    url,
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json", **headers},
    method="POST",
  )
  try:
    with urllib.request.urlopen(request, timeout=90) as response:
      body = response.read().decode("utf-8")
  except urllib.error.HTTPError as error:
    details = error.read().decode("utf-8", errors="replace")
    raise OpenAuthorError(
      f"Provider request failed with HTTP {error.code}: {_truncate(details, 280)}"
    ) from error
  except urllib.error.URLError as error:
    raise OpenAuthorError(f"Provider request failed: {error.reason}") from error

  try:
    return json.loads(body)
  except json.JSONDecodeError as error:
    raise OpenAuthorError(
      f"Provider returned non-JSON response: {_truncate(body, 220)}"
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

  lines: list[str] = []
  lines.append(f"Refine scene '{scene_title}' with focus on: {instruction.strip()}.")
  lines.append(f"Preserve POV voice: {scene_pov}.")
  lines.append(f"Keep intent aligned with summary: {scene_summary}.")

  if continuity_issues:
    lines.append("Address continuity risks:")
    for issue in continuity_issues[:3]:
      lines.append(f"- {issue['title']}: {issue['message']}")

  if codex_entities:
    lines.append("Respect codex anchors:")
    for entity in codex_entities[:3]:
      lines.append(f"- {entity['type']}: {entity['name']}")

  lines.append(
    "Deliver one concise rewrite pass and retain established character motivations."
  )
  return "\n".join(lines)


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
    raise OpenAuthorError("OPENAI_API_KEY is required for provider 'openai'.")
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
  response = _json_post(
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
    raise OpenAuthorError("ANTHROPIC_API_KEY is required for provider 'anthropic'.")
  base_url = os.getenv("OPENAUTHOR_ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1")
  payload: dict[str, Any] = {
    "model": model,
    "system": system_prompt,
    "messages": [{"role": "user", "content": user_prompt}],
    "temperature": temperature,
    "max_tokens": max_output_tokens,
  }
  response = _json_post(
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
  else:
    raise OpenAuthorError(
      f"Invalid provider '{provider}'. Allowed: {', '.join(sorted(SUPPORTED_PROVIDERS))}."
    )

  latency_ms = int((time.perf_counter() - start) * 1000)
  if not text.strip():
    raise OpenAuthorError("Provider returned empty output.")

  return {
    "text": text.strip(),
    "input_tokens": int(input_tokens),
    "output_tokens": int(output_tokens),
    "latency_ms": latency_ms,
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
    "scene-specific, and continuity-safe."
  )
  user_prompt = (
    f"User instruction:\n{instruction.strip()}\n\n"
    "Project context (JSON):\n"
    f"{json.dumps(context, indent=2)}\n\n"
    "Write a concise instruction that can be applied as a proposal card."
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
  estimated_cost_usd: float | None,
) -> tuple[str, str]:
  run_id = f"gen-{uuid.uuid4().hex[:12]}"
  log_file = paths.generations_dir / f"{run_id}.json"
  payload = {
    "run_id": run_id,
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
    "response_text": provider_result["text"],
    "usage": {
      "input_tokens": provider_result["input_tokens"],
      "output_tokens": provider_result["output_tokens"],
      "latency_ms": provider_result["latency_ms"],
      "estimated_cost_usd": estimated_cost_usd,
    },
  }
  log_file.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
  return run_id, str(log_file.relative_to(paths.root))


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
      "estimated_cost_usd": estimated_cost_usd,
      "log_path": log_path,
    },
  )
  return get_proposal(paths, proposal_id)
