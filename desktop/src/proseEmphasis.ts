// Scenes are plain Markdown. Read-only views show `*italic*`, `_italic_` and
// `**bold**` as emphasis; the editor keeps the markers visible so the stored
// text is always exactly what the author sees and edits.

export type ProseSpan = { text: string; style: "plain" | "em" | "strong" };

// No lookbehind: the oldest supported macOS WebView cannot parse it.
const EMPHASIS = /\*\*([^*\n]+?)\*\*|\*([^*\s](?:[^*\n]*?[^*\s])?)\*|(^|[^\p{L}\p{N}_])_([^_\s](?:[^_\n]*?[^_\s])?)_(?![\p{L}\p{N}_])/gu;

/** An emphasised stretch of a line: `from`..`to` covers the markers, which are `marker` characters wide at each end. */
export type EmphasisRange = { from: number; to: number; marker: number; style: "em" | "strong" };

/** Locate the emphasised stretches of one line, in order. */
export function emphasisRanges(text: string): EmphasisRange[] {
  const ranges: EmphasisRange[] = [];
  for (const match of text.matchAll(EMPHASIS)) {
    const at = match.index ?? 0;
    if (match[1] !== undefined) ranges.push({ from: at, to: at + match[0].length, marker: 2, style: "strong" });
    else if (match[2] !== undefined) ranges.push({ from: at, to: at + match[0].length, marker: 1, style: "em" });
    else {
      // The underscore form also matched the character before it, which is not part of the emphasis.
      const from = at + (match[3] ?? "").length;
      ranges.push({ from, to: at + match[0].length, marker: 1, style: "em" });
    }
  }
  return ranges;
}

/** Split one paragraph into plain and emphasised spans. */
export function emphasisSpans(text: string): ProseSpan[] {
  const spans: ProseSpan[] = [];
  const push = (value: string, style: ProseSpan["style"]) => {
    if (!value) return;
    const last = spans[spans.length - 1];
    if (last && last.style === style) last.text += value;
    else spans.push({ text: value, style });
  };
  let from = 0;
  for (const range of emphasisRanges(text)) {
    push(text.slice(from, range.from), "plain");
    push(text.slice(range.from + range.marker, range.to - range.marker), range.style);
    from = range.to;
  }
  push(text.slice(from), "plain");
  return spans;
}

/** True for a line that only marks a break between scenes or sections. */
export function isSceneBreak(line: string): boolean {
  return /^\s*(?:\*\s?\*\s?\*|#|⁂)\s*$/.test(line);
}
