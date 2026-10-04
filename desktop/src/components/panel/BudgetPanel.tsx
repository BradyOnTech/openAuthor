import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { resetGenerationBudget, updateGenerationBudget } from "../../api";
import type { GenerationBudgetUsageWindow } from "../../types";

type FieldKey =
  | "maxInputTokens"
  | "maxOutputTokens"
  | "maxTotalTokens"
  | "maxEstimatedCostUsd"
  | "dailyTokens"
  | "dailyEstimatedCostUsd"
  | "weeklyTokens"
  | "weeklyEstimatedCostUsd";

const FIELDS: Array<{ key: FieldKey; label: string; cost?: boolean }> = [
  { key: "maxInputTokens", label: "Per-run input tokens" },
  { key: "maxOutputTokens", label: "Per-run output tokens" },
  { key: "maxTotalTokens", label: "Per-run total tokens" },
  { key: "maxEstimatedCostUsd", label: "Per-run cost (USD)", cost: true },
  { key: "dailyTokens", label: "Daily tokens" },
  { key: "dailyEstimatedCostUsd", label: "Daily cost (USD)", cost: true },
  { key: "weeklyTokens", label: "Weekly tokens" },
  { key: "weeklyEstimatedCostUsd", label: "Weekly cost (USD)", cost: true },
];

export function BudgetPanel() {
  const { projectRoot, budget, refreshBudget, setError, setMessage } = useWorkspace();
  const [draft, setDraft] = useState<Record<FieldKey, string>>({} as Record<FieldKey, string>);
  const [busy, setBusy] = useState(false);
  const policyKey = useRef("");

  useEffect(() => {
    if (!budget) return;
    const nextPolicyKey = JSON.stringify([projectRoot, budget.policy]);
    // Usage updates must preserve the author's unsaved limit edits.
    if (policyKey.current === nextPolicyKey) return;
    policyKey.current = nextPolicyKey;
    setDraft({
      maxInputTokens: toInput(budget.policy.per_run.max_input_tokens),
      maxOutputTokens: toInput(budget.policy.per_run.max_output_tokens),
      maxTotalTokens: toInput(budget.policy.per_run.max_total_tokens),
      maxEstimatedCostUsd: toInput(budget.policy.per_run.max_estimated_cost_usd),
      dailyTokens: toInput(budget.policy.rolling.daily_tokens),
      dailyEstimatedCostUsd: toInput(budget.policy.rolling.daily_estimated_cost_usd),
      weeklyTokens: toInput(budget.policy.rolling.weekly_tokens),
      weeklyEstimatedCostUsd: toInput(budget.policy.rolling.weekly_estimated_cost_usd),
    });
  }, [budget, projectRoot]);

  async function handleSave() {
    setBusy(true);
    try {
      const payload: Record<string, number | null> = {};
      for (const field of FIELDS) {
        const raw = (draft[field.key] ?? "").trim();
        if (raw === "") { payload[field.key] = null; continue; }
        const value = Number(raw);
        if (!Number.isFinite(value) || value <= 0 || (!field.cost && !Number.isInteger(value))) {
          setError(`${field.label} must be a positive ${field.cost ? "number" : "whole number"}.`);
          return;
        }
        payload[field.key] = value;
      }
      setError("");
      await updateGenerationBudget(projectRoot, payload);
      setMessage("Budget limits updated.");
      await refreshBudget();
    } catch (e) {
      setError(`Budget update failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    setBusy(true);
    try {
      setError("");
      await resetGenerationBudget(projectRoot);
      setDraft(Object.fromEntries(FIELDS.map(field => [field.key, ""])) as Record<FieldKey, string>);
      setMessage("Budget limits cleared.");
      await refreshBudget();
    } catch (e) {
      setError(`Budget reset failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  if (!budget) {
    return (
      <div style={{ padding: "var(--space-4)", color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
        Budget report unavailable.
      </div>
    );
  }

  return (
    <div style={{ overflow: "auto", height: "100%", padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div>
        <div style={{ fontWeight: 600, marginBottom: "var(--space-2)" }}>Usage</div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Window</th>
              <th>Runs</th>
              <th>Tokens</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            <UsageRow label="Today" window={budget.usage.daily} />
            <UsageRow label="This week" window={budget.usage.weekly} />
            <UsageRow label="All time" window={budget.usage.lifetime} />
          </tbody>
        </table>
      </div>

      <div>
        <div style={{ fontWeight: 600, marginBottom: "var(--space-2)" }}>
          Limits (blank = no limit; generation is blocked when a limit would be exceeded)
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(220px, 1fr))", gap: "var(--space-2)" }}>
          {FIELDS.map((field) => (
            <label key={field.key} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--text-sm)" }}>
              <span style={{ color: "var(--text-secondary)" }}>{field.label}</span>
              <input
                className="input"
                inputMode="decimal"
                placeholder="no limit"
                value={draft[field.key] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [field.key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
          <button className="btn btn--primary" disabled={busy} onClick={handleSave}>
            Save limits
          </button>
          <button className="btn btn--ghost" disabled={busy} onClick={handleReset}>
            Clear all limits
          </button>
        </div>
      </div>
    </div>
  );
}

function UsageRow({ label, window: w }: { label: string; window: GenerationBudgetUsageWindow }) {
  return (
    <tr>
      <td>{label}</td>
      <td className="mono">{w.runs}</td>
      <td className="mono">{w.total_tokens.toLocaleString()}</td>
      <td className="mono">
        ${w.estimated_cost_usd.toFixed(4)}
        {w.unknown_cost_runs > 0 ? ` (+${w.unknown_cost_runs} unpriced)` : ""}
      </td>
    </tr>
  );
}

function toInput(value: number | null): string {
  return value == null ? "" : String(value);
}
