// Scenes are plain Markdown. Read-only views show `*italic*`, `_italic_` and
// `**bold**` as emphasis; the editor keeps the markers visible so the stored
// text is always exactly what the author sees and edits.

export type ProseSpan = { text: string; style: "plain" | "em" | "strong" };

// No lookbehind: the oldest supported macOS WebView cannot parse it.
const EMPHASIS = /\*\*([^*\n]+?)\*\*|\*([^*\s](?:[^*\n]*?[^*\s])?)\*|(^|[^\p{L}\p{N}_])_([^_\s](?:[^_\n]*?[^_\s])?)_(?![\p{L}\p{N}_])/gu;

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
  for (const match of text.matchAll(EMPHASIS)) {
    const at = match.index ?? 0;
    push(text.slice(from, at), "plain");
    if (match[1] !== undefined) push(match[1], "strong");
    else if (match[2] !== undefined) push(match[2], "em");
    else { push(match[3] ?? "", "plain"); push(match[4] ?? "", "em"); }
    from = at + match[0].length;
  }
  push(text.slice(from), "plain");
  return spans;
}

/** True for a line that only marks a break between scenes or sections. */
export function isSceneBreak(line: string): boolean {
  return /^\s*(?:\*\s?\*\s?\*|#|⁂)\s*$/.test(line);
}
