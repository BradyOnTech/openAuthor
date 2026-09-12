"""Shared Assistant modules for text and voice channels."""

from .budget import (
  BudgetAllocation,
  BudgetCandidate,
  BudgetPolicy,
  allocate_input_budget,
)
from .history import HistoryPolicy, HistoryWindow, build_history_window
from .references import (
  ContextReference,
  ReferencePolicy,
  ResolvedContextReference,
  ResolvedReferenceSet,
  resolve_context_references,
)
from .tools import DEFAULT_TOOL_REGISTRY, ToolDefinition, ToolRegistry
from .turns import (
  AssistantTurn,
  AssistantTurnStore,
  TurnClaim,
  TurnIdempotencyConflict,
)

__all__ = [
  "BudgetAllocation",
  "BudgetCandidate",
  "BudgetPolicy",
  "AssistantTurn",
  "AssistantTurnStore",
  "ContextReference",
  "DEFAULT_TOOL_REGISTRY",
  "HistoryPolicy",
  "HistoryWindow",
  "ReferencePolicy",
  "ResolvedContextReference",
  "ResolvedReferenceSet",
  "ToolDefinition",
  "ToolRegistry",
  "TurnClaim",
  "TurnIdempotencyConflict",
  "allocate_input_budget",
  "build_history_window",
  "resolve_context_references",
]
