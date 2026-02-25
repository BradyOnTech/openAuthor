import { useEffect } from "react";
import { UIProvider, useUI } from "./contexts/UIContext";
import { WorkspaceProvider } from "./contexts/WorkspaceContext";
import { EditorProvider } from "./contexts/EditorContext";
import { Workbench } from "./components/workbench/Workbench";
import { CommandPalette } from "./components/overlay/CommandPalette";
import { ZenMode } from "./components/overlay/ZenMode";

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
    setActiveView,
    setSidebarOpen,
    setSecondaryTab,
    setSecondarySidebarOpen,
  } = useUI();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      if (mod && e.key === "b" && !e.shiftKey) {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      if (mod && e.shiftKey && e.key === "B") {
        e.preventDefault();
        toggleSecondarySidebar();
        return;
      }

      if (mod && e.key === "j") {
        e.preventDefault();
        togglePanel();
        return;
      }

      if (mod && e.shiftKey && e.key === "Z") {
        e.preventDefault();
        toggleZenMode();
        return;
      }

      if (mod && e.shiftKey && e.key === "T") {
        e.preventDefault();
        toggleTheme();
        return;
      }

      if (mod && e.shiftKey && e.key === "E") {
        e.preventDefault();
        setActiveView("manuscript");
        setSidebarOpen(true);
        return;
      }

      if (mod && e.shiftKey && e.key === "X") {
        e.preventDefault();
        setActiveView("codex");
        setSidebarOpen(true);
        return;
      }

      if (mod && e.shiftKey && e.key === "F") {
        e.preventDefault();
        setActiveView("search");
        setSidebarOpen(true);
        return;
      }

      if (mod && e.shiftKey && e.key === "R") {
        e.preventDefault();
        setActiveView("proposals");
        setSidebarOpen(true);
        return;
      }

      if (mod && e.shiftKey && e.key === "C") {
        e.preventDefault();
        setActiveView("checks");
        setSidebarOpen(true);
        return;
      }

      if (mod && e.key === "l") {
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
    toggleTheme, setCommandPaletteOpen, setActiveView, setSidebarOpen,
    setSecondaryTab, setSecondarySidebarOpen,
  ]);

  return <>{children}</>;
}

export function AppV2() {
  return (
    <UIProvider>
      <ThemeInitializer>
        <WorkspaceProvider>
          <EditorProvider>
            <KeyboardShortcuts>
              <Workbench />
              <CommandPalette />
              <ZenMode />
            </KeyboardShortcuts>
          </EditorProvider>
        </WorkspaceProvider>
      </ThemeInitializer>
    </UIProvider>
  );
}
