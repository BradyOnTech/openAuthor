import { describe, expect, it } from "vitest";
import { findMatches } from "./FindBar";

describe("find in scene", () => {
  it("finds every non-overlapping match regardless of case", () => {
    expect(findMatches("The map. the Map, THE MAP", "the map")).toEqual([
      { start: 0, end: 7 }, { start: 9, end: 16 }, { start: 18, end: 25 },
    ]);
    expect(findMatches("aaaa", "aa")).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }]);
  });

  it("returns nothing for an empty query or a phrase that is absent", () => {
    expect(findMatches("Mara counted.", "")).toEqual([]);
    expect(findMatches("Mara counted.", "Ivo")).toEqual([]);
  });

  it("addresses the original text when case folding changes its length", () => {
    const body = "İstanbul and istanbul";
    for (const match of findMatches(body, "istanbul")) expect(body.slice(match.start, match.end).toLocaleLowerCase()).toContain("stanbul");
  });
});
