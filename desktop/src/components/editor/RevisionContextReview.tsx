import { useEffect, useState } from "react";
import { previewProposalRevision, type MemoryApproval, type RevisionAuthorization, type RevisionContextPreview } from "../../api";
import { flushProjectSceneSaves } from "../../sceneSaveSession";
import type { ProposalProvider } from "../../types";
import { StoryContextChoices } from "../common/StoryContextChoices";

type Props = {
  projectRoot: string; proposalId: string; hunkId?: string; provider: ProposalProvider; model?: string; feedback?: string;
  closeLabel?: string;
  onSend: (authorization: RevisionAuthorization) => Promise<void>;
  onClose: () => void;
};

export function RevisionContextReview({ projectRoot, proposalId, hunkId, provider, model, feedback = "", closeLabel = "Back to Change Set", onSend, onClose }: Props) {
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
      return previewProposalRevision(projectRoot, {
        proposal_id: proposalId, hunk_id: hunkId, provider, model, feedback,
        memory_approvals: memoryApprovals, story_approvals: storyApprovals,
      });
    }).then(result => { if (current) setPreview(result); })
      .catch(cause => { if (current) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [projectRoot, proposalId, hunkId, provider, model, feedback, memoryApprovals, storyApprovals, revision]);
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
  const title = hunkId ? "Review passage revision context" : "Review scene draft context";
  return <section className="revision-context-review" aria-label={title}>
    <h3>{title}</h3>
    <p>{hunkId ? "This passage" : "This scene draft"} is not sent until you confirm. Saved story guidance, {hunkId ? "the selected original and candidate" : "the complete scene and its edit plan"}, and permitted Memory are included. No other full scenes, chat history or private notes are sent. Approved Canon can contain evidence quotes from other scenes; manuscript text is not automatically redacted.</p>
    {feedback && <p className="revision-context-review__feedback">Your direction: {feedback}</p>}
    {loading && <p role="status">Updating context…</p>}
    {error && <p role="alert">{error} You can remove permissions below, refresh, or return to the Change Set.</p>}
    {preview && <>
      <p>Scene: {preview.context.scene.title || preview.context.scene.id}</p>
      <p className="revision-context-review__count">{preview.provider} / {preview.model} · approximately {preview.estimated_input_tokens.toLocaleString()} app-context tokens · {preview.max_output_tokens.toLocaleString()} output-token {provider === "openai-codex" ? "target, not a hard limit" : "limit"}. Provider overhead is additional.</p>
      <p>Saved style guidance, relevant chapter/beat context and protected elements appear in the exact payload below.</p>
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
    </>}
    <footer>
      <button className="btn" disabled={loading || sending} onClick={() => { setLoading(true); setRevision(value => value + 1); }}>Refresh preview</button>
      <button className="btn btn--primary" disabled={!fresh || sending} onClick={() => void send()}>{sending ? "Starting…" : hunkId ? "Generate reviewed passage" : "Generate reviewed scene"}</button>
      <button className="btn btn--ghost" disabled={sending} onClick={onClose}>{closeLabel}</button>
    </footer>
  </section>;
}
