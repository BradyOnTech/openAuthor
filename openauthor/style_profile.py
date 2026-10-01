from __future__ import annotations

import json
import hashlib
import re
import unicodedata
from collections import Counter
from typing import Any

from .project import OpenAuthorError, ProjectPaths, atomic_write_json, utc_now
from .project_lock import project_write_lock
from .scenes import get_scene
from .text_analysis import lexical_spans, uses_unspaced_script

STYLE_PROFILE_SCHEMA_VERSION = 2
COMMON_WORDS = {"the", "and", "that", "with", "this", "from", "have", "were", "was", "for", "but", "not", "you", "she", "his", "her", "they", "their", "into", "about"}


def _profile_path(paths: ProjectPaths):
  return paths.project_dir / "style_profile.json"


def get_style_profile(paths: ProjectPaths) -> dict[str, Any] | None:
  path = _profile_path(paths)
  if not path.exists():
    return None
  try:
    payload = json.loads(path.read_text(encoding="utf-8"))
  except (OSError, json.JSONDecodeError) as error:
    raise OpenAuthorError(f"Style Profile is unreadable: {error}") from error
  if not isinstance(payload, dict) or payload.get("schema_version") not in {1, STYLE_PROFILE_SCHEMA_VERSION}:
    raise OpenAuthorError("Unsupported Style Profile schema version.")
  if (not isinstance(payload.get("exemplar_scene_ids"), list)
      or not all(isinstance(value, str) and value for value in payload["exemplar_scene_ids"])
      or not isinstance(payload.get("metrics"), dict)
      or not isinstance(payload.get("created_at"), str)
      or not isinstance(payload.get("guidance"), list)
      or not all(isinstance(value, str) for value in payload["guidance"])
      or not isinstance(payload.get("source_digests", {}), dict)):
    raise OpenAuthorError("Invalid Style Profile data. Restore a saved version or rebuild the profile.")
  if payload["schema_version"] == STYLE_PROFILE_SCHEMA_VERSION:
    measurement = payload.get("measurement")
    if (payload.get("reference_mode") not in {"current", "frozen"} or not isinstance(measurement, dict)
        or not isinstance(measurement.get("limitations"), list)
        or not all(isinstance(value, str) for value in measurement["limitations"])):
      raise OpenAuthorError("Invalid Style Profile measurements. Restore a saved version or rebuild the profile.")
  current_sources = {}
  for scene_id in payload.get("exemplar_scene_ids", []):
    try:
      current_sources[scene_id] = _source_digest(get_scene(paths, scene_id)["body"])
    except (OpenAuthorError, OSError):
      current_sources[scene_id] = None
  recorded = payload.get("source_digests", {})
  verified = bool(current_sources) and all(recorded.get(scene_id) for scene_id in current_sources) and payload.get("schema_version") == STYLE_PROFILE_SCHEMA_VERSION
  changed = [scene_id for scene_id, digest in current_sources.items() if digest != recorded.get(scene_id) or digest is None]
  freshness = "unknown" if not verified else "stale" if changed else "current"
  usable = verified and (not changed or payload.get("reference_mode") == "frozen")
  fingerprint = hashlib.sha256(json.dumps({"profile": payload, "current_sources": current_sources}, sort_keys=True).encode()).hexdigest()
  return {**payload, "freshness": freshness, "changed_scene_ids": changed, "usable_for_ai": usable, "fingerprint": fingerprint}


def _source_digest(body: str) -> str:
  return hashlib.sha256(body.encode("utf-8")).hexdigest()


def style_profile_for_ai(paths: ProjectPaths) -> dict[str, Any] | None:
  return style_profile_context(paths)["profile"]


def style_profile_context(paths: ProjectPaths) -> dict[str, Any]:
  profile = get_style_profile(paths)
  if not profile:
    return {"profile": None, "status": {"freshness": "absent", "included": False, "reference_mode": "current"}}
  projection = {key: profile[key] for key in (
    "exemplar_scene_ids", "created_at", "source_digests", "reference_mode", "freshness", "metrics", "measurement", "guidance",
  )} if profile["usable_for_ai"] else None
  return {"profile": projection, "status": {
    "freshness": profile["freshness"], "included": profile["usable_for_ai"],
    "reference_mode": profile.get("reference_mode", "current"), "fingerprint": profile["fingerprint"],
    "changed_scene_ids": profile["changed_scene_ids"],
  }}


