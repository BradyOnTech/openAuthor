import { createContext, useContext, useCallback, type ReactNode } from "react";
import { useLocalStorage } from "../hooks/useLocalStorage";

export type Theme = "light" | "dark";

export type ActivityView = "manuscript" | "plan" | "codex" | "storylines" | "search" | "proposals" | "checks" | "settings";

export type SecondaryTab = "chat" | "inspector";

export type PanelTab = "runs" | "merge" | "budget";

type UIState = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;

  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  toggleSidebar: () => void;

  activeView: ActivityView;
  setActiveView: (v: ActivityView) => void;

  secondarySidebarOpen: boolean;
  setSecondarySidebarOpen: (v: boolean) => void;
  toggleSecondarySidebar: () => void;
  secondaryTab: SecondaryTab;
  setSecondaryTab: (t: SecondaryTab) => void;

  panelOpen: boolean;
  setPanelOpen: (v: boolean) => void;
  togglePanel: () => void;
  panelTab: PanelTab;
  setPanelTab: (t: PanelTab) => void;

  zenMode: boolean;
  setZenMode: (v: boolean) => void;
  toggleZenMode: () => void;

  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (v: boolean) => void;
};

const UICtx = createContext<UIState | null>(null);

export function useUI(): UIState {
  const ctx = useContext(UICtx);
  if (!ctx) throw new Error("useUI must be used within UIProvider");
  return ctx;
}

function getSystemTheme(): Theme {
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

export function UIProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeRaw] = useLocalStorage<Theme>("openauthor.theme", getSystemTheme());
  const [sidebarOpen, setSidebarOpen] = useLocalStorage("openauthor.v2.sidebarOpen", true);
  const [activeView, setActiveView] = useLocalStorage<ActivityView>("openauthor.v2.activeView", "manuscript");
  const [secondarySidebarOpen, setSecondarySidebarOpen] = useLocalStorage("openauthor.v2.secondarySidebarOpen", false);
  const [secondaryTabRaw, setSecondaryTabRaw] = useLocalStorage<string>("openauthor.v2.secondaryTab", "chat");
  const secondaryTab: SecondaryTab = secondaryTabRaw === "inspector" ? "inspector" : "chat";
  const setSecondaryTab = useCallback((tab: SecondaryTab) => {
    setSecondaryTabRaw(tab);
  }, [setSecondaryTabRaw]);
  const [panelOpen, setPanelOpen] = useLocalStorage("openauthor.v2.panelOpen", false);
  const [panelTab, setPanelTab] = useLocalStorage<PanelTab>("openauthor.v2.panelTab", "runs");
  const [zenMode, setZenMode] = useLocalStorage("openauthor.v2.zenMode", false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useLocalStorage("openauthor.v2.commandPalette", false);

  const setTheme = useCallback((t: Theme) => {
    setThemeRaw(t);
    document.documentElement.setAttribute("data-theme", t);
  }, [setThemeRaw]);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  const toggleSidebar = useCallback(() => setSidebarOpen((v: boolean) => !v), [setSidebarOpen]);
  const toggleSecondarySidebar = useCallback(() => setSecondarySidebarOpen((v: boolean) => !v), [setSecondarySidebarOpen]);
  const togglePanel = useCallback(() => setPanelOpen((v: boolean) => !v), [setPanelOpen]);
  const toggleZenMode = useCallback(() => setZenMode((v: boolean) => !v), [setZenMode]);

  const value: UIState = {
    theme, setTheme, toggleTheme,
    sidebarOpen, setSidebarOpen, toggleSidebar,
    activeView, setActiveView,
    secondarySidebarOpen, setSecondarySidebarOpen, toggleSecondarySidebar,
    secondaryTab, setSecondaryTab,
    panelOpen, setPanelOpen, togglePanel,
    panelTab, setPanelTab,
    zenMode, setZenMode, toggleZenMode,
    commandPaletteOpen, setCommandPaletteOpen,
  };

  return <UICtx.Provider value={value}>{children}</UICtx.Provider>;
}
