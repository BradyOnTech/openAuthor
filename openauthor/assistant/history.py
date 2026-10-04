from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from ..model_input import estimate_tokens as _estimate_tokens


@dataclass(frozen=True)
class HistoryPolicy:
  """Controls the provider-visible recent conversation window."""

  token_budget: int = 4000
  tool_result_character_limit: int = 2000

  def __post_init__(self) -> None:
    if self.token_budget < 0:
      raise ValueError("token_budget must be >= 0.")
    if self.tool_result_character_limit < 4:
      raise ValueError("tool_result_character_limit must be >= 4.")


@dataclass(frozen=True)
class HistoryWindow:
  """Provider-compatible history plus an inspectable selection trace."""

  messages: list[dict[str, str]]
  estimated_tokens: int
  selected_source_count: int
  omitted_source_count: int


def _history_message(
  row: Mapping[str, Any],
  *,
  tool_result_character_limit: int,
) -> dict[str, str] | None:
  role = str(row.get("role", ""))
  content = str(row.get("content", ""))
  if content.strip() == "":
    return None
  if role in {"user", "assistant"}:
    return {"role": role, "content": content}
  if role == "tool":
    clipped = content
    if len(clipped) > tool_result_character_limit:
      clipped = clipped[: tool_result_character_limit - 3] + "..."
    return {"role": "user", "content": f"Tool result:\n{clipped}"}
  return None


def build_history_window(
  rows: Sequence[Mapping[str, Any]],
  policy: HistoryPolicy | None = None,
) -> HistoryWindow:
  """Build a contiguous recent history window for provider consumption.

  Selection proceeds newest-first and stops at the first entry that would
  exceed the budget, preserving a contiguous suffix. Consecutive equal roles
  are merged and a leading assistant entry is removed for providers that
  require a user-led alternating conversation.
  """

  normalized_policy = policy or HistoryPolicy()
  candidates = [
    message
    for row in rows
    if (
      message := _history_message(
        row,
        tool_result_character_limit=normalized_policy.tool_result_character_limit,
      )
    )
    is not None
  ]
  if normalized_policy.token_budget == 0:
    return HistoryWindow(
      messages=[],
      estimated_tokens=0,
      selected_source_count=0,
      omitted_source_count=len(candidates),
    )

  selected: list[dict[str, str]] = []
  used_tokens = 0
  for entry in reversed(candidates):
    entry_tokens = _estimate_tokens(entry["content"])
    if used_tokens + entry_tokens > normalized_policy.token_budget:
      break
    selected.append(entry)
    used_tokens += entry_tokens
  selected.reverse()

  merged: list[tuple[dict[str, str], int]] = []
  for entry in selected:
    if merged and merged[-1][0]["role"] == entry["role"]:
      previous, source_count = merged[-1]
      merged[-1] = (
        {
          "role": entry["role"],
          "content": previous["content"] + "\n\n" + entry["content"],
        },
        source_count + 1,
      )
    else:
      merged.append((dict(entry), 1))
  provider_omitted_count = 0
  while merged and merged[0][0]["role"] == "assistant":
    _, source_count = merged.pop(0)
    provider_omitted_count += source_count

  messages = [entry for entry, _ in merged]
  estimated_tokens = sum(_estimate_tokens(entry["content"]) for entry in messages)
  selected_source_count = len(selected) - provider_omitted_count

  return HistoryWindow(
    messages=messages,
    estimated_tokens=estimated_tokens,
    selected_source_count=selected_source_count,
    omitted_source_count=len(candidates) - selected_source_count,
  )
