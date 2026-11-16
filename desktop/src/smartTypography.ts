// Typographic help for the prose textarea. Scenes stay plain Markdown, so this
// only chooses characters and emphasis markers; it never stores formatting.

const SMART_PUNCTUATION_KEY = "openauthor.smartPunctuation";
const OPENS_AFTER = /[\s([{<—–‘“-]/;

export function smartPunctuationEnabled(): boolean {
  try {
    return window.localStorage.getItem(SMART_PUNCTUATION_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setSmartPunctuationEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(SMART_PUNCTUATION_KEY, JSON.stringify(enabled));
  } catch {
    // The preference is optional; typing keeps its default behaviour.
  }
}

/** The curly form of a typed straight quote, chosen from the text before the caret. */
export function curlyQuote(before: string, typed: '"' | "'"): string {
  const previous = before.slice(-1);
  const opening = !previous || OPENS_AFTER.test(previous);
  if (typed === '"') return opening ? "“" : "”";
  return opening ? "‘" : "’";
}

type Replacement = { start: number; end: number; text: string };

/** What a keystroke should become, or null to let the browser type it. */
export function smartReplacement(value: string, start: number, end: number, typed: string): Replacement | null {
  if (typed === '"' || typed === "'") return { start, end, text: curlyQuote(value.slice(0, start), typed) };
  // Two hyphens become an em dash; a third hyphen is left alone so `---` can
  // still be typed deliberately after undoing.
  if (typed === "-" && start === end && value[start - 1] === "-" && value[start - 2] !== "-") {
    return { start: start - 1, end, text: "—" };
  }
  return null;
}

/** Wrap or unwrap the selection in a Markdown emphasis marker (`*` or `**`). */
export function toggleEmphasis(value: string, start: number, end: number, marker: "*" | "**"): Replacement & { selectStart: number; selectEnd: number } {
  const size = marker.length;
  const selected = value.slice(start, end);
  const wrappedOutside = value.slice(start - size, start) === marker && value.slice(end, end + size) === marker
    && (marker === "**" || (value[start - size - 1] !== "*" && value[end + size] !== "*"));
  if (wrappedOutside) {
    return { start: start - size, end: end + size, text: selected, selectStart: start - size, selectEnd: end - size };
  }
  if (selected.length >= size * 2 && selected.startsWith(marker) && selected.endsWith(marker)
    && (marker === "**" || !selected.startsWith("**"))) {
    const inner = selected.slice(size, -size);
    return { start, end, text: inner, selectStart: start, selectEnd: start + inner.length };
  }
  // Keep surrounding whitespace outside the markers so `*word *` never appears.
  const lead = selected.match(/^\s*/)?.[0].length ?? 0;
  const trail = selected.length > lead ? selected.match(/\s*$/)?.[0].length ?? 0 : 0;
  const core = selected.slice(lead, selected.length - trail);
  const text = selected.slice(0, lead) + marker + core + marker + selected.slice(selected.length - trail);
  const selectStart = start + lead + size;
  return { start, end, text, selectStart, selectEnd: selectStart + core.length };
}

/**
 * Replace a range through the browser's editing pipeline so native undo and
 * redo keep working. Falls back to a direct edit where that is unavailable.
 */
export function replaceTextRange(textarea: HTMLTextAreaElement, start: number, end: number, text: string): void {
  textarea.focus();
  textarea.setSelectionRange(start, end);
  let inserted = false;
  try {
    inserted = typeof document.execCommand === "function" && document.execCommand("insertText", false, text);
  } catch {
    inserted = false;
  }
  if (inserted) return;
  textarea.setRangeText(text, start, end, "end");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}
