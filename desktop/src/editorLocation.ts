export type TextLocation = { start: number; end: number; direction: "forward" | "backward" | "none"; scrollTop: number; containerScrollTop?: number; anchor: string; before: string; after: string };
const key = (root: string, scope: string, scene: string) => `openauthor.location.v1:${JSON.stringify([root, scope, scene])}`;
export function rememberTextLocation(root: string, scope: string, scene: string, textarea: HTMLTextAreaElement) {
  const start = textarea.selectionStart, end = textarea.selectionEnd, body = textarea.value;
  const location: TextLocation = { start, end, direction: textarea.selectionDirection, scrollTop: textarea.scrollTop, containerScrollTop: textarea.closest(".scene-editor")?.scrollTop || 0,
    anchor: body.slice(start, end).slice(0, 160), before: body.slice(Math.max(0, start - 48), start), after: body.slice(end, end + 48) };
  try { localStorage.setItem(key(root, scope, scene), JSON.stringify(location)); } catch { /* Location is optional; manuscript recovery reports its own storage errors. */ }
}
export function restoreTextLocation(root: string, scope: string, scene: string, body: string): TextLocation | null {
  try {
    const raw = localStorage.getItem(key(root, scope, scene));
    if (!raw) return null;
    const row = JSON.parse(raw) as TextLocation;
    if (!Number.isInteger(row.start) || !Number.isInteger(row.end) || row.start < 0 || row.end < row.start || !Number.isFinite(row.scrollTop)
      || !["forward", "backward", "none"].includes(row.direction) || [row.anchor, row.before, row.after].some(value => typeof value !== "string")) return null;
    const matches = row.end <= body.length && body.slice(Math.max(0, row.start - row.before.length), row.start) === row.before
      && body.slice(row.end, row.end + row.after.length) === row.after && body.slice(row.start, row.start + row.anchor.length) === row.anchor;
    if (matches) return row;
    // Relocate only a unique surrounding passage. Ambiguity returns a safe beginning.
    const context = row.before + row.anchor + row.after;
    const found = context ? body.indexOf(context) : -1;
    if (found < 0 || body.indexOf(context, found + 1) >= 0 || row.end - row.start > row.anchor.length) return null;
    const start = found + row.before.length;
    return { ...row, start, end: start + row.anchor.length, scrollTop: 0 };
  } catch { return null; }
}
