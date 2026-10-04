import { useEffect, useRef, useState } from "react";
import { generateSelection, previewSelection, type MemoryApproval, type SelectionAction, type SelectionInput, type SelectionPreview } from "../../api";
import { useRecoverableDraft } from "../../recoverableDraft";
import { StoryContextChoices } from "../common/StoryContextChoices";
import type { ProposalProvider, ProposalRecord } from "../../types";

type Draft = { input: SelectionInput | null; fingerprint: string; requestId: string };
const empty: Draft = { input: null, fingerprint: "", requestId: "" };
function validDraft(value: unknown): value is Draft {
  if (!value || typeof value !== "object") return false;
  const row = value as Draft;
  return typeof row.fingerprint === "string" && typeof row.requestId === "string" && (row.input === null || (
    typeof row.input === "object" && typeof row.input.scene_id === "string" && Number.isInteger(row.input.start) && Number.isInteger(row.input.end)
    && typeof row.input.selected_text === "string" && ["rewrite", "shorten", "expand", "critique"].includes(row.input.action)
    && typeof row.input.instruction === "string" && typeof row.input.provider === "string" && typeof row.input.model === "string"
    && Array.isArray(row.input.memory_approvals)
    && (row.input.story_approvals === undefined || Array.isArray(row.input.story_approvals) && row.input.story_approvals.every(id => typeof id === "string"))
    && (row.input.review_focus === undefined || ["general", "continuity", "character-knowledge", "motivation", "pacing", "voice"].includes(row.input.review_focus))
    && (row.input.review_scope === undefined || ["passage", "chapter"].includes(row.input.review_scope))
  ));
}

type Props = {
  projectRoot: string; sceneId: string; branch: string;
  selection: { body: string; start: number; end: number } | null;
  disabled: boolean; providers: ProposalProvider[];
  flush: () => Promise<boolean>;
  onResult: (proposal: ProposalRecord) => Promise<void>;
};

export function SelectionAssist(props: Props) {
  return <SelectionAssistSession key={JSON.stringify([props.projectRoot, props.branch, props.sceneId])} {...props} />;
}

