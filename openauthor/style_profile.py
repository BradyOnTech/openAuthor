from __future__ import annotations

import json
import re
from collections import Counter
from typing import Any

from .project import OpenAuthorError, ProjectPaths, atomic_write_json, utc_now
from .scenes import get_scene

STYLE_PROFILE_SCHEMA_VERSION = 1
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
  if payload.get("schema_version") != STYLE_PROFILE_SCHEMA_VERSION:
    raise OpenAuthorError("Unsupported Style Profile schema version.")
  return payload


def build_style_profile(paths: ProjectPaths, *, scene_ids: list[str]) -> dict[str, Any]:
  selected = list(dict.fromkeys(value.strip() for value in scene_ids if value.strip()))
  if not selected:
    raise OpenAuthorError("Select at least one exemplar scene for the Style Profile.")
  bodies = [get_scene(paths, scene_id)["body"] for scene_id in selected]
  text = "\n\n".join(bodies)
  words = re.findall(r"[A-Za-z']+", text)
  sentences = [row.strip() for row in re.split(r"(?<=[.!?])\s+", text) if row.strip()]
  paragraphs = [row.strip() for row in re.split(r"\n\s*\n", text) if row.strip()]
  dialogue_words = sum(len(re.findall(r"[A-Za-z']+", match)) for match in re.findall(r'[“"]([^”"]+)[”"]', text))
  word_counts = Counter(word.casefold() for word in words if len(word) >= 4 and word.casefold() not in COMMON_WORDS)
  avg_sentence = len(words) / max(1, len(sentences))
  avg_paragraph = len(words) / max(1, len(paragraphs))
  dialogue_ratio = dialogue_words / max(1, len(words))
  semicolon_rate = text.count(";") / max(1, len(sentences))
  em_dash_rate = (text.count("—") + text.count("--")) / max(1, len(sentences))
  guidance = [
    f"Aim near {avg_sentence:.1f} words per sentence and {avg_paragraph:.1f} words per paragraph.",
    f"Dialogue occupies about {dialogue_ratio:.0%} of exemplar words.",
    f"Semicolon frequency is {semicolon_rate:.2f} and em-dash frequency is {em_dash_rate:.2f} per sentence.",
  ]
  if word_counts:
    guidance.append("Recurring exemplar diction includes: " + ", ".join(word for word, _ in word_counts.most_common(12)) + ".")
  payload = {
    "schema_version": STYLE_PROFILE_SCHEMA_VERSION,
    "exemplar_scene_ids": selected,
    "created_at": utc_now(),
    "metrics": {
      "word_count": len(words),
      "sentence_count": len(sentences),
      "paragraph_count": len(paragraphs),
      "average_sentence_words": round(avg_sentence, 2),
      "average_paragraph_words": round(avg_paragraph, 2),
      "dialogue_word_ratio": round(dialogue_ratio, 4),
      "semicolon_per_sentence": round(semicolon_rate, 4),
      "em_dash_per_sentence": round(em_dash_rate, 4),
      "signature_words": [word for word, _ in word_counts.most_common(12)],
    },
    "guidance": guidance,
  }
  atomic_write_json(_profile_path(paths), payload)
  return payload
