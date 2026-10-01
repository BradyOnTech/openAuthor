from __future__ import annotations

import hashlib
import json
import math
import re
from collections import Counter
from typing import Any

from .ai_visibility import memory_for_ai
from .project import OpenAuthorError, ProjectPaths, atomic_write_json, utc_now
from .revisions import revision_head
from .scenes import split_scene_text
from .text_analysis import retrieval_terms

RETRIEVAL_INDEX_SCHEMA_VERSION = 1
TOKENIZER_VERSION = 2
DEFAULT_CHUNK_WORDS = 90
DEFAULT_OVERLAP_WORDS = 20
SCENE_SOURCE_TYPE = "scene"
CODEX_SOURCE_TYPE = "codex"


def _normalize_space(value: str) -> str:
  return " ".join(value.split())


def _tokenize(value: str) -> list[str]:
  return retrieval_terms(value)


def _current_git_head(paths: ProjectPaths) -> str:
  return revision_head(paths)


def _collect_sources(paths: ProjectPaths) -> list[dict[str, str]]:
  sources: list[dict[str, str]] = []
  for scene_file in sorted(paths.scenes_dir.glob("*.md")):
    front_matter, body = split_scene_text(scene_file.read_text(encoding="utf-8"))
    scene_id = front_matter.get("id", scene_file.stem).strip()
    if scene_id == "":
      continue
    scene_title = front_matter.get("title", "").strip() or scene_id
    scene_summary = front_matter.get("summary", "").strip()
    scene_pov = front_matter.get("pov", "").strip()
    scene_body = body.strip()
    scene_text = (
      f"Scene {scene_id}: {scene_title}\n"
      f"Summary: {scene_summary}\n"
      f"POV: {scene_pov}\n"
      f"Body: {scene_body}"
    ).strip()
    sources.append(
      {
        "source_id": f"{SCENE_SOURCE_TYPE}:{scene_id}",
        "source_type": SCENE_SOURCE_TYPE,
        "source_ref": scene_id,
        "path": str(scene_file.relative_to(paths.root)),
        "title": scene_title,
        "updated_at": front_matter.get("updated_at", ""),
        "text": _normalize_space(scene_text),
      }
    )

  for codex_row in memory_for_ai(paths):
    entity_id = codex_row.get("id", "").strip()
    if entity_id == "":
      continue
    entity_type = codex_row.get("type", "").strip()
    entity_name = codex_row.get("name", "").strip()
    entity_description = codex_row.get("description", "").strip()
    entity_text = (
      f"Codex {entity_type} {entity_name}\n"
      f"Description: {entity_description}"
    ).strip()
    sources.append(
      {
        "source_id": f"{CODEX_SOURCE_TYPE}:{entity_id}",
        "source_type": CODEX_SOURCE_TYPE,
        "source_ref": entity_id,
        "path": "codex/codex.sqlite3",
        "title": entity_name or entity_id,
        "updated_at": codex_row.get("updated_at", ""),
        "text": _normalize_space(entity_text),
      }
    )

  sources.sort(key=lambda row: row["source_id"])
  return sources


def _compute_source_digest(sources: list[dict[str, str]]) -> str:
  payload = [
    {
      "source_id": row["source_id"],
      "updated_at": row.get("updated_at", ""),
      "text": row.get("text", ""),
    }
    for row in sources
  ]
  raw = json.dumps(payload, sort_keys=True, separators=(",", ":"))
  return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _validate_chunk_params(*, chunk_words: int, overlap_words: int) -> None:
  if chunk_words < 20:
    raise OpenAuthorError("chunk_words must be >= 20.")
  if overlap_words < 0:
    raise OpenAuthorError("overlap_words must be >= 0.")
  if overlap_words >= chunk_words:
    raise OpenAuthorError("overlap_words must be less than chunk_words.")


