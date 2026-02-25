import { useEffect } from "react";
import { useUI } from "../../contexts/UIContext";
import { useEditor } from "../../contexts/EditorContext";
import { ManuscriptExplorer } from "./ManuscriptExplorer";
import { CodexBrowser } from "./CodexBrowser";
import { ProjectSearch } from "./ProjectSearch";
import { ProposalQueue } from "./ProposalQueue";
import { CheckResults } from "./CheckResults";

export function PrimarySidebar() {
  const { sidebarOpen, activeView } = useUI();

  return (
    <div className={`sidebar${sidebarOpen ? "" : " sidebar--collapsed"}`}>
      {sidebarOpen && (
        <>
          {activeView === "manuscript" && <ManuscriptExplorer />}
          {activeView === "codex" && <CodexBrowser />}
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
  const { openTab } = useEditor();

  useEffect(() => {
    openTab({ id: "settings", kind: "settings", label: "Settings" });
  }, [openTab]);

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
