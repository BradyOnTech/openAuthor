import type { GenerationRunDetail } from "./types";

type NumericLike = number | null | undefined;
export type RunComparisonProfileId =
  | "balanced"
  | "quality_first"
  | "cost_first"
  | "speed_first"
  | "reliability_first";

type RunComparisonProfile = {
  id: RunComparisonProfileId;
  label: string;
  weights: {
    status: number;
    quality: number;
    cost: number;
    latency: number;
    attempts: number;
  };
};

const COMPARISON_PROFILES: Record<RunComparisonProfileId, RunComparisonProfile> = {
  balanced: {
    id: "balanced",
    label: "Balanced",
    weights: { status: 2, quality: 1, cost: 1, latency: 1, attempts: 1 }
  },
  quality_first: {
    id: "quality_first",
    label: "Quality First",
    weights: { status: 2, quality: 2, cost: 0.75, latency: 0.75, attempts: 1 }
  },
  cost_first: {
    id: "cost_first",
    label: "Cost First",
    weights: { status: 1.5, quality: 1, cost: 2, latency: 1, attempts: 1 }
  },
  speed_first: {
    id: "speed_first",
    label: "Speed First",
    weights: { status: 1.5, quality: 1, cost: 1, latency: 2, attempts: 1 }
  },
  reliability_first: {
    id: "reliability_first",
    label: "Reliability First",
    weights: { status: 3, quality: 1, cost: 0.75, latency: 1, attempts: 2 }
  }
};

export type RunComparisonMetric = {
  label: string;
  baseline: number | null;
  current: number | null;
  delta: number | null;
};

export type RunComparisonField = {
  label: string;
  baseline: string;
  current: string;
  changed: boolean;
};

export type RunComparisonRecommendation = {
  verdict: "likely_better" | "mixed" | "likely_worse" | "insufficient_data";
  score: number;
  summary: string;
  reasons: string[];
};

export type RunComparison = {
  profileId: RunComparisonProfileId;
  baselineRunId: string;
  currentRunId: string;
  baselineInstruction: string;
  currentInstruction: string;
  instructionChanged: boolean;
  metrics: RunComparisonMetric[];
  settings: RunComparisonField[];
  outcome: RunComparisonField[];
  recommendation: RunComparisonRecommendation;
};

export function runComparisonVerdictLabel(
  verdict: RunComparisonRecommendation["verdict"]
): string {
  if (verdict === "likely_better") return "Likely Better";
  if (verdict === "likely_worse") return "Likely Worse";
  if (verdict === "mixed") return "Mixed";
  return "Insufficient Data";
}

export function runComparisonBaseFilename(comparison: RunComparison): string {
  return `run-comparison-${comparison.currentRunId}-vs-${comparison.baselineRunId}`;
}

export function listRunComparisonProfiles(): Array<{ id: RunComparisonProfileId; label: string }> {
  return (
    Object.values(COMPARISON_PROFILES) as RunComparisonProfile[]
  ).map((profile) => ({ id: profile.id, label: profile.label }));
}

export function pickPreviousRunId(
  runIdsOrderedNewestFirst: string[],
  currentRunId: string
): string | null {
  const currentIndex = runIdsOrderedNewestFirst.findIndex((item) => item === currentRunId);
  if (currentIndex === -1 || currentIndex >= runIdsOrderedNewestFirst.length - 1) {
    return null;
  }
  return runIdsOrderedNewestFirst[currentIndex + 1];
}

function asNumber(value: NumericLike): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function metricRow(
  label: string,
  baselineValue: NumericLike,
  currentValue: NumericLike
): RunComparisonMetric {
  const baseline = asNumber(baselineValue);
  const current = asNumber(currentValue);
  return {
    label,
    baseline,
    current,
    delta: baseline === null || current === null ? null : current - baseline
  };
}

function fieldRow(label: string, baselineValue: unknown, currentValue: unknown): RunComparisonField {
  const baseline = baselineValue === undefined || baselineValue === null ? "n/a" : String(baselineValue);
  const current = currentValue === undefined || currentValue === null ? "n/a" : String(currentValue);
  return {
    label,
    baseline,
    current,
    changed: baseline !== current
  };
}

function instructionText(run: GenerationRunDetail): string {
  const value = run.normalized_instruction ?? run.instruction ?? "";
  return value.trim();
}

function recommendationSummary(
  verdict: RunComparisonRecommendation["verdict"],
  reasons: string[]
): string {
  if (verdict === "likely_better") {
    return reasons[0] ?? "Current run looks better on key metrics.";
  }
  if (verdict === "likely_worse") {
    return reasons[0] ?? "Current run looks worse on key metrics.";
  }
  if (verdict === "mixed") {
    return "Current run has mixed tradeoffs across quality/cost/latency/outcome.";
  }
  return "Not enough overlapping metrics to suggest promotion confidence.";
}

