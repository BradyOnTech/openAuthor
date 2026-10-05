import { useEffect, useState } from "react";
import { previewMergeResolution, previewProposalGeneration, previewProposalRevision, type MemoryApproval, type RevisionAuthorization, type RevisionContextPreview } from "../../api";
import type { GenerationInput } from "../../proposalGenerationSession";
import type { MergeRequest } from "../../mergeResolutionSession";
import { flushProjectSceneSaves } from "../../sceneSaveSession";
import type { ProposalProvider } from "../../types";
import { StoryContextChoices } from "../common/StoryContextChoices";

type Props = {
  projectRoot: string; proposalId?: string; generationInput?: GenerationInput; hunkId?: string; provider: ProposalProvider; model?: string; feedback?: string;
  closeLabel?: string;
  reviewMode?: "off" | "refine";
  mergeInput?: MergeRequest;
  onSend: (authorization: RevisionAuthorization) => Promise<void>;
  onClose: () => void;
};

export function RevisionContextReview({ projectRoot, proposalId, generationInput, mergeInput, hunkId, provider, model, feedback = "", reviewMode = "off", closeLabel = "Back to Change Set", onSend, onClose }: Props) {
  const [memoryApprovals, setMemoryApprovals] = useState<MemoryApproval[]>([]);
  const [storyApprovals, setStoryApprovals] = useState<string[]>([]);
  const [preview, setPreview] = useState<RevisionContextPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true); setError("");
    void flushProjectSceneSaves(projectRoot).then(saved => {
      if (!saved) throw new Error("Save pending writing before reviewing revision context.");
      if (generationInput) return previewProposalGeneration(projectRoot, generationInput, memoryApprovals, storyApprovals);
      if (mergeInput) return previewMergeResolution(projectRoot, mergeInput, memoryApprovals, storyApprovals);
      if (!proposalId) throw new Error("Choose a Change Set to review.");
      return previewProposalRevision(projectRoot, {
        proposal_id: proposalId, hunk_id: hunkId, provider, model, feedback,
        memory_approvals: memoryApprovals, story_approvals: storyApprovals,
        review_mode: reviewMode,
      });
    }).then(result => { if (current) setPreview(result); })
      .catch(cause => { if (current) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [projectRoot, proposalId, generationInput, mergeInput, hunkId, provider, model, feedback, reviewMode, memoryApprovals, storyApprovals, revision]);
  const fresh = Boolean(preview && !loading && !error);
  const hasGrant = (id: string, key?: string) => memoryApprovals.some(row => row.entity_id === id && row.detail_key === key);
  function toggleMemory(id: string, key: string | undefined, checked: boolean) {
    setLoading(true); setStoryApprovals([]);
    setMemoryApprovals(current => checked ? [...current, key ? { entity_id: id, detail_key: key } : { entity_id: id }]
      : current.filter(row => row.entity_id !== id || (key !== undefined && row.detail_key !== key)));
  }
  async function send() {
    if (!preview || !fresh || sending) return;
    setSending(true);
    try { await onSend({ fingerprint: preview.fingerprint, memoryApprovals, storyApprovals }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSending(false); }
  }
  const title = mergeInput ? "Review reconciliation context" : generationInput ? "Review edit-plan context" : hunkId ? "Review passage revision context" : "Review scene draft context";
  return <section className="revision-context-review" aria-label={title}>
    <h3>{title}</h3>
    <p>{mergeInput ? "This reconciliation" : generationInput ? "This edit plan" : hunkId ? "This passage" : "This scene draft"} is not sent until you confirm. Saved story guidance, {mergeInput ? "both scene revisions and their common ancestor" : generationInput ? "the selected scene, nearby scenes and your revision direction" : hunkId ? "the selected original and candidate" : "the complete scene and its edit plan"}, and permitted Memory are included. {generationInput ? "Any retrieval excerpts are visible in the exact payload below." : "No other full scenes are sent."} No chat history or private notes are sent. Approved Canon can contain evidence quotes from other scenes; manuscript text is not automatically redacted.</p>
    {feedback && <p className="revision-context-review__feedback">Your direction: {feedback}</p>}
    {loading && <p role="status">Updating context…</p>}
    {error && <p role="alert">{error} You can remove permissions below, refresh, or return to the Change Set.</p>}
    {preview && <>
      <p>Scene: {preview.context.scene.title || preview.context.scene.id}</p>
      {preview.context.scene_contract && Object.entries(preview.context.scene_contract).map(([key, value]) => value && <p key={key}>{key === "purpose" ? "Scene purpose" : key === "turn" ? "What changes" : key === "word_range" ? "Word target" : "Where it stops"}: {Array.isArray(value) ? `${value[0]}–${value[1]} words` : value}</p>)}
      {preview.context.writing_craft && <p>This request includes fiction craft guidance for this writing task. The complete guidance is visible in the exact context below.</p>}
      {preview.writing_review && <p>Draft review is enabled: up to {preview.writing_review.maximum_calls} model calls for drafting, critique, focused revision and verification. These stages use the same approved sources and the generated candidates, with source changes highlighted for review. The first draft is retained if review fails or is uncertain. Model review supports your judgment.</p>}
      {generationInput && <p>Nearby scenes: {preview.context.nearby_scenes?.map(scene => scene.title || scene.id).join(", ") || "none"}.</p>}
      {mergeInput && <p>Reconcile {mergeInput.head} into {mergeInput.base}. Story guidance and Memory come from the currently checked-out Storyline: {preview.context.guidance_branch}. Review these sources before confirming.</p>}
      <p className="revision-context-review__count">{preview.provider} / {preview.model} · approximately {preview.estimated_input_tokens.toLocaleString()} app-context tokens · {preview.max_output_tokens.toLocaleString()} output-token {provider === "openai-codex" ? "target, not a hard limit" : "limit"}. Provider overhead is additional.</p>
      <p>Saved style guidance, relevant chapter/beat context and protected elements appear in the exact payload below.</p>
      {preview.style_profile_status && <p>Style Profile: {preview.style_profile_status.freshness === "absent" ? "none selected" : preview.style_profile_status.included ? `${preview.style_profile_status.reference_mode === "frozen" ? "frozen reference" : "current sources"} included` : `${preview.style_profile_status.freshness === "unknown" ? "legacy sources unverified" : "source scenes changed"} — excluded; rebuild or review the profile before using it`}.</p>}
      <p>Guidance clipped: {preview.context.story_plan.limits.clipped_fields.join(", ") || "none"}. Omitted: {preview.context.story_plan.limits.omitted_chapters} chapters, {preview.context.story_plan.limits.omitted_relevant_beats} relevant beats and {preview.limits.omitted_memory_ids.length} permitted Memory entries.</p>
      <details><summary>Story Memory · {preview.memory_choices.length} entries · inspect permissions</summary>
      <fieldset disabled={loading || sending}>
        <legend>Story Memory · this request only</legend>
        {preview.memory_choices.map(entry => <div key={entry.id}>
          {entry.visibility === "ask" ? <label><input type="checkbox" checked={hasGrant(entry.id)} onChange={event => toggleMemory(entry.id, undefined, event.target.checked)} />Allow {entry.name} for this request</label>
            : <p>{entry.name} · {entry.visibility === "exclude" ? "excluded" : preview.context.codex_entities.some(row => row.id === entry.id) ? "included" : "omitted"}</p>}
          {entry.visibility !== "exclude" && entry.details.filter(detail => detail.visibility === "ask").map(detail => <label key={detail.key}><input type="checkbox" disabled={entry.visibility === "ask" && !hasGrant(entry.id)} checked={hasGrant(entry.id, detail.key)} onChange={event => toggleMemory(entry.id, detail.key, event.target.checked)} />Allow {entry.name}: {detail.key} for this request</label>)}
        </div>)}
      </fieldset>
      </details>
      <p>Changing Memory permission clears Canon selections and refreshes their availability. Permissions do not carry into a new request.</p>
      <StoryContextChoices choices={preview.story_choices ?? []} selected={storyApprovals} disabled={loading || sending} reviewed={fresh} onChange={ids => { setLoading(true); setStoryApprovals(ids); }} />
      <details><summary>Exact app-supplied revision context</summary><pre>{preview.system_prompt}</pre><pre>{preview.user_prompt}</pre></details>
      {preview.writing_review && <details><summary>Draft review instructions</summary>{Object.entries(preview.writing_review.systems).map(([stage, instructions]) => <div key={stage}><strong>{stage}</strong><pre>{instructions}</pre></div>)}</details>}
    </>}
    <footer>
      <button className="btn" disabled={loading || sending} onClick={() => { setLoading(true); setRevision(value => value + 1); }}>Refresh preview</button>
      <button className="btn btn--primary" disabled={!fresh || sending} onClick={() => void send()}>{sending ? "Starting…" : mergeInput ? "Generate reviewed reconciliation" : generationInput ? "Generate reviewed edit plan" : hunkId ? "Generate reviewed passage" : "Generate reviewed scene"}</button>
      <button className="btn btn--ghost" disabled={sending} onClick={onClose}>{closeLabel}</button>
    </footer>
  </section>;
}
