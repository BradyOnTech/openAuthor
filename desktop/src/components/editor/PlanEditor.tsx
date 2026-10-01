import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  addPlanAct,
  addPlanBeat,
  addPlanChapter,
  assignPlanScene,
  getManuscriptPlan,
  getScene,
  listCharacterArcStates,
  previewPlanSceneMove,
  updateProjectBrief,
  updatePlanSceneMetadata,
} from "../../api";
import { useEditor } from "../../contexts/EditorContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import type { CharacterArcState, ManuscriptPlan, PlanMovePreview, SceneSummary } from "../../types";
import { useRecoverableDraft } from "../../recoverableDraft";
import { DraftStatus } from "../shared/DraftStatus";

const EMPTY_BRIEF: ManuscriptPlan["brief"] = {
  synopsis: "", genre: "", themes: [], style_guide: "", outline: "",
};

function validBrief(value: unknown): value is ManuscriptPlan["brief"] {
  const brief = value as ManuscriptPlan["brief"] | null;
  return !!brief && [brief.synopsis, brief.genre, brief.style_guide, brief.outline].every(value => typeof value === "string")
    && Array.isArray(brief.themes) && brief.themes.every(value => typeof value === "string");
}

function validFormDrafts(value: unknown): value is Record<string, string> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.values(value).every(item => typeof item === "string");
}

