type Props = {
  dirty: boolean;
  recovered: boolean;
  error: string;
  conflict: boolean;
  onUseSaved: () => void;
  onKeepDraft: () => void;
};

export function DraftStatus({ dirty, recovered, error, conflict, onUseSaved, onKeepDraft }: Props) {
  return <div aria-live="polite" style={{ marginBottom: "var(--space-3)", fontSize: "var(--text-sm)", color: error || conflict ? "var(--warning-text)" : "var(--text-secondary)" }}>
    {error || (conflict ? "The saved version changed while this draft was open. Review before replacing it." : recovered && dirty ? "Recovered unsaved draft. Review and save when ready." : dirty ? "Unsaved changes · recovery copy stored on this device." : "Saved")}
    {conflict && <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
      <button className="btn" style={{ minHeight: 40 }} onClick={onUseSaved}>Use saved version</button>
      <button className="btn" style={{ minHeight: 40 }} onClick={onKeepDraft}>Keep my draft</button>
    </div>}
  </div>;
}
