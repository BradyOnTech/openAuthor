import { useEditor, type RevisionDraft } from "../../contexts/EditorContext";
import { useUI } from "../../contexts/UIContext";
import { TabBar } from "./TabBar";
import { SceneDocument } from "./SceneDocument";
import { ManuscriptReader } from "./ManuscriptReader";
import { ProposalReview } from "./ProposalReview";
import { SettingsEditor } from "./SettingsEditor";
import { GenerateProposal } from "./GenerateProposal";
import { RevisionReview } from "./RevisionReview";
import { PlanEditor } from "./PlanEditor";
import { StoryMemoryEditor } from "./StoryMemoryEditor";
import { MemoryWorkspace, type MemoryViewRequest } from "./MemoryWorkspace";
import { ConnectionGraphEditor } from "./ConnectionGraphEditor";
import { StorylineEditor } from "./StorylineEditor";
import { AlternativeComparison } from "./AlternativeComparison";
import { WritingVoiceEditor } from "./WritingVoiceEditor";
import type { SceneDetail, ProposalRecord, CodexEntity, RevisionSummary } from "../../types";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { focusNewSceneTitle, useWorkspaceNavigation } from "../../hooks/useWorkspaceNavigation";

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

function EditorContent({ tab }: { tab: { id: string; kind: string; data?: unknown; modified?: boolean; focusPassage?: import("../../types").CanonEvidence } }) {
  const { zenMode, setZenMode } = useUI();
  switch (tab.kind) {
    case "writing-voice":
      return <WritingVoiceEditor key={JSON.stringify(tab.data) || tab.id} initialBrief={(tab.data as { voiceBrief?: string } | undefined)?.voiceBrief} />;
    case "reader":
      return <ManuscriptReader />;
    case "scene": {
      const scene = tab.data as SceneDetail | undefined;
      if (!scene) return <EmptyState />;
      return <SceneDocument key={tab.id} tabId={tab.id} scene={scene} modified={tab.modified} focusPassage={tab.focusPassage} zenMode={zenMode} onExitZen={() => setZenMode(false)} />;
    }
    case "plan":
      return <PlanEditor focusNoteId={(tab.data as { noteId?: string } | undefined)?.noteId} />;
    case "memory":
      return <MemoryWorkspace request={tab.data as MemoryViewRequest | undefined} />;
    case "connections":
      return <ConnectionGraphEditor />;
    case "storylines":
      return <StorylineEditor />;
    case "proposal": {
      const proposal = tab.data as ProposalRecord | undefined;
      if (!proposal) return <EmptyState />;
      return <ProposalReview key={tab.id} proposal={proposal} />;
    }
    case "alternatives": {
      const proposals = tab.data as ProposalRecord[] | undefined;
      return proposals ? <AlternativeComparison proposals={proposals} /> : <EmptyState />;
    }
    case "revision": {
      const revision = tab.data as RevisionSummary | undefined;
      if (!revision) return <EmptyState />;
      return <RevisionReview revision={revision} />;
    }
    case "codex": {
      const entity = tab.data as CodexEntity | undefined;
      return entity ? <StoryMemoryEditor entity={entity} /> : <EmptyState />;
    }
    case "generate": {
      const scene = tab.data as SceneDetail | undefined;
      const draft = tab.data as RevisionDraft | undefined;
      return <GenerateProposal key={tab.id} tabId={tab.id} initialSceneId={draft?.sceneId ?? scene?.id} initialInstruction={draft?.instruction} />;
    }
    case "settings":
      return <SettingsEditor />;
    default:
      return <EmptyState />;
  }
}

function EmptyState() {
  const { activeProjectId, projects, scenes } = useWorkspace();
  const navigateTo = useWorkspaceNavigation();
  const projectName = projects.find((project) => project.id === activeProjectId)?.name ?? "your novel";
  const isBlank = scenes.length === 0;

  return (
    <div className="project-home" style={{
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
        fontSize: "var(--text-3xl)",
        fontWeight: "var(--weight-semibold)",
        color: "var(--text-primary)",
        letterSpacing: "var(--tracking-tight)",
      }}>
        {isBlank ? `Start ${projectName}` : `Continue ${projectName}`}
      </div>
      <div style={{
        fontSize: "var(--text-sm)",
        color: "var(--text-ghost)",
        textAlign: "center",
        lineHeight: "var(--leading-relaxed)",
      }}>
        {isBlank
          ? "Begin with a scene, or shape the premise and structure first. Your manuscript stays in local, readable files."
          : "Open a scene and return to the sentence where you left off."}
      </div>
      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", justifyContent: "center" }}>
        <button className="btn btn--primary" onClick={() => void navigateTo("manuscript").then(focusNewSceneTitle)}>{isBlank ? "Name your first scene" : "Open manuscript"}</button>
        <button className="btn" onClick={() => void navigateTo("plan")}>Plan the story</button>
      </div>
      <div style={{ display: "flex", gap: "var(--space-4)", color: "var(--text-tertiary)", fontSize: "var(--text-xs)", marginTop: "var(--space-3)" }}>
        <span>Write</span><span>→</span><span>Review changes</span><span>→</span><span>Explore Storylines</span>
      </div>
    </div>
  );
}
