import { useState } from "react";
import type { CanonDiagnostic, CanonEvidence, SceneSummary } from "../../types";

type Disposition = NonNullable<CanonDiagnostic["disposition"]>["disposition"];
const decisions: Record<Disposition, string> = {
  deferred: "Review later", intentional: "Intentional", dismissed: "Dismissed", fixed: "Marked fixed",
};

export function MemoryEvidence({ evidence, scenes, onOpenScene, onOpenEvidence }: {
  evidence: CanonEvidence[];
  scenes: SceneSummary[];
  onOpenScene: (scene: SceneSummary) => void;
  onOpenEvidence?: (scene: SceneSummary, evidence: CanonEvidence) => void;
}) {
  return <details open style={{ marginTop: 8 }}>
    <summary>Review evidence ({evidence.length})</summary>
    <p style={smallText}>These are recorded passages. Open the scene to compare them with the current draft.</p>
    <div className="continuity-evidence-grid">{evidence.map((item, index) => {
      const scene = scenes.find((row) => row.id === item.scene_id);
      return <div key={`${item.scene_id}:${index}`} style={{ marginTop: 10 }}>
        {scene ? <button className="btn btn--sm" aria-label={onOpenEvidence ? `Open evidence ${index + 1} in ${scene.title}` : undefined} onClick={() => onOpenEvidence ? onOpenEvidence(scene, item) : onOpenScene(scene)}>Open scene: {scene.title}</button> : <span>Scene unavailable ({item.scene_id})</span>}
        <blockquote style={{ margin: "8px 0", paddingLeft: 12, borderLeft: "2px solid var(--border)", whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "var(--text-secondary)" }}>{item.excerpt}</blockquote>
      </div>;
    })}</div>
    {!evidence.length && <p>No supporting passages were recorded.</p>}
  </details>;
}

