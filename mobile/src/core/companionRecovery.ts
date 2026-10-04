import type { LocalIdentity } from "./localCompanion";
import type { SnapshotProject } from "./snapshotProject";

export const CAPTURE_KINDS = ["capture_note", "dictated_passage", "story_memory_suggestion", "change_set_request"] as const;
export type CaptureKind = typeof CAPTURE_KINDS[number];
export type CaptureDraft = { operationId: string; kind: CaptureKind; text: string; baseRevision: string };
export type CompanionState = {
  version: 1;
  tab: "scenes" | "capture" | "review";
  reading: { sceneId: string; revision: string; scrollY: number } | null;
  capture: CaptureDraft | null;
};
export interface EncryptedRecoveryStorage {
  loadRecovery(scope: string): Promise<string | null>;
  saveRecovery(scope: string, value: string): Promise<void>;
}
export function emptyCompanionState(): CompanionState {
  return { version: 1, tab: "scenes", reading: null, capture: null };
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9._:-]{1,160}$/.test(value);
}
export function validateCompanionState(value: unknown): CompanionState {
  const state = value as CompanionState;
  if (!state || state.version !== 1 || !["scenes", "capture", "review"].includes(state.tab)
    || (state.reading !== null && (!state.reading || !identifier(state.reading.sceneId) || !identifier(state.reading.revision)
      || !Number.isFinite(state.reading.scrollY) || state.reading.scrollY < 0 || state.reading.scrollY > 10_000_000))
    || (state.capture !== null && (!state.capture || !identifier(state.capture.operationId)
      || !CAPTURE_KINDS.includes(state.capture.kind) || !identifier(state.capture.baseRevision)
      || typeof state.capture.text !== "string" || state.capture.text.length > 48 * 1024))) {
    throw new Error("Saved reading or capture recovery is invalid. No saved work was deleted.");
  }
  // Copy only recognized fields. Never retain arbitrary snapshot or credentials.
  return {
    version: 1, tab: state.tab,
    reading: state.reading ? { sceneId: state.reading.sceneId, revision: state.reading.revision, scrollY: state.reading.scrollY } : null,
    capture: state.capture ? { operationId: state.capture.operationId, kind: state.capture.kind, text: state.capture.text, baseRevision: state.capture.baseRevision } : null,
  };
}

export function reconcileCompanionState(project: SnapshotProject, value: CompanionState): CompanionState {
  const state = validateCompanionState(value);
  if (state.reading && !project.getScene(state.reading.sceneId)) state.reading = null;
  // A new publication can move passages. Keep the scene focus but reset the
  // pixel position rather than silently jumping into unrelated text.
  if (state.reading && state.reading.revision !== project.identity().revision) {
    state.reading = { ...state.reading, revision: project.identity().revision, scrollY: 0 };
  }
  // An unfinished capture retains its original revision for desktop review.
  return state;
}

export function companionRecoveryScope(identity: LocalIdentity, projectId: string): string {
  if (!identifier(projectId)) throw new Error("Recovery book identity is invalid.");
  return JSON.stringify(["openauthor.companion.recovery.v1", identity.deployment, identity.userId, identity.deviceId, identity.keyId, projectId]);
}

/** Use the snapshot cache's device-local encryption, separately from publication
 * replacement. Serial writes prevent older keystrokes from replacing newer ones. */
export class CompanionRecovery {
  readonly #writes = new Map<string, Promise<void>>();
  constructor(private readonly storage: EncryptedRecoveryStorage) {}

  async load(identity: LocalIdentity, projectId: string): Promise<CompanionState> {
    const scope = companionRecoveryScope(identity, projectId);
    await this.#writes.get(scope)?.catch(() => {});
    const encoded = await this.storage.loadRecovery(scope);
    if (encoded === null) return emptyCompanionState();
    try {
      const record = JSON.parse(encoded);
      if (record.scope !== scope) throw new Error();
      return validateCompanionState(record.state);
    } catch { throw new Error("Saved reading or capture recovery could not be unlocked. No saved work was deleted."); }
  }

  save(identity: LocalIdentity, projectId: string, value: CompanionState): Promise<void> {
    const scope = companionRecoveryScope(identity, projectId);
    const encoded = JSON.stringify({ scope, state: validateCompanionState(value) });
    const write = (this.#writes.get(scope) ?? Promise.resolve()).catch(() => {}).then(() => this.storage.saveRecovery(scope, encoded));
    this.#writes.set(scope, write);
    void write.finally(() => { if (this.#writes.get(scope) === write) this.#writes.delete(scope); }).catch(() => {});
    return write;
  }

  async drain(): Promise<void> { await Promise.all([...this.#writes.values()]); }
}