def set_style_profile_reference(paths: ProjectPaths, *, mode: str, expected_fingerprint: str) -> dict[str, Any]:
  if mode not in {"current", "frozen"}:
    raise OpenAuthorError("Choose current or frozen Style Profile reference mode.")
  with project_write_lock(paths):
    profile = get_style_profile(paths)
    if not profile or not expected_fingerprint or profile["fingerprint"] != expected_fingerprint:
      raise OpenAuthorError("Style Profile or its sources changed. Refresh and review before choosing a reference.")
    if profile["freshness"] == "unknown":
      raise OpenAuthorError("Rebuild this legacy Style Profile before choosing a frozen reference.")
    payload = {key: value for key, value in profile.items() if key not in {"freshness", "changed_scene_ids", "usable_for_ai", "fingerprint"}}
    payload["reference_mode"] = mode
    atomic_write_json(_profile_path(paths), payload)
    return get_style_profile(paths)


def build_style_profile(paths: ProjectPaths, *, scene_ids: list[str], expected_fingerprint: str | None = None) -> dict[str, Any]:
  with project_write_lock(paths):
    if expected_fingerprint is not None:
      current = get_style_profile(paths)
      if expected_fingerprint != (current["fingerprint"] if current else ""):
        raise OpenAuthorError("Style Profile or its sources changed. Refresh before rebuilding.")
    return _build_style_profile(paths, scene_ids=scene_ids)


def _build_style_profile(paths: ProjectPaths, *, scene_ids: list[str]) -> dict[str, Any]:
  selected = list(dict.fromkeys(value.strip() for value in scene_ids if value.strip()))
  if not selected:
    raise OpenAuthorError("Select at least one exemplar scene for the Style Profile.")
  bodies = [get_scene(paths, scene_id)["body"] for scene_id in selected]
  text = "\n\n".join(bodies)
  words = [unicodedata.normalize("NFC", text[start:end]) for start, end in lexical_spans(text)]
  segmented = bool(words) and not any(uses_unspaced_script(char) for char in text)
  sentences = [row.strip() for row in re.split(r"(?<=[.!?。！？])\s*", text) if row.strip()]
  paragraphs = [row.strip() for row in re.split(r"\n\s*\n", text) if row.strip()]
  dialogue_words = sum(len(lexical_spans(match)) for match in re.findall(r'[“"]([^”"]+)[”"]', text))
  word_counts = Counter(word.casefold() for word in words if len(word) >= 4 and word.casefold() not in COMMON_WORDS)
  avg_sentence = len(words) / max(1, len(sentences))
  avg_paragraph = len(words) / max(1, len(paragraphs))
  dialogue_ratio = dialogue_words / max(1, len(words))
  semicolon_rate = text.count(";") / max(1, len(sentences))
  em_dash_rate = (text.count("—") + text.count("--")) / max(1, len(sentences))
  limitations = ["Lexical counts and punctuation-based sentences are approximate, not a measure of voice or writing quality.",
    "Dialogue counting recognizes paired straight or curly double quotes, not every dialogue convention."]
  if not segmented:
    limitations.append("Word segmentation is unavailable for this empty or unspaced-script sample. Word-based metrics and advice are omitted.")
  guidance = ["These are descriptive observations of selected exemplars, not targets for sentence length, vocabulary or dialogue."]
  if segmented:
    guidance.extend([
      f"The sample averages approximately {avg_sentence:.1f} lexical words per sentence and {avg_paragraph:.1f} per paragraph.",
      f"Approximately {dialogue_ratio:.0%} of sample words occur inside paired double quotes.",
      f"Semicolon frequency is {semicolon_rate:.2f} and em-dash frequency is {em_dash_rate:.2f} per sentence.",
    ])
  if word_counts and segmented:
    guidance.append("Recurring exemplar diction includes: " + ", ".join(word for word, _ in word_counts.most_common(12)) + ".")
  payload = {
    "schema_version": STYLE_PROFILE_SCHEMA_VERSION,
    "exemplar_scene_ids": selected,
    "created_at": utc_now(),
    "reference_mode": "current",
    "source_digests": {scene_id: _source_digest(body) for scene_id, body in zip(selected, bodies)},
    "measurement": {"method": "unicode_lexical_v1", "word_metrics_available": segmented, "limitations": limitations},
    "metrics": {
      "character_count": len(text),
      "word_count": len(words) if segmented else None,
      "sentence_count": len(sentences) if segmented else None,
      "paragraph_count": len(paragraphs),
      "average_sentence_words": round(avg_sentence, 2) if segmented else None,
      "average_paragraph_words": round(avg_paragraph, 2) if segmented else None,
      "dialogue_word_ratio": round(dialogue_ratio, 4) if segmented else None,
      "semicolon_per_sentence": round(semicolon_rate, 4) if segmented else None,
      "em_dash_per_sentence": round(em_dash_rate, 4) if segmented else None,
      "signature_words": [word for word, _ in word_counts.most_common(12)] if segmented else [],
    },
    "guidance": guidance,
  }
  atomic_write_json(_profile_path(paths), payload)
  return get_style_profile(paths)
