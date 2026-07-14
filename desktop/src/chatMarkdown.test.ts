import { describe, expect, it } from "vitest";
import { parseChatMarkdown, parseInlineSpans } from "./chatMarkdown";

describe("parseInlineSpans", () => {
  it("splits bold, italic, and inline code", () => {
    const spans = parseInlineSpans("Keep **Mira** calm, use *tension*, run `check.continuity`.");
    expect(spans).toEqual([
      { kind: "text", text: "Keep " },
      { kind: "bold", text: "Mira" },
      { kind: "text", text: " calm, use " },
      { kind: "italic", text: "tension" },
      { kind: "text", text: ", run " },
      { kind: "code", text: "check.continuity" },
      { kind: "text", text: "." },
    ]);
  });

  it("leaves bare asterisks alone", () => {
    expect(parseInlineSpans("a * b")).toEqual([{ kind: "text", text: "a * b" }]);
  });
});

describe("parseChatMarkdown", () => {
  it("parses headings, paragraphs, and lists", () => {
    const blocks = parseChatMarkdown(
      "## Plan\nTighten the opening.\n\n- keep POV\n- fix timeline\n\n1. draft\n2. review"
    );
    expect(blocks.map((b) => b.kind)).toEqual([
      "heading",
      "paragraph",
      "list",
      "list",
    ]);
    const heading = blocks[0];
    if (heading.kind === "heading") {
      expect(heading.level).toBe(2);
      expect(heading.spans[0].text).toBe("Plan");
    }
    const ul = blocks[2];
    if (ul.kind === "list") {
      expect(ul.ordered).toBe(false);
      expect(ul.items).toHaveLength(2);
    }
    const ol = blocks[3];
    if (ol.kind === "list") {
      expect(ol.ordered).toBe(true);
      expect(ol.items[1][0].text).toBe("review");
    }
  });

  it("parses fenced code blocks with language", () => {
    const blocks = parseChatMarkdown("Before\n\n```python\nprint('hi')\n```\n\nAfter");
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "code", "paragraph"]);
    const code = blocks[1];
    if (code.kind === "code") {
      expect(code.language).toBe("python");
      expect(code.code).toBe("print('hi')");
    }
  });

  it("parses blockquotes and mixed blocks split by blank lines", () => {
    const blocks = parseChatMarkdown("> a quote\n> continues\n\nplain text");
    expect(blocks.map((b) => b.kind)).toEqual(["quote", "paragraph"]);
    const quote = blocks[0];
    if (quote.kind === "quote") {
      expect(quote.lines).toHaveLength(2);
    }
  });

  it("splits a list directly after a paragraph without a blank line", () => {
    const blocks = parseChatMarkdown("Ideas:\n- one\n- two");
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "list"]);
  });

  it("caps heading depth at level three", () => {
    const blocks = parseChatMarkdown("#### Deep heading");
    const heading = blocks[0];
    if (heading.kind === "heading") {
      expect(heading.level).toBe(3);
    }
  });
});
