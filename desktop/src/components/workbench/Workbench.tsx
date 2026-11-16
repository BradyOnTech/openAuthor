import { useEffect } from "react";
import { useUI } from "../../contexts/UIContext";
import { useProjectName } from "../../hooks/useProjectName";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useEditor } from "../../contexts/EditorContext";
import { ActivityBar } from "./ActivityBar";
import { StatusBar } from "./StatusBar";
import { PrimarySidebar } from "../sidebar/PrimarySidebar";
import { EditorArea } from "../editor/EditorArea";
import { SecondarySidebar } from "../secondary/SecondarySidebar";
import { PanelArea } from "../panel/PanelArea";
import { WelcomeScreen } from "../welcome/WelcomeScreen";
import { FirstRunGuide } from "../onboarding/FirstRunGuide";
import { primaryModifier } from "../../platformKeys";
import { scheduleHistoryUpkeep } from "../../historyUpkeep";

export function Workbench() {
  const { activeTabId } = useEditor();
  const {
    sidebarOpen,
    secondarySidebarOpen,
    panelOpen,
    setSidebarOpen,
  } = useUI();
  const {
    activeProjectId,
    projectFound,
    projectRoot,
    closeProject,
    error,
    message,
    setError,
    setMessage,
    startupHealth,
    refreshStartupHealth,
  } = useWorkspace();

  const projectName = useProjectName();
  const projectReady = !!(activeProjectId && projectFound === true);

  // Thin old automatic saves, at most once a day, a little after the book opens.
  useEffect(() => (projectReady && projectRoot ? scheduleHistoryUpkeep(projectRoot) : undefined), [projectReady, projectRoot]);

  useEffect(() => {
    const revealEditor = () => {
      if (projectReady && activeTabId && window.innerWidth <= 900) setSidebarOpen(false);
    };
    revealEditor();
    window.addEventListener("resize", revealEditor);
    return () => window.removeEventListener("resize", revealEditor);
  }, [projectReady, activeTabId, setSidebarOpen]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 3200);
    return () => window.clearTimeout(timer);
  }, [message, setMessage]);

  useEffect(() => {
    if (!projectReady) return;
    function handleKeyDown(event: KeyboardEvent) {
      const mod = primaryModifier(event);
      if (mod && event.shiftKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        closeProject();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [projectReady, closeProject]);

  // A remembered book is being reopened: stay quiet rather than flash the
  // welcome screen. The line appears only if opening takes a moment.
  if (activeProjectId && projectRoot && projectFound === null) {
    return (
      <div className="workbench-opening" role="status">
        <span className="workbench-opening__label">Opening {projectName || "your book"}…</span>
      </div>
    );
  }

  if (!projectReady) {
    return <WelcomeScreen />;
  }

  const classes = [
    "workbench",
    !sidebarOpen && "workbench--no-sidebar",
    !secondarySidebarOpen && "workbench--no-secondary",
    !panelOpen && "workbench--no-panel",
  ].filter(Boolean).join(" ");

  return (
    <div className="workbench-frame">
      {(error || message) && (
        <div className={`workbench-notification workbench-notification--${error ? "error" : "message"}`} role={error ? "alert" : "status"}>
          <span className="workbench-notification__text" tabIndex={0} aria-label="Notification details">{error || message}</span>
          <button className="btn btn--ghost btn--sm" aria-label="Dismiss notification" onClick={() => { setError(""); setMessage(""); }}>×</button>
        </div>
      )}
      {startupHealth && !startupHealth.ready && (
        <div style={{ position: "fixed", top: "calc(var(--titlebar-height) + var(--space-3))", left: "50%", transform: "translateX(-50%)", zIndex: 650, width: "min(680px, calc(100vw - 32px))", padding: "var(--space-3) var(--space-4)", borderRadius: "var(--radius-md)", border: "1px solid var(--danger-border)", background: "var(--bg-elevated)", boxShadow: "var(--shadow-lg)", display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, color: "var(--danger-text)", marginBottom: 2 }}>
              This project needs attention before safe revision
            </div>
            {startupHealth.checks.filter((check) => check.status === "error").slice(0, 2).map((check) => (
              <div key={check.id} style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                {check.message} {check.recovery}
              </div>
            ))}
          </div>
          {startupHealth.checks.some((check) => check.repairable) && (
            <button className="btn btn--primary btn--sm" onClick={() => void refreshStartupHealth(true)}>
              Run Safe Repair
            </button>
          )}
        </div>
      )}
      <FirstRunGuide />
      <div className={classes}>
        <ActivityBar />
        <PrimarySidebar />
        <EditorArea />
        <SecondarySidebar />
        <PanelArea />
        <StatusBar />
      </div>
    </div>
  );
}
