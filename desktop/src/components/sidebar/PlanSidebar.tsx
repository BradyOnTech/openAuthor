import { useEditor } from "../../contexts/EditorContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";

export function PlanSidebar() {
  const { openTab } = useEditor();
  const { scenes } = useWorkspace();

  return (
    <>
      <div className="sidebar__header">
        <span className="sidebar__title">Plan</span>
      </div>
      <div className="sidebar__content" style={{ padding: "var(--space-4)" }}>
        <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", lineHeight: 1.5 }}>
          Shape the book from acts down to beats. Move scene cards between chapters to change reading order without moving source files.
        </p>
        <div style={{ marginTop: "var(--space-4)", padding: "var(--space-3)", borderRadius: "var(--radius-md)", background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: ".08em" }}>Manuscript inventory</div>
          <div style={{ marginTop: 4, fontSize: "var(--text-lg)", color: "var(--text-primary)" }}>{scenes.length} scene{scenes.length === 1 ? "" : "s"}</div>
        </div>
        <button className="btn btn--primary" style={{ width: "100%", marginTop: "var(--space-4)" }} onClick={() => openTab({ id: "plan", kind: "plan", label: "Plan" })}>
          Open Story Board
        </button>
        <button className="btn" style={{ width: "100%", marginTop: "var(--space-2)" }} disabled={scenes.length === 0} onClick={() => openTab({ id: "reader", kind: "reader", label: "Read manuscript" })}>
          Read manuscript
        </button>
      </div>
    </>
  );
}
