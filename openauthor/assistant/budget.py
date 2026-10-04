from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Sequence

from ..model_input import estimate_tokens as _estimate_tokens
from ..project import OpenAuthorError

TokenEstimator = Callable[[str], int]


@dataclass(frozen=True)
class BudgetCandidate:
  candidate_id: str
  category: str
  serialized: str
  priority: int
  required: bool = False
  ordered_group: str = ""

  def __post_init__(self) -> None:
    if self.candidate_id.strip() == "":
      raise ValueError("candidate_id cannot be empty.")
    if self.category.strip() == "":
      raise ValueError("category cannot be empty.")


@dataclass(frozen=True)
class BudgetPolicy:
  input_token_ceiling: int

  def __post_init__(self) -> None:
    if self.input_token_ceiling < 0:
      raise ValueError("input_token_ceiling must be >= 0.")


@dataclass(frozen=True)
class BudgetAllocation:
  selected: list[BudgetCandidate]
  dropped: list[dict[str, object]]
  used_tokens: int
  remaining_tokens: int
  input_token_ceiling: int
  category_tokens: dict[str, int]


def allocate_input_budget(
  candidates: Sequence[BudgetCandidate],
  policy: BudgetPolicy,
  *,
  estimate_tokens: TokenEstimator = _estimate_tokens,
  measure_selected: Callable[[Sequence[BudgetCandidate]], int] | None = None,
) -> BudgetAllocation:
  """Allocate one model-input ceiling across required and optional content.

  Required candidates preserve caller order and fail closed when they cannot
  fit. Optional candidates are considered by descending priority with stable
  caller order as the tie-breaker. Every omitted candidate receives a trace.
  """

  indexed: list[tuple[int, BudgetCandidate, int]] = []
  seen_ids: set[str] = set()
  for index, candidate in enumerate(candidates):
    normalized_id = candidate.candidate_id.strip()
    if normalized_id in seen_ids:
      raise OpenAuthorError(f"Duplicate budget candidate '{normalized_id}'.")
    seen_ids.add(normalized_id)
    estimated_tokens = int(estimate_tokens(candidate.serialized))
    if estimated_tokens < 0:
      raise OpenAuthorError(
        f"Token estimator returned a negative value for '{normalized_id}'."
      )
    indexed.append((index, candidate, estimated_tokens))

  required = [entry for entry in indexed if entry[1].required]
  optional = sorted(
    (entry for entry in indexed if not entry[1].required),
    key=lambda entry: (-entry[1].priority, entry[0]),
  )

  required_tokens = (measure_selected([entry[1] for entry in required]) if measure_selected
                     else sum(entry[2] for entry in required))
  if required_tokens > policy.input_token_ceiling:
    raise OpenAuthorError(
      "Required Assistant input exceeds the configured input token ceiling. "
      "Choose a smaller scene/chapter scope or shorten the question; your manuscript is unchanged."
    )

  selected_entries = list(required)
  dropped: list[dict[str, object]] = []
  used_tokens = required_tokens
  blocked_groups: set[str] = set()
  for _, candidate, estimated_tokens in optional:
    proposed_tokens = (measure_selected([entry[1] for entry in selected_entries] + [candidate]) if measure_selected
                       else used_tokens + estimated_tokens)
    blocked = bool(candidate.ordered_group and candidate.ordered_group in blocked_groups)
    if not blocked and proposed_tokens <= policy.input_token_ceiling:
      selected_entries.append((0, candidate, estimated_tokens))
      used_tokens = proposed_tokens
      continue
    if candidate.ordered_group:
      blocked_groups.add(candidate.ordered_group)
    dropped.append(
      {
        "candidate_id": candidate.candidate_id,
        "category": candidate.category,
        "estimated_tokens": estimated_tokens,
        "reason": "recent_history_boundary" if blocked else "input_token_ceiling",
      }
    )

  category_tokens: dict[str, int] = {}
  for _, candidate, estimated_tokens in selected_entries:
    category_tokens[candidate.category] = (
      category_tokens.get(candidate.category, 0) + estimated_tokens
    )

  return BudgetAllocation(
    selected=[entry[1] for entry in selected_entries],
    dropped=dropped,
    used_tokens=used_tokens,
    remaining_tokens=policy.input_token_ceiling - used_tokens,
    input_token_ceiling=policy.input_token_ceiling,
    category_tokens=category_tokens,
  )


def enforce_input_ceiling(*, input_tokens: int, response_reserve: int, ceiling: int) -> None:
  if input_tokens + response_reserve > ceiling:
    raise OpenAuthorError(
      f"Required Assistant input exceeds the configured input token ceiling "
      f"({input_tokens:,} estimated input + {response_reserve:,} reserved response > {ceiling:,}). "
      "Choose a smaller scene/chapter scope or shorten the question; your manuscript is unchanged."
    )
