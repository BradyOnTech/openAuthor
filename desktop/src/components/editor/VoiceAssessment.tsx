import { useEffect, useState } from "react";
import { getWritingVoiceWorkspace, writingVoiceAction, type VoicePreview } from "../../api";
import { useRetainedDraft } from "../../hooks/useRetainedDraft";
import { retentionKey } from "../../workspaceRetention";
import { RecoveryNotice } from "./RecoveryNotice";

type Review = VoicePreview["directions"][number]["author_review"];
type Draft = { review: Review; baseline: Review } | null;
function isReview(value: unknown): value is Review {
  const row = value as Review;
  return !!row && typeof row.notes === "string" && row.notes.length <= 3000 && !!row.ratings && typeof row.ratings === "object" && !Array.isArray(row.ratings)
    && Object.values(row.ratings).every((value) => ["unreviewed", "works", "needs_revision"].includes(value));
}
function valid(value: unknown): value is Draft {
  const row = value as Exclude<Draft, null>;
  return value === null || (!!row && isReview(row.review) && isReview(row.baseline));
}
export function VoiceAssessment({ project, scope, previewId, direction, criteria, onSaved }: {
  project: string; scope: string; previewId: string; direction: VoicePreview["directions"][number];
  criteria: Record<string, string>; onSaved: (value: VoicePreview) => void;
}) {
  const [saved, setSaved] = useState(direction.author_review);
  const draft = useRetainedDraft<Draft>(retentionKey(project, scope, `assessment:${previewId}:${direction.id}`), null, valid);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { setSaved(direction.author_review); }, [JSON.stringify(direction.author_review)]);
  const review = draft.value?.review || saved;
  function edit(change: Partial<Review>) { draft.change((old) => ({ review: { ...(old?.review || saved), ...change }, baseline: old?.baseline || saved })); }
  async function save() {
    if (busy) return;
    const submitted = review;
    setBusy(true); setError("");
    try {
      const result = await writingVoiceAction<VoicePreview>(project, "review", { preview_id: previewId, direction_id: direction.id, review: submitted, expected_review: draft.value?.baseline || saved });
      const actual = result.directions.find((row) => row.id === direction.id)!.author_review;
      setSaved(actual);
      draft.change((old) => old?.review === submitted ? null : old ? { ...old, baseline: actual } : null);
      onSaved(result);
      setMessage("Your assessment was saved with this preview. No voice traits were learned automatically.");
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  return <details open={draft.restored && !!draft.value || undefined}>
    <summary>Your quality assessment</summary>
    {(draft.value || draft.alternatives.length > 0) && <RecoveryNotice draft={draft} label="assessment" />}
    {!draft.value && draft.warning && <p role="alert">{draft.warning}</p>}
    {error && <p role="alert">{error}</p>}
    {draft.value && JSON.stringify(draft.value.baseline) !== JSON.stringify(saved) && <div role="alert">
      <p>The saved assessment differs from the recovered baseline. Review it before choosing to replace it.</p>
      <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(saved, null, 2)}</pre>
      <button className="btn" onClick={() => draft.change((old) => old && ({ ...old, baseline: saved }))}>I reviewed the saved assessment; keep my draft for the next save</button>
    </div>}
    {Object.entries(criteria).map(([key, criterion]) => <label key={key}>{criterion}<select className="input" value={review.ratings[key] || "unreviewed"} onChange={(event) => edit({ ratings: { ...review.ratings, [key]: event.target.value } })}>
      <option value="unreviewed">Not judged yet</option><option value="works">Works for this scene</option><option value="needs_revision">Needs revision</option>
    </select></label>)}
    <label>Assessment notes<textarea className="input" maxLength={3000} rows={3} value={review.notes} onChange={(event) => edit({ notes: event.target.value })} /></label>
    <button className="btn" disabled={busy} onClick={() => void save()}>Save assessment</button>
    <button className="btn btn--sm" disabled={busy} onClick={() => {
      void getWritingVoiceWorkspace(project).then((workspace) => {
        const actual = workspace.scope === scope && workspace.previews.find((row) => row.id === previewId)?.directions.find((row) => row.id === direction.id);
        if (!actual) throw new Error("The saved preview is unavailable in this Storyline's recent history. Keep or copy your local assessment.");
        setSaved(actual.author_review);
      }).catch((reason) => setError(String(reason)));
    }}>Compare with saved assessment</button>
    {message && <p role="status">{message}</p>}
  </details>;
}
