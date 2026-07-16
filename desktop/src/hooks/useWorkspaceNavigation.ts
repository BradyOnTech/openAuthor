import { useCallback } from "react";
import { getScene } from "../api";
import { useEditor } from "../contexts/EditorContext";
import { useUI, type ActivityView } from "../contexts/UIContext";
import { useWorkspace } from "../contexts/WorkspaceContext";

/**
 * Author-facing workspace navigation belongs in one place. The activity rail,
 * keyboard shortcuts, command palette, and onboarding all call this hook so a
 * destination cannot update the sidebar while leaving unrelated editor content
 * in the center of the screen.
 */
export function useWorkspaceNavigation() {
  const { setActiveView, setSidebarOpen } = useUI();
  const { tabs, activeTabId, openTab, setActiveTab } = useEditor();
  const { projectRoot, scenes, setError } = useWorkspace();

  return useCallback(async (view: ActivityView) => {
    setActiveView(view);
    setSidebarOpen(true);

    if (view === "plan") {
      openTab({ id: "plan", kind: "plan", label: "Plan" });
      return;
    }
    if (view === "storylines") {
      openTab({ id: "storylines", kind: "storylines", label: "Storylines" });
      return;
    }
    if (view === "settings") {
      openTab({ id: "settings", kind: "settings", label: "Settings" });
      return;
    }
    if (view !== "manuscript") return;

    const activeTab = tabs.find((tab) => tab.id === activeTabId);
    if (activeTab?.kind === "scene") return;

    const openSceneTab = [...tabs].reverse().find((tab) => tab.kind === "scene");
    if (openSceneTab) {
      setActiveTab(openSceneTab.id);
      return;
    }
    if (!projectRoot || scenes.length === 0) return;

    try {
      const scene = await getScene(projectRoot, scenes[0].id);
      openTab({ id: `scene:${scene.id}`, kind: "scene", label: scene.title, data: scene });
    } catch (error) {
      setError(`Failed to open the manuscript: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [activeTabId, openTab, projectRoot, scenes, setActiveTab, setActiveView, setError, setSidebarOpen, tabs]);
}

export function focusNewSceneTitle() {
  window.requestAnimationFrame(() => {
    document.getElementById("new-scene-title")?.focus();
  });
}
