import { useEffect, useState } from "react";
import { previewChatContext, type ChatContextPreview, type ChatSendPayload, type MemoryApproval } from "../../api";

type Props = {
  projectRoot: string;
  payload: ChatSendPayload;
  historyBeforeMessageId?: string;
  onSend: (payload: ChatSendPayload) => Promise<boolean>;
  onClose: () => void;
};

export function ChatContextReview({ projectRoot, payload, historyBeforeMessageId, onSend, onClose }: Props) {
  const [approvals, setApprovals] = useState<MemoryApproval[]>([]);
  const [preview, setPreview] = useState<ChatContextPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void previewChatContext(projectRoot, { ...payload, memoryApprovals: approvals }, historyBeforeMessageId).then(result => {
      if (active) setPreview(result);
    }).catch(cause => {
      if (active) { setPreview(null); setError(cause instanceof Error ? cause.message : String(cause)); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectRoot, payload, approvals, historyBeforeMessageId, revision]);

  const hasGrant = (id: string, key?: string) => approvals.some(grant => grant.entity_id === id && grant.detail_key === key);
  function toggleGrant(id: string, key: string | undefined, checked: boolean) {
    // Changing permission invalidates the old preview immediately, before effects run.
    setLoading(true);
    setApprovals(current => checked
      ? [...current, key === undefined ? { entity_id: id } : { entity_id: id, detail_key: key }]
      : current.filter(grant => grant.entity_id !== id || (key !== undefined && grant.detail_key !== key)));
  }
  async function send() {
    if (!preview || loading || sending) return;
    setSending(true);
    try {
      if (await onSend({ ...payload, memoryApprovals: approvals, expectedContextFingerprint: preview.fingerprint })) onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setSending(false); }
  }

  return <section aria-label="Review AI context" className="chat-context-review">
    <header><h3>Review AI context</h3><button className="btn" disabled={sending} onClick={onClose}>Back to message</button></header>
    <p className="chat-context-review__prompt">{payload.message}</p>
    <p>Nothing is sent until you choose Send. Private Memory notes and excluded fields are never included. These settings do not redact facts you wrote in scene text or your message.</p>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">Updating context…</p>}
    {preview && <>
      <p className="chat-context-review__count">{preview.provider} / {preview.model} · about {preview.estimated_input_tokens.toLocaleString()} input tokens before tool results. This is an estimate, not a price quote.</p>
      {preview.mode === "agent" && <p>Agent mode can read additional scenes and permitted Memory during this turn. The preview below is its initial context; tool results appear in the conversation.</p>}
      <h4>Included scenes</h4>
      <ul>{[...preview.context.current_scene, ...preview.context.nearby_scenes].map(scene => <li key={scene.id}>{scene.title || scene.id}</li>)}</ul>
      {!preview.context.current_scene.length && !preview.context.nearby_scenes.length && <p>No full scenes included.</p>}
      {preview.context.story_plan && <>
        <h4>Saved story guidance</h4>
        <p>{Object.entries(preview.context.story_plan.brief).filter(([, value]) => value.length > 0).map(([key]) => key.replace(/_/g, " ")).join(", ") || "No brief or style guide saved yet."}</p>
        <p>{preview.context.story_plan.structure.flatMap(act => act.chapters.map(chapter => chapter.title)).join(" · ") || "No relevant chapters."} {preview.context.story_plan.beats.length} scene beats included.</p>
        {(preview.context.story_plan.limits.clipped_fields.length > 0 || preview.context.story_plan.limits.omitted_chapters > 0 || preview.context.story_plan.limits.omitted_relevant_beats > 0) && <p role="status">Guidance reached its context limit. Clipped fields: {preview.context.story_plan.limits.clipped_fields.join(", ") || "none"}. Omitted: {preview.context.story_plan.limits.omitted_chapters} chapters and {preview.context.story_plan.limits.omitted_relevant_beats} relevant beats. Inspect the exact payload below.</p>}
      </>}
      <h4>Story Memory</h4>
      <p>“Ask first” permission lasts for this turn and its retries only. It does not change the entry’s saved privacy setting.</p>
      <fieldset disabled={loading || sending}>
        {preview.memory_choices.map(entry => {
          const included = preview.context.codex_entities.some(row => row.id === entry.id);
          const parentAllowed = entry.visibility === "include" || hasGrant(entry.id);
          return <div key={entry.id} className="chat-context-review__entry">
            {entry.visibility === "ask" ? <label><input type="checkbox" aria-label={`Allow ${entry.name} for this turn`} checked={hasGrant(entry.id)} onChange={event => toggleGrant(entry.id, undefined, event.target.checked)} />{entry.name} · ask first</label>
              : <p>{entry.name} · {entry.visibility === "exclude" ? "excluded" : included ? "included" : "not selected"}</p>}
            {entry.visibility !== "exclude" && entry.details.filter(detail => detail.visibility === "ask").map(detail => <label key={detail.key} className="chat-context-review__detail">
              <input type="checkbox" aria-label={`Allow ${entry.name}: ${detail.key} for this turn`} disabled={!parentAllowed} checked={hasGrant(entry.id, detail.key)} onChange={event => toggleGrant(entry.id, detail.key, event.target.checked)} />{detail.key} · ask first
            </label>)}
          </div>;
        })}
      </fieldset>
      {!preview.memory_choices.length && <p>No Memory entries saved yet.</p>}
      <h4>Retrieved passages</h4>
      {preview.context.retrieval.citations.length ? <ul>{preview.context.retrieval.citations.map((citation, index) => <li key={index}>{citation.source_title}</li>)}</ul> : <p>No retrieved passages.</p>}
      {preview.context.retrieval.degraded && <p role="status">Retrieval unavailable: {preview.context.retrieval.error}</p>}
      {preview.context.retrieval.index?.stale && <p role="status">The retrieval index is out of date. Changed, restricted, or unverified sources are omitted until the index is rebuilt.</p>}
      <h4>Conversation history</h4>
      <p>{preview.history_messages_included} provider history messages included within the history budget.</p>
      {preview.context_used.privacy.history_reset && <p>Earlier replies stay on this device but are not being resent because Memory changed or one-time permission expired. This cannot remove information already sent to a provider.</p>}
      {preview.history_budget_limited && <p>Some earlier messages are outside the context window. They remain in this conversation; they have not been summarized.</p>}
      <details><summary>Inspect exact initial prompts and history</summary><pre>{JSON.stringify({ system: preview.system_prompt, user: preview.user_prompt, history: preview.history }, null, 2)}</pre></details>
    </>}
    <footer>
      <button className="btn" disabled={loading || sending} onClick={() => setRevision(value => value + 1)}>Refresh preview</button>
      <button className="btn btn--ai" disabled={!preview || loading || sending} onClick={() => void send()}>{sending ? "Sending…" : "Send reviewed context"}</button>
    </footer>
  </section>;
}
