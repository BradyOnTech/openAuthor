import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_RUN_COMPARISON_PREFS,
  loadRunComparisonPrefs,
  normalizeRunComparisonPrefs,
  saveRunComparisonPrefs
} from "./runComparePrefs";

const originalWindow = (globalThis as { window?: unknown }).window;

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

afterEach(() => {
  if (typeof originalWindow === "undefined") {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

describe("normalizeRunComparisonPrefs", () => {
  it("falls back to defaults for invalid values", () => {
    expect(normalizeRunComparisonPrefs(null)).toEqual(DEFAULT_RUN_COMPARISON_PREFS);
    expect(normalizeRunComparisonPrefs({})).toEqual(DEFAULT_RUN_COMPARISON_PREFS);
    expect(
      normalizeRunComparisonPrefs({
        profileId: "unknown",
        autoComparePrevious: "yes"
      })
    ).toEqual(DEFAULT_RUN_COMPARISON_PREFS);
  });

  it("accepts valid values", () => {
    expect(
      normalizeRunComparisonPrefs({
        profileId: "cost_first",
        autoComparePrevious: true
      })
    ).toEqual({
      profileId: "cost_first",
      autoComparePrevious: true
    });
  });
});

describe("run comparison pref storage", () => {
  it("returns defaults when window/localStorage is unavailable", () => {
    delete (globalThis as { window?: unknown }).window;
    expect(loadRunComparisonPrefs("/project")).toEqual(DEFAULT_RUN_COMPARISON_PREFS);
  });

  it("saves and loads per project root", () => {
    (globalThis as { window?: unknown }).window = {
      localStorage: new MemoryStorage()
    };
    saveRunComparisonPrefs("/project/a", {
      profileId: "quality_first",
      autoComparePrevious: true
    });
    saveRunComparisonPrefs("/project/b", {
      profileId: "cost_first",
      autoComparePrevious: false
    });
    expect(loadRunComparisonPrefs("/project/a")).toEqual({
      profileId: "quality_first",
      autoComparePrevious: true
    });
    expect(loadRunComparisonPrefs("/project/b")).toEqual({
      profileId: "cost_first",
      autoComparePrevious: false
    });
    expect(loadRunComparisonPrefs("/project/missing")).toEqual(DEFAULT_RUN_COMPARISON_PREFS);
  });
});