def _chunk_source(
  source: dict[str, str],
  *,
  chunk_words: int,
  overlap_words: int,
) -> list[dict[str, Any]]:
  text = source.get("text", "")
  words = list(re.finditer(r"\S+", text))
  if not words:
    return []

  step = chunk_words - overlap_words
  chunks: list[dict[str, Any]] = []
  start = 0
  position = 0
  while start < len(words):
    end = min(len(words), start + chunk_words)
    char_start, char_end = words[start].start(), words[end - 1].end()
    max_chars = chunk_words * 32
    # Whitespace counts alone cannot bound CJK or other unspaced prose.
    # Slice the original source rather than inserting artificial word spaces.
    while char_start < char_end:
      quote_end = min(char_end, char_start + max_chars)
      chunk_text = text[char_start:quote_end]
      token_counts = Counter(_tokenize(chunk_text))
      chunks.append(
        {
          "source_id": source["source_id"],
          "source_type": source["source_type"],
          "source_ref": source["source_ref"],
          "source_path": source["path"],
          "source_title": source["title"],
          "chunk_position": position,
          "word_start": start,
          "word_end": end,
          "char_start": char_start,
          "char_end": quote_end,
          "text": chunk_text,
          "token_total": max(1, sum(token_counts.values())),
          "token_counts": {
            term: int(count)
            for term, count in sorted(token_counts.items())
          },
        }
      )
      position += 1
      if quote_end == char_end:
        break
      char_start = quote_end - overlap_words * 32

    if end >= len(words):
      break
    start += step

  return chunks


def _load_index(paths: ProjectPaths) -> dict[str, Any]:
  if not paths.retrieval_index_file.exists():
    raise OpenAuthorError(
      "Retrieval index not found. Run `openauthor retrieval build` first."
    )
  try:
    payload = json.loads(paths.retrieval_index_file.read_text(encoding="utf-8"))
  except json.JSONDecodeError as error:
    raise OpenAuthorError(
      f"Invalid retrieval index JSON at {paths.retrieval_index_file}."
    ) from error

  if not isinstance(payload, dict):
    raise OpenAuthorError("Invalid retrieval index payload shape.")
  schema_version = payload.get("schema_version")
  if schema_version != RETRIEVAL_INDEX_SCHEMA_VERSION:
    raise OpenAuthorError(
      "Unsupported retrieval index schema version. Rebuild the index."
    )
  if not isinstance(payload.get("sources"), list):
    raise OpenAuthorError("Invalid retrieval index payload (sources).")
  if not isinstance(payload.get("chunks"), list):
    raise OpenAuthorError("Invalid retrieval index payload (chunks).")
  if not isinstance(payload.get("document_frequency"), dict):
    raise OpenAuthorError("Invalid retrieval index payload (document_frequency).")
  return payload


def build_retrieval_index(
  paths: ProjectPaths,
  *,
  chunk_words: int = DEFAULT_CHUNK_WORDS,
  overlap_words: int = DEFAULT_OVERLAP_WORDS,
) -> dict[str, Any]:
  _validate_chunk_params(chunk_words=chunk_words, overlap_words=overlap_words)
  paths.retrieval_dir.mkdir(parents=True, exist_ok=True)

  sources = _collect_sources(paths)
  source_digest = _compute_source_digest(sources)
  git_head = _current_git_head(paths)
  chunks: list[dict[str, Any]] = []
  document_frequency: dict[str, int] = {}

  for source in sources:
    for chunk in _chunk_source(source, chunk_words=chunk_words, overlap_words=overlap_words):
      chunk_number = len(chunks)
      chunk["chunk_id"] = f"chunk-{chunk_number:06d}"
      chunks.append(chunk)
      for term in set(chunk["token_counts"].keys()):
        document_frequency[term] = document_frequency.get(term, 0) + 1

  index_payload = {
    "schema_version": RETRIEVAL_INDEX_SCHEMA_VERSION,
    "tokenizer_version": TOKENIZER_VERSION,
    "created_at": utc_now(),
    "project_root": str(paths.root),
    "git_head": git_head,
    "source_digest": source_digest,
    "chunk_words": chunk_words,
    "overlap_words": overlap_words,
    "sources": [
      {
        "source_id": row["source_id"],
        "source_type": row["source_type"],
        "source_ref": row["source_ref"],
        "path": row["path"],
        "title": row["title"],
        "updated_at": row.get("updated_at", ""),
        "content_digest": hashlib.sha256(row["text"].encode("utf-8")).hexdigest(),
      }
      for row in sources
    ],
    "chunks": chunks,
    "document_frequency": {
      term: count
      for term, count in sorted(document_frequency.items())
    },
  }
  atomic_write_json(paths.retrieval_index_file, index_payload)
  return get_retrieval_index_status(paths)


