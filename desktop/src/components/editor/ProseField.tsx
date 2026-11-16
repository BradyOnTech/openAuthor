import { useEffect, useLayoutEffect, useRef } from "react";
import { Annotation, Compartment, EditorSelection, EditorState, StateEffect, StateField, Transaction, type Extension } from "@codemirror/state";
import { Decoration, EditorView, keymap, placeholder as placeholderExtension, type DecorationSet } from "@codemirror/view";
import { history, historyKeymap, redo, standardKeymap } from "@codemirror/commands";
import { proseEmphasis } from "./proseDecorations";
import { smartPunctuationEnabled, smartReplacement, toggleEmphasis } from "../../smartTypography";
import { proseFromHtml } from "../../pastedProse";

/**
 * The prose editing surface.
 *
 * The document is the scene's Markdown text, character for character: nothing
 * is converted on the way in or out, so what is saved is exactly what was
 * typed. Emphasis is drawn from that text (see `proseDecorations`).
 *
 * The editable element also answers to the small part of the `<textarea>`
 * interface the rest of the app and its tests rely on (`value`, the selection
 * offsets, `setSelectionRange`), so callers address the page the same way
 * whichever element implements it.
 */
export type ProseFieldElement = HTMLElement & {
  value: string;
  readOnly: boolean;
  selectionStart: number;
  selectionEnd: number;
  selectionDirection: "forward" | "backward" | "none";
  setSelectionRange: (start: number, end: number, direction?: "forward" | "backward" | "none") => void;
  /** Replace a range as one undoable edit and leave the caret after it. */
  replaceRange: (start: number, end: number, text: string) => void;
  /** Bring a document position into view, centred where possible. */
  revealPosition: (position: number) => void;
};

export type ProseHighlights = { matches: Array<{ start: number; end: number }>; current: number };

type Handlers = {
  onChange: (value: string) => void;
  onSelectionChange?: (field: ProseFieldElement) => void;
  onFocus?: (field: ProseFieldElement) => void;
  onBlur?: (field: ProseFieldElement) => void;
  onPointerDown?: (field: ProseFieldElement) => void;
  /** Called before the author's keystroke, paste or composition changes the text. */
  onBeforeEdit?: (field: ProseFieldElement, event: Event) => void;
};

type Props = Handlers & {
  value: string;
  /** Identifies the document so undo history and the caret survive a tab switch. */
  stateKey: string;
  ariaLabel: string;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
  focusRing?: boolean;
  dimOtherParagraphs?: boolean;
  /** Keep the line being written at the middle of the page as the author types. */
  typewriter?: boolean;
  highlights?: ProseHighlights;
  fieldRef?: { current: ProseFieldElement | null };
};

const externalChange = Annotation.define<boolean>();
// Text assigned through `value` is announced by the `input` or `change` event
// that follows it, exactly as for a textarea, instead of by the assignment.
const assignedValue = Annotation.define<boolean>();
const setHighlights = StateEffect.define<ProseHighlights>();

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, transaction) {
    marks = marks.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setHighlights)) continue;
      const length = transaction.newDoc.length;
      marks = Decoration.set(effect.value.matches
        .filter(match => match.start < match.end && match.end <= length)
        .map((match, index) => Decoration.mark({ class: index === effect.value.current ? "find-mark find-mark--current" : "find-mark" }).range(match.start, match.end)), true);
    }
    return marks;
  },
  provide: field => EditorView.decorations.from(field),
});

/** Curly quotes and em dashes as the author types, when the preference is on. */
const smartPunctuation = EditorView.inputHandler.of((view, from, to, text) => {
  if (text.length !== 1 || view.composing || view.state.readOnly || !smartPunctuationEnabled()) return false;
  const change = smartReplacement(view.state.doc.toString(), from, to, text);
  if (!change) return false;
  view.dispatch({
    changes: { from: change.start, to: change.end, insert: change.text },
    selection: { anchor: change.start + change.text.length },
    userEvent: "input.type",
    scrollIntoView: true,
  });
  return true;
});

