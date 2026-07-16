import { useEditor } from "../../contexts/EditorContext";

export function StorylineSidebar() {
  const { openTab } = useEditor();
  return <><div className="sidebar__header"><span className="sidebar__title">Storylines</span></div><div className="sidebar__content" style={{ padding: "var(--space-4)" }}><p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", lineHeight: 1.5 }}>Explore a different ending, arc, or premise without disturbing the manuscript you trust. Every return to primary becomes a reviewable Change Set.</p><button className="btn btn--primary" style={{ width: "100%", marginTop: "var(--space-3)" }} onClick={() => openTab({ id: "storylines", kind: "storylines", label: "Storylines" })}>Open Experiments</button></div></>;
}
