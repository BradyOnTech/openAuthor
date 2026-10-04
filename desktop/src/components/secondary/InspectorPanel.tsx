import { useEffect, useRef, useState } from "react";
import { useEditor } from "../../contexts/EditorContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { updateSceneMetadata } from "../../api";
import type { SceneDetail } from "../../types";
import { SceneEditConflictError, type SceneConflict } from "../../sceneConflicts";

export function InspectorPanel() {
  const { tabs, activeTabId } = useEditor();
  const activeTab = tabs.find((t) => t.id === activeTabId);

  if (!activeTab || activeTab.kind !== "scene") {
    return (
      <div style={{ padding: "var(--space-4)", color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
        Open a scene to see its metadata.
      </div>
    );
  }

  const scene = activeTab.data as SceneDetail | undefined;
  if (!scene) return null;

  return <SceneInspector key={activeTab.id} scene={scene} tabId={activeTab.id} />;
}

function SceneInspector({ scene, tabId }: { scene: SceneDetail; tabId: string }) {
  const { proposals, projectRoot, refreshScenes, setError, setMessage } = useWorkspace();
  const { updateTab } = useEditor();
  const [summary, setSummary] = useState(scene.summary);
  const [pov, setPov] = useState(scene.pov);
  const [status, setStatus] = useState(scene.status);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<SceneConflict | null>(null);
  const [allowStorylineTransfer, setAllowStorylineTransfer] = useState(false);
  const baseRef = useRef(scene);
  const savingRef = useRef(false);
  const changed = summary !== baseRef.current.summary || pov !== baseRef.current.pov || status !== baseRef.current.status;
  useEffect(() => setAllowStorylineTransfer(false), [conflict]);

  useEffect(() => {
    if (changed || savingRef.current || conflict) return;
    setSummary(scene.summary);
    setPov(scene.pov);
    setStatus(scene.status);
    baseRef.current = scene;
  }, [scene, changed, conflict]);

  const sceneProposals = proposals.filter((p) => p.scene_id === scene.id);
  const wordCount = scene.body.split(/\s+/).filter(Boolean).length;
  async function saveDetails(reviewed?: SceneDetail) {
    if (savingRef.current || (conflict && !reviewed)) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const updated = await updateSceneMetadata(projectRoot, scene.id, { summary, pov, status, expectedVersion: (reviewed || baseRef.current).edit_version });
      baseRef.current = updated;
      setConflict(null);
      updateTab(tabId, { data: updated });
      await refreshScenes();
      setMessage("Scene details saved.");
    } catch (error) {
      if (error instanceof SceneEditConflictError) setConflict(error.conflict);
      setError(`Scene details failed to save: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div>
        <div className="section-header">Scene Metadata</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", padding: "0 var(--space-3)" }}>
          <label style={{ display: "grid", gap: 4, fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>Status<select className="select" disabled={saving} value={status} onChange={(event) => setStatus(event.target.value)}><option value="draft">Draft</option><option value="revised">Revised</option><option value="final">Final</option></select></label>
          <label style={{ display: "grid", gap: 4, fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>Point of view<input className="input" disabled={saving} value={pov} onChange={(event) => setPov(event.target.value)} placeholder="Character or narrator" /></label>
          <label style={{ display: "grid", gap: 4, fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>Scene summary<textarea className="input" disabled={saving} rows={5} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="What changes in this scene?" /></label>
          <MetaRow label="Words">
            <span style={{ fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
              {wordCount}
            </span>
          </MetaRow>
          <button className="btn btn--primary btn--sm" disabled={!changed || saving || Boolean(conflict)} onClick={() => void saveDetails()}>{saving ? "Saving…" : "Save scene details"}</button>
          {conflict && <section className="scene-conflict" aria-label="Metadata conflict review">
            <h2>Scene details changed elsewhere</h2>
            <p role="alert">Your entered details are retained. The saved scene was not replaced.</p>
            <dl><dt>Saved status</dt><dd>{conflict.current.status}</dd><dt>Saved POV</dt><dd>{conflict.current.pov}</dd><dt>Saved summary</dt><dd>{conflict.current.summary}</dd></dl>
            {conflict.reason === "storyline_changed" && <><p>The current Storyline differs from the one these details were loaded from.</p><label><input type="checkbox" checked={allowStorylineTransfer} onChange={(event) => setAllowStorylineTransfer(event.target.checked)} />Save these reviewed details into {conflict.current.edit_version?.storyline}</label></>}
            <button className="btn btn--sm" disabled={saving || (conflict.reason === "storyline_changed" && !allowStorylineTransfer)} onClick={() => void saveDetails(conflict.current)}>Save reviewed details</button>
            <p>Both submitted versions are backed up in {conflict.recovery_path}.</p>
          </section>}
        </div>
      </div>

      {sceneProposals.length > 0 && (
        <div>
          <div className="section-header">
            <span>Change Sets</span>
            <span className="section-header__count">({sceneProposals.length})</span>
          </div>
          {sceneProposals.slice(0, 5).map((p) => (
            <div key={p.id} style={{ padding: "var(--space-1) var(--space-3)", display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <span className={`list-item__dot list-item__dot--${p.status}`} />
              <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.title || p.id.slice(0, 12)}
              </span>
              <span style={{ fontSize: "var(--text-2xs)", color: "var(--text-ghost)", fontFamily: "var(--font-mono)" }}>
                {p.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>{label}</span>
      {children}
    </div>
  );
}