function buildRecommendation(
  baseline: GenerationRunDetail,
  current: GenerationRunDetail,
  profile: RunComparisonProfile
): RunComparisonRecommendation {
  let score = 0;
  let evaluatedSignals = 0;
  const reasons: string[] = [];

  const applySignal = (points: number, weight: number): number => points * weight;

  if (baseline.status !== current.status) {
    evaluatedSignals += 1;
    if (baseline.status !== "succeeded" && current.status === "succeeded") {
      score += applySignal(3, profile.weights.status);
      reasons.push("Current run succeeded while baseline did not.");
    } else if (baseline.status === "succeeded" && current.status !== "succeeded") {
      score -= applySignal(3, profile.weights.status);
      reasons.push("Current run did not succeed while baseline did.");
    }
  }

  const baselineQuality = asNumber(baseline.quality?.score);
  const currentQuality = asNumber(current.quality?.score);
  if (baselineQuality !== null && currentQuality !== null) {
    evaluatedSignals += 1;
    const delta = currentQuality - baselineQuality;
    if (delta >= 5) {
      score += applySignal(2, profile.weights.quality);
      reasons.push(`Quality score increased by ${delta}.`);
    } else if (delta >= 2) {
      score += applySignal(1, profile.weights.quality);
      reasons.push(`Quality score improved by ${delta}.`);
    } else if (delta <= -5) {
      score -= applySignal(2, profile.weights.quality);
      reasons.push(`Quality score decreased by ${Math.abs(delta)}.`);
    } else if (delta <= -2) {
      score -= applySignal(1, profile.weights.quality);
      reasons.push(`Quality score slipped by ${Math.abs(delta)}.`);
    }
  }

  const baselineCost = asNumber(baseline.usage?.estimated_cost_usd ?? null);
  const currentCost = asNumber(current.usage?.estimated_cost_usd ?? null);
  if (baselineCost !== null && currentCost !== null) {
    evaluatedSignals += 1;
    const delta = currentCost - baselineCost;
    if (delta <= -0.00001) {
      score += applySignal(1, profile.weights.cost);
      reasons.push(`Estimated cost decreased by ${Math.abs(delta).toFixed(6)} USD.`);
    } else if (delta >= 0.00001) {
      score -= applySignal(1, profile.weights.cost);
      reasons.push(`Estimated cost increased by ${delta.toFixed(6)} USD.`);
    }
  }

  const baselineLatency = asNumber(baseline.usage?.latency_ms);
  const currentLatency = asNumber(current.usage?.latency_ms);
  if (baselineLatency !== null && currentLatency !== null) {
    evaluatedSignals += 1;
    const delta = currentLatency - baselineLatency;
    if (delta <= -100) {
      score += applySignal(1, profile.weights.latency);
      reasons.push(`Latency improved by ${Math.abs(delta)} ms.`);
    } else if (delta >= 100) {
      score -= applySignal(1, profile.weights.latency);
      reasons.push(`Latency regressed by ${delta} ms.`);
    }
  }

  const baselineAttempts = asNumber(
    baseline.usage?.provider_attempts ?? baseline.error?.attempts
  );
  const currentAttempts = asNumber(
    current.usage?.provider_attempts ?? current.error?.attempts
  );
  if (baselineAttempts !== null && currentAttempts !== null) {
    evaluatedSignals += 1;
    const delta = currentAttempts - baselineAttempts;
    if (delta <= -1) {
      score += applySignal(1, profile.weights.attempts);
      reasons.push(`Provider attempts dropped by ${Math.abs(delta)}.`);
    } else if (delta >= 1) {
      score -= applySignal(1, profile.weights.attempts);
      reasons.push(`Provider attempts increased by ${delta}.`);
    }
  }

  if (evaluatedSignals === 0) {
    return {
      verdict: "insufficient_data",
      score: 0,
      summary: recommendationSummary("insufficient_data", reasons),
      reasons
    };
  }

  const verdict: RunComparisonRecommendation["verdict"] =
    score >= 2 ? "likely_better" : score <= -2 ? "likely_worse" : "mixed";
  return {
    verdict,
    score,
    summary: recommendationSummary(verdict, reasons),
    reasons
  };
}

export function formatNumericDelta(delta: number | null): string {
  if (delta === null) return "n/a";
  if (delta === 0) return "0";
  return delta > 0 ? `+${delta}` : String(delta);
}

