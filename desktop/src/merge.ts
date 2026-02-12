import type { BranchPreflightReport } from "./types";

export type MergeGuidanceTone = "ok" | "warn" | "risk";

export type MergeGuidance = {
  label: string;
  detail: string;
  tone: MergeGuidanceTone;
  canApply: boolean;
};

export function mergeGuidanceFromPreflight(
  report: BranchPreflightReport | null
): MergeGuidance {
  if (!report) {
    return {
      label: "Preflight Required",
      detail: "Run preflight before applying merge.",
      tone: "warn",
      canApply: false
    };
  }

  if (report.safe_to_merge) {
    return {
      label: "Low Risk",
      detail: "No overlapping authoring files detected.",
      tone: "ok",
      canApply: true
    };
  }

  if (report.risk_level === "high") {
    return {
      label: "High Risk",
      detail:
        "Overlapping scene/codex files detected. Merge may require manual follow-up.",
      tone: "risk",
      canApply: true
    };
  }

  return {
    label: "Medium Risk",
    detail: "Overlapping authoring files detected. Review diff and recommendations.",
    tone: "warn",
    canApply: true
  };
}
