import { useEffect, useRef, useState } from "react";
import { generateMemoryScan, previewMemoryScan, type MemoryScanPreview, type MemoryScanReport, type MemoryScanRequest } from "../../api";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { availableProviders, defaultProvider } from "../../providerSelection";
import { flushProjectSceneSaves } from "../../sceneSaveSession";
import type { GenerationRuntimeConfig, ProposalProvider, SceneSummary } from "../../types";
import "./MemoryScanReview.css";

type Props = { disabled?: boolean; onQueued: (report: MemoryScanReport) => Promise<void>; onBusyChange?: (busy: boolean) => void; onOpenChange?: (open: boolean) => void };
export function MemoryScanReview(props: Props) {
  const { projectRoot, branches, scenes, runtimeConfig } = useWorkspace();
  const branch = branches?.find(row => row.current)?.name || "";
  return <MemoryScanSession key={JSON.stringify([projectRoot, branch])} {...props} projectRoot={projectRoot} scenes={scenes ?? []} runtimeConfig={runtimeConfig} />;
}

function MemoryScanSession({ projectRoot, scenes, runtimeConfig, disabled = false, onQueued, onBusyChange, onOpenChange }: Props & {
  projectRoot: string; scenes: SceneSummary[]; runtimeConfig: GenerationRuntimeConfig | null;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [provider, setProvider] = useState<ProposalProvider>(defaultProvider(runtimeConfig).id);
  const [model, setModel] = useState("");
  const [preview, setPreview] = useState<MemoryScanPreview | null>(null);
  const [report, setReport] = useState<MemoryScanReport | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "send">("");
  const [error, setError] = useState("");
  const pending = useRef(false), serial = useRef(0), providerSelected = useRef(false);
  const providers = availableProviders(runtimeConfig);
  if (!providers.some(row => row.id === "local")) providers.push(defaultProvider(null));
  const chosen = providers.find(row => row.id === provider);
  const request: MemoryScanRequest = { scene_ids: selected, provider, model: model.trim() || chosen?.model || "" };
  const key = JSON.stringify([projectRoot, request, chosen?.model, selected.map(id => scenes.some(row => row.id === id))]);
  const view = useRef({ mounted: true, key }); view.current.key = key;
  useEffect(() => {
    view.current.mounted = true;
    return () => { view.current.mounted = false; ++serial.current; };
  }, []);
  useEffect(() => { onBusyChange?.(Boolean(busy)); }, [busy, onBusyChange]);
  useEffect(() => () => { onBusyChange?.(false); }, [onBusyChange]);
  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);
  useEffect(() => () => { onOpenChange?.(false); }, [onOpenChange]);
  useEffect(() => { if (!providerSelected.current && runtimeConfig) setProvider(defaultProvider(runtimeConfig).id); }, [runtimeConfig]);
  useEffect(() => { ++serial.current; setPreview(null); setError(""); }, [key]);
  const validScope = selected.length > 0 && selected.length <= 6 && selected.every(id => scenes.some(row => row.id === id));
  function chooseScene(id: string, checked: boolean) {
    if (pending.current) return;
    setSelected(previous => checked ? [...previous, id] : previous.filter(value => value !== id));
    setPreview(null); setReport(null);
  }
  async function review() {
    if (pending.current || disabled || !validScope || !chosen) return;
    pending.current = true; setBusy("preview"); setError(""); setPreview(null); setReport(null);
    const operation = ++serial.current, submitted = request, submittedKey = key;
    try {
      if (!await flushProjectSceneSaves(projectRoot)) throw new Error("Save pending manuscript writing before reviewing scan sources.");
      if (!view.current.mounted || view.current.key !== submittedKey || operation !== serial.current) return;
      const result = await previewMemoryScan(projectRoot, submitted);
      if (view.current.mounted && view.current.key === submittedKey && operation === serial.current) setPreview(result);
    } catch (cause) { if (view.current.mounted && view.current.key === submittedKey) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { pending.current = false; if (view.current.mounted) setBusy(""); }
  }
  async function send() {
    if (pending.current || disabled || !preview || !validScope || !chosen) return;
    pending.current = true; setBusy("send"); setError("");
    const operation = ++serial.current, submitted = request, submittedKey = key, fingerprint = preview.fingerprint;
    try {
      if (!await flushProjectSceneSaves(projectRoot)) throw new Error("Save pending manuscript writing before sending this scan.");
      if (!view.current.mounted || view.current.key !== submittedKey || operation !== serial.current) return;
      const result = await generateMemoryScan(projectRoot, submitted, fingerprint);
      if (!view.current.mounted || view.current.key !== submittedKey || operation !== serial.current) return;
      setPreview(null); setReport(result);
      try { await onQueued(result); }
      catch (cause) { setError(`Suggestions were queued. Could not refresh the inbox: ${cause instanceof Error ? cause.message : String(cause)}`); }
    } catch (cause) {
      if (view.current.mounted && view.current.key === submittedKey) { setPreview(null); setError(cause instanceof Error ? cause.message : String(cause)); }
    } finally { pending.current = false; if (view.current.mounted) setBusy(""); }
  }
  return <section className={`memory-scan-review${open ? " memory-scan-review--open" : ""}`} aria-label="Reviewed AI Memory scan">
    {!open ? <button className="btn" disabled={disabled || Boolean(busy)} onClick={() => setOpen(true)}>Review AI scan</button> : <div className="revision-context-review memory-scan-review__panel">
      <h2>Review a Memory scan</h2>
      <div className="memory-scan-review__body" role="region" aria-label="Memory scan scope and source passages" tabIndex={0}>
      <p>Choose up to six saved scenes, totaling at most 36,000 characters. Preview their exact text before sending. Candidates remain unconfirmed until you review and accept them.</p>
      <fieldset className="memory-scan-review__picker" disabled={disabled || Boolean(busy)}><legend>Scenes to scan</legend>
        {scenes.map(scene => <label key={scene.id}><input type="checkbox" checked={selected.includes(scene.id)} disabled={!selected.includes(scene.id) && selected.length >= 6} onChange={event => chooseScene(scene.id, event.target.checked)} />{scene.title || scene.id}</label>)}
      </fieldset>
      <label>Scan provider<select className="select" aria-label="Scan provider" value={provider} disabled={disabled || Boolean(busy)} onChange={event => { providerSelected.current = true; setProvider(event.target.value as ProposalProvider); setModel(""); setPreview(null); setReport(null); }}>
        {providers.map(row => <option key={row.id} value={row.id}>{row.id === "local" ? "Local heuristic — no semantic interpretation" : row.id}</option>)}
        {!chosen && <option value={provider}>{provider} — unavailable</option>}
      </select></label>
      <label>Scan model override<input className="input" aria-label="Scan model override" value={model} placeholder={chosen?.model || "Provider default"} disabled={disabled || Boolean(busy)} onChange={event => { setModel(event.target.value); setPreview(null); setReport(null); }} /></label>
      {!chosen && <p role="alert">This provider is no longer configured. Choose an available provider and review again.</p>}
      {provider === "local" ? <p>Local mode performs no semantic interpretation and contacts no provider. It may refresh identities across all saved scenes; selected scenes limit fact and connection extraction.</p>
        : <p>The selected full prose and listed accepted identity names, types and aliases may be sent. Other Memory details, notes and Ask-first entries are excluded. Text within selected prose is not automatically redacted.</p>}
      {preview && <div aria-label="Exact scan sources">
        <p>{preview.provider} / {preview.model} · approximately {preview.input_tokens_estimate.toLocaleString()} app-context tokens · {preview.response_token_reserve.toLocaleString()} output-token {preview.provider === "openai-codex" ? "target, not a hard limit" : "reserve"}. Provider instructions and runtime overhead are additional.</p>
        {preview.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
        <h3>Accepted identities included</h3>
        {preview.accepted_entities.length ? <ul>{preview.accepted_entities.map(entity => <li key={entity.id}>{entity.name} · {entity.type}{entity.aliases.length ? ` · aliases: ${entity.aliases.join(", ")}` : ""}</li>)}</ul> : <p>No accepted identities included.</p>}
        {preview.scenes.map(scene => <article key={scene.scene_id}><h3>{scene.title || scene.scene_id}</h3><pre style={{ whiteSpace: "pre-wrap" }}>{scene.body}</pre></article>)}
      </div>}
      {report && <div role="status"><p>{report.added} new and {report.refreshed} refreshed suggestions; {report.pending} await review. Suggestions remain unconfirmed.</p>{report.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
      </div>
      {busy && <p role="status">{busy === "preview" ? "Preparing saved sources…" : "Scanning reviewed sources… This request cannot be interrupted here. Suggestions will still need your approval."}</p>}
      {error && <p role="alert">{error}</p>}
      <footer>
        <button className="btn" disabled={disabled || Boolean(busy) || !validScope || !chosen} onClick={() => void review()}>Preview scan sources</button>
        {preview && <button className="btn btn--primary" disabled={disabled || Boolean(busy) || !chosen || !validScope} onClick={() => void send()}>{provider === "local" ? "Run reviewed local scan" : "Send reviewed AI scan"}</button>}
        <button className="btn btn--ghost" disabled={Boolean(busy)} onClick={() => { ++serial.current; setOpen(false); setPreview(null); }}>Close scan review</button>
      </footer>
    </div>}
  </section>;
}
