import { useUI } from "../../contexts/UIContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { ActivityBar } from "./ActivityBar";
import { StatusBar } from "./StatusBar";
import { PrimarySidebar } from "../sidebar/PrimarySidebar";
import { EditorArea } from "../editor/EditorArea";
import { SecondarySidebar } from "../secondary/SecondarySidebar";
import { PanelArea } from "../panel/PanelArea";

export function Workbench() {
  const { sidebarOpen, secondarySidebarOpen, panelOpen, zenMode } = useUI();
  const { projectFound, projectRoot, setProjectRoot, error, message, setError, setMessage } = useWorkspace();

  if (zenMode) return null;

  const classes = [
    "workbench",
    !sidebarOpen && "workbench--no-sidebar",
    !secondarySidebarOpen && "workbench--no-secondary",
    !panelOpen && "workbench--no-panel",
  ].filter(Boolean).join(" ");

  return (
    <>
      {projectFound === false && (
        <ProjectSetup projectRoot={projectRoot} setProjectRoot={setProjectRoot} />
      )}
      {(error || message) && (
        <div style={{
          position: "fixed",
          top: "var(--space-2)",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 500,
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

function ProjectSetup({ projectRoot, setProjectRoot }: {
  projectRoot: string;
  setProjectRoot: (v: string) => void;
}) {
  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 600,
      background: "var(--backdrop)",
      backdropFilter: "blur(var(--backdrop-blur))",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}>
      <div style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-8)",
        maxWidth: 400,
        width: "100%",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        boxShadow: "var(--shadow-lg)",
      }}>
        <h2 style={{
          fontFamily: "var(--font-prose)",
          fontSize: "var(--text-2xl)",
          fontWeight: "var(--weight-semibold)",
          color: "var(--text-primary)",
        }}>
          openAuthor
        </h2>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: "var(--leading-relaxed)" }}>
          Enter the path to your openAuthor project directory.
        </p>
        <input
          className="input input--mono"
          placeholder="/path/to/your/project"
          value={projectRoot}
          onChange={(e) => setProjectRoot(e.target.value)}
          autoFocus
        />
        <p style={{ fontSize: "var(--text-xs)", color: "var(--text-ghost)" }}>
          The directory should contain a <code style={{ fontFamily: "var(--font-mono)" }}>manuscript/</code> folder
          or be initialized with <code style={{ fontFamily: "var(--font-mono)" }}>openauthor init</code>.
        </p>
      </div>
    </div>
  );
}