export function PlanEditor() {
  const { projectRoot, branches, scenes, codexEntities, refreshScenes, setError, setMessage } = useWorkspace();
  const { openTab } = useEditor();
  const branch = branches?.find(row => row.current)?.name || "main";
  const draftScope = JSON.stringify([projectRoot, branch]);
  const [plan, setPlan] = useState<ManuscriptPlan | null>(null);
  const briefDraft = useRecoverableDraft(`openauthor.briefRecovery.v1:${draftScope}`, EMPTY_BRIEF, validBrief);
  const brief = briefDraft.value;
  const setBrief = briefDraft.session.edit;
  const forms = useRecoverableDraft<Record<string, string>>(`openauthor.planFormRecovery.v1:${draftScope}`, {}, validFormDrafts);
  const newAct = forms.value["act:new"] ?? "";
  const changeForm = (key: string, value: string) => {
    const next = { ...forms.session.getSnapshot().value, [key]: value };
    if (!value) delete next[key];
    forms.session.edit(next);
  };
  async function submitForm(key: string, action: (value: string) => Promise<unknown>, success: string) {
    const submitted = forms.session.getSnapshot().value[key];
    if (busy || !submitted?.trim()) return;
    if (await runMutation(() => action(submitted.trim()), success)) {
      forms.session.amend(current => {
        const next = { ...current };
        if (current[key] === submitted) delete next[key];
        return next;
      });
    }
  }
  const [draggedScene, setDraggedScene] = useState("");
  const [movePreview, setMovePreview] = useState<PlanMovePreview | null>(null);
  const [previewKey, setPreviewKey] = useState("");
  const [busy, setBusy] = useState(false);
  const mutationPending = useRef(false);
  const [arcStates, setArcStates] = useState<CharacterArcState[]>([]);

  const scenesById = useMemo(() => new Map(scenes.map((scene) => [scene.id, scene])), [scenes]);
  const chapterOptions = useMemo(() => (plan?.acts ?? []).flatMap((act) => (
    act.chapters.map((chapter) => ({ id: chapter.id, label: `${act.title} · ${chapter.title}` }))
  )), [plan]);

  useEffect(() => {
    void loadPlan();
  }, [projectRoot, branch]);

  async function loadPlan() {
    if (!projectRoot) return;
    try {
      const [next, arcs] = await Promise.all([getManuscriptPlan(projectRoot), listCharacterArcStates(projectRoot)]);
      setPlan(next);
      briefDraft.session.acceptSaved(next.brief);
      setArcStates(arcs);
    } catch (error) {
      setError(`Failed to load plan: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function runMutation(action: () => Promise<unknown>, success: string) {
    if (mutationPending.current) return false;
    mutationPending.current = true;
    setBusy(true);
    try {
      await action();
      await loadPlan();
      await refreshScenes();
      setError("");
      setMessage(success);
      return true;
    } catch (error) {
      setError(`Plan update failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    } finally {
      mutationPending.current = false;
      setBusy(false);
    }
  }

  async function openScene(scene: SceneSummary) {
    try {
      const detail = await getScene(projectRoot, scene.id);
      openTab({ id: `scene:${scene.id}`, kind: "scene", label: scene.title, data: detail });
    } catch (error) {
      setError(`Failed to open scene: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function dragStart(event: DragEvent, sceneId: string) {
    setDraggedScene(sceneId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", sceneId);
  }

  function dropScene(event: DragEvent, chapterId: string | null, beforeSceneId?: string) {
    event.preventDefault();
    const sceneId = event.dataTransfer.getData("text/plain") || draggedScene;
    if (!sceneId) return;
    void runMutation(
      () => assignPlanScene(projectRoot, sceneId, chapterId, beforeSceneId),
      chapterId ? "Scene moved. Manuscript order updated." : "Scene moved to Unassigned."
    );
    setDraggedScene("");
    setMovePreview(null);
    setPreviewKey("");
  }

  function previewMove(chapterId: string | null, beforeSceneId?: string) {
    if (!draggedScene) return;
    const key = `${draggedScene}:${chapterId ?? "unassigned"}:${beforeSceneId ?? "end"}`;
    if (key === previewKey) return;
    setPreviewKey(key);
    void previewPlanSceneMove(projectRoot, draggedScene, chapterId, beforeSceneId)
      .then(setMovePreview)
      .catch((error) => setError(`Move preview failed: ${error instanceof Error ? error.message : String(error)}`));
  }

  function previewSceneMove(sceneId: string, chapterId: string | null) {
    void previewPlanSceneMove(projectRoot, sceneId, chapterId)
      .then(setMovePreview)
      .catch((error) => setError(`Move preview failed: ${error instanceof Error ? error.message : String(error)}`));
  }

  function moveScene(sceneId: string, chapterId: string | null) {
    void runMutation(
      () => assignPlanScene(projectRoot, sceneId, chapterId),
      chapterId ? "Scene moved. Manuscript order updated." : "Scene moved to Unassigned."
    );
    setMovePreview(null);
  }

  if (!plan) {
    return <div style={{ padding: "var(--space-8)", color: "var(--text-secondary)" }}>Loading story board…</div>;
  }

  return (
    <div style={{ height: "100%", overflow: "auto", background: "var(--bg-deep)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "var(--space-6)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "var(--space-4)", marginBottom: "var(--space-5)" }}>
          <div>
            <div style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)", letterSpacing: ".1em", textTransform: "uppercase" }}>Story architecture</div>
            <h1 style={{ margin: "4px 0 0", color: "var(--text-primary)", fontFamily: "var(--font-prose)", fontWeight: 500 }}>Plan</h1>
          </div>
          <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
            {plan.acts.length} acts · {scenes.length} scenes · {plan.beats.length} beats
          </div>
        </div>

        {movePreview && (
          <section aria-label="Structural move preview" style={{ ...panelStyle, marginBottom: "var(--space-4)", borderColor: "var(--info-border)", background: "var(--info-subtle)" }}>
            <strong style={{ color: "var(--text-primary)" }}>Move preview</strong>
            <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", marginTop: 4 }}>{movePreview.summary}</div>
            {movePreview.warnings.map((warning) => <div key={warning} style={{ color: "var(--warning-text)", fontSize: "var(--text-xs)", marginTop: 5 }}>• {warning}</div>)}
          </section>
        )}

        <section style={panelStyle}>
          <h2 style={sectionTitle}>Project Brief</h2>
          <DraftStatus {...briefDraft} onUseSaved={briefDraft.session.useSaved} onKeepDraft={briefDraft.session.keepDraft} />
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(220px, 1fr)", gap: "var(--space-3)" }}>
            <textarea className="input" rows={4} aria-label="Synopsis" placeholder="What is this story about?" value={brief.synopsis} onChange={(event) => setBrief({ ...brief, synopsis: event.target.value })} />
            <div style={{ display: "grid", gap: "var(--space-2)" }}>
              <input className="input" aria-label="Genre" placeholder="Genre" value={brief.genre} onChange={(event) => setBrief({ ...brief, genre: event.target.value })} />
              <input className="input" aria-label="Themes" placeholder="Themes, comma separated" value={brief.themes.join(",")} onChange={(event) => setBrief({ ...brief, themes: event.target.value.split(",") })} />
              <button className="btn btn--primary" disabled={busy || briefDraft.conflict} onClick={() => void runMutation(async () => {
                const updated = await updateProjectBrief(projectRoot, { ...brief, themes: brief.themes.map(value => value.trim()).filter(Boolean) });
                briefDraft.session.saved(brief, updated.brief);
              }, "Project brief saved.")}>Save Brief</button>
            </div>
          </div>
          <textarea className="input" rows={3} aria-label="Style guide" placeholder="Style guide: voice, tense, prose boundaries…" style={{ marginTop: "var(--space-3)" }} value={brief.style_guide} onChange={(event) => setBrief({ ...brief, style_guide: event.target.value })} />
          <textarea className="input" rows={4} aria-label="Outline" placeholder="High-level outline or north-star ending…" style={{ marginTop: "var(--space-3)" }} value={brief.outline} onChange={(event) => setBrief({ ...brief, outline: event.target.value })} />
        </section>

        {arcStates.length > 0 && <section style={{ ...panelStyle, marginTop: "var(--space-4)" }}>
          <h2 style={sectionTitle}>Character Arc Overview</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)", marginTop: -4 }}>Planned and observed states stay evidence-backed in Story Memory; this view keeps character movement visible beside structure.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "var(--space-3)" }}>
            {Array.from(new Set(arcStates.map((state) => state.character_entity_id))).map((characterId) => <article key={characterId} style={{ padding: "var(--space-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--bg-elevated)" }}>
              <strong style={{ color: "var(--text-primary)" }}>{codexEntities.find((entity) => entity.id === characterId)?.name ?? characterId}</strong>
              {arcStates.filter((state) => state.character_entity_id === characterId).map((state) => <div key={state.id} style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)", marginTop: 6 }}><span className="badge">{state.state_type}</span> {state.dimension}: {state.value}</div>)}
            </article>)}
          </div>
        </section>}

        <div style={{ display: "flex", gap: "var(--space-2)", margin: "var(--space-5) 0 var(--space-3)" }}>
          <input className="input" placeholder="New act title" value={newAct} onChange={(event) => changeForm("act:new", event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter") void submitForm("act:new", value => addPlanAct(projectRoot, value), "Act added.");
          }} />
          <button className="btn btn--primary" disabled={busy || !newAct.trim()} onClick={() => void submitForm("act:new", value => addPlanAct(projectRoot, value), "Act added.")}>Add Act</button>
        </div>
        {forms.error ? <p role="alert">{forms.error}</p> : forms.dirty && <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>Unfinished act, chapter, and beat drafts are stored on this device. Add them when ready.</p>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "var(--space-4)", alignItems: "start" }}>
          {plan.acts.map((act) => (
            <section key={act.id} style={panelStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)" }}>
                <div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>ACT {act.position}</div>
                  <h2 style={{ ...sectionTitle, marginTop: 3 }}>{act.title}</h2>
                </div>
                <span style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)" }}>{act.chapters.length} chapters</span>
              </div>
              {act.chapters.map((chapter) => (
                <div key={chapter.id} onDragOver={(event) => event.preventDefault()} onDragEnter={() => previewMove(chapter.id)} onDrop={(event) => dropScene(event, chapter.id)} style={{ marginTop: "var(--space-3)", padding: "var(--space-3)", borderRadius: "var(--radius-md)", background: draggedScene ? "var(--info-subtle)" : "var(--bg-surface)", border: "1px solid var(--border)" }}>
                  <div style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: "var(--space-2)" }}>{chapter.position}. {chapter.title}</div>
                  {chapter.scene_ids.map((sceneId) => {
                    const scene = scenesById.get(sceneId);
                    return scene ? <SceneCard key={sceneId} scene={scene} metadata={plan.scene_metadata?.[sceneId]} beats={plan.beats.filter((beat) => beat.scene_id === sceneId)} beatDraft={forms.value[`beat:${sceneId}`] ?? ""} chapterOptions={chapterOptions} currentChapterId={chapter.id} busy={busy} onBeatDraft={(value) => changeForm(`beat:${sceneId}`, value)} onAddBeat={() => void submitForm(`beat:${sceneId}`, summary => addPlanBeat(projectRoot, sceneId, summary), "Beat added.")} onMetadataSave={(timelinePosition, labels) => runMutation(() => updatePlanSceneMetadata(projectRoot, sceneId, { timelinePosition, labels }), "Scene planning details saved.")} onOpen={() => void openScene(scene)} onDragStart={(event) => dragStart(event, sceneId)} onPreview={() => previewMove(chapter.id, sceneId)} onDrop={(event) => dropScene(event, chapter.id, sceneId)} onMovePreview={(chapterId) => previewSceneMove(sceneId, chapterId)} onMove={(chapterId) => moveScene(sceneId, chapterId)} /> : null;
                  })}
                  {chapter.scene_ids.length === 0 && <DropHint text="Drop scenes here" />}
                </div>
              ))}
              <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
                <input className="input" placeholder="Chapter title" value={forms.value[`chapter:${act.id}`] ?? ""} onChange={(event) => changeForm(`chapter:${act.id}`, event.target.value)} />
                <button className="btn" disabled={busy || !(forms.value[`chapter:${act.id}`] ?? "").trim()} onClick={() => void submitForm(`chapter:${act.id}`, title => addPlanChapter(projectRoot, act.id, title), "Chapter added.")}>Add</button>
              </div>
            </section>
          ))}

          <section onDragOver={(event) => event.preventDefault()} onDragEnter={() => previewMove(null)} onDrop={(event) => dropScene(event, null)} style={panelStyle}>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>UNASSIGNED</div>
            <h2 style={{ ...sectionTitle, marginTop: 3 }}>Scene Inbox</h2>
            <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", lineHeight: 1.5 }}>New and imported scenes stay here until you place them. Drag a card, or use its Move to control, to preview and change reading order.</p>
            {plan.unassigned_scene_ids.map((sceneId) => {
              const scene = scenesById.get(sceneId);
              return scene ? <SceneCard key={sceneId} scene={scene} metadata={plan.scene_metadata?.[sceneId]} beats={plan.beats.filter((beat) => beat.scene_id === sceneId)} beatDraft={forms.value[`beat:${sceneId}`] ?? ""} chapterOptions={chapterOptions} currentChapterId={null} busy={busy} onBeatDraft={(value) => changeForm(`beat:${sceneId}`, value)} onAddBeat={() => void submitForm(`beat:${sceneId}`, summary => addPlanBeat(projectRoot, sceneId, summary), "Beat added.")} onMetadataSave={(timelinePosition, labels) => runMutation(() => updatePlanSceneMetadata(projectRoot, sceneId, { timelinePosition, labels }), "Scene planning details saved.")} onOpen={() => void openScene(scene)} onDragStart={(event) => dragStart(event, sceneId)} onPreview={() => previewMove(null, sceneId)} onDrop={(event) => dropScene(event, null, sceneId)} onMovePreview={(chapterId) => previewSceneMove(sceneId, chapterId)} onMove={(chapterId) => moveScene(sceneId, chapterId)} /> : null;
            })}
            {plan.unassigned_scene_ids.length === 0 && <DropHint text={scenes.length === 0 ? "Create your first scene in Manuscript, then place it here." : "All scenes are placed"} />}
          </section>
        </div>

        {plan.notes.length > 0 && (
          <section style={{ ...panelStyle, marginTop: "var(--space-5)" }}>
            <h2 style={sectionTitle}>Notes</h2>
            <p style={{ marginTop: 0, color: "var(--text-secondary)", fontSize: "var(--text-xs)" }}>Durable ideas promoted from the Assistant. These are planning material, not Canon Facts.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "var(--space-3)" }}>
              {[...plan.notes].reverse().map((note) => (
                <article key={note.id} style={{ padding: "var(--space-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--bg-elevated)" }}>
                  <div style={{ color: "var(--text-primary)", fontWeight: 600 }}>{note.title}</div>
                  <div style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)", marginTop: 3 }}>{note.scene_id ? scenesById.get(note.scene_id)?.title ?? note.scene_id : "Project note"} · {note.source}</div>
                  <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{note.content}</p>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function SceneCard({ scene, metadata, beats, beatDraft, chapterOptions, currentChapterId, busy, onBeatDraft, onAddBeat, onMetadataSave, onOpen, onDragStart, onPreview, onDrop, onMovePreview, onMove }: {
  scene: SceneSummary;
  metadata?: ManuscriptPlan["scene_metadata"][string];
  beats: ManuscriptPlan["beats"];
  beatDraft: string;
  chapterOptions: Array<{ id: string; label: string }>;
  currentChapterId: string | null;
  busy: boolean;
  onBeatDraft: (value: string) => void;
  onAddBeat: () => void;
  onMetadataSave: (timelinePosition: string, labels: string[]) => Promise<boolean>;
  onOpen: () => void;
  onDragStart: (event: DragEvent) => void;
  onPreview: () => void;
  onDrop: (event: DragEvent) => void;
  onMovePreview: (chapterId: string | null) => void;
  onMove: (chapterId: string | null) => void;
}) {
  const { projectRoot, branches } = useWorkspace();
  const savedMetadata = { timelinePosition: metadata?.timeline_position ?? "", labels: (metadata?.labels ?? []).join(", ") };
  const recovery = useRecoverableDraft(`openauthor.scenePlanRecovery.v1:${JSON.stringify([projectRoot, branches?.find(row => row.current)?.name || "main", scene.id])}`, savedMetadata, validSceneMetadata);
  const { timelinePosition, labels } = recovery.value;
  const setTimelinePosition = (value: string) => recovery.session.edit({ ...recovery.value, timelinePosition: value });
  const setLabels = (value: string) => recovery.session.edit({ ...recovery.value, labels: value });
  const [moveTarget, setMoveTarget] = useState(currentChapterId ?? "__unassigned__");

  useEffect(() => {
    recovery.session.acceptSaved(savedMetadata);
  }, [metadata?.timeline_position, metadata?.labels?.join("\u0000"), recovery.session]);

  useEffect(() => {
    setMoveTarget(currentChapterId ?? "__unassigned__");
  }, [currentChapterId]);

  return (
    <article draggable onDragStart={onDragStart} onDragOver={(event) => event.preventDefault()} onDragEnter={(event) => { event.stopPropagation(); onPreview(); }} onDrop={(event) => { event.stopPropagation(); onDrop(event); }} style={{ marginTop: "var(--space-2)", padding: "var(--space-3)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--bg-elevated)", cursor: "grab" }}>
      <button onClick={onOpen} style={{ border: 0, background: "transparent", color: "var(--text-primary)", padding: 0, fontWeight: 600, textAlign: "left", cursor: "pointer" }}>{scene.title || scene.id}</button>
      <div style={{ display: "flex", gap: "var(--space-2)", marginTop: 4, color: "var(--text-tertiary)", fontSize: "var(--text-xs)" }}>
        <span>{scene.pov || "No POV"}</span><span>·</span><span>{scene.status}</span><span>·</span><span>{scene.word_count ?? 0} words</span>
      </div>
      {scene.summary && <p style={{ margin: "var(--space-2) 0 0", color: "var(--text-secondary)", fontSize: "var(--text-xs)", lineHeight: 1.45 }}>{scene.summary}</p>}
      {(timelinePosition || labels) && <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7, color: "var(--text-secondary)", fontSize: "var(--text-xs)" }}>{timelinePosition && <span className="badge">Story time · {timelinePosition}</span>}{labels.split(",").map((label) => label.trim()).filter(Boolean).map((label) => <span className="badge" key={label}>{label}</span>)}</div>}
      {beats.map((beat) => <div key={beat.id} style={{ marginTop: 6, paddingLeft: 9, borderLeft: "2px solid var(--info)", color: "var(--text-secondary)", fontSize: "var(--text-xs)" }}>Beat {beat.position}: {beat.summary}</div>)}
      {chapterOptions.length > 0 && <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 6, marginTop: 8 }}>
        <select className="select" aria-label={`Move ${scene.title} to`} value={moveTarget} onChange={(event) => {
          const target = event.target.value;
          setMoveTarget(target);
          onMovePreview(target === "__unassigned__" ? null : target);
        }}>
          <option value="__unassigned__">Unassigned scene inbox</option>
          {chapterOptions.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.label}</option>)}
        </select>
        <button className="btn btn--sm" disabled={busy || moveTarget === (currentChapterId ?? "__unassigned__")} onClick={() => onMove(moveTarget === "__unassigned__" ? null : moveTarget)}>Move</button>
      </div>}
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <input className="input" aria-label={`New beat for ${scene.title}`} placeholder="Add beat…" value={beatDraft} onChange={(event) => onBeatDraft(event.target.value)} onKeyDown={(event) => event.key === "Enter" && onAddBeat()} />
        <button className="btn btn--sm" aria-label={`Add beat to ${scene.title}`} disabled={busy || !beatDraft.trim()} onClick={onAddBeat}>+</button>
      </div>
      <details style={{ marginTop: 8 }} onClick={(event) => event.stopPropagation()}>
        <summary style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)", cursor: "pointer" }}>Story time & labels</summary>
        <div style={{ display: "grid", gap: 6, marginTop: 7 }}>
          <DraftStatus {...recovery} onUseSaved={recovery.session.useSaved} onKeepDraft={recovery.session.keepDraft} />
          <input className="input" aria-label={`Story time for ${scene.title}`} placeholder="Story time, e.g. Day 3 · dusk" value={timelinePosition} onChange={(event) => setTimelinePosition(event.target.value)} />
          <input className="input" aria-label={`Labels for ${scene.title}`} placeholder="Labels, comma separated" value={labels} onChange={(event) => setLabels(event.target.value)} />
          <button className="btn btn--sm" disabled={busy || recovery.conflict} onClick={async () => {
            const submitted = recovery.value;
            const nextLabels = labels.split(",").map(value => value.trim()).filter(Boolean);
            if (await onMetadataSave(timelinePosition, nextLabels)) recovery.session.saved(submitted, { timelinePosition: timelinePosition.trim(), labels: nextLabels.join(", ") });
          }}>Save planning details</button>
        </div>
      </details>
    </article>
  );
}

function validSceneMetadata(value: unknown): value is { timelinePosition: string; labels: string } {
  const row = value as { timelinePosition?: unknown; labels?: unknown } | null;
  return !!row && typeof row.timelinePosition === "string" && typeof row.labels === "string";
}

function DropHint({ text }: { text: string }) {
  return <div style={{ padding: "var(--space-4)", textAlign: "center", color: "var(--text-ghost)", fontSize: "var(--text-xs)", border: "1px dashed var(--border)", borderRadius: "var(--radius-sm)" }}>{text}</div>;
}

const panelStyle = {
  padding: "var(--space-4)",
  borderRadius: "var(--radius-lg)",
  border: "1px solid var(--border)",
  background: "var(--bg-surface)",
  boxShadow: "var(--shadow-sm)",
} as const;

const sectionTitle = {
  margin: "0 0 var(--space-3)",
  color: "var(--text-primary)",
  fontSize: "var(--text-lg)",
  fontWeight: 600,
} as const;
