import { useState } from "react";
import { createPortableBackup, pickExportTarget, pickFolder, pickZipFile, restorePortableBackup } from "../api";
import { flushProjectSceneSaves } from "../sceneSaveSession";

const controlStyle = { minHeight: 40, minWidth: 40 };

function PathField({ label, value, onChange, onBrowse, disabled }: {
  label: string; value: string; onChange: (value: string) => void;
  onBrowse: () => Promise<void>; disabled: boolean;
}) {
  return <label style={{ display: "grid", gap: 6, marginTop: 12 }}>
    <span>{label}</span>
    <span style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <input className="input input--mono" aria-label={label} value={value} onChange={event => onChange(event.target.value)} disabled={disabled} style={{ ...controlStyle, flex: "1 1 200px" }} />
      <button type="button" className="btn btn--ghost" aria-label={`Browse ${label.toLowerCase()}`} disabled={disabled} onClick={() => void onBrowse()} style={controlStyle}>Browse</button>
    </span>
  </label>;
}

export function BackupCreate({ projectRoot, setError, setMessage }: {
  projectRoot: string; setError: (value: string) => void; setMessage: (value: string) => void;
}) {
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  async function browse() {
    try { const selected = await pickExportTarget("backup", target); if (selected) setTarget(selected); }
    catch (error) { setError(String(error)); }
  }
  async function create() {
    setBusy(true);
    setError("");
    try {
      if (!await flushProjectSceneSaves(projectRoot)) throw new Error("Save your pending writing before creating a backup.");
      const report = await createPortableBackup(projectRoot, target.trim());
      if (!report.verified) throw new Error("Backup verification did not succeed.");
      setMessage(`Verified backup saved to ${report.path}. Keep a copy on a separate drive.`);
    } catch (error) { setError(`Backup failed: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  }
  return <section className="settings-editor__section">
    <h3 className="settings-editor__section-title">Portable Backup</h3>
    <p className="settings-editor__note">Save prose, Plan, Story Memory, Revisions, and Storylines together. Archives are not encrypted and include earlier writing, prompts, and committed branch files. Store them privately. Provider credential stores are not included.</p>
    <PathField label="Backup file" value={target} onChange={setTarget} onBrowse={browse} disabled={busy} />
    <button className="btn btn--primary" disabled={busy || !target.trim()} onClick={() => void create()} style={{ ...controlStyle, marginTop: 12 }}>{busy ? "Saving and verifying…" : "Create verified backup"}</button>
  </section>;
}

export function BackupRestore({ onRestored, setError }: {
  onRestored: (root: string) => Promise<boolean>; setError: (value: string) => void;
}) {
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  async function browse(kind: "source" | "target") {
    try {
      const selected = kind === "source" ? await pickZipFile(source) : await pickFolder(target);
      if (selected) (kind === "source" ? setSource : setTarget)(selected);
    } catch (error) { setError(String(error)); }
  }
  async function restore() {
    setBusy(true);
    setError("");
    try {
      const report = await restorePortableBackup(source.trim(), target.trim());
      if (!report.verified) throw new Error("Recovery verification did not succeed.");
      if (!await onRestored(report.project_root)) throw new Error(`Book recovered at ${report.project_root}, but opening it failed. Use Open Project to retry.`);
    } catch (error) { setError(`Recovery failed: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  }
  return <section aria-label="Backup recovery">
    <p>Restore a trusted openAuthor backup into a new or empty folder. Existing books are never overwritten. Every archived file is checked before recovery.</p>
    <PathField label="Backup to restore" value={source} onChange={setSource} onBrowse={() => browse("source")} disabled={busy} />
    <PathField label="Recovery folder" value={target} onChange={setTarget} onBrowse={() => browse("target")} disabled={busy} />
    <button className="btn btn--primary" disabled={busy || !source.trim() || !target.trim()} onClick={() => void restore()} style={{ ...controlStyle, marginTop: 12 }}>{busy ? "Verifying and restoring…" : "Verify and restore"}</button>
  </section>;
}
