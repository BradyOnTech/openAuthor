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
} from "../../api";
import { useEditor } from "../../contexts/EditorContext";
import { flushProjectSceneSaves } from "../../sceneSaveSession";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import type { CharacterArcState, ManuscriptPlan, PlanMovePreview, SceneSummary } from "../../types";
import { useRetainedDraft } from "../../hooks/useRetainedDraft";
import { retentionKey } from "../../workspaceRetention";
import { acknowledgePlanEntry, emptyPlanDraft, isPlanDraft, nonemptyDrafts } from "../../planDraft";
import { RecoveryNotice } from "./RecoveryNotice";
import { PlanMetadataEditor } from "./PlanMetadataEditor";
import { PlanNotes } from "./PlanNotes";

export function PlanEditor({ focusNoteId }: { focusNoteId?: string }) {
  const { projectRoot, setError } = useWorkspace();
  const [initial, setInitial] = useState<ManuscriptPlan | null>(null);
  useEffect(() => {
    let current = true;
    setInitial(null);
    void getManuscriptPlan(projectRoot).then((value) => { if (current) setInitial(value); })
      .catch((error) => { if (current) setError(`Failed to load plan: ${String(error)}`); });
    return () => { current = false; };
  }, [projectRoot]);
  return initial ? <PlanWorkspace key={`${projectRoot}:${initial.workspace}`} initial={initial} focusNoteId={focusNoteId} /> : <p>Loading story board…</p>;
}