function italic(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  const { from, to } = view.state.selection.main;
  const change = toggleEmphasis(view.state.doc.toString(), from, to, "*");
  view.dispatch({
    changes: { from: change.start, to: change.end, insert: change.text },
    selection: EditorSelection.range(change.selectStart, change.selectEnd),
    userEvent: "input",
  });
  return true;
}

/** True when two texts differ at most in trailing blank space, which saving normalises. */
function sameProse(left: string, right: string): boolean {
  return left === right || left.trimEnd() === right.trimEnd();
}

function commonPrefix(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left.charCodeAt(index) === right.charCodeAt(index)) index += 1;
  return index;
}

type Session = {
  state: EditorState;
  handlers: { current: Handlers };
  typewriter: { current: boolean };
  editable: Compartment;
  attributes: Compartment;
  hint: Compartment;
  dimming: Compartment;
};

// Editor state outlives the mounted view, so switching tabs keeps each scene's
// undo history and caret. Bounded, because a state holds a copy of its text.
const sessions = new Map<string, Session>();
const SESSION_LIMIT = 24;

function contentAttributes(label: string, className: string, hint: string, focusRing: boolean): Extension {
  return EditorView.contentAttributes.of({
    class: className,
    "aria-label": label,
    // Kept as an attribute too, so the hint is discoverable the way a field's is.
    placeholder: hint,
    spellcheck: "true",
    autocorrect: "on",
    autocapitalize: "sentences",
    ...(focusRing ? { "data-focus-ring": "true" } : {}),
  });
}

function createSession(text: string, props: Pick<Props, "ariaLabel" | "className" | "placeholder" | "readOnly" | "focusRing" | "dimOtherParagraphs">, handlers: { current: Handlers }): Session {
  const typewriter = { current: false };
  const editable = new Compartment();
  const attributes = new Compartment();
  const hint = new Compartment();
  const dimming = new Compartment();
  const state = EditorState.create({
    doc: text,
    extensions: [
      history(),
      smartPunctuation,
      // Redo answers to Shift with the undo key on every platform, as well as each platform's own key.
      keymap.of([{ key: "Mod-i", run: italic }, { key: "Mod-Shift-z", run: redo }, ...historyKeymap, ...standardKeymap]),
      EditorView.lineWrapping,
      proseEmphasis,
      highlightField,
      editable.of([EditorState.readOnly.of(Boolean(props.readOnly)), EditorView.editable.of(!props.readOnly)]),
      attributes.of(contentAttributes(props.ariaLabel, props.className || "", props.placeholder || "", Boolean(props.focusRing))),
      hint.of(props.placeholder ? placeholderExtension(props.placeholder) : []),
      dimming.of(props.dimOtherParagraphs ? EditorView.editorAttributes.of({ class: "prose-field--dim-others" }) : []),
      EditorView.updateListener.of(update => {
        const field = update.view.contentDOM as ProseFieldElement;
        if (update.docChanged && !update.transactions.some(transaction => transaction.annotation(externalChange) || transaction.annotation(assignedValue))) {
          handlers.current.onChange(update.state.doc.toString());
        }
        if (update.selectionSet || update.docChanged) handlers.current.onSelectionChange?.(field);
      }),
      // Typewriter scrolling: while the author types, the caret's line stays
      // at mid-page instead of creeping down to the bottom edge.
      EditorView.updateListener.of(update => {
        if (!typewriter.current || !update.docChanged || !update.view.hasFocus) return;
        if (!update.transactions.some(transaction => transaction.isUserEvent("input") || transaction.isUserEvent("delete"))) return;
        const head = update.state.selection.main.head;
        requestAnimationFrame(() => {
          if (update.view.state.selection.main.head === head) update.view.dispatch({ effects: EditorView.scrollIntoView(head, { y: "center" }) });
        });
      }),
      EditorView.domEventHandlers({
        // Emphasis copied from a word processor is kept as Markdown; anything
        // without emphasis pastes as plain text in the usual way.
        paste: (event, view) => {
          if (view.state.readOnly) return false;
          const prose = proseFromHtml(event.clipboardData?.getData("text/html") || "");
          if (prose === null) return false;
          event.preventDefault();
          view.dispatch(view.state.replaceSelection(prose), { userEvent: "input.paste", scrollIntoView: true });
          return true;
        },
      }),
      EditorView.domEventHandlers({
        // The editor reports focus changes a moment late to avoid flicker; the
        // caret bookkeeping around focus needs them as they happen.
        focus: (_event, view) => { handlers.current.onFocus?.(view.contentDOM as ProseFieldElement); },
        blur: (_event, view) => { handlers.current.onBlur?.(view.contentDOM as ProseFieldElement); },
        pointerdown: (_event, view) => { handlers.current.onPointerDown?.(view.contentDOM as ProseFieldElement); },
        keydown: (event, view) => { if (event.key !== "Tab") handlers.current.onBeforeEdit?.(view.contentDOM as ProseFieldElement, event); },
        beforeinput: (event, view) => { handlers.current.onBeforeEdit?.(view.contentDOM as ProseFieldElement, event); },
        paste: (event, view) => { handlers.current.onBeforeEdit?.(view.contentDOM as ProseFieldElement, event); },
        compositionstart: (event, view) => { handlers.current.onBeforeEdit?.(view.contentDOM as ProseFieldElement, event); },
      }),
    ],
  });
  return { state, handlers, typewriter, editable, attributes, hint, dimming };
}

