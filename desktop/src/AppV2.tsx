import { useEffect, useMemo, useState } from "react";
import { UIProvider, useUI } from "./contexts/UIContext";
import { WorkspaceProvider, useWorkspace } from "./contexts/WorkspaceContext";
import { EditorProvider } from "./contexts/EditorContext";
import { Workbench } from "./components/workbench/Workbench";
import { CommandPalette } from "./components/overlay/CommandPalette";
import { ZenMode } from "./components/overlay/ZenMode";
import { useWorkspaceNavigation } from "./hooks/useWorkspaceNavigation";

function ThemeInitializer({ children }: { children: React.ReactNode }) {
  const { theme } = useUI();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return <>{children}</>;
}

function requiresRegistryAuth(): boolean {
  const meta = import.meta as unknown as {
    env?: Record<string, string | undefined>;
  };
  return Boolean(meta.env?.VITE_SUPABASE_URL && meta.env?.VITE_SUPABASE_ANON_KEY);
}

function RegistryAuthGate({ children }: { children: React.ReactNode }) {
  const [tokenInput, setTokenInput] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const enabled = useMemo(() => requiresRegistryAuth(), []);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      setHasToken(true);
      return;
    }
    const token = window.localStorage.getItem("openauthor.supabaseAccessToken");
    setHasToken(Boolean(token && token.trim()));
  }, [enabled]);

  if (!enabled || hasToken) {
    return <>{children}</>;
  }

  return (
    <div style={{
      minHeight: "100vh",
      display: "grid",
      placeItems: "center",
      background: "var(--bg-canvas)",
      padding: "var(--space-8)",
    }}>
      <div style={{
        width: "100%",
        maxWidth: 540,
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--radius-lg)",
        background: "var(--bg-elevated)",
        padding: "var(--space-6)",
        display: "grid",
        gap: "var(--space-4)",
      }}>
        <h1 style={{ margin: 0, fontSize: "var(--text-2xl)" }}>Sign In Required</h1>
        <p style={{ margin: 0, color: "var(--text-secondary)" }}>
          This build is configured for Supabase-backed project registry. Paste a valid access token to continue.
        </p>
        <input
          className="input input--mono"
          value={tokenInput}
          onChange={(event) => setTokenInput(event.target.value)}
          placeholder="Supabase access token"
        />
        <button
          className="button button--primary"
          onClick={() => {
            if (typeof window === "undefined") return;
            window.localStorage.setItem("openauthor.supabaseAccessToken", tokenInput.trim());
            setHasToken(tokenInput.trim() !== "");
          }}
        >
          Continue
        </button>
      </div>
    </div>
  );
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
  const { activeProjectId } = useWorkspace();
  return <EditorProvider key={activeProjectId || "welcome"}>{children}</EditorProvider>;
}

export function AppV2() {
  return (
    <RegistryAuthGate>
      <UIProvider>
        <ThemeInitializer>
          <WorkspaceProvider>
            <ProjectScopedEditor>
              <KeyboardShortcuts>
                <Workbench />
                <CommandPalette />
                <ZenMode />
              </KeyboardShortcuts>
            </ProjectScopedEditor>
          </WorkspaceProvider>
        </ThemeInitializer>
      </UIProvider>
    </RegistryAuthGate>
  );
}