function PlanWorkspace({ initial, focusNoteId }: { initial: ManuscriptPlan; focusNoteId?: string }) {
  const { projectRoot, scenes, codexEntities, setError, setMessage } = useWorkspace();
  const { openTab, tabs, setActiveTab, beginNavigation } = useEditor();
  const [plan, setPlan] = useState(initial);
  const retained = useRetainedDraft(retentionKey(projectRoot, initial.workspace || "legacy", "plan"), emptyPlanDraft, isPlanDraft);
  const brief = retained.value.brief || plan.brief;
  const newAct = retained.value.newAct;
  const chapterDrafts = retained.value.chapters;
  const beatDrafts = retained.value.beats;
  const setBrief = (value: ManuscriptPlan["brief"]) => retained.change((old) => ({ ...old, brief: value, baseline: old.baseline || plan.brief }));
  const setNewAct = (value: string) => retained.change((old) => ({ ...old, newAct: value }));
  const setChapterDrafts = (value: Record<string, string>) => retained.change((old) => ({ ...old, chapters: nonemptyDrafts(value) }));
  const setBeatDrafts = (value: Record<string, string>) => retained.change((old) => ({ ...old, beats: nonemptyDrafts(value) }));
  const [draggedScene, setDraggedScene] = useState("");
  const [movePreview, setMovePreview] = useState<PlanMovePreview | null>(null);
  const [previewKey, setPreviewKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [arcStates, setArcStates] = useState<CharacterArcState[]>([]);
  const loadSequence = useRef(0);
  const mutationPending = useRef(false);

  useEffect(() => {
    // A note can be saved from the sidebar while Plan remains open. Refresh
    // saved data without remounting the author's retained brief/structure drafts.
    if (focusNoteId) void loadPlan();
  }, [focusNoteId]);

  const scenesById = useMemo(() => new Map(scenes.map((scene) => [scene.id, scene])), [scenes]);
  const chapterOptions = useMemo(() => (plan?.acts ?? []).flatMap((act) => (
    act.chapters.map((chapter) => ({ id: chapter.id, label: `${act.title} · ${chapter.title}` }))
  )), [plan]);

  useEffect(() => {
    void listCharacterArcStates(projectRoot).then(setArcStates).catch((error) => setError(String(error)));
    return () => { ++loadSequence.current; };
  }, [projectRoot]);

  async function loadPlan() {
    if (!projectRoot) return;
    const sequence = ++loadSequence.current;
    try {
      const [next, arcs] = await Promise.all([getManuscriptPlan(projectRoot), listCharacterArcStates(projectRoot)]);
      if (sequence !== loadSequence.current) return;
      if (next.workspace !== initial.workspace) throw new Error("Storyline changed. Reopen Plan; your local drafts are retained in the original Storyline.");
      setPlan(next);
      setArcStates(arcs);
      return true;
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      setError(`Failed to load plan: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async function runMutation(action: () => Promise<unknown>, success: string, acknowledge?: () => void) {
    if (mutationPending.current) return;
    mutationPending.current = true;
    setBusy(true);
    try {
      if (!await flushProjectSceneSaves(projectRoot)) throw new Error("Save pending writing before updating the plan.");
      await action();
      acknowledge?.();
      if (await loadPlan()) setError("");
      setMessage(success);
    } catch (error) {
      setError(`Plan update failed: ${error instanceof Error ? error.message : String(error)}`);
      await loadPlan();
    } finally {
      mutationPending.current = false;
      setBusy(false);
    }
  }

  function saveBrief() {
    const submitted = brief;
    void runMutation(() => updateProjectBrief(projectRoot, submitted, initial.workspace ? { workspace: initial.workspace, value: retained.value.baseline || plan.brief } : undefined), "Project brief saved.", () => {
      setPlan((old) => ({ ...old, brief: submitted }));
      retained.change((old) => ({ ...old, baseline: !old.brief || old.brief === submitted ? null : submitted, brief: old.brief === submitted ? null : old.brief }));
    });
  }

  function addActDraft() {
    const submitted = newAct;
    if (!submitted.trim()) return;
    void runMutation(() => addPlanAct(projectRoot, submitted.trim(), "", initial.workspace), "Act added.", () => retained.change((old) => ({ ...old, newAct: old.newAct === submitted ? "" : old.newAct })));
  }

  function addBeatDraft(sceneId: string) {
    const submitted = beatDrafts[sceneId] || "";
    if (!submitted.trim()) return;
    void runMutation(() => addPlanBeat(projectRoot, sceneId, submitted.trim(), initial.workspace), "Beat added.", () => retained.change((old) => acknowledgePlanEntry(old, "beats", sceneId, submitted)));
  }

  async function openScene(scene: SceneSummary) {
    const tabId = `scene:${scene.id}`;
    if (tabs.some((tab) => tab.id === tabId)) {
      setActiveTab(tabId);
      return;
    }
    const isCurrent = beginNavigation();
    try {
      const detail = await getScene(projectRoot, scene.id);
      if (isCurrent()) openTab({ id: tabId, kind: "scene", label: detail.title, data: detail });
    } catch (error) {
      if (isCurrent()) setError(`Failed to open scene: ${error instanceof Error ? error.message : String(error)}`);
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
      () => assignPlanScene(projectRoot, sceneId, chapterId, beforeSceneId, initial.workspace),
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
      () => assignPlanScene(projectRoot, sceneId, chapterId, undefined, initial.workspace),
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

        <RecoveryNotice draft={retained} label="Plan drafts" />
        <details><summary>Inspect retained Plan text</summary><p>Unfinished text is kept even if its act or scene was removed. Copy it before discarding.</p><pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(retained.value, null, 2)}</pre></details>
        {retained.value.baseline && JSON.stringify(retained.value.baseline) !== JSON.stringify(plan.brief) && <section role="alert" style={panelStyle}>
          <p>The saved brief changed. Your draft has been kept. Compare the saved brief below before choosing to replace it.</p>
          <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(plan.brief, null, 2)}</pre>
          <button className="btn" onClick={() => retained.change((old) => ({ ...old, baseline: plan.brief }))}>I reviewed the saved brief; keep my draft for the next save</button>
        </section>}
        <section style={panelStyle}>
          <h2 style={sectionTitle}>Project Brief</h2>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(220px, 1fr)", gap: "var(--space-3)" }}>
            <textarea className="input" rows={4} aria-label="Synopsis" placeholder="What is this story about?" value={brief.synopsis} onChange={(event) => setBrief({ ...brief, synopsis: event.target.value })} />
            <div style={{ display: "grid", gap: "var(--space-2)" }}>
              <input className="input" aria-label="Genre" placeholder="Genre" value={brief.genre} onChange={(event) => setBrief({ ...brief, genre: event.target.value })} />
              <input className="input" aria-label="Themes" placeholder="Themes, comma separated" value={retained.value.themesText ?? brief.themes.join(", ")} onChange={(event) => { const themesText = event.target.value; retained.change(old => ({ ...old, brief: { ...brief, themes: themesText.split(",").map(value => value.trim()).filter(Boolean) }, baseline: old.baseline || plan.brief, themesText })); }} />
              <button className="btn btn--primary" disabled={busy} onClick={saveBrief}>Save Brief</button>
            </div>
          </div>
          <textarea className="input" rows={3} aria-label="Style guide" placeholder="Style guide: voice, tense, prose boundaries…" style={{ marginTop: "var(--space-3)" }} value={brief.style_guide} onChange={(event) => setBrief({ ...brief, style_guide: event.target.value })} />
          <textarea className="input" rows={4} aria-label="Outline" placeholder="High-level outline or north-star ending…" style={{ marginTop: "var(--space-3)" }} value={brief.outline} onChange={(event) => setBrief({ ...brief, outline: event.target.value })} />
        </section>

        <PlanNotes notes={plan.notes} scenes={scenes} focusNoteId={focusNoteId} onOpenScene={(scene) => void openScene(scene)} onRevise={(note) => {
          openTab({ id: `generate:note:${note.id}`, kind: "generate", label: "Revise from note", data: { sceneId: note.scene_id || undefined, instruction: note.content } });
        }} />

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
              addActDraft();
            }
          }} />
          <button className="btn btn--primary" disabled={busy || !newAct.trim()} onClick={() => {
            addActDraft();
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
                    return scene ? <SceneCard key={sceneId} scene={scene} workspace={initial.workspace || "legacy"} metadata={plan.scene_metadata?.[sceneId]} onMetadataSaved={(metadata) => setPlan((old) => ({ ...old, scene_metadata: { ...old.scene_metadata, [sceneId]: metadata } }))} beats={plan.beats.filter((beat) => beat.scene_id === sceneId)} beatDraft={beatDrafts[sceneId] ?? ""} chapterOptions={chapterOptions} currentChapterId={chapter.id} busy={busy} onBeatDraft={(value) => setBeatDrafts({ ...beatDrafts, [sceneId]: value })} onAddBeat={() => {
                      addBeatDraft(sceneId);
                    }} onOpen={() => void openScene(scene)} onDragStart={(event) => dragStart(event, sceneId)} onPreview={() => previewMove(chapter.id, sceneId)} onDrop={(event) => dropScene(event, chapter.id, sceneId)} onMovePreview={(chapterId) => previewSceneMove(sceneId, chapterId)} onMove={(chapterId) => moveScene(sceneId, chapterId)} /> : null;
                  })}
                  {chapter.scene_ids.length === 0 && <DropHint text="Drop scenes here" />}
                </div>
              ))}
              <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
                <input className="input" placeholder="Chapter title" value={chapterDrafts[act.id] ?? ""} onChange={(event) => setChapterDrafts({ ...chapterDrafts, [act.id]: event.target.value })} />
                <button className="btn" disabled={busy || !(chapterDrafts[act.id] ?? "").trim()} onClick={() => {
                  const submitted = chapterDrafts[act.id] ?? "";
                  void runMutation(() => addPlanChapter(projectRoot, act.id, submitted.trim(), "", initial.workspace), "Chapter added.", () => retained.change((old) => acknowledgePlanEntry(old, "chapters", act.id, submitted)));
                }}>Add</button>
              </div>
            </section>
          ))}

          <section onDragOver={(event) => event.preventDefault()} onDragEnter={() => previewMove(null)} onDrop={(event) => dropScene(event, null)} style={panelStyle}>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>UNASSIGNED</div>
            <h2 style={{ ...sectionTitle, marginTop: 3 }}>Scene Inbox</h2>
            <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", lineHeight: 1.5 }}>New and imported scenes stay here until you place them. Drag a card, or use its Move to control, to preview and change reading order.</p>
            {plan.unassigned_scene_ids.map((sceneId) => {
              const scene = scenesById.get(sceneId);
              return scene ? <SceneCard key={sceneId} scene={scene} workspace={initial.workspace || "legacy"} metadata={plan.scene_metadata?.[sceneId]} onMetadataSaved={(metadata) => setPlan((old) => ({ ...old, scene_metadata: { ...old.scene_metadata, [sceneId]: metadata } }))} beats={plan.beats.filter((beat) => beat.scene_id === sceneId)} beatDraft={beatDrafts[sceneId] ?? ""} chapterOptions={chapterOptions} currentChapterId={null} busy={busy} onBeatDraft={(value) => setBeatDrafts({ ...beatDrafts, [sceneId]: value })} onAddBeat={() => {
                addBeatDraft(sceneId);
              }} onOpen={() => void openScene(scene)} onDragStart={(event) => dragStart(event, sceneId)} onPreview={() => previewMove(null, sceneId)} onDrop={(event) => dropScene(event, null, sceneId)} onMovePreview={(chapterId) => previewSceneMove(sceneId, chapterId)} onMove={(chapterId) => moveScene(sceneId, chapterId)} /> : null;
            })}
            {plan.unassigned_scene_ids.length === 0 && <DropHint text={scenes.length === 0 ? "Create your first scene in Manuscript, then place it here." : "All scenes are placed"} />}
          </section>
        </div>

      </div>
    </div>
  );
}

function SceneCard({ scene, workspace, metadata, onMetadataSaved, beats, beatDraft, chapterOptions, currentChapterId, busy, onBeatDraft, onAddBeat, onOpen, onDragStart, onPreview, onDrop, onMovePreview, onMove }: {
  scene: SceneSummary;
  workspace: string;
  metadata?: ManuscriptPlan["scene_metadata"][string];
  onMetadataSaved: (value: ManuscriptPlan["scene_metadata"][string]) => void;
  beats: ManuscriptPlan["beats"];
  beatDraft: string;
  chapterOptions: Array<{ id: string; label: string }>;
  currentChapterId: string | null;
  busy: boolean;
  onBeatDraft: (value: string) => void;
  onAddBeat: () => void;
  onOpen: () => void;
  onDragStart: (event: DragEvent) => void;
  onPreview: () => void;
  onDrop: (event: DragEvent) => void;
  onMovePreview: (chapterId: string | null) => void;
  onMove: (chapterId: string | null) => void;
}) {
  const { projectRoot } = useWorkspace();
  const timelinePosition = metadata?.timeline_position ?? "";
  const labels = (metadata?.labels ?? []).join(", ");
  const [moveTarget, setMoveTarget] = useState(currentChapterId ?? "__unassigned__");

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
      <PlanMetadataEditor key={`${workspace}:${scene.id}`} project={projectRoot} scope={workspace} sceneId={scene.id} title={scene.title} metadata={metadata} onSaved={onMetadataSaved} />
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
