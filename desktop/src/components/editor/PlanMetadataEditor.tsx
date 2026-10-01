import { useEffect, useState } from "react";
import { getManuscriptPlan, updatePlanSceneMetadata } from "../../api";
import { useRetainedDraft } from "../../hooks/useRetainedDraft";
import { retentionKey } from "../../workspaceRetention";
import type { ManuscriptPlan } from "../../types";
import { RecoveryNotice } from "./RecoveryNotice";

type Metadata = ManuscriptPlan["scene_metadata"][string];
type Draft = { timeline: string; labels: string; baseline: Metadata } | null;
function valid(value: unknown): value is Draft {
  if (value === null) return true;
  const row = value as Exclude<Draft, null>;
  return !!row && typeof row.timeline === "string" && typeof row.labels === "string"
    && !!row.baseline && typeof row.baseline.timeline_position === "string" && Array.isArray(row.baseline.labels)
    && row.baseline.labels.every((item) => typeof item === "string");
}
export function PlanMetadataEditor({ project, scope, sceneId, title, metadata, onSaved }: { project: string; scope: string; sceneId: string; title: string; metadata?: Metadata; onSaved?: (value: Metadata) => void }) {
  const [saved, setSaved] = useState(metadata || { timeline_position: "", labels: [] });
  const draft = useRetainedDraft<Draft>(retentionKey(project, scope, `plan-metadata:${sceneId}`), null, valid);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { setSaved(metadata || { timeline_position: "", labels: [] }); }, [JSON.stringify(metadata)]);
  const value = draft.value || { timeline: saved.timeline_position, labels: saved.labels.join(", "), baseline: saved };
  async function save() {
    if (busy) return;
    const submitted = value;
    setBusy(true);
    try {
      const result = await updatePlanSceneMetadata(project, sceneId, { timelinePosition: submitted.timeline, labels: submitted.labels.split(",").map((item) => item.trim()).filter(Boolean) }, scope === "legacy" ? undefined : { workspace: scope, value: submitted.baseline });
      setSaved(result);
      onSaved?.(result);
      draft.change((current) => current === submitted ? null : current ? { ...current, baseline: result } : null);
      setMessage("Planning details saved.");
    } catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  }
  return <details onClick={(event) => event.stopPropagation()}>
    <summary>Story time &amp; labels</summary>
    <div style={{ display: "grid", gap: 6, marginTop: 7 }}>
      {draft.value && <RecoveryNotice draft={draft} label="planning details" />}
      {!draft.value && draft.warning && <p role="alert">{draft.warning}</p>}
      <input className="input" aria-label={`Story time for ${title}`} placeholder="Story time, e.g. Day 3 · dusk" value={value.timeline} onChange={(event) => draft.change({ ...value, timeline: event.target.value })} />
      <input className="input" aria-label={`Labels for ${title}`} placeholder="Labels, comma separated" value={value.labels} onChange={(event) => draft.change({ ...value, labels: event.target.value })} />
      <button className="btn btn--sm" disabled={busy} onClick={() => void save()}>Save planning details</button>
      <button className="btn btn--sm" disabled={busy} onClick={() => {
        void getManuscriptPlan(project).then((plan) => {
          if (plan.workspace !== scope && scope !== "legacy") throw new Error("Storyline changed. Reopen Plan in its original Storyline.");
          setSaved(plan.scene_metadata[sceneId] || { timeline_position: "", labels: [] });
        }).catch((error) => setMessage(String(error)));
      }}>Compare with saved details</button>
      {message && <p role="status">{message} If the saved details changed, reopen Plan to compare them; your local copy remains available.</p>}
      {draft.value && <pre style={{ whiteSpace: "pre-wrap" }}>Saved details: {JSON.stringify(saved)}</pre>}
      {draft.value && JSON.stringify(draft.value.baseline) !== JSON.stringify(saved) && <button className="btn" onClick={() => draft.change({ ...value, baseline: saved })}>I reviewed the saved details; keep my draft for the next save</button>}
    </div>
  </details>;
}