def get_retrieval_index_status(paths: ProjectPaths) -> dict[str, Any]:
  index_path = str(paths.retrieval_index_file.relative_to(paths.root))
  if not paths.retrieval_index_file.exists():
    return {
      "present": False,
      "path": index_path,
      "schema_version": RETRIEVAL_INDEX_SCHEMA_VERSION,
      "chunk_count": 0,
      "source_count": 0,
      "stale": False,
      "stale_reasons": [],
      "git_head": _current_git_head(paths),
      "indexed_git_head": "",
    }

  payload = _load_index(paths)
  sources = _collect_sources(paths)
  current_digest = _compute_source_digest(sources)
  current_head = _current_git_head(paths)
  indexed_head = str(payload.get("git_head", ""))
  indexed_digest = str(payload.get("source_digest", ""))
  stale_by_head = (
    (indexed_head or current_head) != "" and indexed_head != current_head
  )
  stale_by_sources = indexed_digest != current_digest
  stale_reasons: list[str] = []
  if payload.get("tokenizer_version") != TOKENIZER_VERSION:
    stale_reasons.append("tokenizer_changed")
  if any(not row.get("content_digest") for row in payload.get("sources", [])):
    stale_reasons.append("source_content_validation_missing")
  if any(row.get("source_type") == CODEX_SOURCE_TYPE and not row.get("content_digest") for row in payload.get("sources", [])):
    stale_reasons.append("memory_visibility_policy_changed")
  if stale_by_head:
    stale_reasons.append("git_head_changed")
  if stale_by_sources:
    stale_reasons.append("source_digest_changed")

  return {
    "present": True,
    "path": index_path,
    "schema_version": payload.get("schema_version", RETRIEVAL_INDEX_SCHEMA_VERSION),
    "created_at": payload.get("created_at", ""),
    "chunk_count": len(payload.get("chunks", [])),
    "source_count": len(payload.get("sources", [])),
    "chunk_words": payload.get("chunk_words", DEFAULT_CHUNK_WORDS),
    "overlap_words": payload.get("overlap_words", DEFAULT_OVERLAP_WORDS),
    "stale": bool(stale_reasons),
    "stale_reasons": stale_reasons,
    "git_head": current_head,
    "indexed_git_head": indexed_head,
    "source_digest": current_digest,
    "indexed_source_digest": indexed_digest,
  }


