import { describe, expect, it } from "vitest";
import { emphasisSpans, isSceneBreak } from "./proseEmphasis";

describe("prose emphasis", () => {
  it("reads asterisk and underscore italics and double-asterisk bold", () => {
    expect(emphasisSpans("It *isn’t* supposed to, **ever**, said _Ivo_.")).toEqual([
      { text: "It ", style: "plain" }, { text: "isn’t", style: "em" }, { text: " supposed to, ", style: "plain" },
      { text: "ever", style: "strong" }, { text: ", said ", style: "plain" }, { text: "Ivo", style: "em" }, { text: ".", style: "plain" },
    ]);
  });

  it("leaves stray markers, spaced asterisks and snake_case words alone", () => {
    for (const text of ["2 * 3 * 4", "a lone * star", "file_name_here", "5 *", "**"]) {
      expect(emphasisSpans(text)).toEqual([{ text, style: "plain" }]);
    }
  });

  it("keeps every other character, so reading text equals stored text without markers", () => {
    const stored = "“*Nobody* rings that but Odile,” he had said.";
    expect(emphasisSpans(stored).map(span => span.text).join("")).toBe(stored.replace(/\*/g, ""));
  });

  it("recognises scene-break lines", () => {
    expect(["***", "* * *", " # ", "⁂"].every(isSceneBreak)).toBe(true);
    expect(["**", "*** end", "#1", "A * * *"].some(isSceneBreak)).toBe(false);
  });
});
