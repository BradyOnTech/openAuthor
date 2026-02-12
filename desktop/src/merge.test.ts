import { describe, expect, it } from "vitest";
import { mergeGuidanceFromPreflight } from "./merge";

describe("mergeGuidanceFromPreflight", () => {
  it("requires preflight before merge apply", () => {
    const guidance = mergeGuidanceFromPreflight(null);
    expect(guidance.canApply).toBe(false);
    expect(guidance.label).toBe("Preflight Required");
  });

  it("returns low-risk guidance when safe_to_merge", () => {
    const guidance = mergeGuidanceFromPreflight({
      base: "main",
      head: "exp-one",
      merge_base: "abc",
      base_changed_count: 1,
      head_changed_count: 1,
      overlap_count: 0,
      overlap_by_category: {},
      safe_to_merge: true,
      risk_level: "low",
      recommendations: []
    });
    expect(guidance.tone).toBe("ok");
    expect(guidance.canApply).toBe(true);
  });

  it("returns high-risk guidance when overlapping scene/codex risks exist", () => {
    const guidance = mergeGuidanceFromPreflight({
      base: "exp-one",
      head: "exp-two",
      merge_base: "abc",
      base_changed_count: 2,
      head_changed_count: 2,
      overlap_count: 1,
      overlap_by_category: { scene: ["manuscript/scenes/0001-a.md"] },
      safe_to_merge: false,
      risk_level: "high",
      recommendations: ["review scene overlap"]
    });
    expect(guidance.tone).toBe("risk");
    expect(guidance.canApply).toBe(true);
  });
});
