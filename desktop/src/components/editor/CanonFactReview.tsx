import { useEffect, useRef, useState } from "react";
import { reviewCanonFact } from "../../api";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useRecoverableDraft } from "../../recoverableDraft";
import { flushProjectSceneSaves } from "../../sceneSaveSession";
import type { CanonEvidence, CanonFact } from "../../types";
import { DraftStatus } from "../shared/DraftStatus";
import { EvidencePassages } from "../shared/EvidencePassages";

type EvidenceDraft = { evidence: CanonEvidence[]; updatedAt: string; editVersion?: string };
const toDraft = (fact: CanonFact): EvidenceDraft => ({ evidence: fact.evidence, updatedAt: fact.updated_at || "", editVersion: fact.edit_version || "" });
const validDraft = (value: unknown): value is EvidenceDraft => {
  if (!value || typeof value !== "object") return false;
  const row = value as EvidenceDraft;
  return typeof row.updatedAt === "string" && (row.editVersion === undefined || typeof row.editVersion === "string") && Array.isArray(row.evidence) && row.evidence.length > 0 && row.evidence.every(item => typeof item.scene_id === "string" && typeof item.excerpt === "string" && typeof item.start === "number" && typeof item.end === "number");
};

export function CanonFactReview({ fact, onUpdated }: { fact: CanonFact; onUpdated: () => Promise<void> }) {
  const { projectRoot, branches, scenes, setError, setMessage } = useWorkspace();
  const branch = branches.find(row => row.current)?.name || "main";
  const draft = useRecoverableDraft(`openauthor:canon-evidence:${projectRoot}:${branch}:${fact.id}`, toDraft(fact), validDraft);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const saving = useRef(false), mounted = useRef(false);
  const activeSession = useRef(draft.session), currentFact = useRef(fact);
  activeSession.current = draft.session;
  currentFact.current = fact;
  useEffect(() => {
    mounted.current = true; saving.current = false; setBusy(false); setNotice("");
    return () => { mounted.current = false; };
  }, [draft.session]);
  useEffect(() => { draft.session.acceptSaved(toDraft(fact)); }, [fact, draft.session]);
  const label = `${fact.predicate}: ${fact.value}`;
  const stale = !fact.edit_version || !draft.base.editVersion || fact.edit_version !== draft.base.editVersion || draft.conflict;

  function edit(index: number, changes: Partial<CanonEvidence>) {
    draft.session.edit({ ...draft.value, evidence: draft.value.evidence.map((item, position) => position === index ? { ...item, ...changes, start: 0, end: 0 } : item) });
  }
  async function review(disposition: "accepted" | "rejected") {
    if (saving.current || stale) return;
    const session = draft.session, submitted = session.getSnapshot().value;
    const expectedLatest = session.getSnapshot().latest;
    const expectedVersion = session.getSnapshot().base.editVersion!;
    const isCurrent = () => mounted.current && activeSession.current === session;
    saving.current = true; setBusy(true); setNotice("");
    try {
      if (!await flushProjectSceneSaves(projectRoot)) throw new Error("Save pending manuscript writing before reviewing Canon evidence.");
      const updated = await reviewCanonFact(projectRoot, fact.id, {
        disposition, expectedVersion,
        evidence: disposition === "accepted" ? submitted.evidence : undefined,
      });
      if (disposition === "accepted") {
        if (isCurrent()) session.acceptSaved(toDraft(currentFact.current));
        if (!session.saved(submitted, toDraft(updated), expectedLatest)) {
          if (isCurrent()) setNotice("The evidence was saved, and a newer saved fact is now available. Compare it with your correction before making further changes.");
          return;
        }
      }
      // Retirement leaves an unfinished evidence correction available. The
      // refreshed fact supplies its current authority, never an old response.
      if (!isCurrent()) return;
      await onUpdated();
      if (isCurrent()) {
        setError("");
        setMessage(disposition === "accepted" ? "Canon evidence verified and saved." : "Canon Fact retired. Its evidence and history are preserved.");
      }
    } catch (error) {
      if (isCurrent()) setError(`Canon review failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally { if (isCurrent()) { saving.current = false; setBusy(false); } }
  }

  return <details className="canon-fact-review">
    <summary>Review evidence for {label}</summary>
    <p>{fact.status === "rejected" ? "Retired · excluded from accepted Canon checks" : fact.status === "suggested" ? "Needs author review · excluded from accepted Canon checks" : "Accepted by the author · review source passages before relying on this fact"}</p>
    <EvidencePassages evidence={fact.evidence} />
    <DraftStatus {...draft} onUseSaved={draft.session.useSaved} onKeepDraft={draft.session.keepDraft} />
    {!fact.edit_version && <p role="alert">This fact has no current review version. Run Diagnostics to reload it before reviewing evidence.</p>}
    {draft.dirty && !draft.base.editVersion && fact.edit_version && <p role="alert">This recovered evidence correction has no original Storyline version. Compare it with the saved passages before keeping the draft.</p>}
    {notice && <p role="status">{notice}</p>}
    {draft.value.evidence.map((item, index) => <div key={index} style={{ display: "grid", gap: 8, marginTop: 12 }}>
      <label>Source scene {index + 1}<select className="select" value={item.scene_id} onChange={event => edit(index, { scene_id: event.target.value })}>
        {!scenes.some(scene => scene.id === item.scene_id) && <option value={item.scene_id}>Missing source scene</option>}
        {scenes.map(scene => <option key={scene.id} value={scene.id}>{scene.title}</option>)}
      </select></label>
      <label>Exact supporting passage<textarea className="input" rows={3} aria-label={`Supporting passage${draft.value.evidence.length > 1 ? ` ${index + 1}` : ""} for ${label}`} value={item.excerpt} onChange={event => edit(index, { excerpt: event.target.value })} /></label>
      {draft.value.evidence.length > 1 && <button className="btn btn--sm" onClick={() => draft.session.edit({ ...draft.value, evidence: draft.value.evidence.filter((_, position) => position !== index) })}>Remove passage {index + 1} from draft</button>}
    </div>)}
    <button className="btn btn--sm" style={{ marginTop: 8 }} onClick={() => draft.session.edit({ ...draft.value, evidence: [...draft.value.evidence, { scene_id: scenes[0]?.id || "", excerpt: "", start: 0, end: 0 }] })}>Add supporting passage</button>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
      <button className="btn btn--primary" disabled={busy || stale || draft.value.evidence.some(item => !item.scene_id || !item.excerpt.trim())} onClick={() => void review("accepted")}>{fact.status === "rejected" ? "Restore with verified evidence" : "Save verified evidence"}</button>
      {fact.status !== "rejected" && <button className="btn" disabled={busy || stale} onClick={() => void review("rejected")}>Retire fact</button>}
    </div>
    <p>Saving checks every passage against current prose. Retiring excludes the fact from accepted Canon without erasing it. To change the assertion itself, use Correct or withdraw fact.</p>
  </details>;
}
