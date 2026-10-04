import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { readWorkspace, restoreBookmarks, saveWorkspace, workspaceKey } from "../tabRecovery";
import type { SceneDetail, CodexEntity, ProposalRecord, RevisionSummary, ManuscriptPlan, CanonEvidence } from "../types";

export type EditorTabKind = "scene" | "reader" | "plan" | "memory" | "connections" | "storylines" | "codex" | "proposal" | "alternatives" | "revision" | "generate" | "outliner" | "settings" | "writing-voice";

export type RevisionDraft = { sceneId?: string; instruction: string };

export type EditorTab = {
  id: string;
  kind: EditorTabKind;
  label: string;
  modified?: boolean;
  focusPassage?: CanonEvidence;
  data?: SceneDetail | CodexEntity | ProposalRecord | ProposalRecord[] | RevisionSummary | ManuscriptPlan | { voiceBrief: string } | { noteId: string } | { memoryView: "suggestions" | "canon"; suggestionId?: string } | RevisionDraft | null;
};

export type SplitDirection = "none" | "horizontal" | "vertical";

type EditorState = {
  tabs: EditorTab[];
  activeTabId: string;
  splitDirection: SplitDirection;
  secondaryActiveTabId: string;

  openTab: (tab: EditorTab) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, updates: Partial<EditorTab>) => void;
  beginNavigation: () => () => boolean;

  setSplitDirection: (d: SplitDirection) => void;
  setSecondaryActiveTab: (id: string) => void;
};

const EditorCtx = createContext<EditorState | null>(null);

export function useEditor(): EditorState {
  const ctx = useContext(EditorCtx);
  if (!ctx) throw new Error("useEditor must be used within EditorProvider");
  return ctx;
}

export function EditorProvider({ children, projectRoot = "", scope = "main" }: { children: ReactNode; projectRoot?: string; scope?: string }) {
  const [{ tabs, activeTabId }, setTabState] = useState<{ tabs: EditorTab[]; activeTabId: string }>({ tabs: [], activeTabId: "" });
  const [splitDirection, setSplitDirection] = useState<SplitDirection>("none");
  const [secondaryActiveTabId, setSecondaryActiveTabId] = useState("");
  const navigationRevision = useRef(0);
  const key = projectRoot ? workspaceKey(projectRoot, scope) : "";
  const [hydratedKey, setHydratedKey] = useState("");
  useEffect(() => {
    if (!key) return;
    let current = true;
    const revision = navigationRevision.current;
    const saved = readWorkspace(key);
    if (!saved) { setHydratedKey(key); return; }
    void restoreBookmarks(projectRoot, saved).then(restored => {
      if (!current) return;
      if (revision === navigationRevision.current) {
        setTabState({ tabs: restored, activeTabId: restored.some(row => row.id === saved.activeTabId) ? saved.activeTabId : restored[0]?.id || "" });
        setSplitDirection(saved.splitDirection);
        setSecondaryActiveTabId(restored.some(row => row.id === saved.secondaryActiveTabId) ? saved.secondaryActiveTabId : "");
      }
      setHydratedKey(key);
    });
    return () => { current = false; };
  }, [key, projectRoot]);
  useEffect(() => {
    if (key && hydratedKey === key) saveWorkspace(key, tabs, activeTabId, splitDirection, secondaryActiveTabId);
  }, [key, hydratedKey, tabs, activeTabId, splitDirection, secondaryActiveTabId]);
  useEffect(() => () => { ++navigationRevision.current; }, []);
  const beginNavigation = useCallback(() => {
    const revision = ++navigationRevision.current;
    return () => revision === navigationRevision.current;
  }, []);

  const openTab = useCallback((tab: EditorTab) => {
    ++navigationRevision.current;
    setTabState((prev) => ({
      tabs: prev.tabs.some((t) => t.id === tab.id)
        ? prev.tabs.map((t) => (t.id === tab.id ? { ...t, ...tab } : t))
        : [...prev.tabs, tab],
      activeTabId: tab.id,
    }));
  }, []);

  const closeTab = useCallback((id: string) => {
    ++navigationRevision.current;
    setTabState((prev) => {
      const idx = prev.tabs.findIndex((t) => t.id === id);
      const next = prev.tabs.filter((t) => t.id !== id);
      return {
        tabs: next,
        activeTabId: next.length === 0 ? ""
          : id === prev.activeTabId ? next[Math.min(idx, next.length - 1)].id : prev.activeTabId,
      };
    });
  }, []);

  const setActiveTab = useCallback((id: string) => {
    ++navigationRevision.current;
    setTabState((prev) => ({ ...prev, activeTabId: id }));
  }, []);

  const updateTab = useCallback((id: string, updates: Partial<EditorTab>) => {
    setTabState((prev) => ({ ...prev, tabs: prev.tabs.map((t) => (t.id === id ? { ...t, ...updates } : t)) }));
  }, []);

  const setSecondaryActiveTab = useCallback((id: string) => {
    setSecondaryActiveTabId(id);
  }, []);

  const value: EditorState = {
    tabs,
    activeTabId,
    splitDirection,
    secondaryActiveTabId,
    openTab,
    closeTab,
    setActiveTab,
    updateTab,
    beginNavigation,
    setSplitDirection,
    setSecondaryActiveTab,
  };

  return <EditorCtx.Provider value={value}>{children}</EditorCtx.Provider>;
}
