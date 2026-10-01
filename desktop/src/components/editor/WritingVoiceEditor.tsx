import { useEffect, useRef, useState } from "react";
import { getScene, getWritingVoiceWorkspace, writingVoiceAction, type StyleProfile, type VoicePreview, type WritingVoiceWorkspace } from "../../api";
import type { ProposalProvider, ProposalRecord } from "../../types";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useEditor } from "../../contexts/EditorContext";
import { useUI } from "../../contexts/UIContext";
import { availableProviders, defaultProvider } from "../../providerSelection";
import { VoiceAssessment } from "./VoiceAssessment";
import { VoiceRefinement } from "./VoiceRefinement";
import { readPosition, retentionKey, savePosition } from "../../workspaceRetention";
import "./writingVoice.css";

const emptyProfile = (): StyleProfile => ({ schema_version: 2, name: "My book's voice", description: "", traits: {}, guidance: [], avoid: [], exemplar_scene_ids: [], exemplar_digests: {}, observations: [], metrics: {}, created_at: "" });
const lines = (value: string) => value.split("\n");
const stringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function sameDirection(left: StyleProfile, right: WritingVoiceWorkspace["presets"][number]) {
  return left.description === right.description && JSON.stringify(left.guidance) === JSON.stringify(right.guidance)
    && JSON.stringify(left.avoid) === JSON.stringify(right.avoid)
    && [...new Set([...Object.keys(left.traits), ...Object.keys(right.traits)])].every((key) => left.traits[key] === right.traits[key]);
}
function recoveredDraft(value: unknown): value is { draft: StyleProfile; brief: string; selected: string[]; version: string; scope: string } {
  if (!object(value) || !object(value.draft)) return false;
  const draft = value.draft;
  return typeof value.version === "string" && typeof value.scope === "string" && typeof value.brief === "string"
    && stringList(value.selected) && typeof draft.name === "string" && typeof draft.description === "string"
    && object(draft.traits) && Object.values(draft.traits).every((trait) => typeof trait === "string")
    && stringList(draft.guidance) && stringList(draft.avoid) && stringList(draft.exemplar_scene_ids)
    && object(draft.metrics) && typeof draft.created_at === "string"
    && (draft.observations === undefined || (Array.isArray(draft.observations) && draft.observations.every((row) =>
      object(row) && [row.scene_id, row.aspect, row.observation, row.excerpt].every((field) => typeof field === "string"))));
}

