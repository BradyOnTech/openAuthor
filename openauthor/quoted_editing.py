"""Reconstruct quote-only revisions from host-retained manuscript text.

This is a literal paired-double-quote scope, not a dialogue classifier. It
reads only the supplied scene; written signs and messages are quotes too.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass

from .project import OpenAuthorError

QUOTED_EDIT_SYSTEM = """Final output format for the author's quoted-text scope:
Return only JSON {\"edits\": [{\"id\": \"quote-1\", \"text\": \"replacement contents\"}]}.
Use IDs from quoted_editing.passages. Omit unchanged passages. Return contents
without their outer quotation marks; JSON-escape backslashes and double quotes.
The host retains all text outside these passages, including quote delimiters,
narration, paragraph spacing, attributions and passage order. You cannot add
speakers, split or merge passages, or move facts into narration in this mode.
Keep the author's facts, uncertainty, knowledge and protected elements inside
the quotes as well. An allowed location is not permission to change its meaning.
Ignore earlier requests to return complete Markdown prose: this JSON format
governs the draft and focused revision. No other keys, commentary or fences.
"""


def _escaped(text: str, index: int) -> bool:
  count = 0
  while index > 0 and text[index - 1] == "\\":
    count += 1
    index -= 1
  return count % 2 == 1


def _spans(source: str) -> list[tuple[int, int]]:
  spans, start, close = [], None, ""
  for index, char in enumerate(source):
    if _escaped(source, index):
      continue
    if start is None:
      if char in {'"', '“'}:
        start, close = index + 1, '”' if char == '“' else '"'
      elif char == '”':
        raise OpenAuthorError("Quoted-text editing needs paired quotation marks; a closing mark has no opening mark.")
    elif char == close:
      spans.append((start, index))
      start = None
    elif close == '”' and char == '“':
      raise OpenAuthorError("Quoted-text editing cannot identify nested or repeated opening quotation marks. Choose a passage or whole-scene editing.")
  if start is not None:
    raise OpenAuthorError("Quoted-text editing needs paired quotation marks; an opening mark has no closing mark.")
  if not spans:
    raise OpenAuthorError("This scene has no paired double quotes to edit. Choose a passage or whole-scene editing.")
  if len(spans) > 200:
    raise OpenAuthorError("Quoted-text editing supports up to 200 passages; choose a shorter scene or passage.")
  return spans


def _object(pairs):
  result = {}
  for key, value in pairs:
    if key in result:
      raise ValueError("Duplicate JSON key")
    result[key] = value
  return result


@dataclass(frozen=True)
class QuotedRevision:
  """One reviewed source, stable passage IDs, and a bounded replacement reply."""
  source: str

  def __post_init__(self):
    if len(self.source) > 100000:
      raise OpenAuthorError("Quoted-text editing supports scenes up to 100,000 characters.")
    _spans(self.source)

  def context(self) -> dict:
    return {"mode": "quoted_text", "schema_version": 1,
      "recipe_sha256": hashlib.sha256(QUOTED_EDIT_SYSTEM.encode()).hexdigest(),
      "source_sha256": hashlib.sha256(self.source.encode()).hexdigest(),
      "passages": [{"id": f"quote-{number}", "text": self.source[start:end]}
        for number, (start, end) in enumerate(_spans(self.source), 1)]}

  def apply(self, reply: str) -> str:
    """Never take outside prose from the model, even when it approves itself."""
    if len(reply) > 200000:
      raise OpenAuthorError("Quoted-text revision returned an oversized response; no draft was delivered.")
    try:
      payload = json.loads(reply, object_pairs_hook=_object)
    except (ValueError, TypeError) as error:
      raise OpenAuthorError("Quoted-text revision must return valid edit JSON; no draft was delivered.") from error
    spans = _spans(self.source)
    allowed = {f"quote-{number}" for number in range(1, len(spans) + 1)}
    if not isinstance(payload, dict) or set(payload) != {"edits"} or not isinstance(payload["edits"], list) or len(payload["edits"]) > len(spans):
      raise OpenAuthorError("Quoted-text revision returned an invalid edit list; no draft was delivered.")
    edits = {}
    for row in payload["edits"]:
      if not isinstance(row, dict) or set(row) != {"id", "text"} or not isinstance(row["id"], str) or row["id"] not in allowed or row["id"] in edits or not isinstance(row["text"], str) or len(row["text"]) > 12000:
        raise OpenAuthorError("Quoted-text revision returned an unknown, duplicate or invalid passage; no draft was delivered.")
      edits[row["id"]] = row["text"]
    parts, cursor = [], 0
    for number, (start, end) in enumerate(spans, 1):
      parts.extend([self.source[cursor:start], edits.get(f"quote-{number}", self.source[start:end])])
      cursor = end
    parts.append(self.source[cursor:])
    result = "".join(parts)
    if len(result) > 120000:
      raise OpenAuthorError("Quoted-text revision exceeds the scene size limit; no draft was delivered.")
    # Check reconstruction boundaries. A replacement can neither close its
    # quote early nor escape the host's closing mark with a trailing slash.
    actual = _spans(result)
    def outside(text, ranges):
      cursor, pieces = 0, []
      for start, end in ranges:
        pieces.append(text[cursor:start])
        cursor = end
      pieces.append(text[cursor:])
      return pieces
    if outside(self.source, spans) != outside(result, actual):
      raise OpenAuthorError("Quoted-text revision crossed a quotation boundary; no draft was delivered.")
    return result
