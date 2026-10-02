import { useMemo } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useEditor } from "../../contexts/EditorContext";
import { countContinuityIssues, orderContinuityIssues } from "../../state";
import { getScene } from "../../api";

export function CheckResults() {
  const { projectRoot, continuityIssues, checksCompleted, runChecks, busy, setError } = useWorkspace();
  const { openTab } = useEditor();

  const counts = useMemo(() => countContinuityIssues(continuityIssues), [continuityIssues]);
  const ordered = useMemo(() => orderContinuityIssues(continuityIssues), [continuityIssues]);

  async function handleIssueClick(sceneId: string) {
    if (!sceneId) return;
    try {
      const detail = await getScene(projectRoot, sceneId);
      openTab({ id: `scene:${sceneId}`, kind: "scene", label: detail.title || sceneId, data: detail });
    } catch (e) {
      setError(`Failed to open scene: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <>
      <div className="sidebar__header">
        <span className="sidebar__title">Manuscript hygiene</span>
        <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
          {counts.error > 0 && <span className="badge badge--error">{counts.error}E</span>}
          {counts.warning > 0 && <span className="badge badge--warning">{counts.warning}W</span>}
          {counts.info > 0 && <span className="badge badge--info">{counts.info}I</span>}
          <button className="btn btn--primary btn--sm" style={{ minHeight: 40 }} aria-label="Run hygiene checks" onClick={runChecks} disabled={busy}>
            Run
          </button>
        </div>
      </div>
      <div className="sidebar__content">
        <p style={{ padding: "0 var(--space-3)", color: "var(--text-secondary)", fontSize: "var(--text-sm)", lineHeight: 1.5 }}>Checks summaries, scene length, duplicate titles and POV metadata—not a story-consistency verdict.</p>
        <button className="btn btn--sm" style={{ minHeight: 40, margin: "0 var(--space-3) var(--space-3)", whiteSpace: "normal" }} onClick={() => openTab({ id: "memory:canon", kind: "memory", label: "Story Memory", data: { memoryView: "canon" } })}>Open story continuity</button>
        {(["error", "warning", "info"] as const).map((severity) => {
          const items = ordered.filter((i) => i.severity === severity);
          if (items.length === 0) return null;
          return (
            <div key={severity}>
              <div className="section-header">
                <span>{severity}s</span>
                <span className="section-header__count">({items.length})</span>
              </div>
              {items.map((issue) => (
                <button
                  key={issue.id}
                  className="list-item"
                  onClick={() => handleIssueClick(issue.scene_id)}
                  title={issue.message}
                  style={{ minHeight: 40, width: "100%", textAlign: "left", whiteSpace: "normal" }}
                >
                  <span className={`list-item__dot list-item__dot--${severity}`} />
                  <div className="list-item__content">
                    <div className="list-item__title">{issue.title}</div>
                    <div className="list-item__meta">{issue.scene_id || issue.code}</div>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", whiteSpace: "normal", marginTop: 4 }}>{issue.message}</div>
                  </div>
                </button>
              ))}
            </div>
          );
        })}

        {continuityIssues.length === 0 && (
          <div style={{ padding: "var(--space-4)", color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
            {checksCompleted ? "No hygiene findings in the last run." : "Run hygiene checks to inspect manuscript metadata and completeness."}
          </div>
        )}
      </div>
    </>
  );
}
