import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { Range } from "@codemirror/state";
import { emphasisRanges, isSceneBreak } from "../../proseEmphasis";

// How the stored Markdown is drawn on the page. The text itself is never
// changed here: emphasis markers are hidden while the author is elsewhere and
// shown, faintly, while the caret or selection touches the emphasised words,
// so they can always be edited as the plain characters they are.

const emphasis = { em: Decoration.mark({ class: "prose-em" }), strong: Decoration.mark({ class: "prose-strong" }) };
const visibleMarker = Decoration.mark({ class: "prose-marker" });
const hiddenMarker = Decoration.replace({});
const sceneBreak = Decoration.line({ class: "prose-scene-break" });
const activeParagraph = Decoration.line({ class: "prose-active" });

function build(view: EditorView): { decorations: DecorationSet; hidden: DecorationSet } {
  const marks: Range<Decoration>[] = [];
  const hidden: Range<Decoration>[] = [];
  const selection = view.state.selection.ranges;
  const focused = view.hasFocus;
  const activeLines = new Set(selection.map(range => view.state.doc.lineAt(range.head).number));
  for (const { from, to } of view.visibleRanges) {
    for (let position = from; position <= to;) {
      const line = view.state.doc.lineAt(position);
      if (activeLines.has(line.number)) marks.push(activeParagraph.range(line.from));
      if (isSceneBreak(line.text) && line.length > 0) {
        marks.push(sceneBreak.range(line.from));
      } else {
        for (const range of emphasisRanges(line.text)) {
          const start = line.from + range.from, end = line.from + range.to;
          const editing = focused && selection.some(item => item.from <= end && item.to >= start);
          for (const [markerFrom, markerTo] of [[start, start + range.marker], [end - range.marker, end]]) {
            if (editing) marks.push(visibleMarker.range(markerFrom, markerTo));
            else { marks.push(hiddenMarker.range(markerFrom, markerTo)); hidden.push(hiddenMarker.range(markerFrom, markerTo)); }
          }
          if (end - range.marker > start + range.marker) marks.push(emphasis[range.style].range(start + range.marker, end - range.marker));
        }
      }
      position = line.to + 1;
    }
  }
  return { decorations: Decoration.set(marks, true), hidden: Decoration.set(hidden, true) };
}

const plugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  hidden: DecorationSet;
  constructor(view: EditorView) { ({ decorations: this.decorations, hidden: this.hidden } = build(view)); }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged) {
      ({ decorations: this.decorations, hidden: this.hidden } = build(update.view));
    }
  }
}, { decorations: value => value.decorations });

/** Emphasis, scene breaks and the current-paragraph marker for the prose page. */
export const proseEmphasis = [
  plugin,
  // A hidden marker is stepped over as one unit, so the arrow keys never stop on something invisible.
  EditorView.atomicRanges.of(view => view.plugin(plugin)?.hidden ?? Decoration.none),
];
