import { useEffect } from "react";
import { useUI } from "../../contexts/UIContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { ActivityBar } from "./ActivityBar";
import { StatusBar } from "./StatusBar";
import { PrimarySidebar } from "../sidebar/PrimarySidebar";
import { EditorArea } from "../editor/EditorArea";
import { SecondarySidebar } from "../secondary/SecondarySidebar";
import { PanelArea } from "../panel/PanelArea";
import { WelcomeScreen } from "../welcome/WelcomeScreen";
import { FirstRunGuide } from "../onboarding/FirstRunGuide";

export function Workbench() {
  const {
    sidebarOpen,
    secondarySidebarOpen,
    panelOpen,
    setActiveView,
    setSidebarOpen,
    setSecondarySidebarOpen,
    setPanelOpen,
  } = useUI();
  const {
    activeProjectId,
    projectFound,
    closeProject,
    error,
    message,
    setError,
    setMessage,
    startupHealth,
    refreshStartupHealth,
  } = useWorkspace();

  const projectReady = !!(activeProjectId && projectFound === true);

  useEffect(() => {
    if (!activeProjectId) return;
    setActiveView("manuscript");
    setSidebarOpen(true);
    setSecondarySidebarOpen(false);
    setPanelOpen(false);
  }, [activeProjectId, setActiveView, setPanelOpen, setSecondarySidebarOpen, setSidebarOpen]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 3200);
    return () => window.clearTimeout(timer);
  }, [message, setMessage]);

  useEffect(() => {
    if (!projectReady) return;
    function handleKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.shiftKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        closeProject();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [projectReady, closeProject]);

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
        <div className="workbench-notification" role={error ? "alert" : "status"} style={{
          background: error ? "var(--danger-subtle)" : "var(--success-subtle)",
          borderBottom: `1px solid ${error ? "var(--danger-border)" : "var(--success-border)"}`,
          color: error ? "var(--danger-text)" : "var(--success-text)",
        }}>
          <span className="workbench-notification__text" tabIndex={0} aria-label="Notification details">{error || message}</span>
          <button className="btn btn--ghost btn--sm" aria-label="Dismiss notification" onClick={() => { setError(""); setMessage(""); }}>×</button>
        </div>
      )}
      {startupHealth && !startupHealth.ready && (
        <div style={{ position: "fixed", top: "var(--space-3)", left: "50%", transform: "translateX(-50%)", zIndex: 650, width: "min(680px, calc(100vw - 32px))", padding: "var(--space-3) var(--space-4)", borderRadius: "var(--radius-md)", border: "1px solid var(--danger-border)", background: "var(--bg-elevated)", boxShadow: "var(--shadow-lg)", display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
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
