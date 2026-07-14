export type ChatInlineSpan = {
  kind: "text" | "bold" | "italic" | "code" | "link";
  text: string;
  href?: string;
};

export type ChatBlock =
  | { kind: "code"; language: string; code: string }
  | { kind: "heading"; level: 1 | 2 | 3; spans: ChatInlineSpan[] }
  | { kind: "list"; ordered: boolean; items: ChatInlineSpan[][] }
  | { kind: "quote"; lines: ChatInlineSpan[][] }
  | { kind: "paragraph"; lines: ChatInlineSpan[][] };

const INLINE_TOKEN = /(`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*\*[^*]+\*\*|\*[^*]+\*)/g;
const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/;

function isSafeHref(href: string): boolean {
  return href.startsWith("https://") || href.startsWith("http://");
}
const UL_ITEM = /^\s*[-*]\s+(.*)$/;
const OL_ITEM = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;

export function parseInlineSpans(text: string): ChatInlineSpan[] {
  const pieces = text.split(INLINE_TOKEN).filter((piece) => piece !== "");
  return pieces.map((piece) => {
    const link = LINK.exec(piece);
    if (link) {
      if (isSafeHref(link[2])) {
        return { kind: "link" as const, text: link[1], href: link[2] };
      }
      return { kind: "text" as const, text: link[1] };
    }
    if (piece.length > 4 && piece.startsWith("**") && piece.endsWith("**")) {
      return { kind: "bold" as const, text: piece.slice(2, -2) };
    }
    if (piece.length > 2 && piece.startsWith("*") && piece.endsWith("*")) {
      return { kind: "italic" as const, text: piece.slice(1, -1) };
    }
    if (piece.length > 2 && piece.startsWith("`") && piece.endsWith("`")) {
      return { kind: "code" as const, text: piece.slice(1, -1) };
    }
    return { kind: "text" as const, text: piece };
  });
}

function classifyLine(line: string): "ul" | "ol" | "heading" | "quote" | "text" {
  if (UL_ITEM.test(line)) return "ul";
  if (OL_ITEM.test(line)) return "ol";
  if (HEADING.test(line)) return "heading";
  if (QUOTE.test(line)) return "quote";
  return "text";
}

function parseTextBlocks(segment: string): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  const lines = segment.split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    const type = classifyLine(line);
    if (type === "heading") {
      const match = HEADING.exec(line);
      if (match) {
        const level = Math.min(3, match[1].length) as 1 | 2 | 3;
        blocks.push({ kind: "heading", level, spans: parseInlineSpans(match[2]) });
      }
      index += 1;
      continue;
    }
    if (type === "ul" || type === "ol") {
      const pattern = type === "ul" ? UL_ITEM : OL_ITEM;
      const items: ChatInlineSpan[][] = [];
      while (index < lines.length) {
        const itemMatch = pattern.exec(lines[index]);
        if (!itemMatch) break;
        items.push(parseInlineSpans(itemMatch[1]));
        index += 1;
      }
      blocks.push({ kind: "list", ordered: type === "ol", items });
      continue;
    }
    if (type === "quote") {
      const quoteLines: ChatInlineSpan[][] = [];
      while (index < lines.length) {
        const quoteMatch = QUOTE.exec(lines[index]);
        if (!quoteMatch) break;
        quoteLines.push(parseInlineSpans(quoteMatch[1]));
        index += 1;
      }
      blocks.push({ kind: "quote", lines: quoteLines });
      continue;
    }
    const textLines: ChatInlineSpan[][] = [];
    while (
      index < lines.length &&
      lines[index].trim() !== "" &&
      classifyLine(lines[index]) === "text"
    ) {
      textLines.push(parseInlineSpans(lines[index]));
      index += 1;
    }
    blocks.push({ kind: "paragraph", lines: textLines });
  }
  return blocks;
}

export function parseChatMarkdown(content: string): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  const segments = content.split(/(```[\s\S]*?```)/g);
  for (const segment of segments) {
    if (segment.startsWith("```") && segment.endsWith("```") && segment.length >= 6) {
      const inner = segment.slice(3, -3);
      const newlineIndex = inner.indexOf("\n");
      const language = newlineIndex >= 0 ? inner.slice(0, newlineIndex).trim() : "";
      const code = newlineIndex >= 0 ? inner.slice(newlineIndex + 1) : inner;
      blocks.push({ kind: "code", language, code: code.replace(/\n$/, "") });
      continue;
    }
    blocks.push(...parseTextBlocks(segment));
  }
  return blocks;
}
