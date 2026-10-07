import { useMemo } from "react";
import { comparePassage } from "../../passageComparison";

export function PassageComparison({ before, after, beforeLabel = "Before", afterLabel = "After" }: { before: string; after: string; beforeLabel?: string; afterLabel?: string }) {
  const comparison = useMemo(() => comparePassage(before, after), [before, after]);
  return <div className="selection-review__comparison">
    <div><strong>{beforeLabel}</strong><blockquote>{comparison.before.map((part, index) => part.changed
      ? <del key={index} style={{ background: "var(--danger-subtle)", textDecoration: "line-through" }}>{part.text}</del> : <span key={index}>{part.text}</span>)}</blockquote></div>
    <div><strong>{afterLabel}</strong><blockquote>{comparison.after.map((part, index) => part.changed
      ? <ins key={index} style={{ background: "var(--success-subtle)", textDecoration: "underline" }}>{part.text}</ins> : <span key={index}>{part.text}</span>)}</blockquote></div>
  </div>;
}
