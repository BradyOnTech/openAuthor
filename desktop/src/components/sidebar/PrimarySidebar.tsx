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
        <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
          Provider settings are shown in the editor area.
        </p>
      </div>
    </>
  );
}
