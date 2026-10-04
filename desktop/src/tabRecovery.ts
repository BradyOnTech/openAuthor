import { getScene, getCodexEntity, getProposal, listRevisions } from "./api";
import type { EditorTab, SplitDirection } from "./contexts/EditorContext";

type Bookmark = Pick<EditorTab, "id" | "kind" | "label"> & {
  reference?: string;
  references?: string[];
  request?: { sceneId?: string; instruction: string };
};
export type SavedWorkspace = { tabs: Bookmark[]; activeTabId: string; splitDirection: SplitDirection; secondaryActiveTabId: string };
const simpleKinds = new Set(["reader", "plan", "memory", "connections", "storylines", "outliner", "settings", "writing-voice", "generate"]);
export const workspaceKey = (root: string, scope: string) => `openauthor.tabs.v1:${JSON.stringify([root, scope])}`;
export function saveWorkspace(key: string, tabs: EditorTab[], activeTabId: string, splitDirection: SplitDirection, secondaryActiveTabId: string) {
  const bookmarks: Bookmark[] = tabs.slice(0, 40).map(tab => {
    const data = tab.data as { id?: string; sceneId?: string; instruction?: string } | undefined;
    return { id: tab.id, kind: tab.kind, label: tab.label, ...(data?.id ? { reference: data.id } : {}),
      ...(tab.kind === "generate" && data ? { request: {
        ...(typeof data.sceneId === "string" ? { sceneId: data.sceneId } : typeof data.id === "string" ? { sceneId: data.id } : {}),
        instruction: typeof data.instruction === "string" ? data.instruction : "",
      } } : {}),
      ...(tab.kind === "alternatives" && Array.isArray(tab.data) ? { references: tab.data.map(row => row.id) } : {}) };
  });
  try { localStorage.setItem(key, JSON.stringify({ tabs: bookmarks, activeTabId, splitDirection, secondaryActiveTabId })); } catch { /* Saved text has a separate recovery journal. */ }
}
export function readWorkspace(key: string): SavedWorkspace | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    if (!value || !Array.isArray(value.tabs) || value.tabs.length > 40 || typeof value.activeTabId !== "string" || typeof value.secondaryActiveTabId !== "string"
      || !["none", "horizontal", "vertical"].includes(value.splitDirection)) return null;
    const seen = new Set<string>();
    for (const row of value.tabs) {
      if (!row || typeof row.id !== "string" || typeof row.kind !== "string" || typeof row.label !== "string" || seen.has(row.id) || (row.reference !== undefined && typeof row.reference !== "string")
        || row.references !== undefined && (!Array.isArray(row.references) || row.references.some((id: unknown) => typeof id !== "string"))
        || row.request !== undefined && (row.kind !== "generate" || !row.request || typeof row.request !== "object" || Array.isArray(row.request)
          || typeof row.request.instruction !== "string" || row.request.sceneId !== undefined && typeof row.request.sceneId !== "string"
          || Object.keys(row.request).some(field => !["sceneId", "instruction"].includes(field)))) return null;
      seen.add(row.id);
    }
    return value;
  } catch { return null; }
}
export async function restoreBookmarks(root: string, saved: SavedWorkspace): Promise<EditorTab[]> {
  const restored = await Promise.all(saved.tabs.map(async (tab): Promise<EditorTab | null> => {
    try {
      if (simpleKinds.has(tab.kind)) return { id: tab.id, kind: tab.kind, label: tab.label, ...(tab.kind === "generate" && tab.request ? { data: { ...tab.request } } : {}) };
      if (tab.kind === "scene" && tab.reference) { const scene = await getScene(root, tab.reference); return { ...tab, label: scene.title, data: scene }; }
      if (tab.kind === "codex" && tab.reference) { const entity = await getCodexEntity(root, tab.reference); return { ...tab, label: entity.name, data: entity }; }
      if (tab.kind === "proposal" && tab.reference) { const proposal = await getProposal(root, tab.reference); return { ...tab, data: proposal }; }
      if (tab.kind === "alternatives" && tab.references?.length) { const proposals = await Promise.all(tab.references.map(id => getProposal(root, id))); return { ...tab, data: proposals }; }
      if (tab.kind === "revision" && tab.reference) { const revision = (await listRevisions(root, 500)).find(row => row.id === tab.reference); return revision ? { ...tab, data: revision } : null; }
      return null;
    } catch { return null; } // Deleted or inaccessible artifacts cannot reopen stale snapshots.
  }));
  return restored.filter((tab): tab is EditorTab => Boolean(tab));
}
