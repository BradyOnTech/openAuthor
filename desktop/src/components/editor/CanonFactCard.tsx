import { useEffect, useRef, useState } from "react";
import { updateCanonFact, type CanonFactChanges } from "../../api";
import { useRecoverableDraft } from "../../recoverableDraft";
import type { CanonFact, SceneSummary } from "../../types";
import { MemoryEvidence } from "./ContinuityReview";

const statusLabels = { accepted: "Accepted canon", suggested: "Needs review", rejected: "Withdrawn" };
const draftFrom = (fact: CanonFact): CanonFactChanges => ({ predicate: fact.predicate, value: fact.value, status: fact.status, validity: { ...fact.validity }, evidence: fact.evidence.map((row) => ({ ...row })) });
type CorrectionDraft = { editVersion: string; changes: CanonFactChanges };
const correctionFrom = (fact: CanonFact): CorrectionDraft => ({ editVersion: fact.edit_version || "", changes: draftFrom(fact) });
function validCorrection(value: unknown): value is CorrectionDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as CorrectionDraft;
  const changes = row.changes;
  return typeof row.editVersion === "string" && !!changes && typeof changes === "object"
    && typeof changes.predicate === "string" && typeof changes.value === "string"
    && ["accepted", "suggested", "rejected"].includes(changes.status)
    && !!changes.validity && typeof changes.validity.from_scene_id === "string" && typeof changes.validity.to_scene_id === "string"
    && Array.isArray(changes.evidence) && changes.evidence.length > 0 && changes.evidence.every(item => !!item && typeof item === "object"
      && typeof item.scene_id === "string" && typeof item.excerpt === "string"
      && Number.isInteger(item.start) && item.start >= 0 && Number.isInteger(item.end) && item.end >= item.start
      && (item.attribution === undefined || typeof item.attribution === "string")
      && (item.anchor_text === undefined || typeof item.anchor_text === "string")
      && (item.source_field === undefined || item.source_field === "pov"));
}

