import { useEffect, useState } from "react";
import { useEditor } from "../../contexts/EditorContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { updateSceneMetadata } from "../../api";
import type { SceneDetail } from "../../types";

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

  return <SceneInspector scene={scene} tabId={activeTab.id} />;
}

function SceneInspector({ scene, tabId }: { scene: SceneDetail; tabId: string }) {
  const { proposals, projectRoot, refreshScenes, setError, setMessage } = useWorkspace();
  const { updateTab } = useEditor();
  const [summary, setSummary] = useState(scene.summary);
  const [pov, setPov] = useState(scene.pov);
  const [status, setStatus] = useState(scene.status);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSummary(scene.summary);
    setPov(scene.pov);
    setStatus(scene.status);
  }, [scene.id, scene.pov, scene.status, scene.summary]);

  const sceneProposals = proposals.filter((p) => p.scene_id === scene.id);
  const wordCount = scene.body.split(/\s+/).filter(Boolean).length;
  const changed = summary !== scene.summary || pov !== scene.pov || status !== scene.status;

  async function saveDetails() {
    setSaving(true);
    try {
      const updated = await updateSceneMetadata(projectRoot, scene.id, { summary, pov, status });
      updateTab(tabId, { data: { ...scene, summary: updated.summary, pov: updated.pov, status: updated.status, updated_at: updated.updated_at } });
      await refreshScenes();
      setMessage("Scene details saved.");
    } catch (error) {
      setError(`Scene details failed to save: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div>
        <div className="section-header">Scene Metadata</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", padding: "0 var(--space-3)" }}>
          <label style={{ display: "grid", gap: 4, fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>Status<select className="select" value={status} onChange={(event) => setStatus(event.target.value)}><option value="draft">Draft</option><option value="revised">Revised</option><option value="final">Final</option></select></label>
          <label style={{ display: "grid", gap: 4, fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>Point of view<input className="input" value={pov} onChange={(event) => setPov(event.target.value)} placeholder="Character or narrator" /></label>
          <label style={{ display: "grid", gap: 4, fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>Scene summary<textarea className="input" rows={5} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="What changes in this scene?" /></label>
          <MetaRow label="Words">
            <span style={{ fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
              {wordCount}
            </span>
          </MetaRow>
          <button className="btn btn--primary btn--sm" disabled={!changed || saving} onClick={() => void saveDetails()}>{saving ? "Saving…" : "Save scene details"}</button>
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
