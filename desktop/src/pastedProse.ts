// Prose copied from a word processor arrives as HTML. Scenes are Markdown, so
// the emphasis in it is kept as `*italic*` and `**bold**`; every other kind of
// formatting is dropped, exactly as a plain-text paste would drop it.

const BLOCKS = new Set(["P", "DIV", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "TR", "SECTION", "ARTICLE"]);
const SKIPPED = new Set(["STYLE", "SCRIPT", "HEAD", "META", "TITLE", "TEMPLATE"]);

type Emphasis = { italic: boolean; bold: boolean };
type Run = { text: string } & Emphasis;

function emphasisOf(element: Element, inherited: Emphasis): Emphasis {
  const style = (element as HTMLElement).style;
  const weight = style?.fontWeight || "";
  let { italic, bold } = inherited;
  if (element.tagName === "I" || element.tagName === "EM" || style?.fontStyle === "italic" || style?.fontStyle === "oblique") italic = true;
  if (style?.fontStyle === "normal") italic = false;
  // Google Docs wraps everything in <b style="font-weight:normal">.
  if (weight === "normal" || weight === "400") bold = false;
  else if (element.tagName === "B" || element.tagName === "STRONG" || weight === "bold" || Number(weight) >= 600) bold = true;
  return { italic, bold };
}

function wrap(text: string, marker: string): string {
  const lead = text.match(/^\s*/)?.[0] ?? "";
  const trail = text.length > lead.length ? text.match(/\s*$/)?.[0] ?? "" : "";
  const core = text.slice(lead.length, text.length - trail.length);
  return core ? `${lead}${marker}${core}${marker}${trail}` : text;
}

/**
 * Markdown for pasted HTML, or null when the HTML carries no emphasis and the
 * plain-text clipboard should be used as it always was.
 */
export function proseFromHtml(html: string): string | null {
  if (!/<(i|em|b|strong)\b|font-style\s*:\s*(italic|oblique)|font-weight\s*:\s*(bold|[6-9]00)/i.test(html)) return null;
  const body = new DOMParser().parseFromString(html, "text/html").body;
  const paragraphs: Run[][] = [[]];
  const breakParagraph = () => { if (paragraphs[paragraphs.length - 1].length) paragraphs.push([]); };
  const walk = (node: Node, emphasis: Emphasis) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent || "").replace(/\s+/g, " ");
      if (text) paragraphs[paragraphs.length - 1].push({ text, ...emphasis });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    if (SKIPPED.has(element.tagName)) return;
    if (element.tagName === "BR") { paragraphs[paragraphs.length - 1].push({ text: "\n", italic: false, bold: false }); return; }
    const block = BLOCKS.has(element.tagName);
    if (block) breakParagraph();
    const next = emphasisOf(element, emphasis);
    element.childNodes.forEach(child => walk(child, next));
    if (block) breakParagraph();
  };
  walk(body, { italic: false, bold: false });
  let sawEmphasis = false;
  const text = paragraphs.map(runs => {
    // Join neighbouring runs with the same emphasis so one phrase gets one pair of markers.
    const merged: Run[] = [];
    for (const run of runs) {
      const last = merged[merged.length - 1];
      if (last && last.italic === run.italic && last.bold === run.bold) last.text += run.text;
      else merged.push({ ...run });
    }
    return merged.map(run => {
      let piece = run.text;
      if (run.bold && piece.trim()) { piece = wrap(piece, "**"); sawEmphasis = true; }
      if (run.italic && piece.trim()) { piece = wrap(piece, "*"); sawEmphasis = true; }
      return piece;
    }).join("").replace(/ *\n */g, "\n").trim();
  }).filter(Boolean).join("\n\n");
  return sawEmphasis && text ? text : null;
}