export function CanonFactCard({ fact, subjectName, scenes, projectRoot, branch, disabled, onOpenScene, onSaved }: {
  fact: CanonFact;
  subjectName: string;
  scenes: SceneSummary[];
  projectRoot: string;
  branch: string;
  disabled: boolean;
  onOpenScene: (scene: SceneSummary) => void;
  onSaved: (fact: CanonFact) => void;
}) {
  const [editing, setEditing] = useState(false);
  const recovery = useRecoverableDraft(`openauthor.canonCorrection.v1:${JSON.stringify([projectRoot, branch, fact.id])}`, correctionFrom(fact), validCorrection);
  const draft = recovery.value.changes;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const saving = useRef(false);
  const mounted = useRef(false);
  const activeSession = useRef(recovery.session);
  const currentFact = useRef(fact);
  activeSession.current = recovery.session;
  currentFact.current = fact;
  useEffect(() => {
    mounted.current = true;
    setEditing(false); setBusy(false); setError(""); setNotice(""); saving.current = false;
    return () => { mounted.current = false; };
  }, [recovery.session]);
  useEffect(() => { recovery.session.acceptSaved(correctionFrom(fact)); }, [fact, recovery.session]);
  const open = editing || recovery.dirty;
  const stale = open && (!fact.edit_version || fact.edit_version !== recovery.base.editVersion);
  const sceneName = (id: string, fallback: string) => scenes.find((scene) => scene.id === id)?.title || id || fallback;

  function setDraft(changes: CanonFactChanges) { recovery.session.edit({ ...recovery.session.getSnapshot().value, changes }); setNotice(""); }
  function resetDraft() { recovery.session.acceptSaved(correctionFrom(fact)); recovery.session.useSaved(); setError(""); setNotice(""); }
  async function save() {
    if (saving.current || stale || !recovery.base.editVersion) return;
    const session = recovery.session;
    const submitted = session.getSnapshot().value;
    const expectedLatest = session.getSnapshot().latest;
    const baseline = { ...fact, edit_version: session.getSnapshot().base.editVersion };
    saving.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const updated = await updateCanonFact(projectRoot, baseline, submitted.changes);
      if (mounted.current && activeSession.current === session) session.acceptSaved(correctionFrom(currentFact.current));
      const acknowledged = session.saved(submitted, correctionFrom(updated), expectedLatest);
      if (mounted.current && activeSession.current === session) {
        if (acknowledged) { setEditing(false); onSaved(updated); }
        else setNotice("The correction was saved, and a newer saved fact is now available. Compare it with your correction before making further changes.");
      }
    } catch (reason) {
      if (mounted.current && activeSession.current === session) setError(reason instanceof Error ? reason.message : String(reason));
    } finally { if (mounted.current && activeSession.current === session) { saving.current = false; setBusy(false); } }
  }

  return <article aria-label={`${subjectName}: ${fact.predicate}`} style={{ padding: "var(--space-3)", marginTop: 8, border: "1px solid var(--border)", borderRadius: "var(--radius-md)", color: "var(--text-primary)" }}>
    <strong>{subjectName} · {fact.predicate}</strong>
    <p style={{ color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>{fact.value}</p>
    <p style={smallText}>{statusLabels[fact.status]} · {sceneName(fact.validity.from_scene_id, "beginning")} → {sceneName(fact.validity.to_scene_id, "ongoing")}</p>
    {fact.status !== "accepted" && <p style={smallText}>Excluded from new Copilot canon context and fact-based continuity checks. Earlier conversations retain their original context.</p>}
    <MemoryEvidence evidence={fact.evidence} scenes={scenes} onOpenScene={onOpenScene} />
    {recovery.error && <p role="alert">{recovery.error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!open ? <button className="btn btn--sm" style={{ marginTop: 10 }} disabled={disabled || !fact.edit_version} onClick={() => { setError(""); setEditing(true); }}>Correct or withdraw fact</button> : <div style={{ marginTop: 12 }}>
      <p style={smallText}>Correct this Memory entry without rewriting the manuscript. Withdraw an outdated fact to stop using it as canon; its text and sources remain available here.</p>
      {!recovery.error && <p aria-live="polite" style={smallText}>{recovery.recovered && recovery.dirty ? "Recovered unsaved correction. Review and save when ready." : recovery.dirty ? "Unsaved correction · recovery copy stored on this device." : "No unsaved correction."}</p>}
      {error && <p role="alert">{error} Your entered correction is still here.</p>}
      {stale && <div role="alert"><p>The saved fact changed. Compare the saved value above with your correction below.</p><div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button className="btn btn--sm" disabled={busy || disabled} onClick={resetDraft}>Discard these edits and use the saved fact</button>
        <button className="btn btn--sm" disabled={busy || disabled || !fact.edit_version} onClick={() => { recovery.session.acceptSaved(correctionFrom(fact)); recovery.session.keepDraft(); setError(""); }}>Keep correction after reviewing saved fact</button>
      </div></div>}
      <fieldset disabled={busy || disabled} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <label style={fieldStyle}>Predicate<input className="input" value={draft.predicate} onChange={(event) => setDraft({ ...draft, predicate: event.target.value })} /></label>
        <label style={fieldStyle}>Value<textarea className="input" rows={3} value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} /></label>
        <label style={fieldStyle}>Canon status<select className="select" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as CanonFact["status"] })}>
          {Object.entries(statusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
        </select></label>
        {(["from_scene_id", "to_scene_id"] as const).map((boundary) => <label key={boundary} style={fieldStyle}>{boundary === "from_scene_id" ? "True from" : "True until"}<select className="select" value={draft.validity[boundary]} onChange={(event) => setDraft({ ...draft, validity: { ...draft.validity, [boundary]: event.target.value } })}>
          <option value="">{boundary === "from_scene_id" ? "Beginning" : "Ongoing"}</option>
          {draft.validity[boundary] && !scenes.some((scene) => scene.id === draft.validity[boundary]) && <option value={draft.validity[boundary]}>Unavailable scene: {draft.validity[boundary]}</option>}
          {scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}
        </select></label>)}
        {draft.evidence.map((item, index) => <div key={index}>
          <label style={fieldStyle}>Source scene {index + 1}<select className="select" value={item.scene_id} onChange={(event) => setDraft({ ...draft, evidence: draft.evidence.map((row, rowIndex) => rowIndex === index ? { ...row, scene_id: event.target.value } : row) })}>
            {!scenes.some((scene) => scene.id === item.scene_id) && <option value={item.scene_id}>Unavailable scene: {item.scene_id}</option>}
            {scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}
          </select></label>
          <label style={fieldStyle}>Supporting passage {index + 1}<textarea className="input" rows={3} value={item.excerpt} onChange={(event) => setDraft({ ...draft, evidence: draft.evidence.map((row, rowIndex) => rowIndex === index ? { ...row, excerpt: event.target.value } : row) })} /></label>
        </div>)}
        <p style={smallText}>Accepted corrections require exact passages from the current saved scenes. A matching passage still needs your judgment about what it establishes.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button className="btn btn--primary btn--sm" disabled={stale || !recovery.base.editVersion || !draft.predicate.trim() || !draft.value.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Save fact correction"}</button>
          <button className="btn btn--sm" onClick={() => { resetDraft(); setEditing(false); }}>Cancel correction</button>
        </div>
      </fieldset>
    </div>}
  </article>;
}

const smallText = { color: "var(--text-secondary)", fontSize: "var(--text-xs)", lineHeight: 1.5 } as const;
const fieldStyle = { display: "grid", gap: 5, margin: "10px 0", fontSize: "var(--text-sm)" } as const;
