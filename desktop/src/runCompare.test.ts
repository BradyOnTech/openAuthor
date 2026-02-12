import { describe, expect, it } from "vitest";
import {
  buildRunComparison,
  formatNumericDelta,
  formatRunComparisonJson,
  formatRunComparisonMarkdown,
  listRunComparisonProfiles,
  pickPreviousRunId,
  runComparisonVerdictLabel
} from "./runCompare";
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
        provider_attempts: 1,
        estimated_cost_usd: 0.0015
      },
      quality: {
        score: 90,
        tier: "high",
        flags: []
      }
    });

    const comparison = buildRunComparison(baseline, current);
    expect(comparison.profileId).toBe("balanced");
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
    expect(comparison.recommendation.verdict).toBe("likely_better");
    expect(comparison.recommendation.score).toBeGreaterThan(0);
  });

  it("falls back to raw instruction if normalized text is missing", () => {
    const baseline = makeRun({ normalized_instruction: undefined, instruction: "raw baseline" });
    const current = makeRun({ run_id: "gen-new", normalized_instruction: undefined, instruction: "raw baseline" });
    const comparison = buildRunComparison(baseline, current);
    expect(comparison.instructionChanged).toBe(false);
    expect(comparison.baselineInstruction).toBe("raw baseline");
  });

  it("exports JSON and Markdown comparison reports", () => {
    const comparison = buildRunComparison(
      makeRun({ run_id: "gen-base" }),
      makeRun({ run_id: "gen-new", normalized_instruction: "Intent:\n- improved" })
    );
    const json = formatRunComparisonJson(comparison);
    const markdown = formatRunComparisonMarkdown(comparison);
    expect(json.endsWith("\n")).toBe(true);
    expect(json).toContain('"baselineRunId": "gen-base"');
    expect(markdown).toContain("# Run Comparison");
    expect(markdown).toContain("## Metric Deltas");
    expect(markdown).toContain("## Recommendation");
    expect(markdown).toContain("Baseline: gen-base");
    expect(markdown).toContain("Current: gen-new");
  });

  it("returns likely_worse when status regresses from success to failure", () => {
    const comparison = buildRunComparison(
      makeRun({ run_id: "gen-base", status: "succeeded" }),
      makeRun({ run_id: "gen-new", status: "failed", error: { category: "timeout" } })
    );
    expect(comparison.recommendation.verdict).toBe("likely_worse");
    expect(comparison.recommendation.score).toBeLessThan(0);
  });

  it("supports weighting profiles for recommendation scoring", () => {
    const baseline = makeRun({
      run_id: "gen-base",
      usage: {
        input_tokens: 100,
        output_tokens: 60,
        latency_ms: 1200,
        provider_attempts: 1,
        estimated_cost_usd: 0.001
      },
      quality: { score: 80, tier: "medium", flags: [] }
    });
    const current = makeRun({
      run_id: "gen-new",
      usage: {
        input_tokens: 110,
        output_tokens: 70,
        latency_ms: 950,
        provider_attempts: 1,
        estimated_cost_usd: 0.002
      },
      quality: { score: 92, tier: "high", flags: [] }
    });
    const qualityFirst = buildRunComparison(baseline, current, "quality_first");
    const costFirst = buildRunComparison(baseline, current, "cost_first");
    expect(qualityFirst.recommendation.score).toBeGreaterThan(costFirst.recommendation.score);
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

describe("pickPreviousRunId", () => {
  it("returns immediate previous run id from newest-first ordering", () => {
    const picked = pickPreviousRunId(
      ["gen-0004", "gen-0003", "gen-0002", "gen-0001"],
      "gen-0003"
    );
    expect(picked).toBe("gen-0002");
  });

  it("returns null for newest/oldest missing position", () => {
    expect(pickPreviousRunId(["gen-0002", "gen-0001"], "gen-0001")).toBe(null);
    expect(pickPreviousRunId(["gen-0002", "gen-0001"], "gen-missing")).toBe(null);
  });
});

describe("runComparisonVerdictLabel", () => {
  it("maps verdicts to user-facing labels", () => {
    expect(runComparisonVerdictLabel("likely_better")).toBe("Likely Better");
    expect(runComparisonVerdictLabel("mixed")).toBe("Mixed");
    expect(runComparisonVerdictLabel("likely_worse")).toBe("Likely Worse");
    expect(runComparisonVerdictLabel("insufficient_data")).toBe("Insufficient Data");
  });
});

describe("listRunComparisonProfiles", () => {
  it("returns all supported profile ids and labels", () => {
    const profiles = listRunComparisonProfiles();
    expect(profiles.map((item) => item.id)).toEqual([
      "balanced",
      "quality_first",
      "cost_first",
      "speed_first",
      "reliability_first"
    ]);
  });
});
