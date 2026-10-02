import type { SceneDetail } from "./types";
import type { SceneConflict } from "./sceneConflicts";

// The loaded-scene precondition and save queue survive tab unmounts together.
// A returning editor contributes to the same latest draft while a write drains.
const queues = new Map<string, ReturnType<typeof newQueue>>();
function newQueue(scene: SceneDetail, tabId: string) {
  return {
    lastSaved: { current: { title: scene.title, body: scene.body } },
    baseVersion: { current: scene.edit_version },
    latest: { current: { sceneId: scene.id, title: scene.title, body: scene.body, tabId } },
    pending: { current: null as Promise<void> | null },
    conflict: { current: null as SceneConflict | null },
    acknowledged: { current: null as SceneDetail | null },
    mounts: 0,
  };
}
export function editorSaveQueue(root: string, scene: SceneDetail, tabId: string) {
  const key = JSON.stringify([root, scene.edit_version?.workspace, scene.id]);
  let queue = queues.get(key);
  if (!queue) { queue = newQueue(scene, tabId); queues.set(key, queue); }
  const current = queue;
  return { ...current, mount() {
    ++current.mounts;
    return () => {
      --current.mounts;
      const forget = () => {
        if (!current.mounts && !current.pending.current && !current.conflict.current && current.latest.current.title === current.lastSaved.current.title && current.latest.current.body === current.lastSaved.current.body && queues.get(key) === current) queues.delete(key);
      };
      if (current.pending.current) void current.pending.current.finally(forget);
      else queueMicrotask(forget);
    };
  } };
}
