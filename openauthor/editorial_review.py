"""Focused critique with source-checked passages; literary judgments remain opinions."""
from __future__ import annotations

import json
from typing import Any

FOCUSES = {
  "general": "Review the most consequential concerns; do not manufacture an issue for every category.",
  "continuity": "Check incompatible established facts. Respect explicit changes, quoted claims, uncertainty and unreliable narration.",
  "character-knowledge": "Check what each viewpoint character can know at this point. Distinguish narrator knowledge, inference, belief and confirmed knowledge.",
  "motivation": "Review the causal link between a character's stated goal, pressure and choices. Do not invent backstory or motives to repair an unexplained choice.",
  "pacing": "Review scene purpose, repeated beats, transitions and where time expands or contracts. Preserve necessary setup and deliberate pauses.",
  "voice": "Review character-specific diction, narrative distance, rhythm and restraint against the author's supplied guidance. Do not treat approximate metrics as writing targets.",
}


def review_instructions(focus: str) -> str:
  return (
    FOCUSES[focus] + " This is a read-only critique, not permission to rewrite. "
    "Prioritize supported concerns over quantity. Separate a source observation from an interpretation. "
    "State what unavailable context could change your interpretation. Preserve deliberate ambiguity, "
    "the author's voice and unresolved endings. Suggest the smallest useful intervention; do not add plot, "
    "motives, knowledge or events. Report strengths worth preserving. No finding is required. "
    "Return ONLY JSON with schema_version 1, summary (string), strengths (array of strings), "
    "limitations (array of strings), and findings (at most 12). Each finding has category "
    "(continuity, character-knowledge, motivation, pacing, voice, or clarity), title, observation, "
    "uncertainty, suggestion (all strings), and evidence (1–4 passages). Each passage has scene_id, "
    "start, end (absolute Unicode code-point offsets within that scene), and quote (exact source text). "
    "Use only review_sources for quoted evidence; their start offsets locate supplied text in the scene. "
    "Never quote a paraphrase as evidence. Cross-scene concerns need passages from both scenes. "
    "An exact quotation establishes its presence, not the truth of your interpretation."
  )


def _unique_quote_start(sources: list[dict[str, Any]], scene_id: str, quote: str) -> int | None:
  """Locate an exact quote only in supplied windows, deduplicating absolute spans."""
  starts: set[int] = set()
  for source in sources:
    if source["scene_id"] != scene_id:
      continue
    offset = source["text"].find(quote)
    while offset != -1:
      starts.add(source["start"] + offset)
      if len(starts) > 1:
        return None
      # Advance one code point so self-overlapping quotes remain ambiguous.
      offset = source["text"].find(quote, offset + 1)
  return next(iter(starts)) if starts else None


def parse_review(text: str, sources: list[dict[str, Any]], *, focus: str, scope: str, mechanical: bool = False) -> dict[str, Any]:
  """Retain responses while withholding findings whose supplied evidence cannot be checked."""
  base: dict[str, Any] = {
    "schema_version": 1, "focus": focus, "scope": scope,
    "kind": "mechanical" if mechanical else "editorial",
    "summary": "", "strengths": [], "limitations": [], "findings": [], "warnings": [],
    "sources": [{"scene_id": row["scene_id"], "title": row["title"], "start": row["start"], "end": row["start"] + len(row["text"])} for row in sources],
  }
  if mechanical:
    base["summary"] = text
    base["limitations"] = ["The local adapter does not assess literary quality or story understanding."]
    return base
  try:
    payload = json.loads(text)
    if not isinstance(payload, dict) or type(payload.get("schema_version")) is not int or payload["schema_version"] != 1:
      raise ValueError("unsupported review format")
    for name in ("strengths", "limitations"):
      values = payload.get(name, [])
      if not isinstance(values, list) or len(values) > 12 or any(not isinstance(value, str) or len(value) > 2000 for value in values):
        raise ValueError(f"invalid {name}")
      base[name] = values
    summary = payload.get("summary", "")
    if not isinstance(summary, str) or len(summary) > 4000:
      raise ValueError("invalid summary")
    base["summary"] = summary
    rows = payload.get("findings", [])
    if not isinstance(rows, list) or len(rows) > 12:
      raise ValueError("invalid finding list")
  except (ValueError, TypeError):
    base["warnings"] = ["The response did not follow the evidence-review format. Its original feedback is retained below; no findings were verified."]
    return base
  for number, row in enumerate(rows, 1):
    try:
      if not isinstance(row, dict) or not isinstance(row.get("category"), str) or row["category"] not in {*FOCUSES.keys() - {"general"}, "clarity"}:
        raise ValueError("unknown review category")
      for name in ("title", "observation", "uncertainty", "suggestion"):
        if not isinstance(row.get(name), str) or not row[name].strip() or len(row[name]) > 2000:
          raise ValueError(f"missing or invalid {name}")
      passages = row.get("evidence")
      if not isinstance(passages, list) or not 1 <= len(passages) <= 4:
        raise ValueError("missing supporting passages")
      checked = []
      corrections = []
      for passage_number, passage in enumerate(passages, 1):
        if not isinstance(passage, dict):
          raise ValueError("invalid supporting passage")
        scene_id, start, end, quote = (passage.get(key) for key in ("scene_id", "start", "end", "quote"))
        if type(start) is not int or type(end) is not int or not isinstance(quote, str) or not quote.strip() or len(quote) > 2000:
          raise ValueError("invalid quote or offsets")
        source = next((source for source in sources if source["scene_id"] == scene_id
          and source["start"] <= start < end <= source["start"] + len(source["text"])
          and source["text"][start - source["start"]:end - source["start"]] == quote), None)
        if source is None:
          recovered_start = _unique_quote_start(sources, scene_id, quote)
          if recovered_start is None:
            raise ValueError("a quote does not match the supplied source and offsets and has no unique exact match in its reviewed scene")
          recovered_end = recovered_start + len(quote)
          corrections.append(f"Finding {number}, passage {passage_number}: provider offsets {start}–{end} were corrected to {recovered_start}–{recovered_end} in {scene_id} using its unique exact quote in the supplied reviewed source. The original response remains available for inspection.")
          start, end = recovered_start, recovered_end
        checked.append({"scene_id": scene_id, "start": start, "end": end, "excerpt": quote, "anchor_text": quote})
      base["findings"].append({"id": f"finding-{number}", **{key: row[key] for key in ("category", "title", "observation", "uncertainty", "suggestion")}, "evidence": checked})
      base["warnings"].extend(corrections)
    except ValueError as error:
      base["warnings"].append(f"Finding {number} was withheld: {error}. Its original response remains available for inspection.")
  base["limitations"].append("Quoted passages were checked against the reviewed source. Interpretations and suggested corrections still require author judgment.")
  return base
