import { describe, expect, it } from "vitest";
import { evidenceRange } from "./evidenceRange";

describe("evidence navigation", () => {
  it("uses the exact name anchor when a suggestion displays a longer contextual excerpt", () => {
    expect(evidenceRange("Mara waited.\n\nIvo left.", { scene_id: "one", excerpt: "Mara waited. Ivo left.", anchor_text: "Ivo", start: 14, end: 17 })).toEqual([14, 17]);
  });
  it("translates Python code-point offsets without splitting emoji", () => {
    expect(evidenceRange("🌙 Mara waits.", { scene_id: "one", excerpt: "Mara waits.", start: 2, end: 13 })).toEqual([3, 14]);
  });
  it("relocates a unique unchanged passage after nearby writing moved", () => {
    expect(evidenceRange("New words. Mara waits.", { scene_id: "one", excerpt: "Mara waits.", start: 0, end: 11 })).toEqual([11, 22]);
  });
  it("does not guess after the evidence changed", () => {
    expect(evidenceRange("Mara leaves.", { scene_id: "one", excerpt: "Mara waits.", start: 0, end: 11 })).toBeNull();
  });
  it("does not guess between repeated passages when offsets no longer match", () => {
    expect(evidenceRange("New. Mara waits. Mara waits.", { scene_id: "one", excerpt: "Mara waits.", start: 0, end: 11 })).toBeNull();
  });
});
