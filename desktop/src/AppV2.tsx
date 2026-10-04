import { useEffect, useRef } from "react";
import { RegistryAuthGate } from "./cloud/RegistryAuthGate";
import { UIProvider, useUI } from "./contexts/UIContext";
import { WorkspaceProvider, useWorkspace } from "./contexts/WorkspaceContext";
import { EditorProvider } from "./contexts/EditorContext";
import { Workbench } from "./components/workbench/Workbench";
import { CommandPalette } from "./components/overlay/CommandPalette";
import { useWorkspaceNavigation } from "./hooks/useWorkspaceNavigation";
import { loadProjectBindings } from "./projectBindings";

function ThemeInitializer({ children }: { children: React.ReactNode }) {
  const { theme } = useUI();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return <>{children}</>;
}

function KeyboardShortcuts({ children }: { children: React.ReactNode }) {
  const {
    toggleSidebar,
    toggleSecondarySidebar,
    togglePanel,
    toggleZenMode,
    toggleTheme,
    setCommandPaletteOpen,
    setSecondaryTab,
    setSecondarySidebarOpen,
  } = useUI();
  const navigateTo = useWorkspaceNavigation();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === "k" && !e.shiftKey) {
        e.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      if (mod && key === "b" && !e.shiftKey) {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      if (mod && e.shiftKey && key === "b") {
        e.preventDefault();
        toggleSecondarySidebar();
        return;
      }

      if (mod && key === "j") {
        e.preventDefault();
        togglePanel();
        return;
      }

      if (mod && e.shiftKey && key === "z") {
        e.preventDefault();
        toggleZenMode();
        return;
      }

      if (mod && e.shiftKey && key === "t") {
        e.preventDefault();
        toggleTheme();
        return;
      }

      if (mod && e.shiftKey && key === "e") {
        e.preventDefault();
        void navigateTo("manuscript");
        return;
      }

      if (mod && e.shiftKey && key === "p") {
        e.preventDefault();
        void navigateTo("plan");
        return;
      }

      if (mod && e.shiftKey && key === "x") {
        e.preventDefault();
        void navigateTo("codex");
        return;
      }

      if (mod && e.shiftKey && key === "l") {
        e.preventDefault();
        void navigateTo("storylines");
        return;
      }

      if (mod && e.shiftKey && key === "f") {
        e.preventDefault();
        void navigateTo("search");
        return;
      }

      if (mod && e.shiftKey && key === "r") {
        e.preventDefault();
        void navigateTo("proposals");
        return;
      }

      if (mod && e.shiftKey && key === "c") {
        e.preventDefault();
        void navigateTo("checks");
        return;
      }

      if (mod && key === "," && !e.shiftKey) {
        e.preventDefault();
        void navigateTo("settings");
        return;
      }

      if (mod && key === "l" && !e.shiftKey) {
        e.preventDefault();
        setSecondaryTab("chat");
        setSecondarySidebarOpen(true);
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    toggleSidebar, toggleSecondarySidebar, togglePanel, toggleZenMode,
    toggleTheme, setCommandPaletteOpen, navigateTo,
    setSecondaryTab, setSecondarySidebarOpen,
  ]);

  return <>{children}</>;
}

function ProjectScopedEditor({ children }: { children: React.ReactNode }) {
  const { activeProjectId, projectRoot, branches } = useWorkspace();
  const { setActiveView, setSidebarOpen, setSecondarySidebarOpen, setPanelOpen } = useUI();
  // The ID cache may be absent while the registry/route restores the last book.
  // Its retained initial root is evidence only when one valid binding owns it.
  const boundIds = activeProjectId || !projectRoot ? [] : Object.entries(loadProjectBindings())
    .filter(([id, binding]) => binding.projectId === id && binding.localPath === projectRoot).map(([id]) => id);
  const previousProjectId = useRef(activeProjectId || (boundIds.length === 1 ? boundIds[0] : ""));
  const resolvingInitialProject = useRef(!activeProjectId && boundIds.length === 1);
  useEffect(() => {
    if (resolvingInitialProject.current && !activeProjectId) return;
    resolvingInitialProject.current = false;
    const changed = previousProjectId.current !== activeProjectId;
    previousProjectId.current = activeProjectId;
    if (!changed || !activeProjectId) return;
    // This wrapper survives the keyed editor. Reset for a different project,
    // while restart keeps the author's independent document and tool choices.
    setActiveView("manuscript");
    setSidebarOpen(true);
    setSecondarySidebarOpen(false);
    setPanelOpen(false);
  }, [activeProjectId, setActiveView, setPanelOpen, setSecondarySidebarOpen, setSidebarOpen]);
  const scope = branches.find(row => row.current)?.name || "main";
  return <EditorProvider key={activeProjectId || "welcome"} projectRoot={projectRoot} scope={scope}>{children}</EditorProvider>;
}

export function AppV2() {
  return (
    <RegistryAuthGate>
      {(registryMode) => (
      <UIProvider>
        <ThemeInitializer>
          <WorkspaceProvider registryMode={registryMode}>
            <ProjectScopedEditor>
              <KeyboardShortcuts>
                <Workbench />
                <CommandPalette />
              </KeyboardShortcuts>
            </ProjectScopedEditor>
          </WorkspaceProvider>
        </ThemeInitializer>
      </UIProvider>
      )}
    </RegistryAuthGate>
  );
}
