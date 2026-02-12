import type { GenerationRunDetail } from "./types";

type NumericLike = number | null | undefined;

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

export type RunComparison = {
  baselineRunId: string;
  currentRunId: string;
  baselineInstruction: string;
  currentInstruction: string;
  instructionChanged: boolean;
  metrics: RunComparisonMetric[];
  settings: RunComparisonField[];
  outcome: RunComparisonField[];
};

export function runComparisonBaseFilename(comparison: RunComparison): string {
  return `run-comparison-${comparison.currentRunId}-vs-${comparison.baselineRunId}`;
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

export function formatNumericDelta(delta: number | null): string {
  if (delta === null) return "n/a";
  if (delta === 0) return "0";
  return delta > 0 ? `+${delta}` : String(delta);
}

export function buildRunComparison(
  baseline: GenerationRunDetail,
  current: GenerationRunDetail
): RunComparison {
  const baselineInstruction = instructionText(baseline);
  const currentInstruction = instructionText(current);

  return {
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
    ]
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
  return (
    `# Run Comparison\n\n` +
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
    `${markdownFieldRows(comparison.outcome)}\n`
  );
}
