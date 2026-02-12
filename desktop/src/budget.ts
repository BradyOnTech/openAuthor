import type { GenerationBudgetPolicy } from "./types";

export type GenerationBudgetDraft = {
  maxInputTokens: string;
  maxOutputTokens: string;
  maxTotalTokens: string;
  maxEstimatedCostUsd: string;
  dailyTokens: string;
  dailyEstimatedCostUsd: string;
  weeklyTokens: string;
  weeklyEstimatedCostUsd: string;
};

export const EMPTY_BUDGET_DRAFT: GenerationBudgetDraft = {
  maxInputTokens: "",
  maxOutputTokens: "",
  maxTotalTokens: "",
  maxEstimatedCostUsd: "",
  dailyTokens: "",
  dailyEstimatedCostUsd: "",
  weeklyTokens: "",
  weeklyEstimatedCostUsd: ""
};

function parsePositiveInt(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  const normalized = Math.trunc(parsed);
  if (normalized < 1) return undefined;
  return normalized;
}

function parsePositiveFloat(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function stringifyOptionalNumber(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "";
  return String(value);
}

export function draftFromBudgetPolicy(
  policy: GenerationBudgetPolicy | null | undefined
): GenerationBudgetDraft {
  if (!policy) return { ...EMPTY_BUDGET_DRAFT };
  return {
    maxInputTokens: stringifyOptionalNumber(policy.per_run.max_input_tokens),
    maxOutputTokens: stringifyOptionalNumber(policy.per_run.max_output_tokens),
    maxTotalTokens: stringifyOptionalNumber(policy.per_run.max_total_tokens),
    maxEstimatedCostUsd: stringifyOptionalNumber(
      policy.per_run.max_estimated_cost_usd
    ),
    dailyTokens: stringifyOptionalNumber(policy.rolling.daily_tokens),
    dailyEstimatedCostUsd: stringifyOptionalNumber(
      policy.rolling.daily_estimated_cost_usd
    ),
    weeklyTokens: stringifyOptionalNumber(policy.rolling.weekly_tokens),
    weeklyEstimatedCostUsd: stringifyOptionalNumber(
      policy.rolling.weekly_estimated_cost_usd
    )
  };
}

export function buildBudgetUpdatePayload(draft: GenerationBudgetDraft): {
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxTotalTokens?: number;
  maxEstimatedCostUsd?: number;
  dailyTokens?: number;
  dailyEstimatedCostUsd?: number;
  weeklyTokens?: number;
  weeklyEstimatedCostUsd?: number;
} {
  return {
    maxInputTokens: parsePositiveInt(draft.maxInputTokens),
    maxOutputTokens: parsePositiveInt(draft.maxOutputTokens),
    maxTotalTokens: parsePositiveInt(draft.maxTotalTokens),
    maxEstimatedCostUsd: parsePositiveFloat(draft.maxEstimatedCostUsd),
    dailyTokens: parsePositiveInt(draft.dailyTokens),
    dailyEstimatedCostUsd: parsePositiveFloat(draft.dailyEstimatedCostUsd),
    weeklyTokens: parsePositiveInt(draft.weeklyTokens),
    weeklyEstimatedCostUsd: parsePositiveFloat(draft.weeklyEstimatedCostUsd)
  };
}
