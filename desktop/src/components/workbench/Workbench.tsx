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

export function Workbench() {
  const { sidebarOpen, secondarySidebarOpen, panelOpen, zenMode } = useUI();
  const {
    activeProjectId,
    projectFound,
    closeProject,
    error,
    message,
    setError,
    setMessage,
  } = useWorkspace();

  const projectReady = !!(activeProjectId && projectFound === true);

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

  if (zenMode) return null;

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
    <>
      {(error || message) && (
        <div style={{
          position: "fixed",
          top: "var(--space-2)",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 700,
          padding: "var(--space-2) var(--space-4)",
          borderRadius: "var(--radius-md)",
          fontSize: "var(--text-sm)",
          maxWidth: "500px",
          background: error ? "var(--danger-subtle)" : "var(--success-subtle)",
          border: `1px solid ${error ? "var(--danger-border)" : "var(--success-border)"}`,
          color: error ? "var(--danger-text)" : "var(--success-text)",
          cursor: "pointer",
        }} onClick={() => { setError(""); setMessage(""); }}>
          {error || message}
        </div>
      )}
      <div className={classes}>
        <ActivityBar />
        <PrimarySidebar />
        <EditorArea />
        <SecondarySidebar />
        <PanelArea />
        <StatusBar />
      </div>
    </>
  );
}