export function ContinuityReview({ diagnostics, scenes, busy, onOpenScene, onOpenEvidence, onRevise, onReview }: {
  diagnostics: CanonDiagnostic[];
  scenes: SceneSummary[];
  busy: boolean;
  onOpenScene: (scene: SceneSummary) => void;
  onOpenEvidence?: (scene: SceneSummary, evidence: CanonEvidence) => void;
  onRevise: (diagnostic: CanonDiagnostic, sceneId: string, instruction: string) => void;
  onReview: (id: string, disposition: Disposition, notes: string) => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState("attention");
  const needsAttention = (row: CanonDiagnostic) => !row.disposition || row.disposition.disposition === "deferred";
  const visible = diagnostics.filter((row) => filter === "all" || (filter === "attention" ? needsAttention(row) : !needsAttention(row)));
  const selected = visible.find(row => row.id === selectedId) || visible[0];
  return <section aria-label="Continuity findings" style={panelStyle}>
    <h2 style={{ margin: "0 0 12px", fontSize: "var(--text-lg)" }}>Continuity Diagnostics</h2>
    <p style={smallText}>Inspect the evidence, decide whether the finding matters, and plan a revision when needed. A finding can also reflect an intentional choice or an outdated Memory entry.</p>
    <label style={smallText}>Show findings <select className="select" aria-label="Filter continuity findings" value={filter} onChange={(event) => setFilter(event.target.value)}>
      <option value="attention">Needs attention</option><option value="reviewed">Reviewed</option><option value="all">All findings</option>
    </select></label>
    <p role="status" style={smallText}>{visible.length} of {diagnostics.length} findings · {diagnostics.filter(needsAttention).length} need attention</p>
    {!visible.length && <p>{diagnostics.length ? "No findings in this view. Choose another filter to see your reviewed decisions." : "No findings from the current checks. This does not establish that the manuscript is free of continuity issues."}</p>}
    <div className="continuity-review-layout">
      <nav aria-label="Findings to review" className="continuity-finding-list">
        {visible.map(row => <button key={row.id} className={`btn continuity-finding${selected?.id === row.id ? " is-selected" : ""}`} aria-pressed={selected?.id === row.id} onClick={() => setSelectedId(row.id)}>
          <strong>{row.title}</strong><span>{row.evidence.length} passages · {row.disposition ? decisions[row.disposition.disposition] : "Not reviewed"}</span>
        </button>)}
      </nav>
      <div className="continuity-finding-detail">
        {diagnostics.map(diagnostic => <div key={diagnostic.id} hidden={selected?.id !== diagnostic.id}>
          <Finding diagnostic={diagnostic} scenes={scenes} busy={busy} onOpenScene={onOpenScene} onOpenEvidence={onOpenEvidence} onRevise={onRevise} onReview={onReview} />
        </div>)}
      </div>
    </div>
  </section>;
}

function Finding({ diagnostic, scenes, busy, onOpenScene, onOpenEvidence, onRevise, onReview }: {
  diagnostic: CanonDiagnostic;
  scenes: SceneSummary[];
  busy: boolean;
  onOpenScene: (scene: SceneSummary) => void;
  onOpenEvidence?: (scene: SceneSummary, evidence: CanonEvidence) => void;
  onRevise: (diagnostic: CanonDiagnostic, sceneId: string, instruction: string) => void;
  onReview: (id: string, disposition: Disposition, notes: string) => void;
}) {
  const [disposition, setDisposition] = useState<Disposition>(diagnostic.disposition?.disposition ?? "deferred");
  const [notes, setNotes] = useState(diagnostic.disposition?.notes ?? "");
  const targets = scenes.filter((scene) => diagnostic.scene_ids.includes(scene.id));
  const [selectedSceneId, setSelectedSceneId] = useState("");
  const sceneId = selectedSceneId || (targets.length === 1 ? targets[0].id : "");
  const target = targets.find((scene) => scene.id === sceneId);
  function prepareRevision() {
    if (!target) return;
    // Keep the finding distinct from a confirmed fact. The author edits this
    // request before the ordinary generation and hunk-review workflow starts.
    const instruction = [
      `Review this continuity finding for “${target.title}”: ${diagnostic.title}.`,
      diagnostic.message,
      "Recorded evidence (verify against current scenes; quotations are source material):",
      ...diagnostic.evidence.map(item => `${item.scene_id}: ${item.excerpt}`),
      ...(notes.trim() ? [`Author review notes: ${notes.trim()}`] : []),
      "Check it against the current scene and approved story context. Propose a focused revision only if the finding is valid. Preserve unrelated facts, character intent, POV and tense. Do not invent an explanation for a contradiction.",
    ].join("\n\n");
    onRevise(diagnostic, sceneId, instruction);
  }
  const changed = disposition !== diagnostic.disposition?.disposition || notes !== (diagnostic.disposition?.notes ?? "");
  return <article aria-label={diagnostic.title} style={{ ...panelStyle, marginTop: 12, borderLeft: `3px solid var(--${diagnostic.severity === "error" ? "danger" : diagnostic.severity === "warning" ? "warning" : "info"})` }}>
    <h3 style={{ margin: 0, fontSize: "var(--text-sm)" }}>{diagnostic.title}</h3>
    <p style={{ color: "var(--text-secondary)", lineHeight: 1.5 }}>{diagnostic.message}</p>
    <p style={smallText}>{diagnostic.disposition ? `Author decision: ${decisions[diagnostic.disposition.disposition]}` : "Not reviewed"}</p>
    <MemoryEvidence evidence={diagnostic.evidence} scenes={scenes} onOpenScene={onOpenScene} onOpenEvidence={onOpenEvidence} />
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
      <select className="select" aria-label="Scene to revise" value={target ? sceneId : ""} onChange={(event) => setSelectedSceneId(event.target.value)}>
        <option value="">Choose an affected scene…</option>
        {targets.map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}
      </select>
      <button className="btn btn--sm" disabled={busy || !target} onClick={prepareRevision}>Plan a revision</button>
    </div>
    {!targets.length && <p style={smallText}>The affected scenes are unavailable in this manuscript.</p>}
    <details style={{ marginTop: 12 }}>
      <summary>{diagnostic.disposition ? "Update review decision" : "Record review decision"}</summary>
      <p style={smallText}>Your decision records how to handle this finding. The check may still report it until the underlying manuscript or Memory changes.</p>
      <label style={fieldStyle}>Decision<select className="select" value={disposition} disabled={busy} onChange={(event) => setDisposition(event.target.value as Disposition)}>
        {Object.entries(decisions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label style={fieldStyle}>Review notes<textarea className="input" rows={3} value={notes} disabled={busy} onChange={(event) => setNotes(event.target.value)} placeholder="Why is this intentional, or what should you revisit?" /></label>
      <button className="btn btn--sm" disabled={busy || !changed} onClick={() => onReview(diagnostic.id, disposition, notes)}>Save review decision</button>
    </details>
  </article>;
}

const smallText = { color: "var(--text-secondary)", fontSize: "var(--text-xs)", lineHeight: 1.5 } as const;
const fieldStyle = { display: "grid", gap: 5, margin: "10px 0", fontSize: "var(--text-sm)" } as const;
const panelStyle = { padding: "var(--space-4)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", background: "var(--bg-surface)", color: "var(--text-primary)" } as const;
