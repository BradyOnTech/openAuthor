import { getCodexEntity, getScene, listCodexEntities, listScenes } from "../api";
import { useEditor } from "../contexts/EditorContext";
import { sceneSaveSession } from "../sceneSaveSession";
import type { CodexEntity, SceneDetail } from "../types";

export function useRefreshBookTabs(projectRoot: string) {
  const { tabs, updateTab, closeTab } = useEditor();
  return async () => {
    const [scenes, entities] = await Promise.all([listScenes(projectRoot), listCodexEntities(projectRoot)]);
    for (const tab of tabs) {
      if (tab.kind === "scene" && tab.data) {
        const id = (tab.data as SceneDetail).id;
        if (!scenes.some(scene => scene.id === id)) { closeTab(tab.id); continue; }
        const scene = await getScene(projectRoot, id);
        sceneSaveSession(projectRoot, scene).acceptScene(scene);
        updateTab(tab.id, { data: scene, label: scene.title, modified: false });
      } else if (tab.kind === "codex" && tab.data) {
        const id = (tab.data as CodexEntity).id;
        if (!entities.some(entity => entity.id === id)) { closeTab(tab.id); continue; }
        const entity = await getCodexEntity(projectRoot, id);
        updateTab(tab.id, { data: entity, label: entity.name, modified: false });
      }
    }
  };
}