function SelectionAssistSession({ projectRoot, sceneId, branch, selection, disabled, providers, flush, onResult }: Props) {
  const draft = useRecoverableDraft(`openauthor.selection.v1:${JSON.stringify([projectRoot, branch, sceneId])}`, empty, validDraft);
  const { input, requestId, fingerprint } = draft.value;
  const [preview, setPreview] = useState<SelectionPreview | null>(null);
  const [choices, setChoices] = useState<Pick<SelectionPreview, "memory_choices" | "story_choices"> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  function choose(action: SelectionAction) {
    if (!selection || pending.current || input) return;
    const text = selection.body.slice(selection.start, selection.end);
    draft.session.edit({ ...empty, input: {
      scene_id: sceneId, start: [...selection.body.slice(0, selection.start)].length, end: [...selection.body.slice(0, selection.end)].length,
      selected_text: text, action, instruction: "", provider: providers.find(value => value !== "local") ?? "local", model: "", memory_approvals: [], story_approvals: [],
      ...(action === "critique" ? { review_focus: "general" as const, review_scope: "passage" as const } : {}),
    } });
    setPreview(null); setChoices(null); setError("");
  }
  function edit(changes: Partial<SelectionInput>) {
    if (!input || requestId || pending.current) return;
    setPreview(null); setError("");
    if (changes.provider) setChoices(null);
    draft.session.edit({ ...empty, input: { ...input, ...changes, ...(changes.provider ? { memory_approvals: [], story_approvals: [] } : {}) } });
  }
  function allow(permission: MemoryApproval, enabled: boolean) {
    if (!input) return;
    let approvals = input.memory_approvals.filter(item => !(item.entity_id === permission.entity_id && (item.detail_key === permission.detail_key || (!permission.detail_key && !enabled))));
    if (enabled) approvals = [...approvals, permission];
    edit({ memory_approvals: approvals, story_approvals: [] });
  }
  async function review() {
    if (!input || pending.current || disabled) return;
    pending.current = true; setBusy(true); setError(""); setPreview(null);
    try {
      if (!await flush()) throw new Error("Save the scene successfully before reviewing this selection.");
      const result = await previewSelection(projectRoot, input);
      if (result.anchor.branch !== branch) throw new Error("The book version changed. Reopen the scene and select the passage again.");
      if (mounted.current) { setPreview(result); setChoices(result); }
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  async function generate() {
    if (!input || pending.current || disabled || (!preview && !requestId)) return;
    pending.current = true; setBusy(true); setError("");
    const next = requestId ? draft.value : { input, fingerprint: preview!.fingerprint, requestId: crypto.randomUUID() };
    try {
      draft.session.edit(next);
      if (draft.session.getSnapshot().error) throw new Error("Cannot safely start: request recovery storage is unavailable. Free local storage and retry.");
      if (!await flush()) throw new Error("Save the scene successfully before sending this selection.");
      const result = await generateSelection(projectRoot, input, next.fingerprint, next.requestId);
      if (!mounted.current) return;
      await onResult(result);
      draft.session.amend(current => current.requestId === next.requestId ? empty : current);
      setPreview(null);
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }

  return <section className="selection-assist" aria-label="Selection assistant">
    <div className="selection-assist__toolbar">
      {(["rewrite", "shorten", "expand", "critique"] as SelectionAction[]).map(action => <button key={action} className="btn btn--ghost" disabled={disabled || busy || Boolean(input) || !selection || !selection.body.slice(selection.start, selection.end).trim()} onMouseDown={event => event.preventDefault()} onClick={() => choose(action)}>{action[0].toUpperCase() + action.slice(1)}</button>)}
      {!input && <span>Select a passage to edit or critique.</span>}
    </div>
    {draft.error && <p role="alert">{draft.error}</p>}
    {input && <div className="selection-assist__request">
      <div className="selection-assist__panel" role="region" aria-label="Selection context and permissions" tabIndex={0}>
        <strong>{input.action[0].toUpperCase() + input.action.slice(1)} selected passage</strong>
        {draft.recovered && <p role="status">Recovered your passage and direction. Review context again before a new request.</p>}
        <blockquote>{input.selected_text}</blockquote>
        <p>{input.action === "critique" ? "Critique is feedback only and never changes manuscript prose." : "Only this passage can change after you accept it. Any later scene change makes this edit stale."}</p>
        <label>Direction for this passage<textarea className="input" rows={2} maxLength={2000} value={input.instruction} disabled={busy || Boolean(requestId) || disabled} onChange={event => edit({ instruction: event.target.value })} /></label>
        {input.action === "critique" && <div className="selection-assist__toolbar">
          <label>Review focus<select className="input" value={input.review_focus || "general"} disabled={busy || Boolean(requestId) || disabled} onChange={event => edit({ review_focus: event.target.value as SelectionInput["review_focus"] })}>
            <option value="general">General editorial review</option><option value="continuity">Continuity</option><option value="character-knowledge">Character knowledge</option><option value="motivation">Motivation</option><option value="pacing">Pacing</option><option value="voice">Writing Voice</option>
          </select></label>
          <label>Review scope<select className="input" value={input.review_scope || "passage"} disabled={busy || Boolean(requestId) || disabled} onChange={event => edit({ review_scope: event.target.value as SelectionInput["review_scope"] })}>
            <option value="passage">Selected passage</option><option value="chapter">Connected chapter</option>
          </select></label>
          {input.review_scope === "chapter" && <p>Compare this passage with its saved chapter in reading order. Review the exact included context before sending.</p>}
        </div>}
        <div className="selection-assist__toolbar">
          <label>Provider<select className="input" value={input.provider} disabled={busy || Boolean(requestId) || disabled} onChange={event => edit({ provider: event.target.value as ProposalProvider, model: "" })}>{[...new Set([...providers, input.provider])].map(provider => <option key={provider} value={provider}>{provider === "local" ? "Local (mechanical edits only)" : provider}</option>)}</select></label>
          <label>Model override<input className="input" value={input.model} placeholder="Provider default" disabled={busy || Boolean(requestId) || disabled} onChange={event => edit({ model: event.target.value })} /></label>
        </div>
        <p>Saved story guidance, approved Writing Voice guidance and permitted Memory may be sent with {input.action === "critique" && input.review_scope === "chapter" ? "full scenes from this chapter in saved reading order" : "up to 2,000 surrounding characters per side"}. Canon and relationships require your permission below. {input.action === "critique" && input.review_scope === "chapter" ? "No full scenes outside this chapter, chat history or private notes are sent." : "No full other scenes, chat history or private notes are sent."} Text in included prose, guidance or approved evidence is not automatically redacted.</p>
        {preview && <div className="selection-assist__preview">
          {preview.review && <p>{preview.review.scope === "chapter" ? "Connected chapter" : "Passage"} critique · {preview.review.focus.replace(/-/g, " ")} · {preview.review.scene_ids.length} source scene{preview.review.scene_ids.length === 1 ? "" : "s"}. Inspect the exact sources below before sending.</p>}
          <p role="status">{preview.provider} / {preview.model} · approximately {preview.estimated_input_tokens.toLocaleString()} app-context tokens · {preview.max_output_tokens.toLocaleString()} output-token {preview.provider === "openai-codex" ? "target (not a hard limit)" : "limit"}</p>
          <p>The estimate covers only openAuthor’s supplied text. Provider instructions and runtime overhead can substantially increase actual token usage; Runs records reported usage.</p>
          <p>{preview.limits.omitted_before_characters + preview.limits.omitted_after_characters} surrounding characters and {preview.limits.omitted_memory_ids.length} permitted Memory entries omitted by context limits. Inspect the exact payload below for included story guidance.</p>
        </div>}
        {choices && <div className="selection-assist__choices">
          {choices.memory_choices.filter(row => row.visibility === "ask" || row.visibility === "include" && row.details.some(detail => detail.visibility === "ask")).map(row => <fieldset key={row.id} disabled={busy || Boolean(requestId) || disabled}>
            <legend>{row.name}</legend>
            {row.visibility === "ask" && <label><input type="checkbox" checked={input.memory_approvals.some(item => item.entity_id === row.id && !item.detail_key)} onChange={event => allow({ entity_id: row.id }, event.target.checked)} />Allow {row.name} for this request</label>}
            {row.details.filter(detail => detail.visibility === "ask").map(detail => <label key={detail.key}><input type="checkbox" disabled={row.visibility === "ask" && !input.memory_approvals.some(item => item.entity_id === row.id && !item.detail_key)} checked={input.memory_approvals.some(item => item.entity_id === row.id && item.detail_key === detail.key)} onChange={event => allow({ entity_id: row.id, detail_key: detail.key }, event.target.checked)} />Allow {row.name}: {detail.key} for this request</label>)}
          </fieldset>)}
          <p>Changing Memory permission clears Canon selections; review context to refresh their availability.</p>
          <StoryContextChoices choices={choices.story_choices ?? []} selected={input.story_approvals ?? []} disabled={busy || Boolean(requestId) || disabled} reviewed={Boolean(preview)} onChange={ids => edit({ story_approvals: ids })} />
        </div>}
        {preview && <details><summary>Exact app-supplied editorial context</summary><pre>{preview.system_prompt}</pre><pre>{preview.user_prompt}</pre></details>}
        {requestId && <p>Request saved for recovery. Retry reuses a completed result. If the provider replied before the result was saved, retry may incur another charge. A changed scene or context will block a new provider call.</p>}
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="selection-assist__toolbar selection-assist__actions" role="group" aria-label="Selection request actions">
        {!requestId && <button className="btn" disabled={disabled || busy} onClick={() => void review()}>{busy ? "Working…" : "Review context"}</button>}
        {(preview || requestId) && <button className="btn btn--primary" disabled={disabled || busy || Boolean(draft.error) || (!preview && !fingerprint)} onClick={() => void generate()}>{busy ? "Working…" : requestId ? "Recover request" : input.action === "critique" ? "Generate reviewed critique" : "Generate reviewed edit"}</button>}
        {requestId && <button className="btn" disabled={busy || disabled} onClick={() => { draft.session.edit({ ...empty, input: { ...input, memory_approvals: [], story_approvals: [] } }); setPreview(null); setChoices(null); setError(""); }}>Review as a new request</button>}
        <button className="btn btn--ghost" disabled={busy} onClick={() => { draft.session.edit(empty); setPreview(null); setError(""); }}>Discard selection request</button>
      </div>
      <small className="selection-assist__footnote">Discarding keeps saved results in Changes and never changes manuscript prose.</small>
    </div>}
  </section>;
}
