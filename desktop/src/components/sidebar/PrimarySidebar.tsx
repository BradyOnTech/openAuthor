import { useUI } from "../../contexts/UIContext";
import { ManuscriptExplorer } from "./ManuscriptExplorer";
import { CodexBrowser } from "./CodexBrowser";
import { ProjectSearch } from "./ProjectSearch";
import { ProposalQueue } from "./ProposalQueue";
import { CheckResults } from "./CheckResults";
import { PlanSidebar } from "./PlanSidebar";
import { StorylineSidebar } from "./StorylineSidebar";

export function PrimarySidebar() {
  const { sidebarOpen, activeView } = useUI();

  return (
    <div className={`sidebar${sidebarOpen ? "" : " sidebar--collapsed"}`}>
      {sidebarOpen && (
        <>
          {activeView === "manuscript" && <ManuscriptExplorer />}
          {activeView === "plan" && <PlanSidebar />}
          {activeView === "codex" && <CodexBrowser />}
          {activeView === "storylines" && <StorylineSidebar />}
          {activeView === "search" && <ProjectSearch />}
          {activeView === "proposals" && <ProposalQueue />}
          {activeView === "checks" && <CheckResults />}
          {activeView === "settings" && <SettingsView />}
        </>
      )}
    </div>
  );
}

function SettingsView() {
  return (
    <>
      <div className="sidebar__header">
        <span className="sidebar__title">Settings</span>
      </div>
      <div className="sidebar__content" style={{ padding: "var(--space-4)" }}>
        <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", lineHeight: "var(--leading-relaxed)" }}>
          Connect ChatGPT, set writing preferences, and export or back up this book.
        </p>
        <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", lineHeight: "var(--leading-relaxed)", marginTop: "var(--space-3)" }}>
          Everything is stored in this book&apos;s folder on your computer. Nothing is sent anywhere until you approve a request to an AI provider.
        </p>
      </div>
    </>
  );
}
