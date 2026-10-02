import { describe, expect, it } from "vitest";
import { comparePassage } from "./passageComparison";

describe("passage comparison", () => {
  it("preserves every source character through repeats, Unicode and whitespace", () => {
    const examples = [
      ["🌙 Élodie waits.\n\nMara waits.", "🌙 Élodie waited.\n\nMara waits."],
      ["The keeper said the keeper knew.", "The keeper knew."],
      ["门已关。她等待。", "门已打开。她等待。"],
      ["", "Added"], ["Removed", ""], ["  Same\n", "  Same\n"],
      ["a ".repeat(1000), "b ".repeat(1000)],
    ];
    for (const [before, after] of examples) {
      const result = comparePassage(before, after);
      expect(result.before.map(part => part.text).join("")).toBe(before);
      expect(result.after.map(part => part.text).join("")).toBe(after);
      if (before === after) expect([...result.before, ...result.after].every(part => !part.changed)).toBe(true);
    }
  });
  it("marks just the changed words while retaining shared context", () => {
    const result = comparePassage("Mara began to count the lights.", "Mara counted the lights.");
    expect(result.before.filter(part => part.changed).map(part => part.text).join("")).toBe("began to count");
    expect(result.after.filter(part => part.changed).map(part => part.text).join("")).toBe("counted");
    expect(result.after.some(part => !part.changed && part.text.includes("the lights."))).toBe(true);
  });
});