export function WritingVoiceEditor({ initialBrief = "" }: { initialBrief?: string }) {
  const { projectRoot, scenes, runtimeConfig, refreshProposals, setMessage } = useWorkspace();
  const { openTab, updateTab } = useEditor();
  const { sidebarOpen, secondarySidebarOpen, panelOpen, setSidebarOpen, setSecondarySidebarOpen, setPanelOpen } = useUI();
  const previousLayout = useRef<{ sidebar: boolean; secondary: boolean; panel: boolean } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [workspace, setWorkspace] = useState<WritingVoiceWorkspace | null>(null);
  const [draft, setDraft] = useState<StyleProfile>(emptyProfile);
  const [baseVersion, setBaseVersion] = useState("");
  const [baseScope, setBaseScope] = useState("");
  const [brief, setBrief] = useState(initialBrief);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [provider, setProvider] = useState<ProposalProvider>(defaultProvider(runtimeConfig).id);
  const [model, setModel] = useState("");
  const [sceneId, setSceneId] = useState("");
  const [source, setSource] = useState("");
  const [intent, setIntent] = useState("Explore this voice while preserving events, POV, tense and facts.");
  const [comparisons, setComparisons] = useState<string[]>(["kinetic", "atmospheric"]);
  const [preview, setPreview] = useState<VoicePreview | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const [discard, setDiscard] = useState(false);
  const requestSerial = useRef(0);
  const providerWasSelected = useRef(false);
  const storageKey = `openauthor:writing-voice-draft:v2:${projectRoot}`;
  function restoreLayout() {
    const previous = previousLayout.current;
    if (!previous) return;
    setSidebarOpen(previous.sidebar); setSecondarySidebarOpen(previous.secondary); setPanelOpen(previous.panel);
    previousLayout.current = null;
  }
  useEffect(() => () => {
    const previous = previousLayout.current;
    if (previous) { setSidebarOpen(previous.sidebar); setSecondarySidebarOpen(previous.secondary); setPanelOpen(previous.panel); }
  }, [setSidebarOpen, setSecondarySidebarOpen, setPanelOpen]);
  useEffect(() => { if (!providerWasSelected.current && runtimeConfig) setProvider(defaultProvider(runtimeConfig).id); }, [runtimeConfig]);
  useEffect(() => {
    if (!workspace) return;
    setComparisons((current) => {
      const available = workspace.presets.filter((preset) => !sameDirection(draft, preset)).map((preset) => preset.id);
      const kept = current.filter((id) => available.includes(id));
      if (kept.length === current.length) return current;
      return [...kept, ...available.filter((id) => !kept.includes(id))].slice(0, current.length);
    });
  }, [draft, workspace]);

  useEffect(() => {
    let active = true;
    void getWritingVoiceWorkspace(projectRoot).then((loaded) => {
      if (!active) return;
      setWorkspace(loaded);
      setPreview(loaded.previews?.[0] || null);
      try {
        const previous = readPosition(retentionKey(projectRoot, loaded.scope, "voice-preview-selection"), (value): value is string => typeof value === "string");
        if (previous) setPreview(loaded.previews.find((row) => row.id === previous) || loaded.previews[0] || null);
      } catch { setNotice("Preview selection could not be restored. Assessment drafts are retained separately."); }
      setDraft(loaded.profile || emptyProfile());
      setBaseVersion(loaded.profile?.version || ""); setBaseScope(loaded.scope);
      setSelected(loaded.profile?.exemplar_scene_ids || []);
      setDirty(!!initialBrief);
      try {
        const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
        if (recoveredDraft(stored)) {
          setDraft(stored.draft); setBaseVersion(stored.version); setBaseScope(stored.scope);
          setBrief(initialBrief || stored.brief || ""); setSelected(stored.selected || []); setDirty(true);
          setNotice("Restored your unsaved Writing Voice draft. Saving checks the original book and Storyline version.");
        } else if (stored !== null) {
          setNotice("The local voice draft is invalid and could not be restored. The approved profile is unchanged.");
        }
      } catch { setNotice("Local draft recovery is unavailable. Save your profile before leaving this screen."); }
    }).catch((reason) => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, [projectRoot, storageKey, initialBrief, reload]);

  useEffect(() => {
    updateTab("writing-voice", { modified: dirty });
    if (!dirty || !workspace) return;
    try { localStorage.setItem(storageKey, JSON.stringify({ draft, brief, selected, version: baseVersion, scope: baseScope })); }
    catch { setNotice("Your draft could not be retained locally. Save before leaving this screen."); }
  }, [draft, brief, selected, baseVersion, baseScope, dirty, workspace, storageKey, updateTab]);

  useEffect(() => { if (!sceneId && scenes[0]) setSceneId(scenes[0].id); }, [scenes, sceneId]);
  useEffect(() => {
    const serial = ++requestSerial.current;
    if (!sceneId) { setSource(""); return; }
    setSource("");
    void getScene(projectRoot, sceneId).then((scene) => {
      if (serial !== requestSerial.current) return;
      const words = [...scene.body.matchAll(/\S+/g)];
      const end = words[179] ? words[179].index! + words[179][0].length : scene.body.length;
      setSource(scene.body.slice(0, end).trim());
    }).catch((reason) => { if (serial === requestSerial.current) setError(String(reason)); });
    return () => { ++requestSerial.current; };
  }, [projectRoot, sceneId]);

  function edit(change: Partial<StyleProfile>) { setDraft((value) => ({ ...value, ...change })); setDirty(true); }
  async function run(name: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(name); setError("");
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(""); }
  }
  async function save() {
    await run("save", async () => {
      const profile = await writingVoiceAction<StyleProfile>(projectRoot, "save", { profile: draft, expected_version: baseVersion, scope: baseScope });
      setDraft(profile); setBaseVersion(profile.version || ""); setDirty(false);
      setWorkspace((value) => value && ({ ...value, profile }));
      try { localStorage.removeItem(storageKey); } catch { /* The saved core profile remains authoritative. */ }
      setNotice("Writing Voice approved. New copilot requests and manuscript revisions use this profile; no prose was changed.");
    });
  }
  async function suggest() {
    await run("analysis", async () => {
      const result = await writingVoiceAction<{ profile: StyleProfile; message: string }>(projectRoot, "suggest", { profile: draft, brief, scene_ids: selected, provider, model });
      edit(result.profile); setNotice(result.message + " This is an unsaved proposal.");
    });
  }
  async function compare() {
    await run("preview", async () => {
      const directions = [draft, ...comparisons.map((id) => workspace!.presets.find((preset) => preset.id === id)!)];
      const result = await writingVoiceAction<VoicePreview>(projectRoot, "preview", { scene_id: sceneId, source_text: source, instruction: intent, directions, provider, model });
      choosePreview(result);
      setWorkspace((value) => value && ({ ...value, previews: [result, ...(value.previews || [])].slice(0, 5) }));
      setNotice("Previews are separate from your manuscript and approved profile. Review them before choosing a direction.");
    });
  }
  async function stage(directionId: string) {
    await run(`stage:${directionId}`, async () => {
      const proposal = await writingVoiceAction<ProposalRecord>(projectRoot, "stage", { preview_id: preview!.id, direction_id: directionId });
      await refreshProposals();
      setMessage("Voice sample queued as a Change Set. Review its hunks before applying; the book's voice was not changed.");
      openTab({ id: `proposal:${proposal.id}`, kind: "proposal", label: proposal.title, data: proposal });
    });
  }
  function choosePreview(value: VoicePreview | null) {
    setPreview(value);
    if (workspace) {
      try { savePosition(retentionKey(projectRoot, workspace.scope, "voice-preview-selection"), value?.id || ""); }
      catch { setNotice("Could not retain your preview selection on this device."); }
    }
  }

  return <div className="writing-voice">
    <header><span className="writing-voice__eyebrow">CRAFT / ORIGINAL PROSE</span><h1>Writing Voice</h1>
      <p>Shape how this book reads. Explore traits, learn from your writing, then approve the direction. Your copilot stays conversational.</p>
    </header>
    {error && <div className="writing-voice__notice" role="alert">{error}<button className="btn btn--sm" onClick={() => setDiscard(true)}>Reload saved profile…</button></div>}
    {discard && <div className="writing-voice__notice" role="alert">Discard the local profile draft and load the saved version? Your manuscript and saved profile will not change.
      <button className="btn" onClick={() => { try { localStorage.removeItem(storageKey); } catch { setError("Could not remove the local draft; keep a copy before retrying."); return; } setDirty(false); setDiscard(false); setError(""); setReload((value) => value + 1); }}>Discard draft and reload</button><button className="btn" onClick={() => setDiscard(false)}>Keep draft</button>
    </div>}
    {notice && <p className="writing-voice__notice" role="status">{notice}</p>}
    {!workspace ? <p>Loading Writing Voice…</p> : <>
      <section className="writing-voice__section">
        <div className="writing-voice__section-heading"><h2>1. Define this book’s voice</h2><span>{dirty ? "Unsaved draft" : workspace.profile ? "Approved profile" : "No profile approved"}</span></div>
        <label>Start with a preset<select className="input" aria-label="Writing Voice preset" defaultValue="" disabled={!!busy} onChange={(event) => {
          const preset = workspace.presets.find((row) => row.id === event.target.value);
          if (preset) edit({ ...emptyProfile(), ...preset });
        }}><option value="">Choose a starting point…</option>{workspace.presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
        <label>Profile name<input className="input" value={draft.name} maxLength={100} disabled={!!busy} onChange={(event) => edit({ name: event.target.value })} /></label>
        <label>Voice description<textarea className="input" rows={3} maxLength={2400} value={draft.description} disabled={!!busy} onChange={(event) => edit({ description: event.target.value })} /></label>
        <div className="writing-voice__traits">{Object.entries(workspace.dimensions).map(([key, dimension]) => <label key={key}>{dimension.label}<select className="input" aria-label={`Voice ${dimension.label}`} disabled={!!busy} value={draft.traits[key] || (key === "pacing" ? "varied" : key === "humor" ? "earnest" : "balanced")} onChange={(event) => edit({ traits: { ...draft.traits, [key]: event.target.value } })}>{dimension.options.map((option) => <option key={option}>{option}</option>)}</select></label>)}</div>
        <div className="writing-voice__traits"><label>Do more of (one preference per line)<textarea className="input" rows={4} value={draft.guidance.join("\n")} disabled={!!busy} onChange={(event) => edit({ guidance: lines(event.target.value) })} /></label>
          <label>Avoid (one preference per line)<textarea className="input" rows={4} value={draft.avoid.join("\n")} disabled={!!busy} onChange={(event) => edit({ avoid: lines(event.target.value) })} /></label></div>
        <button className="btn btn--primary" disabled={!!busy} onClick={() => void save()}>{busy === "save" ? "Saving…" : "Approve and save Writing Voice"}</button>
      </section>
      <section className="writing-voice__section">
        <h2>2. Discover your voice</h2><p>Describe what you want, choose your own exemplar scenes, or combine both. Analysis proposes editable traits; it never silently changes your profile.</p>
        <label>Tell the copilot how this book should read<textarea className="input" rows={3} maxLength={4000} value={brief} disabled={!!busy} onChange={(event) => { setBrief(event.target.value); setDirty(true); }} placeholder="Close perspective, restrained emotion, dry humor. Let dialogue imply more than it explains." /></label>
        <details><summary>Choose your exemplar scenes ({selected.length} selected)</summary><div className="writing-voice__exemplars">{scenes.map((scene) => <label key={scene.id}><input type="checkbox" checked={selected.includes(scene.id)} disabled={!!busy || (!selected.includes(scene.id) && selected.length >= 6)} onChange={(event) => { setSelected(event.target.checked ? [...selected, scene.id] : selected.filter((id) => id !== scene.id)); setDirty(true); }} />{scene.title}</label>)}</div></details>
        <div className="writing-voice__traits"><label>Writing provider<select className="input" value={provider} disabled={!!busy} onChange={(event) => { providerWasSelected.current = true; setProvider(event.target.value as ProposalProvider); }}>{availableProviders(runtimeConfig).map((row) => <option key={row.id} value={row.id}>{row.id === "local" ? "Local measurements — no creative generation" : row.id}</option>)}</select></label><label>Writing model (optional)<input className="input" value={model} disabled={!!busy} onChange={(event) => setModel(event.target.value)} placeholder="Provider default" /></label></div>
        <p className="writing-voice__muted">An AI provider receives your brief and selected exemplars when you request analysis. Previews also use relevant book context. Existing provider budgets apply.</p>
        <button className="btn" disabled={!!busy || (!brief.trim() && !selected.length)} onClick={() => void suggest()}>{busy === "analysis" ? "Analyzing…" : "Propose a voice profile"}</button>
        {(draft.observations || []).map((row, index) => <blockquote key={index}><strong>{row.aspect} · {row.scene_id}</strong><p>{row.observation}</p><q>{row.excerpt}</q></blockquote>)}
      </section>
      <section className="writing-voice__section">
        <h2>3. Preview before revising</h2><p>Compare your draft profile with one or two preset directions on the same passage. Choosing a profile and queueing prose are separate decisions.</p>
        <label>Preview scene<select className="input" value={sceneId} disabled={!!busy} onChange={(event) => { setSceneId(event.target.value); setPreview(null); }}>{scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</select></label>
        <label>Exact excerpt to preview (up to 400 words)<textarea className="input" rows={5} value={source} disabled={!!busy} onChange={(event) => setSource(event.target.value)} /></label>
        <label>Scene-specific direction<textarea className="input" rows={2} maxLength={2000} value={intent} disabled={!!busy} onChange={(event) => setIntent(event.target.value)} /></label>
        <fieldset disabled={!!busy}><legend>Compare draft profile with</legend>{workspace.presets.map((preset) => <label key={preset.id}><input type="checkbox" checked={comparisons.includes(preset.id)} disabled={sameDirection(draft, preset) || (!comparisons.includes(preset.id) && comparisons.length >= 2)} onChange={(event) => setComparisons(event.target.checked ? [...comparisons, preset.id] : comparisons.filter((id) => id !== preset.id))} />{preset.name}</label>)}</fieldset>
        <button className="btn btn--primary" disabled={!!busy || !source.trim() || !comparisons.length} onClick={() => void compare()}>{busy === "preview" ? "Generating short previews…" : `Compare ${comparisons.length + 1} short previews`}</button>
        {provider === "local" && <p className="writing-voice__muted">Local mode repeats your source as a baseline. It cannot demonstrate literary quality or produce creative voice variations.</p>}
        {!!workspace.previews?.length && <label>Reopen saved previews<select className="input" disabled={!!busy} value={preview?.id || ""} onChange={(event) => choosePreview(workspace.previews.find((row) => row.id === event.target.value) || null)}><option value="">Choose a saved comparison…</option>{workspace.previews.map((row, index) => <option key={row.id} value={row.id}>{index + 1}. {row.scene_id} · {row.refinement ? "Refined · " : ""}{row.directions.map((direction) => direction.profile.name).join(" / ")}</option>)}</select></label>}
      </section>
      {preview && <section className="writing-voice__section"><div className="writing-voice__section-heading"><h2>Compare and judge</h2><button className="btn btn--sm" onClick={() => {
        if (expanded) restoreLayout();
        else { previousLayout.current = { sidebar: sidebarOpen, secondary: secondarySidebarOpen, panel: panelOpen }; setSidebarOpen(false); setSecondarySidebarOpen(false); setPanelOpen(false); }
        setExpanded(!expanded);
      }}>{expanded ? "Restore workspace layout" : "Expand comparison"}</button></div><p>Source: {preview.scene_id}. Measurements describe prose shape, not writing quality. Each assessment below is yours to approve.</p>
        <section aria-label="Original passage" className="writing-voice__reference"><h3>Original passage</h3>
          <p className="writing-voice__muted">Saved when this comparison was created, not a live view of the manuscript. Keeping the original is a valid choice; no action is needed.</p>
          <p className="writing-voice__prose">{preview.source_text}</p>
          {preview.instruction && <p><strong>Requested direction:</strong> {preview.instruction}</p>}
        </section>
        {preview.refinement && <section aria-label="Previous attempt" className="writing-voice__reference"><h3>Previous attempt</h3>
          <p className="writing-voice__prose">{preview.refinement.candidate}</p>
          <p><strong>Your revision feedback:</strong> {preview.refinement.feedback}</p>
        </section>}
        <div className="writing-voice__comparisons">{preview.directions.map((direction) => <article key={direction.id} aria-label={`Preview ${direction.profile.name}`}>
          <h3>{direction.profile.name}</h3><p className="writing-voice__prose">{direction.text}</p>
          <p className="writing-voice__muted">{direction.measures.words} words · {direction.measures.average_sentence_words} words/sentence · {direction.measures.dialogue_passages} dialogue passages</p>
          {direction.warnings.map((warning) => <p className="writing-voice__muted" key={warning}>{warning}</p>)}
          {!!direction.observations.length && <details><summary>Generator self-review — not independent evidence</summary>{direction.observations.map((row, index) => <blockquote key={index}><strong>{row.criterion.replace(/_/g, " ")}</strong><p>{row.observation}</p><q>{row.excerpt}</q></blockquote>)}</details>}
          <VoiceAssessment key={`${projectRoot}:${workspace.scope}:${preview.id}:${direction.id}`} project={projectRoot} scope={workspace.scope} previewId={preview.id} direction={direction} criteria={workspace.criteria} onSaved={(saved) => {
            setWorkspace((value) => value && ({ ...value, previews: value.previews.map((row) => row.id === saved.id ? saved : row) }));
            setPreview((value) => value?.id === saved.id ? saved : value);
          }} />
          <VoiceRefinement key={`refine:${projectRoot}:${workspace.scope}:${preview.id}:${direction.id}`} project={projectRoot} scope={workspace.scope} previewId={preview.id} direction={direction} provider={provider} model={model} disabled={!!busy} onBusy={(value) => setBusy(value ? "refine" : "")} onRefined={(result) => {
            choosePreview(result);
            setWorkspace((value) => value && ({ ...value, previews: [result, ...value.previews].slice(0, 5) }));
            setNotice("Refined sample saved separately. Compare it with the original and previous attempt before queueing a Change Set. Your manuscript and approved voice are unchanged.");
          }} />
          <div className="writing-voice__actions"><button className="btn" disabled={!!busy} onClick={() => { edit(direction.profile); setNotice("Direction copied into your draft profile. Approve and save to use it for this book."); }}>Use as draft voice</button>
            <button className="btn btn--primary" disabled={!!busy || direction.text === preview.source_text} onClick={() => void stage(direction.id)}>Queue sample as Change Set</button></div>
        </article>)}</div>
      </section>}
    </>}
  </div>;
}
