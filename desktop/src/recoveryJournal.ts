import type { SceneEditVersion } from "./types";

export type SceneRecoveryDraft = {
  schemaVersion: 1 | 2;
  projectRoot: string;
  sceneId: string;
  baseUpdatedAt: string;
  title: string;
  body: string;
  journaledAt: string;
  baseVersion?: SceneEditVersion;
  draftId?: string;
  sequence?: number;
};

const PREFIX = "openauthor.sceneRecovery.v1";
const OWNED_PREFIX = "openauthor.sceneRecovery.v2";

function normalizedEditorText(value: string): string {
  return value.replace(/\r\n/g, "\n").trimEnd();
}

export function recoveryDraftMatchesScene(
  draft: Pick<SceneRecoveryDraft, "title" | "body">,
  scene: { title: string; body: string }
): boolean {
  return draft.title === scene.title && normalizedEditorText(draft.body) === normalizedEditorText(scene.body);
}

function storageKey(projectRoot: string, sceneId: string): string {
  return `${PREFIX}:${encodeURIComponent(projectRoot)}:${encodeURIComponent(sceneId)}`;
}

function ownedPrefix(projectRoot: string, sceneId: string): string {
  return `${OWNED_PREFIX}:${encodeURIComponent(projectRoot)}:${encodeURIComponent(sceneId)}:`;
}

export function listSceneRecoveryDrafts(projectRoot: string, sceneId: string): SceneRecoveryDraft[] {
  const storage = availableStorage();
  if (!storage) return [];
  const rows: SceneRecoveryDraft[] = [];
  const retired: Record<string, number> = {};
  const prefix = ownedPrefix(projectRoot, sceneId);
  try {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const key of keys) {
      if (!key || (key !== storageKey(projectRoot, sceneId) && !key.startsWith(prefix))) continue;
      try {
        const row = JSON.parse(storage.getItem(key) || "null");
        if (!row) continue;
        if (key.startsWith(`${prefix}retired:`)) {
          if (typeof row.draftId === "string" && Number.isSafeInteger(row.sequence) && row.sequence > 0) {
            retired[row.draftId] = Math.max(retired[row.draftId] || 0, row.sequence);
          }
        } else if ((row.schemaVersion === 1 || row.schemaVersion === 2) && row.projectRoot === projectRoot && row.sceneId === sceneId
          && typeof row.title === "string" && typeof row.body === "string" && typeof row.baseUpdatedAt === "string" && typeof row.journaledAt === "string"
          && (row.schemaVersion === 1 || (typeof row.draftId === "string" && Number.isSafeInteger(row.sequence) && row.sequence > 0
            && key === `${prefix}draft:${row.draftId}`))) rows.push(row);
      } catch { /* Keep damaged records in place for manual recovery. */ }
    }
  } catch { return []; }
  return rows.filter((row) => !row.draftId || row.sequence! > (retired[row.draftId] || 0))
    .sort((a, b) => b.journaledAt.localeCompare(a.journaledAt) || (b.sequence || 0) - (a.sequence || 0));
}

function availableStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function writeSceneRecoveryDraft(
  draft: Omit<SceneRecoveryDraft, "schemaVersion" | "journaledAt">
): SceneRecoveryDraft | null {
  const storage = availableStorage();
  if (!storage) return null;
  const record: SceneRecoveryDraft = {
    ...draft,
    schemaVersion: 2,
    draftId: draft.draftId || crypto.randomUUID(),
    sequence: draft.sequence || 1,
    journaledAt: new Date().toISOString(),
  };
  try {
    const key = `${ownedPrefix(draft.projectRoot, draft.sceneId)}draft:${record.draftId}`;
    const previous = storage.getItem(key);
    if (previous) {
      const old = JSON.parse(previous) as SceneRecoveryDraft;
      if ((old.sequence || 0) >= record.sequence!) return null;
    }
    storage.setItem(key, JSON.stringify(record));
    return record;
  } catch {
    return null;
  }
}

export function readSceneRecoveryDraft(
  projectRoot: string,
  sceneId: string
): SceneRecoveryDraft | null {
  return listSceneRecoveryDrafts(projectRoot, sceneId)[0] || null;
}

export function clearSceneRecoveryDraft(
  projectRoot: string,
  sceneId: string,
  savedDraft?: Partial<SceneRecoveryDraft>
): void {
  if (!savedDraft) return;
  try {
    if (savedDraft.draftId && savedDraft.sequence) {
      // A receipt only retires this owner's known sequence. It never deletes
      // a mutable slot that another event could already have updated.
      availableStorage()?.setItem(`${ownedPrefix(projectRoot, sceneId)}retired:${savedDraft.draftId}:${savedDraft.sequence}`, JSON.stringify({ draftId: savedDraft.draftId, sequence: savedDraft.sequence }));
      return;
    }
    const key = storageKey(projectRoot, sceneId);
    const raw = availableStorage()?.getItem(key);
    if (!raw) return;
    const current = JSON.parse(raw) as SceneRecoveryDraft;
    if (current.title === savedDraft.title && current.body === savedDraft.body) availableStorage()?.removeItem(key);
  } catch {
    // An unavailable recovery store must not interrupt a successful disk save.
  }
}
