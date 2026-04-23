import { useEffect, useMemo, useState } from "react";
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
    <RegistryAuthGate>
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
    </RegistryAuthGate>
  );
}
