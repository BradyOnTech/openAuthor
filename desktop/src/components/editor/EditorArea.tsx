import { useEditor } from "../../contexts/EditorContext";
import { TabBar } from "./TabBar";
import { SceneEditor } from "./SceneEditor";
import { ProposalReview } from "./ProposalReview";
import { SettingsEditor } from "./SettingsEditor";
import type { SceneDetail, ProposalRecord, CodexEntity } from "../../types";

export function EditorArea() {
  const { tabs, activeTabId } = useEditor();
  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div className="editor-area">
      <TabBar />
      {activeTab ? (
        <EditorContent tab={activeTab} />
      ) : (
        <EmptyState />
      )}
    </div>
  );
}

function EditorContent({ tab }: { tab: { id: string; kind: string; data?: unknown } }) {
  switch (tab.kind) {
    case "scene": {
      const scene = tab.data as SceneDetail | undefined;
      if (!scene) return <EmptyState />;
      return <SceneEditor key={tab.id} scene={scene} />;
    }
    case "proposal": {
      const proposal = tab.data as ProposalRecord | undefined;
      if (!proposal) return <EmptyState />;
      return <ProposalReview proposal={proposal} />;
    }
    case "codex": {
      const entity = tab.data as CodexEntity | undefined;
      return (
        <div style={{ padding: "var(--space-6) var(--space-8)", background: "var(--bg-surface)", minHeight: "100%", overflow: "auto" }}>
          <div style={{ maxWidth: "var(--editor-max-width)", margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
              <span style={{ fontSize: "var(--text-lg)", color: "var(--text-tertiary)" }}>{"\u25C6"}</span>
              <h2 style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-xl)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
                {entity?.name ?? "Entity"}
              </h2>
              {entity?.type && <span className="badge badge--info">{entity.type}</span>}
            </div>
            {entity?.description && (
              <p style={{ fontSize: "var(--text-md)", lineHeight: "var(--leading-relaxed)", color: "var(--text-primary)" }}>
                {entity.description}
              </p>
            )}
            {!entity?.description && (
              <p style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)", fontStyle: "italic" }}>
                No description yet.
              </p>
            )}
          </div>
        </div>
      );
    }
    case "settings":
      return <SettingsEditor />;
    default:
      return <EmptyState />;
  }
}

function EmptyState() {
  return (
    <div style={{
      flex: 1,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--bg-deep)",
      gap: "var(--space-4)",
    }}>
      <div style={{
        fontFamily: "var(--font-prose)",
        fontSize: "var(--text-2xl)",
        fontWeight: "var(--weight-light)",
        color: "var(--text-ghost)",
        letterSpacing: "var(--tracking-tight)",
      }}>
        openAuthor
      </div>
      <div style={{
        fontSize: "var(--text-sm)",
        color: "var(--text-ghost)",
        textAlign: "center",
        lineHeight: "var(--leading-relaxed)",
      }}>
        Select a scene from the sidebar to begin writing.
        <br />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
          Cmd+K to open command palette
        </span>
      </div>
    </div>
  );
}
