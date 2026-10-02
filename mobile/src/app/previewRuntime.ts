import { emptyCompanionState, type CompanionState } from "../core/companionRecovery";
import { SnapshotProject, type MobileSnapshot } from "../core/snapshotProject";
import type { AppProject, AppRuntime, AppSession, PendingItem, VoiceHandle } from "./types";

const previewSnapshot: MobileSnapshot = {
  schema: "openauthor.mobile.snapshot",
  schema_version: 1,
  project_id: "preview-project",
  revision: "preview-rev-12",
  scenes: [
    {
      id: "scene-observatory",
      title: "The Observatory",
      summary: "Mara follows the clockmaker into the abandoned observatory.",
      pov: "Mara",
      status: "draft",
      created_at: "2026-08-29T18:00:00.000Z",
      updated_at: "2026-08-30T14:22:00.000Z",
      body: "Rain clicked against the copper dome. Beneath the stopped clock, Mara found a brass key wrapped in blue thread.",
    },
    {
      id: "scene-platform",
      title: "Last Train North",
      summary: "Mara must decide whether to trust Elias before the final train leaves.",
      pov: "Mara",
      status: "revised",
      created_at: "2026-08-29T19:00:00.000Z",
      updated_at: "2026-08-30T15:04:00.000Z",
      body: "The departure board flickered between two impossible destinations while Elias waited beside the open carriage.",
    },
  ],
  codex: {
    entities: [{ id: "mara", name: "Mara Vale", role: "protagonist" }],
    relationships: [],
  },
  evidence: [],
};

export class PreviewRuntime implements AppRuntime {
  readonly mode = "preview" as const;
  #session: AppSession | null = null;
  #pending: PendingItem[] = [];

  async restoreSession(): Promise<AppSession | null> {
    return this.#session;
  }

  async openDownloadedLibrary(): Promise<AppSession> {
    return this.signIn("preview@openauthor.local", "");
  }

  async signIn(email: string, _password: string): Promise<AppSession> {
    if (!email.trim()) throw new Error("Email is required.");
    this.#session = { userId: "preview-user", email: email.trim() };
    return this.#session;
  }

  subscribeLocalAccessLock(_listener: () => void): () => void { return () => {}; }

  async signOut(): Promise<void> {
    this.#session = null;
  }

  async projects(): Promise<AppProject[]> {
    return [{
      id: "preview-project",
      title: "The Clockmaker's Map",
      role: "owner",
      lastPublishedAt: "2026-08-30T15:04:00.000Z",
    }];
  }

  async openProject(): Promise<{ project: SnapshotProject; freshness: string; offline: boolean }> {
    return {
      project: SnapshotProject.open(previewSnapshot),
      freshness: "Preview snapshot · revision 12",
      offline: true,
    };
  }

  async loadCompanionState(): Promise<CompanionState> { return emptyCompanionState(); }
  async saveCompanionState(): Promise<void> { /* Sample drafts remain in memory only. */ }

  async pending(): Promise<PendingItem[]> {
    return this.#pending.map((item) => ({ ...item }));
  }

  async capture(input: { kind: PendingItem["kind"]; text: string }): Promise<PendingItem> {
    const item: PendingItem = {
      operationId: `preview-${Date.now()}`,
      kind: input.kind,
      summary: input.text.trim(),
      createdAt: new Date().toISOString(),
      status: "local",
    };
    this.#pending.unshift(item);
    return item;
  }

  async flush(): Promise<{ uploaded: number; remaining: number }> {
    throw new Error("Hosted sync is disabled in preview mode.");
  }

  async startVoice(): Promise<VoiceHandle> {
    throw new Error("Configure the hosted Session Gateway to use voice on a device.");
  }

  async exportRecoveryKey(): Promise<{ keyVersion: number; recoveryKey: string }> {
    throw new Error("Recovery keys are available only for hosted encrypted projects.");
  }

  async importRecoveryKey(): Promise<void> {
    throw new Error("Recovery keys are available only for hosted encrypted projects.");
  }

  async revokeDeviceAndDeleteLocalData(): Promise<void> {
    this.#pending = [];
    this.#session = null;
  }
}
