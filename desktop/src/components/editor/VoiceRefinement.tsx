import { useEffect, useRef, useState } from "react";
import { writingVoiceAction, type VoicePreview } from "../../api";
import { useRetainedDraft } from "../../hooks/useRetainedDraft";
import { retentionKey } from "../../workspaceRetention";
import { RecoveryNotice } from "./RecoveryNotice";

const validFeedback = (value: unknown): value is string => typeof value === "string" && value.length <= 2000;

type Props = {
  project: string; scope: string; previewId: string; direction: VoicePreview["directions"][number];
  preservationFingerprint?: string;
  provider: string; model: string; disabled: boolean; onBusy: (value: boolean) => void; onRefined: (value: VoicePreview) => void;
};
export function VoiceRefinement(props: Props) {
  return <RetainedVoiceRefinement key={JSON.stringify([props.project, props.scope, props.previewId, props.direction.id])} {...props} />;
}
function RetainedVoiceRefinement({ project, scope, previewId, preservationFingerprint, direction, provider, model, disabled, onBusy, onRefined }: Props) {
  const feedback = useRetainedDraft(retentionKey(project, scope, `voice-refinement:${previewId}:${direction.id}`), "", validFeedback);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const pending = useRef(false);
  const identity = JSON.stringify([project, scope, previewId, direction.id, preservationFingerprint]);
  const activeIdentity = useRef(identity);
  activeIdentity.current = identity;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function refine() {
    if (disabled || pending.current || !feedback.value.trim()) return;
    const owner = identity;
    const submitted = feedback.value;
    const current = () => mounted.current && activeIdentity.current === owner;
    pending.current = true;
    onBusy(true); setError("");
    try {
      const result = await writingVoiceAction<VoicePreview>(project, "refine", {
        preview_id: previewId, direction_id: direction.id, feedback: submitted, provider, model,
        ...(preservationFingerprint ? { expected_preservation_fingerprint: preservationFingerprint } : {}),
      });
      if (!current()) return;
      feedback.change((value) => value === submitted ? "" : value);
      onRefined(result);
    } catch (reason) { if (current()) setError(String(reason)); }
    finally { pending.current = false; if (current()) onBusy(false); }
  }
  return <details open={feedback.restored || undefined}>
    <summary>Refine this sample</summary>
    <p className="writing-voice__muted">Keep what works; describe what should change. The original passage remains the story reference. This saves a separate attempt, not a manuscript edit.</p>
    {(feedback.value || feedback.alternatives.length > 0) && <RecoveryNotice draft={feedback} label="revision feedback" />}
    {!feedback.value && feedback.warning && <p role="alert">{feedback.warning}</p>}
    <label>Revision feedback<textarea className="input" maxLength={2000} rows={3} disabled={disabled} value={feedback.value} onChange={(event) => feedback.change(event.target.value)} placeholder="Keep the dry humor. Remove the extra exchange at the end; let the bread carry the pressure." /></label>
    {!!direction.author_review.notes && <button className="btn btn--sm" disabled={disabled || direction.author_review.notes.length > 2000} onClick={() => feedback.change(direction.author_review.notes)}>Use saved assessment notes</button>}
    {direction.author_review.notes.length > 2000 && <p className="writing-voice__muted">Shorten or copy the relevant assessment notes into the 2,000-character feedback field.</p>}
    <p className="writing-voice__muted">{provider === "local" ? "Local mode returns the original as a baseline; choose an AI writing provider above for a creative revision." : `Uses ${provider}${model ? ` · ${model}` : ""} for one sample. Existing provider budgets apply.`}</p>
    {error && <p role="alert">{error}</p>}
    <button className="btn" disabled={disabled || !feedback.value.trim()} onClick={() => void refine()}>Generate refined sample</button>
  </details>;
}