export function buildRunComparison(
  baseline: GenerationRunDetail,
  current: GenerationRunDetail,
  profileId: RunComparisonProfileId = "balanced"
): RunComparison {
  const profile = COMPARISON_PROFILES[profileId] ?? COMPARISON_PROFILES.balanced;
  const baselineInstruction = instructionText(baseline);
  const currentInstruction = instructionText(current);

  return {
    profileId: profile.id,
    baselineRunId: baseline.run_id,
    currentRunId: current.run_id,
    baselineInstruction,
    currentInstruction,
    instructionChanged: baselineInstruction !== currentInstruction,
    metrics: [
      metricRow("Quality Score", baseline.quality?.score, current.quality?.score),
      metricRow("Input Tokens", baseline.usage?.input_tokens, current.usage?.input_tokens),
      metricRow("Output Tokens", baseline.usage?.output_tokens, current.usage?.output_tokens),
      metricRow("Latency (ms)", baseline.usage?.latency_ms, current.usage?.latency_ms),
      metricRow(
        "Estimated Cost (USD)",
        baseline.usage?.estimated_cost_usd ?? null,
        current.usage?.estimated_cost_usd ?? null
      ),
      metricRow(
        "Provider Attempts",
        baseline.usage?.provider_attempts ?? baseline.error?.attempts,
        current.usage?.provider_attempts ?? current.error?.attempts
      )
    ],
    settings: [
      fieldRow("Provider", baseline.provider, current.provider),
      fieldRow("Model", baseline.model, current.model),
      fieldRow("Temperature", baseline.temperature, current.temperature),
      fieldRow("Max Tokens", baseline.max_output_tokens, current.max_output_tokens),
      fieldRow("Context Scenes", baseline.context_scene_radius, current.context_scene_radius),
      fieldRow("Codex Limit", baseline.codex_limit, current.codex_limit)
    ],
    outcome: [
      fieldRow("Status", baseline.status, current.status),
      fieldRow("Error Category", baseline.error?.category, current.error?.category),
      fieldRow("Error Retriable", baseline.error?.retriable, current.error?.retriable),
      fieldRow("Quality Tier", baseline.quality?.tier, current.quality?.tier)
    ],
    recommendation: buildRecommendation(baseline, current, profile)
  };
}

export function formatRunComparisonJson(comparison: RunComparison): string {
  return `${JSON.stringify(comparison, null, 2)}\n`;
}

function markdownFieldRows(rows: RunComparisonField[]): string {
  if (rows.length === 0) return "_none_\n";
  return rows
    .map((row) => `- ${row.label}: ${row.baseline} -> ${row.current}${row.changed ? " (changed)" : ""}`)
    .join("\n");
}

function markdownMetricRows(rows: RunComparisonMetric[]): string {
  if (rows.length === 0) return "_none_\n";
  return rows
    .map(
      (row) =>
        `- ${row.label}: baseline ${row.baseline ?? "n/a"} / current ${row.current ?? "n/a"} / delta ${formatNumericDelta(row.delta)}`
    )
    .join("\n");
}

export function formatRunComparisonMarkdown(comparison: RunComparison): string {
  const profile = COMPARISON_PROFILES[comparison.profileId] ?? COMPARISON_PROFILES.balanced;
  return (
    `# Run Comparison\n\n` +
    `- Profile: ${profile.label}\n` +
    `- Baseline: ${comparison.baselineRunId}\n` +
    `- Current: ${comparison.currentRunId}\n` +
    `- Instruction changed: ${comparison.instructionChanged ? "yes" : "no"}\n\n` +
    `## Baseline Instruction\n\n` +
    "```text\n" +
    `${comparison.baselineInstruction || "(empty)"}\n` +
    "```\n\n" +
    `## Current Instruction\n\n` +
    "```text\n" +
    `${comparison.currentInstruction || "(empty)"}\n` +
    "```\n\n" +
    `## Metric Deltas\n\n` +
    `${markdownMetricRows(comparison.metrics)}\n\n` +
    `## Settings\n\n` +
    `${markdownFieldRows(comparison.settings)}\n\n` +
    `## Outcome\n\n` +
    `${markdownFieldRows(comparison.outcome)}\n\n` +
    `## Recommendation\n\n` +
    `- Verdict: ${comparison.recommendation.verdict}\n` +
    `- Score: ${comparison.recommendation.score}\n` +
    `- Summary: ${comparison.recommendation.summary}\n` +
    `${
      comparison.recommendation.reasons.length > 0
        ? comparison.recommendation.reasons.map((reason) => `- Reason: ${reason}`).join("\n")
        : "- Reason: n/a"
    }\n`
  );
}
