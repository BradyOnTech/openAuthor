import { useMemo } from "react";
import { useEditor } from "../../contexts/EditorContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import type { SceneDetail } from "../../types";

export function InspectorPanel() {
  const { tabs, activeTabId } = useEditor();
  const { proposals, codexEntities } = useWorkspace();
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

  const sceneProposals = proposals.filter((p) => p.scene_id === scene.id);
  const wordCount = scene.body.split(/\s+/).filter(Boolean).length;

  return (
    <div style={{ padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div>
        <div className="section-header">Scene Metadata</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", padding: "0 var(--space-3)" }}>
          <MetaRow label="Status">
            <span className={`badge badge--${scene.status}`}>{scene.status}</span>
          </MetaRow>
          <MetaRow label="POV">
            <span style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>
              {scene.pov || "\u2014"}
            </span>
          </MetaRow>
          <MetaRow label="Words">
            <span style={{ fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
              {wordCount}
            </span>
          </MetaRow>
          <MetaRow label="ID">
            <span style={{ fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
              {scene.id}
            </span>
          </MetaRow>
        </div>
      </div>

      {scene.summary && (
        <div>
          <div className="section-header">Summary</div>
          <p style={{ padding: "0 var(--space-3)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: "var(--leading-relaxed)" }}>
            {scene.summary}
          </p>
        </div>
      )}

      {sceneProposals.length > 0 && (
        <div>
          <div className="section-header">
            <span>Proposals</span>
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
