import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { replaceTextRange } from "../../smartTypography";

export type FindMatch = { start: number; end: number };
const MATCH_LIMIT = 2000;

/** Case-insensitive, non-overlapping matches of a literal phrase. */
export function findMatches(body: string, query: string): FindMatch[] {
  if (!query) return [];
  const haystack = body.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  // Case folding can change length for a few characters; fall back to exact
  // matching there so offsets always address the original text.
  const folded = haystack.length === body.length && needle.length === query.length;
  const source = folded ? haystack : body;
  const target = folded ? needle : query;
  const matches: FindMatch[] = [];
  for (let at = source.indexOf(target); at >= 0 && matches.length < MATCH_LIMIT; at = source.indexOf(target, at + target.length)) {
    matches.push({ start: at, end: at + target.length });
  }
  return matches;
}

type Props = {
  body: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  readOnly: boolean;
  initialQuery: string;
  /** Bumped by Cmd+F so an already open bar takes focus again. */
  focusRequest: number;
  /** Bumped (signed) by Cmd+G / Cmd+Shift+G from the prose field. */
  step: number;
  onMatches: (matches: FindMatch[], current: number) => void;
  onClose: () => void;
};

export function FindBar({ body, textareaRef, readOnly, initialQuery, focusRequest, step, onMatches, onClose }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [replacement, setReplacement] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [current, setCurrent] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => findMatches(body, query), [body, query]);
  const active = matches.length ? Math.min(current, matches.length - 1) : -1;

  useEffect(() => {
    if (initialQuery) setQuery(initialQuery);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusRequest]);

  useEffect(() => { onMatches(matches, active); }, [matches, active]);
  useEffect(() => () => onMatches([], -1), []);

  const move = (direction: number) => {
    if (!matches.length) return;
    setCurrent((Math.max(active, 0) + direction + matches.length) % matches.length);
  };
  const lastStep = useRef(step);
  useEffect(() => {
    if (step === lastStep.current) return;
    move(step > lastStep.current ? 1 : -1);
    lastStep.current = step;
  }, [step]);

  // Start from the first match at or after the caret, as a reader expects.
  useEffect(() => {
    const caret = textareaRef.current?.selectionStart ?? 0;
    const next = matches.findIndex(match => match.start >= caret);
    setCurrent(next >= 0 ? next : 0);
  }, [query]);

  const close = () => {
    const textarea = textareaRef.current;
    const match = active >= 0 ? matches[active] : null;
    onClose();
    if (!textarea) return;
    textarea.focus();
    if (match) textarea.setSelectionRange(match.start, match.end);
  };

  const replaceOne = () => {
    const textarea = textareaRef.current;
    const match = active >= 0 ? matches[active] : null;
    if (!textarea || !match || readOnly) return;
    replaceTextRange(textarea, match.start, match.end, replacement);
    inputRef.current?.focus();
  };
  const replaceAll = () => {
    const textarea = textareaRef.current;
    if (!textarea || !matches.length || readOnly) return;
    let next = "";
    let from = 0;
    for (const match of matches) {
      next += body.slice(from, match.start) + replacement;
      from = match.end;
    }
    // One edit, so one undo restores every replaced passage.
    replaceTextRange(textarea, 0, textarea.value.length, next + body.slice(from));
    inputRef.current?.focus();
  };

  return (
    <div className="find-bar" role="search" aria-label="Find in this scene" onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
      <div className="find-bar__row">
        <input
          ref={inputRef}
          className="input find-bar__input"
          aria-label="Find in scene"
          placeholder="Find in this scene"
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); move(event.shiftKey ? -1 : 1); } }}
        />
        <span className="find-bar__count" role="status">{query ? (matches.length ? `${active + 1} of ${matches.length}${matches.length === MATCH_LIMIT ? "+" : ""}` : "No matches") : ""}</span>
        <button className="btn btn--ghost btn--sm" aria-label="Previous match" disabled={!matches.length} onClick={() => move(-1)}>↑</button>
        <button className="btn btn--ghost btn--sm" aria-label="Next match" disabled={!matches.length} onClick={() => move(1)}>↓</button>
        <button className="btn btn--ghost btn--sm" aria-expanded={replacing} disabled={readOnly} onClick={() => setReplacing(value => !value)}>Replace</button>
        <button className="btn btn--ghost btn--sm" aria-label="Close find" onClick={close}>×</button>
      </div>
      {replacing && !readOnly && (
        <div className="find-bar__row">
          <input
            className="input find-bar__input"
            aria-label="Replace with"
            placeholder="Replace with"
            value={replacement}
            onChange={event => setReplacement(event.target.value)}
            onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); replaceOne(); } }}
          />
          <button className="btn btn--sm" disabled={!matches.length} onClick={replaceOne}>Replace</button>
          <button className="btn btn--sm" disabled={!matches.length} onClick={replaceAll}>Replace all</button>
        </div>
      )}
    </div>
  );
}

/** Draws match highlights behind the transparent prose field. */
export function FindMarks({ body, matches, current }: { body: string; matches: FindMatch[]; current: number }) {
  const currentRef = useRef<HTMLElement>(null);
  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: "center" });
  }, [current, matches]);
  if (!matches.length) return null;
  const parts: React.ReactNode[] = [];
  let from = 0;
  matches.forEach((match, index) => {
    parts.push(body.slice(from, match.start));
    parts.push(<mark key={match.start} ref={index === current ? currentRef : undefined} className={index === current ? "find-mark find-mark--current" : "find-mark"}>{body.slice(match.start, match.end)}</mark>);
    from = match.end;
  });
  parts.push(body.slice(from));
  // The trailing newline keeps the layer as tall as a field ending in a break.
  return <div className="scene-editor__marks" aria-hidden="true">{parts}{"\n"}</div>;
}
