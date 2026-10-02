import { updateScene } from "./api";
import { clearSceneRecoveryDraft, writeSceneRecoveryDraft } from "./recoveryJournal";
import type { SceneDetail } from "./types";
import { isProjectBookChanging, withBookVersionBarrier } from "./bookOperationBarrier";

type Snapshot = {
  title: string;
  body: string;
  saved: SceneDetail;
  saving: boolean;
  error: string;
  readOnly: boolean;
};

// Navigation may unmount an editor before its native save finishes. The queue
// belongs to the project and scene, not to a particular React component.
type MountedSave = { projectRoot: string; sceneId: string; scope: string; flush: () => Promise<boolean>; setReadOnly: (value: boolean) => void };
const mountedSaves = new Map<string, MountedSave>();
export function registerSceneSave(entry: MountedSave) {
  const key = JSON.stringify([entry.projectRoot, entry.scope, entry.sceneId]);
  mountedSaves.set(key, entry);
  return () => { void entry.flush().then(saved => { if (saved && mountedSaves.get(key) === entry) mountedSaves.delete(key); }); };
}
const sessions = new Map<string, SceneSaveSession>();

export class SceneSaveSession {
  private state: Snapshot;
  private listeners = new Set<() => void>();
  private pending: Promise<boolean> | null = null;
  private onSaved: (scene: SceneDetail, dirty: boolean) => void = () => {};

  constructor(readonly projectRoot: string, readonly sceneId: string, scene: SceneDetail) {
    this.state = { title: scene.title, body: scene.body, saved: scene, saving: false, error: "", readOnly: isProjectBookChanging(projectRoot) };
  }

  getSnapshot = (): Snapshot => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(next: Partial<Snapshot>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach(listener => listener());
  }

  get dirty() {
    return this.state.title !== this.state.saved.title || this.state.body !== this.state.saved.body;
  }

  acceptScene(scene: SceneDetail) {
    if (this.pending || this.dirty) return;
    if (scene !== this.state.saved) this.publish({ saved: scene, title: scene.title, body: scene.body });
  }

  setOnSaved(callback: (scene: SceneDetail, dirty: boolean) => void) {
    this.onSaved = callback;
  }

  edit(changes: Partial<Pick<Snapshot, "title" | "body">>) {
    if (this.state.readOnly) return;
    this.publish({ ...changes, error: "" });
    try {
      writeSceneRecoveryDraft({
        projectRoot: this.projectRoot, sceneId: this.sceneId,
        baseUpdatedAt: this.state.saved.updated_at,
        title: this.state.title, body: this.state.body,
      });
    } catch {
      this.publish({ error: "Recovery storage is full or unavailable. Save your writing before closing this window." });
    }
  }

  setReadOnly(readOnly: boolean) { this.publish({ readOnly }); }

  flush = (): Promise<boolean> => {
    if (this.pending) return this.pending;
    if (!this.dirty) return Promise.resolve(true);
    // Start on a microtask so reentrant subscribers see the same pending queue.
    this.pending = Promise.resolve().then(async () => {
      this.publish({ saving: true, error: "" });
      try {
        while (this.dirty) {
          const { title, body } = this.state;
          const updated = await updateScene(this.projectRoot, this.sceneId, { title, body, expectedVersion: this.state.saved.edit_version });
          // Preserve the editor's newline convention after serialization.
          const saved = { ...updated, title, body };
          this.publish({ saved });
          if (!this.dirty) clearSceneRecoveryDraft(this.projectRoot, this.sceneId);
          this.onSaved({ ...saved, title: this.state.title, body: this.state.body }, this.dirty);
        }
        return true;
      } catch (error) {
        this.publish({ error: `Save failed: ${error instanceof Error ? error.message : String(error)}` });
        return false;
      } finally {
        this.pending = null;
        this.publish({ saving: false });
        if (!this.listeners.size && !this.dirty) sessions.delete(JSON.stringify([this.projectRoot, this.sceneId]));
      }
    });
    return this.pending;
  };
}

export function sceneSaveSession(projectRoot: string, scene: SceneDetail): SceneSaveSession {
  const key = JSON.stringify([projectRoot, scene.id]);
  let session = sessions.get(key);
  if (!session) {
    session = new SceneSaveSession(projectRoot, scene.id, scene);
    sessions.set(key, session);
  }
  return session;
}

export async function flushProjectSceneSaves(projectRoot: string): Promise<boolean> {
  const results = await Promise.all([...Array.from(mountedSaves.values()).filter(entry => entry.projectRoot === projectRoot).map(entry => entry.flush()), ...[...sessions.values()]
    .filter(session => session.projectRoot === projectRoot)
    .map(session => session.flush())]);
  return results.every(Boolean);
}

export async function withProjectBookChange<T>(projectRoot: string, change: () => Promise<T>): Promise<T> {
  if (isProjectBookChanging(projectRoot)) throw new Error("Another book change is in progress.");
  for (const entry of mountedSaves.values()) if (entry.projectRoot === projectRoot) entry.setReadOnly(true);
  for (const session of sessions.values()) if (session.projectRoot === projectRoot) session.setReadOnly(true);
  try {
    return await withBookVersionBarrier(projectRoot, async () => {
      if (!await flushProjectSceneSaves(projectRoot)) throw new Error("Save your pending writing before changing book versions.");
      return await change();
    });
  } finally {
    for (const entry of mountedSaves.values()) if (entry.projectRoot === projectRoot) entry.setReadOnly(false);
    for (const session of sessions.values()) if (session.projectRoot === projectRoot) session.setReadOnly(false);
  }
}
