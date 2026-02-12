import { describe, expect, it } from "vitest";
import {
  buildBudgetUpdatePayload,
  draftFromBudgetPolicy,
  EMPTY_BUDGET_DRAFT
} from "./budget";

describe("draftFromBudgetPolicy", () => {
  it("maps nullable numeric policy fields into editable strings", () => {
    const draft = draftFromBudgetPolicy({
      schema_version: 1,
      enforcement: "fail_closed",
      per_run: {
        max_input_tokens: 1200,
        max_output_tokens: 700,
        max_total_tokens: null,
        max_estimated_cost_usd: 0.45
      },
      rolling: {
        daily_tokens: 5000,
        daily_estimated_cost_usd: null,
        weekly_tokens: 25000,
        weekly_estimated_cost_usd: 4.5
      }
    });
    expect(draft.maxInputTokens).toBe("1200");
    expect(draft.maxOutputTokens).toBe("700");
    expect(draft.maxTotalTokens).toBe("");
    expect(draft.maxEstimatedCostUsd).toBe("0.45");
    expect(draft.dailyTokens).toBe("5000");
    expect(draft.weeklyTokens).toBe("25000");
  });

  it("returns empty draft when no policy is provided", () => {
    expect(draftFromBudgetPolicy(null)).toEqual(EMPTY_BUDGET_DRAFT);
  });
});

describe("buildBudgetUpdatePayload", () => {
  it("builds numeric update payload from valid draft values", () => {
    const payload = buildBudgetUpdatePayload({
      maxInputTokens: "1000",
      maxOutputTokens: "800",
      maxTotalTokens: "1500",
      maxEstimatedCostUsd: "1.25",
      dailyTokens: "12000",
      dailyEstimatedCostUsd: "5.5",
      weeklyTokens: "50000",
      weeklyEstimatedCostUsd: "25.0"
    });
    expect(payload).toEqual({
      maxInputTokens: 1000,
      maxOutputTokens: 800,
      maxTotalTokens: 1500,
      maxEstimatedCostUsd: 1.25,
      dailyTokens: 12000,
      dailyEstimatedCostUsd: 5.5,
      weeklyTokens: 50000,
      weeklyEstimatedCostUsd: 25
    });
  });

  it("drops invalid and empty values from update payload", () => {
    const payload = buildBudgetUpdatePayload({
      maxInputTokens: "",
      maxOutputTokens: "-1",
      maxTotalTokens: "0",
      maxEstimatedCostUsd: "abc",
      dailyTokens: "2000",
      dailyEstimatedCostUsd: "",
      weeklyTokens: "x",
      weeklyEstimatedCostUsd: "1.2"
    });
    expect(payload).toEqual({
      maxInputTokens: undefined,
      maxOutputTokens: undefined,
      maxTotalTokens: undefined,
      maxEstimatedCostUsd: undefined,
      dailyTokens: 2000,
      dailyEstimatedCostUsd: undefined,
      weeklyTokens: undefined,
      weeklyEstimatedCostUsd: 1.2
    });
  });
});
