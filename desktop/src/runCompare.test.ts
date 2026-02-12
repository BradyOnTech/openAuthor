import { describe, expect, it } from "vitest";
import { buildRunComparison, formatNumericDelta } from "./runCompare";
import type { GenerationRunDetail } from "./types";

function makeRun(overrides: Partial<GenerationRunDetail> = {}): GenerationRunDetail {
  return {
    run_id: "gen-base",
    status: "succeeded",
    created_at: "2026-02-12T10:00:00Z",
    scene_id: "scene-0001",
    provider: "openai",
    model: "gpt-4.1-mini",
    temperature: 0.2,
    max_output_tokens: 700,
    context_scene_radius: 1,
    codex_limit: 20,
    instruction: "tighten pacing",
    normalized_instruction: "Intent:\n- baseline",
    prompt_sha256: "deadbeef",
    system_prompt: "system",
    user_prompt: "user",
    context: {},
    usage: {
      input_tokens: 100,
      output_tokens: 60,
      latency_ms: 1200,
      provider_attempts: 1,
      estimated_cost_usd: 0.001
    },
    quality: {
      score: 80,
      tier: "medium",
      flags: []
    },
    log_path: ".openauthor/generations/gen-base.json",
    ...overrides
  };
}

describe("buildRunComparison", () => {
  it("calculates numeric deltas and field changes", () => {
    const baseline = makeRun();
    const current = makeRun({
      run_id: "gen-new",
      model: "gpt-4.1",
      normalized_instruction: "Intent:\n- improved",
      usage: {
        input_tokens: 110,
        output_tokens: 70,
        latency_ms: 1000,
        provider_attempts: 2,
        estimated_cost_usd: 0.0015
      },
      quality: {
        score: 90,
        tier: "high",
        flags: []
      }
    });

    const comparison = buildRunComparison(baseline, current);
    expect(comparison.baselineRunId).toBe("gen-base");
    expect(comparison.currentRunId).toBe("gen-new");
    expect(comparison.instructionChanged).toBe(true);
    expect(comparison.metrics[0]).toMatchObject({
      label: "Quality Score",
      baseline: 80,
      current: 90,
      delta: 10
    });
    expect(comparison.settings.find((row) => row.label === "Model")?.changed).toBe(true);
    expect(comparison.outcome.find((row) => row.label === "Quality Tier")?.changed).toBe(true);
  });

  it("falls back to raw instruction if normalized text is missing", () => {
    const baseline = makeRun({ normalized_instruction: undefined, instruction: "raw baseline" });
    const current = makeRun({ run_id: "gen-new", normalized_instruction: undefined, instruction: "raw baseline" });
    const comparison = buildRunComparison(baseline, current);
    expect(comparison.instructionChanged).toBe(false);
    expect(comparison.baselineInstruction).toBe("raw baseline");
  });
});

describe("formatNumericDelta", () => {
  it("formats positive/negative/empty deltas", () => {
    expect(formatNumericDelta(5)).toBe("+5");
    expect(formatNumericDelta(-3)).toBe("-3");
    expect(formatNumericDelta(0)).toBe("0");
    expect(formatNumericDelta(null)).toBe("n/a");
  });
});