/** Give the editable element the textarea-shaped interface described above. */
function describeAsField(view: EditorView, handlers: { current: Handlers }): ProseFieldElement {
  const clamp = (position: number) => Math.max(0, Math.min(view.state.doc.length, Math.trunc(position) || 0));
  // The editor adopts a selection made in the page a moment after it happens.
  // A focused field answers with the page's selection, as a textarea would, so
  // a select-all followed at once by typing is seen for what it is.
  const liveSelection = (): { anchor: number; head: number } => {
    const main = view.state.selection.main;
    const selection = view.contentDOM.ownerDocument.getSelection();
    if (view.contentDOM.ownerDocument.activeElement !== view.contentDOM || !selection || !selection.anchorNode || !selection.focusNode) return main;
    if (!view.contentDOM.contains(selection.anchorNode) || !view.contentDOM.contains(selection.focusNode)) return main;
    try {
      return { anchor: view.posAtDOM(selection.anchorNode, selection.anchorOffset), head: view.posAtDOM(selection.focusNode, selection.focusOffset) };
    } catch {
      return main;
    }
  };
  let unannounced = false;
  const announce = () => {
    if (!unannounced) return;
    unannounced = false;
    handlers.current.onChange(view.state.doc.toString());
  };
  view.contentDOM.addEventListener("input", announce);
  view.contentDOM.addEventListener("change", announce);
  view.contentDOM.addEventListener("select", () => handlers.current.onSelectionChange?.(view.contentDOM as ProseFieldElement));
  Object.defineProperties(view.contentDOM, {
    value: {
      configurable: true,
      get: () => view.state.doc.toString(),
      set: (text: string) => {
        if (text === view.state.doc.toString()) return;
        unannounced = true;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: String(text) },
          selection: { anchor: Math.min(view.state.selection.main.head, String(text).length) },
          annotations: assignedValue.of(true),
        });
      },
    },
    readOnly: { configurable: true, get: () => view.state.readOnly },
    selectionStart: { configurable: true, get: () => Math.min(liveSelection().anchor, liveSelection().head) },
    selectionEnd: { configurable: true, get: () => Math.max(liveSelection().anchor, liveSelection().head) },
    selectionDirection: {
      configurable: true,
      get: () => {
        const range = liveSelection();
        return range.anchor === range.head ? "none" : range.head < range.anchor ? "backward" : "forward";
      },
    },
    setSelectionRange: {
      configurable: true,
      value: (start: number, end: number, direction?: "forward" | "backward" | "none") => {
        const from = clamp(start), to = clamp(Math.max(start, end));
        view.dispatch({ selection: direction === "backward" ? EditorSelection.range(to, from) : EditorSelection.range(from, to) });
      },
    },
    replaceRange: {
      configurable: true,
      value: (start: number, end: number, text: string) => {
        const from = clamp(start), to = clamp(Math.max(start, end));
        view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent: "input.replace" });
      },
    },
    revealPosition: {
      configurable: true,
      value: (position: number) => view.dispatch({ effects: EditorView.scrollIntoView(clamp(position), { y: "center" }) }),
    },
  });
  return view.contentDOM as ProseFieldElement;
}