def query_retrieval_index(
  paths: ProjectPaths,
  *,
  query: str,
  limit: int = 5,
  min_score: float = 0.0,
  require_fresh: bool = False,
) -> dict[str, Any]:
  if limit < 1:
    raise OpenAuthorError("limit must be >= 1.")
  if min_score < 0:
    raise OpenAuthorError("min_score must be >= 0.")

  normalized_query = _normalize_space(query)
  if normalized_query == "":
    raise OpenAuthorError("query cannot be empty.")

  status = get_retrieval_index_status(paths)
  if not status.get("present"):
    raise OpenAuthorError(
      "Retrieval index not found. Run `openauthor retrieval build` first."
    )
  if "tokenizer_changed" in status.get("stale_reasons", []):
    raise OpenAuthorError("Retrieval tokenization changed. Rebuild the index before querying.")
  if require_fresh and status.get("stale"):
    raise OpenAuthorError(
      "Retrieval index is stale for current project state. Rebuild before querying."
    )

  payload = _load_index(paths)
  chunks = payload.get("chunks", [])
  document_frequency = payload.get("document_frequency", {})
  query_terms: list[str] = []
  seen: set[str] = set()
  for token in retrieval_terms(normalized_query, query=True):
    if token not in seen:
      seen.add(token)
      query_terms.append(token)
  if not query_terms:
    raise OpenAuthorError("query must include at least one searchable token.")

  source_lookup = {
    row.get("source_id", ""): row
    for row in payload.get("sources", [])
    if isinstance(row, dict)
  }
  corpus_size = max(1, len(chunks))
  ranked: list[dict[str, Any]] = []
  current_source_digests = {
    source["source_id"]: hashlib.sha256(source["text"].encode("utf-8")).hexdigest()
    for source in _collect_sources(paths)
  }

  for chunk in chunks:
    if not isinstance(chunk, dict):
      continue
    source_id = str(chunk.get("source_id", ""))
    source_row = source_lookup.get(source_id, {})
    # A stale index can still return unchanged, permitted sources. Never quote
    # obsolete manuscript facts, revoked Memory, or unverified legacy chunks.
    if source_id not in current_source_digests or source_row.get("content_digest") != current_source_digests[source_id]:
      continue
    token_counts = chunk.get("token_counts")
    if not isinstance(token_counts, dict):
      continue
    token_total = max(1, int(chunk.get("token_total", 1)))
    matched_terms: list[str] = []
    score = 0.0
    for term in query_terms:
      raw_tf = token_counts.get(term, 0)
      try:
        tf = int(raw_tf)
      except (TypeError, ValueError):
        tf = 0
      if tf < 1:
        continue
      matched_terms.append(term)
      raw_df = document_frequency.get(term, 0)
      try:
        df = int(raw_df)
      except (TypeError, ValueError):
        df = 0
      idf = 1.0 + math.log((1 + corpus_size) / (1 + max(0, df)))
      score += (1.0 + math.log(tf)) * idf

    if not matched_terms:
      continue

    normalized_score = score / math.sqrt(token_total)
    if normalized_score < min_score:
      continue

    source_id = str(chunk.get("source_id", ""))
    source_row = source_lookup.get(source_id, {})
    coverage = len(matched_terms) / len(query_terms)
    ranked.append(
      {
        "chunk_id": chunk.get("chunk_id", ""),
        "score": normalized_score,
        "coverage": coverage,
        "matched_terms": matched_terms,
        "text": chunk.get("text", ""),
        "source_id": source_id,
        "source_type": source_row.get("source_type", chunk.get("source_type", "")),
        "source_ref": source_row.get("source_ref", chunk.get("source_ref", "")),
        "source_path": source_row.get("path", chunk.get("source_path", "")),
        "source_title": source_row.get("title", chunk.get("source_title", "")),
        "chunk_position": int(chunk.get("chunk_position", 0)),
      }
    )

  ranked.sort(
    key=lambda row: (
      -row["score"],
      -row["coverage"],
      row["source_id"],
      row["chunk_position"],
      row["chunk_id"],
    )
  )
  trimmed = ranked[:limit]
  results = [
    {
      **row,
      "score": round(float(row["score"]), 6),
      "coverage": round(float(row["coverage"]), 4),
      "citation": {
        "source_type": row["source_type"],
        "source_ref": row["source_ref"],
        "source_path": row["source_path"],
        "source_title": row["source_title"],
        "chunk_id": row["chunk_id"],
        "chunk_position": row["chunk_position"],
      },
    }
    for row in trimmed
  ]

  return {
    "query": normalized_query,
    "terms": query_terms,
    "limit": limit,
    "min_score": min_score,
    "result_count": len(results),
    "index": {
      "path": status.get("path"),
      "stale": status.get("stale"),
      "stale_reasons": status.get("stale_reasons", []),
      "chunk_count": status.get("chunk_count"),
      "source_count": status.get("source_count"),
      "git_head": status.get("git_head"),
      "indexed_git_head": status.get("indexed_git_head"),
    },
    "results": results,
  }
