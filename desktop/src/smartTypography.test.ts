// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { curlyQuote, replaceTextRange, smartReplacement, toggleEmphasis } from "./smartTypography";

describe("smart punctuation", () => {
  it("opens quotes at the start, after spaces and after dashes, and closes them after words", () => {
    expect(curlyQuote("", '"')).toBe("“");
    expect(curlyQuote("She said, ", '"')).toBe("“");
    expect(curlyQuote("She said, “Go", '"')).toBe("”");
    expect(curlyQuote("wait—", '"')).toBe("“");
    expect(curlyQuote("Ivo", "'")).toBe("’");
    expect(curlyQuote("He whispered, ", "'")).toBe("‘");
    expect(curlyQuote("“", "'")).toBe("‘");
  });

  it("turns a second hyphen into an em dash but leaves a deliberate third hyphen", () => {
    expect(smartReplacement("wait-", 5, 5, "-")).toEqual({ start: 4, end: 5, text: "—" });
    expect(smartReplacement("--", 2, 2, "-")).toBeNull();
    expect(smartReplacement("well-known", 4, 4, "-")).toBeNull();
    expect(smartReplacement("abc", 1, 2, "x")).toBeNull();
  });

  it("replaces a selection with the quote that fits its position", () => {
    expect(smartReplacement("say hello", 4, 9, '"')).toEqual({ start: 4, end: 9, text: "“" });
  });
});

describe("emphasis markers", () => {
  it("wraps the selection and keeps surrounding spaces outside the markers", () => {
    expect(toggleEmphasis("a quiet door", 1, 8, "*")).toEqual({ start: 1, end: 8, text: " *quiet* ", selectStart: 3, selectEnd: 8 });
  });

  it("unwraps emphasis whether or not the markers were selected", () => {
    expect(toggleEmphasis("a *quiet* door", 3, 8, "*")).toMatchObject({ start: 2, end: 9, text: "quiet", selectStart: 2, selectEnd: 7 });
    expect(toggleEmphasis("a *quiet* door", 2, 9, "*")).toMatchObject({ start: 2, end: 9, text: "quiet" });
    expect(toggleEmphasis("a **loud** door", 4, 8, "**")).toMatchObject({ start: 2, end: 10, text: "loud" });
  });

  it("does not mistake bold markers for italics", () => {
    expect(toggleEmphasis("a **loud** door", 4, 8, "*")).toMatchObject({ text: "*loud*" });
  });

  it("inserts an empty pair at a caret with the caret between the markers", () => {
    expect(toggleEmphasis("ab", 1, 1, "*")).toEqual({ start: 1, end: 1, text: "**", selectStart: 2, selectEnd: 2 });
  });
});

describe("replaceTextRange", () => {
  it("edits the textarea and reports the change when the editing command is unavailable", () => {
    const textarea = document.createElement("textarea");
    document.body.append(textarea);
    textarea.value = "wait-";
    let inputs = 0;
    textarea.addEventListener("input", () => { inputs += 1; });
    replaceTextRange(textarea, 4, 5, "—");
    expect(textarea.value).toBe("wait—");
    expect(textarea.selectionStart).toBe(5);
    expect(inputs).toBe(1);
    textarea.remove();
  });
});
