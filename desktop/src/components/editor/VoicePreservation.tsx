import { useEffect } from "react";
import type { VoicePreservation } from "../../api";
import { useRetainedDraft } from "../../hooks/useRetainedDraft";
import { RecoveryNotice } from "./RecoveryNotice";

export const preservationKinds: Record<VoicePreservation["kind"], string> = {
  fact: "Story fact", knowledge: "Character knowledge", uncertainty: "Intentional uncertainty",
  protected_text: "Exact wording", end_beat: "Ending beat",
};
const characters = (text: string) => [...text].length;

export function validPreservationDraft(value: unknown): value is VoicePreservation[] {
  return Array.isArray(value) && value.length <= 12 && value.every((row) => row && typeof row === "object"
    && !Array.isArray(row) && typeof row.kind === "string" && Object.keys(row).every(key => key === "kind" || key === "text")
    && Object.prototype.hasOwnProperty.call(preservationKinds, row.kind) && typeof row.text === "string" && characters(row.text) <= 400)
    && value.reduce((total, row) => total + characters(row.text), 0) <= 3000;
}

export function preservationError(rows: VoicePreservation[], source: string): string {
  if (!validPreservationDraft(rows)) return "Use at most 12 preservation instructions, 400 characters each and 3,000 characters altogether.";
  for (const [index, row] of rows.entries()) {
    if (!row.text.trim()) return `Preservation instruction ${index + 1} needs text; remove it if it is unnecessary.`;
    if (row.kind === "protected_text" && !source.includes(row.text)) return `Exact wording in preservation instruction ${index + 1} must appear unchanged in the excerpt.`;
  }
  return "";
}

export function VoicePreservationInput({ retentionId, source, disabled, onChange }: {
  retentionId: string; source: string; disabled: boolean;
  onChange: (retentionId: string, value: VoicePreservation[]) => void;
}) {
  const draft = useRetainedDraft<VoicePreservation[]>(retentionId, [], validPreservationDraft);
  useEffect(() => { onChange(retentionId, draft.value); }, [retentionId, draft.value, onChange]);
  const total = draft.value.reduce((count, row) => count + characters(row.text), 0);
  const issue = preservationError(draft.value, source);
  return <section aria-label="Preservation instructions" style={{ display: "grid", gap: 12 }}>
    <h3>What must stay? <span className="writing-voice__muted">Optional</span></h3>
    <p className="writing-voice__muted">Record facts, who knows what, unresolved questions, exact wording or the ending beat to preserve. These instructions accompany every direction and later refinement; they do not establish Canon.</p>
    {(draft.value.length > 0 || draft.alternatives.length > 0) && <RecoveryNotice draft={draft} label="preservation instructions" />}
    {!draft.value.length && draft.warning && <p role="alert">{draft.warning}</p>}
    {draft.value.map((row, index) => <div key={index} style={{ display: "grid", gap: 8, padding: 12, border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
      <label>Preservation kind {index + 1}<select className="input" disabled={disabled} value={row.kind} onChange={(event) => draft.change((old) => old.map((value, item) => item === index ? { ...value, kind: event.target.value as VoicePreservation["kind"] } : value))}>
        {Object.entries(preservationKinds).map(([kind, label]) => <option value={kind} key={kind}>{label}</option>)}
      </select></label>
      <label>Preservation instruction {index + 1}<textarea className="input" rows={2} maxLength={Math.min(400, 3000 - total + characters(row.text))} disabled={disabled} value={row.text} onChange={(event) => draft.change((old) => old.map((value, item) => item === index ? { ...value, text: event.target.value } : value))} /></label>
      <button className="btn btn--sm" disabled={disabled} onClick={() => draft.change((old) => old.filter((_, item) => item !== index))}>Remove preservation instruction {index + 1}</button>
    </div>)}
    {issue && <p role="alert">{issue}</p>}
    <p className="writing-voice__muted">{draft.value.length}/12 instructions · {total}/3,000 characters · up to 400 per instruction</p>
    <button className="btn btn--sm" disabled={disabled || draft.value.length >= 12 || total >= 3000} onClick={() => draft.change((old) => [...old, { kind: "fact", text: "" }])}>Add preservation instruction</button>
  </section>;
}

export function SavedVoicePreservation({ rows }: { rows: VoicePreservation[] }) {
  if (!rows.length) return null;
  return <section aria-label="Saved preservation instructions" className="writing-voice__reference">
    <h3>Preserve in this comparison</h3>
    <p className="writing-voice__muted">Saved with this original passage. Refinement and Change Set review keep these same instructions. Compare the prose yourself; a generator's claim is not verification.</p>
    <dl>{rows.map((row, index) => <div key={index}>
      <dt><strong>{preservationKinds[row.kind]}</strong></dt><dd style={{ margin: "4px 0 12px", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{row.text}</dd>
    </div>)}</dl>
  </section>;
}
