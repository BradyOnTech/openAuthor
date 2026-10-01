import { useRef, useState } from "react";
import { updateCanonFact, type CanonFactChanges } from "../../api";
import type { CanonFact, SceneSummary } from "../../types";
import { MemoryEvidence } from "./ContinuityReview";

const statusLabels = { accepted: "Accepted canon", suggested: "Needs review", rejected: "Withdrawn" };
const draftFrom = (fact: CanonFact): CanonFactChanges => ({ predicate: fact.predicate, value: fact.value, status: fact.status, validity: { ...fact.validity }, evidence: fact.evidence.map((row) => ({ ...row })) });

export function CanonFactCard({ fact, subjectName, scenes, projectRoot, disabled, onOpenScene, onSaved }: {
  fact: CanonFact;
  subjectName: string;
  scenes: SceneSummary[];
  projectRoot: string;
  disabled: boolean;
  onOpenScene: (scene: SceneSummary) => void;
  onSaved: (fact: CanonFact) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [baseline, setBaseline] = useState(fact);
  const [draft, setDraft] = useState(() => draftFrom(fact));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const stale = editing && fact.edit_version !== baseline.edit_version;
  const sceneName = (id: string, fallback: string) => scenes.find((scene) => scene.id === id)?.title || id || fallback;

  function resetDraft() { setBaseline(fact); setDraft(draftFrom(fact)); setError(""); }
  async function save() {
    if (saving.current || stale) return;
    saving.current = true; setBusy(true); setError("");
    try {
      const updated = await updateCanonFact(projectRoot, baseline, draft);
      setEditing(false);
      onSaved(updated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { saving.current = false; setBusy(false); }
  }

  return <article aria-label={`${subjectName}: ${fact.predicate}`} style={{ padding: "var(--space-3)", marginTop: 8, border: "1px solid var(--border)", borderRadius: "var(--radius-md)", color: "var(--text-primary)" }}>
    <strong>{subjectName} · {fact.predicate}</strong>
    <p style={{ color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>{fact.value}</p>
    <p style={smallText}>{statusLabels[fact.status]} · {sceneName(fact.validity.from_scene_id, "beginning")} → {sceneName(fact.validity.to_scene_id, "ongoing")}</p>
    {fact.status !== "accepted" && <p style={smallText}>Excluded from new Copilot canon context and fact-based continuity checks. Earlier conversations retain their original context.</p>}
    <MemoryEvidence evidence={fact.evidence} scenes={scenes} onOpenScene={onOpenScene} />
    {!editing ? <button className="btn btn--sm" style={{ marginTop: 10 }} disabled={disabled || !fact.edit_version} onClick={() => { resetDraft(); setEditing(true); }}>Correct or withdraw fact</button> : <div style={{ marginTop: 12 }}>
      <p style={smallText}>Correct this Memory entry without rewriting the manuscript. Withdraw an outdated fact to stop using it as canon; its text and sources remain available here.</p>
      {error && <p role="alert">{error} Your entered correction is still here.</p>}
      {stale && <div role="alert"><p>The saved fact changed. Compare the saved value above with your correction below.</p><button className="btn btn--sm" disabled={busy} onClick={resetDraft}>Discard these edits and use the saved fact</button></div>}
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
          <button className="btn btn--primary btn--sm" disabled={stale || !draft.predicate.trim() || !draft.value.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Save fact correction"}</button>
          <button className="btn btn--sm" onClick={() => setEditing(false)}>Cancel correction</button>
        </div>
      </fieldset>
    </div>}
  </article>;
}

const smallText = { color: "var(--text-secondary)", fontSize: "var(--text-xs)", lineHeight: 1.5 } as const;
const fieldStyle = { display: "grid", gap: 5, margin: "10px 0", fontSize: "var(--text-sm)" } as const;
