import type { CanonEvidence } from "./types";

export function evidenceRange(body: string, evidence: CanonEvidence): [number, number] | null {
  // Core offsets count Unicode code points; textarea offsets count UTF-16 units.
  const points = [...body];
  const passage = evidence.anchor_text || evidence.excerpt;
  const start = points.slice(0, evidence.start).join("").length;
  const end = points.slice(0, evidence.end).join("").length;
  if (evidence.start >= 0 && evidence.end > evidence.start && body.slice(start, end) === passage) return [start, end];
  const found = passage ? body.indexOf(passage) : -1;
  if (found < 0 || body.indexOf(passage, found + 1) >= 0) return null;
  return [found, found + passage.length];
}
