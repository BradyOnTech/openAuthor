import { useEffect, useMemo, useState, type DragEvent } from "react";
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

const EMPTY_BRIEF: ManuscriptPlan["brief"] = {
  synopsis: "", genre: "", themes: [], style_guide: "", outline: "",
};

export function PlanEditor() {
  const { projectRoot, scenes, codexEntities, setError, setMessage } = useWorkspace();
  const { openTab } = useEditor();
  const [plan, setPlan] = useState<ManuscriptPlan | null>(null);
  const [brief, setBrief] = useState(EMPTY_BRIEF);
  const [newAct, setNewAct] = useState("");
  const [chapterDrafts, setChapterDrafts] = useState<Record<string, string>>({});
  const [beatDrafts, setBeatDrafts] = useState<Record<string, string>>({});
  const [draggedScene, setDraggedScene] = useState("");
  const [movePreview, setMovePreview] = useState<PlanMovePreview | null>(null);
  const [previewKey, setPreviewKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [arcStates, setArcStates] = useState<CharacterArcState[]>([]);

  const scenesById = useMemo(() => new Map(scenes.map((scene) => [scene.id, scene])), [scenes]);

  useEffect(() => {
    void loadPlan();
  }, [projectRoot]);

  async function loadPlan() {
    if (!projectRoot) return;
    try {
      const [next, arcs] = await Promise.all([getManuscriptPlan(projectRoot), listCharacterArcStates(projectRoot)]);
      setPlan(next);
      setBrief(next.brief);
      setArcStates(arcs);
    } catch (error) {
      setError(`Failed to load plan: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function runMutation(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      await loadPlan();
      setMessage(success);
    } catch (error) {
      setError(`Plan update failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
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
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(220px, 1fr)", gap: "var(--space-3)" }}>
            <textarea className="input" rows={4} aria-label="Synopsis" placeholder="What is this story about?" value={brief.synopsis} onChange={(event) => setBrief({ ...brief, synopsis: event.target.value })} />
            <div style={{ display: "grid", gap: "var(--space-2)" }}>
              <input className="input" aria-label="Genre" placeholder="Genre" value={brief.genre} onChange={(event) => setBrief({ ...brief, genre: event.target.value })} />
              <input className="input" aria-label="Themes" placeholder="Themes, comma separated" value={brief.themes.join(", ")} onChange={(event) => setBrief({ ...brief, themes: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} />
              <button className="btn btn--primary" disabled={busy} onClick={() => void runMutation(() => updateProjectBrief(projectRoot, brief), "Project brief saved.")}>Save Brief</button>
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
          <input className="input" placeholder="New act title" value={newAct} onChange={(event) => setNewAct(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter" && newAct.trim()) {
              void runMutation(() => addPlanAct(projectRoot, newAct.trim()), "Act added.");
              setNewAct("");
            }
          }} />
          <button className="btn btn--primary" disabled={busy || !newAct.trim()} onClick={() => {
            void runMutation(() => addPlanAct(projectRoot, newAct.trim()), "Act added.");
            setNewAct("");
          }}>Add Act</button>
        </div>

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
                    return scene ? <SceneCard key={sceneId} scene={scene} metadata={plan.scene_metadata?.[sceneId]} beats={plan.beats.filter((beat) => beat.scene_id === sceneId)} beatDraft={beatDrafts[sceneId] ?? ""} onBeatDraft={(value) => setBeatDrafts({ ...beatDrafts, [sceneId]: value })} onAddBeat={() => {
                      const summary = (beatDrafts[sceneId] ?? "").trim();
                      if (!summary) return;
                      void runMutation(() => addPlanBeat(projectRoot, sceneId, summary), "Beat added.");
                      setBeatDrafts({ ...beatDrafts, [sceneId]: "" });
                    }} onMetadataSave={(timelinePosition, labels) => void runMutation(() => updatePlanSceneMetadata(projectRoot, sceneId, { timelinePosition, labels }), "Scene planning details saved.")} onOpen={() => void openScene(scene)} onDragStart={(event) => dragStart(event, sceneId)} onPreview={() => previewMove(chapter.id, sceneId)} onDrop={(event) => dropScene(event, chapter.id, sceneId)} /> : null;
                  })}
                  {chapter.scene_ids.length === 0 && <DropHint text="Drop scenes here" />}
                </div>
              ))}
              <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
                <input className="input" placeholder="Chapter title" value={chapterDrafts[act.id] ?? ""} onChange={(event) => setChapterDrafts({ ...chapterDrafts, [act.id]: event.target.value })} />
                <button className="btn" disabled={busy || !(chapterDrafts[act.id] ?? "").trim()} onClick={() => {
                  const title = (chapterDrafts[act.id] ?? "").trim();
                  void runMutation(() => addPlanChapter(projectRoot, act.id, title), "Chapter added.");
                  setChapterDrafts({ ...chapterDrafts, [act.id]: "" });
                }}>Add</button>
              </div>
            </section>
          ))}

          <section onDragOver={(event) => event.preventDefault()} onDragEnter={() => previewMove(null)} onDrop={(event) => dropScene(event, null)} style={panelStyle}>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>UNASSIGNED</div>
            <h2 style={{ ...sectionTitle, marginTop: 3 }}>Scene Inbox</h2>
            <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", lineHeight: 1.5 }}>New and imported scenes stay here until you place them. Drag cards between chapters to preview and change reading order.</p>
            {plan.unassigned_scene_ids.map((sceneId) => {
              const scene = scenesById.get(sceneId);
              return scene ? <SceneCard key={sceneId} scene={scene} metadata={plan.scene_metadata?.[sceneId]} beats={plan.beats.filter((beat) => beat.scene_id === sceneId)} beatDraft={beatDrafts[sceneId] ?? ""} onBeatDraft={(value) => setBeatDrafts({ ...beatDrafts, [sceneId]: value })} onAddBeat={() => {
                const summary = (beatDrafts[sceneId] ?? "").trim();
                if (!summary) return;
                void runMutation(() => addPlanBeat(projectRoot, sceneId, summary), "Beat added.");
                setBeatDrafts({ ...beatDrafts, [sceneId]: "" });
              }} onMetadataSave={(timelinePosition, labels) => void runMutation(() => updatePlanSceneMetadata(projectRoot, sceneId, { timelinePosition, labels }), "Scene planning details saved.")} onOpen={() => void openScene(scene)} onDragStart={(event) => dragStart(event, sceneId)} onPreview={() => previewMove(null, sceneId)} onDrop={(event) => dropScene(event, null, sceneId)} /> : null;
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

function SceneCard({ scene, metadata, beats, beatDraft, onBeatDraft, onAddBeat, onMetadataSave, onOpen, onDragStart, onPreview, onDrop }: {
  scene: SceneSummary;
  metadata?: ManuscriptPlan["scene_metadata"][string];
  beats: ManuscriptPlan["beats"];
  beatDraft: string;
  onBeatDraft: (value: string) => void;
  onAddBeat: () => void;
  onMetadataSave: (timelinePosition: string, labels: string[]) => void;
  onOpen: () => void;
  onDragStart: (event: DragEvent) => void;
  onPreview: () => void;
  onDrop: (event: DragEvent) => void;
}) {
  const [timelinePosition, setTimelinePosition] = useState(metadata?.timeline_position ?? "");
  const [labels, setLabels] = useState((metadata?.labels ?? []).join(", "));

  useEffect(() => {
    setTimelinePosition(metadata?.timeline_position ?? "");
    setLabels((metadata?.labels ?? []).join(", "));
  }, [metadata?.timeline_position, metadata?.labels?.join("\u0000")]);

  return (
    <article draggable onDragStart={onDragStart} onDragOver={(event) => event.preventDefault()} onDragEnter={(event) => { event.stopPropagation(); onPreview(); }} onDrop={(event) => { event.stopPropagation(); onDrop(event); }} style={{ marginTop: "var(--space-2)", padding: "var(--space-3)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--bg-elevated)", cursor: "grab" }}>
      <button onClick={onOpen} style={{ border: 0, background: "transparent", color: "var(--text-primary)", padding: 0, fontWeight: 600, textAlign: "left", cursor: "pointer" }}>{scene.title || scene.id}</button>
      <div style={{ display: "flex", gap: "var(--space-2)", marginTop: 4, color: "var(--text-tertiary)", fontSize: "var(--text-xs)" }}>
        <span>{scene.pov || "No POV"}</span><span>·</span><span>{scene.status}</span><span>·</span><span>{scene.word_count ?? 0} words</span>
      </div>
      {scene.summary && <p style={{ margin: "var(--space-2) 0 0", color: "var(--text-secondary)", fontSize: "var(--text-xs)", lineHeight: 1.45 }}>{scene.summary}</p>}
      {(timelinePosition || labels) && <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7, color: "var(--text-secondary)", fontSize: "var(--text-xs)" }}>{timelinePosition && <span className="badge">Story time · {timelinePosition}</span>}{labels.split(",").map((label) => label.trim()).filter(Boolean).map((label) => <span className="badge" key={label}>{label}</span>)}</div>}
      {beats.map((beat) => <div key={beat.id} style={{ marginTop: 6, paddingLeft: 9, borderLeft: "2px solid var(--info)", color: "var(--text-secondary)", fontSize: "var(--text-xs)" }}>Beat {beat.position}: {beat.summary}</div>)}
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <input className="input" aria-label={`New beat for ${scene.title}`} placeholder="Add beat…" value={beatDraft} onChange={(event) => onBeatDraft(event.target.value)} onKeyDown={(event) => event.key === "Enter" && onAddBeat()} />
        <button className="btn btn--sm" aria-label={`Add beat to ${scene.title}`} disabled={!beatDraft.trim()} onClick={onAddBeat}>+</button>
      </div>
      <details style={{ marginTop: 8 }} onClick={(event) => event.stopPropagation()}>
        <summary style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)", cursor: "pointer" }}>Story time & labels</summary>
        <div style={{ display: "grid", gap: 6, marginTop: 7 }}>
          <input className="input" aria-label={`Story time for ${scene.title}`} placeholder="Story time, e.g. Day 3 · dusk" value={timelinePosition} onChange={(event) => setTimelinePosition(event.target.value)} />
          <input className="input" aria-label={`Labels for ${scene.title}`} placeholder="Labels, comma separated" value={labels} onChange={(event) => setLabels(event.target.value)} />
          <button className="btn btn--sm" onClick={() => onMetadataSave(timelinePosition, labels.split(",").map((value) => value.trim()).filter(Boolean))}>Save planning details</button>
        </div>
      </details>
    </article>
  );
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
