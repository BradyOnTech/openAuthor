"""Unicode lexical units, not a linguistic word-segmentation or style model."""
from __future__ import annotations

import unicodedata


def uses_unspaced_script(char: str) -> bool:
  return char.isalpha() and unicodedata.name(char, "").startswith((
    "CJK ", "HIRAGANA ", "KATAKANA ", "THAI ", "LAO ", "KHMER ", "MYANMAR ",
  ))


def lexical_spans(text: str) -> list[tuple[int, int]]:
  """Keep original offsets, combining marks and internal apostrophes."""
  spans = []
  cursor = 0
  while cursor < len(text):
    if not text[cursor].isalnum():
      cursor += 1
      continue
    start = cursor
    cursor += 1
    while cursor < len(text):
      char = text[cursor]
      if char.isalnum() or unicodedata.category(char).startswith("M"):
        cursor += 1
      elif char in "'’" and cursor + 1 < len(text) and text[cursor + 1].isalnum():
        cursor += 1
      else:
        break
    spans.append((start, cursor))
  return spans


def retrieval_terms(text: str, *, query: bool = False) -> list[str]:
  normalized = unicodedata.normalize("NFC", text.casefold()).replace("’", "'")
  terms = []
  for start, end in lexical_spans(normalized):
    word = normalized[start:end]
    run = ""
    unspaced = uses_unspaced_script(word[0])
    runs = []
    for char in word:
      next_unspaced = unspaced if unicodedata.category(char).startswith("M") else uses_unspaced_script(char)
      if run and next_unspaced != unspaced:
        runs.append((run, unspaced))
        run = ""
      run += char
      unspaced = next_unspaced
    runs.append((run, unspaced))
    for run, unspaced in runs:
      if not unspaced:
        terms.append(run)
        if "'" in run:
          terms.extend(part for part in run.split("'") if part)
        continue
      # Character pairs allow exact local matching without pretending to
      # segment words. Single-character queries remain possible.
      if not query or len(run) == 1:
        terms.extend(run)
      terms.extend(run[index:index + 2] for index in range(len(run) - 1))
  return terms