export function ProseField({ value, stateKey, ariaLabel, placeholder, readOnly = false, className = "", focusRing = false, dimOtherParagraphs = false, typewriter = false, highlights, fieldRef, ...handlers }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const handlersRef = useRef<Handlers>(handlers);
  handlersRef.current = handlers;

  useLayoutEffect(() => {
    let session = sessions.get(stateKey);
    // A remembered state is only reused for the text it was editing; anything
    // else (a scene changed elsewhere) starts clean rather than offering undo
    // back into text that is no longer the saved scene.
    if (!session || !sameProse(session.state.doc.toString(), value)) {
      session = createSession(value, { ariaLabel, className, placeholder, readOnly, focusRing, dimOtherParagraphs }, { current: handlersRef.current });
    }
    sessions.delete(stateKey);
    sessions.set(stateKey, session);
    for (const key of sessions.keys()) {
      if (sessions.size <= SESSION_LIMIT) break;
      sessions.delete(key);
    }
    session.handlers.current = handlersRef.current;
    sessionRef.current = session;
    const view = new EditorView({ state: session.state, parent: host.current! });
    viewRef.current = view;
    const field = describeAsField(view, session.handlers);
    if (fieldRef) fieldRef.current = field;
    return () => {
      session.state = view.state;
      view.destroy();
      viewRef.current = null;
      if (fieldRef && fieldRef.current === field) fieldRef.current = null;
    };
  }, [stateKey]);

  // Callbacks change identity on every render; the editor reads them through
  // one stable holder instead of being reconfigured.
  useEffect(() => {
    if (!sessionRef.current) return;
    sessionRef.current.handlers.current = handlersRef.current;
    sessionRef.current.typewriter.current = typewriter;
  });

  useLayoutEffect(() => {
    const view = viewRef.current, session = sessionRef.current;
    if (!view || !session) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    if (sameProse(current, value)) {
      // Saving normalises trailing blank space. Only that tail is changed, so
      // every position the undo history remembers still means the same place.
      const kept = commonPrefix(current, value);
      view.dispatch({
        changes: { from: kept, to: current.length, insert: value.slice(kept) },
        annotations: [externalChange.of(true), Transaction.addToHistory.of(false)],
      });
      return;
    }
    // Different text arrived from outside (a reload, an applied or undone
    // Change Set). Undo must not reach back across it into a scene that is no
    // longer the saved one, so the page starts a fresh history, as a field does
    // when its text is replaced.
    const head = Math.min(view.state.selection.main.head, value.length);
    const fresh = createSession(value, { ariaLabel, className, placeholder, readOnly, focusRing, dimOtherParagraphs }, session.handlers);
    fresh.typewriter.current = session.typewriter.current;
    fresh.state = fresh.state.update({ selection: { anchor: head } }).state;
    Object.assign(session, fresh);
    view.setState(session.state);
  }, [value]);

  useLayoutEffect(() => {
    const view = viewRef.current, session = sessionRef.current;
    if (!view || !session) return;
    view.dispatch({ effects: [
      session.editable.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
      session.attributes.reconfigure(contentAttributes(ariaLabel, className, placeholder || "", focusRing)),
      session.hint.reconfigure(placeholder ? placeholderExtension(placeholder) : []),
      session.dimming.reconfigure(dimOtherParagraphs ? EditorView.editorAttributes.of({ class: "prose-field--dim-others" }) : []),
    ] });
  }, [readOnly, ariaLabel, className, placeholder, focusRing, dimOtherParagraphs]);

  useLayoutEffect(() => {
    viewRef.current?.dispatch({ effects: setHighlights.of(highlights || { matches: [], current: -1 }) });
  }, [highlights]);

  return <div ref={host} className="prose-field" />;
}
