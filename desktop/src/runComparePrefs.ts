import type { RunComparisonProfileId } from "./runCompare";

const STORAGE_KEY = "openauthor.runComparisonPrefs";
const DEFAULT_PROJECT_KEY = "__default__";

export type RunComparisonPrefs = {
  profileId: RunComparisonProfileId;
  autoComparePrevious: boolean;
};

export const DEFAULT_RUN_COMPARISON_PREFS: RunComparisonPrefs = {
  profileId: "balanced",
  autoComparePrevious: false
};

function projectKey(projectRoot: string): string {
  const normalized = projectRoot.trim();
  return normalized === "" ? DEFAULT_PROJECT_KEY : normalized;
}

function isProfileId(value: unknown): value is RunComparisonProfileId {
  return (
    value === "balanced" ||
    value === "quality_first" ||
    value === "cost_first" ||
    value === "speed_first" ||
    value === "reliability_first"
  );
}

export function normalizeRunComparisonPrefs(value: unknown): RunComparisonPrefs {
  if (typeof value !== "object" || value === null) {
    return { ...DEFAULT_RUN_COMPARISON_PREFS };
  }
  const raw = value as Record<string, unknown>;
  return {
    profileId: isProfileId(raw.profileId)
      ? raw.profileId
      : DEFAULT_RUN_COMPARISON_PREFS.profileId,
    autoComparePrevious:
      typeof raw.autoComparePrevious === "boolean"
        ? raw.autoComparePrevious
        : DEFAULT_RUN_COMPARISON_PREFS.autoComparePrevious
  };
}

function loadPrefsMap(): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function savePrefsMap(next: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage failures.
  }
}

export function loadRunComparisonPrefs(projectRoot: string): RunComparisonPrefs {
  const key = projectKey(projectRoot);
  const prefsMap = loadPrefsMap();
  return normalizeRunComparisonPrefs(prefsMap[key]);
}

export function saveRunComparisonPrefs(
  projectRoot: string,
  prefs: RunComparisonPrefs
): void {
  const key = projectKey(projectRoot);
  const prefsMap = loadPrefsMap();
  prefsMap[key] = normalizeRunComparisonPrefs(prefs);
  savePrefsMap(prefsMap);
}
