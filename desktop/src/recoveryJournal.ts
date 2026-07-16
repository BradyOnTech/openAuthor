export type SceneRecoveryDraft = {
  schemaVersion: 1;
  projectRoot: string;
  sceneId: string;
  baseUpdatedAt: string;
  title: string;
  body: string;
  journaledAt: string;
};

const PREFIX = "openauthor.sceneRecovery.v1";

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

function availableStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function writeSceneRecoveryDraft(
  draft: Omit<SceneRecoveryDraft, "schemaVersion" | "journaledAt">
): SceneRecoveryDraft | null {
  const storage = availableStorage();
  if (!storage) return null;
  const record: SceneRecoveryDraft = {
    schemaVersion: 1,
    ...draft,
    journaledAt: new Date().toISOString(),
  };
  storage.setItem(storageKey(draft.projectRoot, draft.sceneId), JSON.stringify(record));
  return record;
}

export function readSceneRecoveryDraft(
  projectRoot: string,
  sceneId: string
): SceneRecoveryDraft | null {
  const storage = availableStorage();
  if (!storage) return null;
  const raw = storage.getItem(storageKey(projectRoot, sceneId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SceneRecoveryDraft>;
    if (
      parsed.schemaVersion !== 1 || parsed.projectRoot !== projectRoot || parsed.sceneId !== sceneId ||
      typeof parsed.title !== "string" || typeof parsed.body !== "string" ||
      typeof parsed.baseUpdatedAt !== "string" || typeof parsed.journaledAt !== "string"
    ) {
      storage.removeItem(storageKey(projectRoot, sceneId));
      return null;
    }
    return parsed as SceneRecoveryDraft;
  } catch {
    storage.removeItem(storageKey(projectRoot, sceneId));
    return null;
  }
}

export function clearSceneRecoveryDraft(projectRoot: string, sceneId: string): void {
  availableStorage()?.removeItem(storageKey(projectRoot, sceneId));
}
