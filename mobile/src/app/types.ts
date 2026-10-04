import type { MobileVoiceEvent } from "../voice/realtimeEvents";
import type { CompanionState } from "../core/companionRecovery";
import type { SnapshotProject } from "../core/snapshotProject";

export type AppSession = { userId: string; email: string; downloadedOnly?: boolean };
export type AppProject = {
  id: string;
  title: string;
  role: "owner" | "editor" | "viewer" | "member";
  lastPublishedAt: string | null;
  downloaded?: boolean;
};
export type PendingItem = {
  operationId: string;
  kind: string;
  summary: string;
  createdAt: string;
  status: "local" | "uploaded" | "imported" | "conflict";
  unreadable?: boolean;
};
export type VoiceHandle = {
  mute(muted: boolean): void;
  sendText(text: string): void;
  interrupt(): void;
  stop(): void;
};

export interface AppRuntime {
  readonly mode: "hosted" | "preview";
  restoreSession(options?: { online?: boolean }): Promise<AppSession | null>;
  openDownloadedLibrary(): Promise<AppSession>;
  signIn(email: string, password: string): Promise<AppSession>;
  signOut(): Promise<void>;
  subscribeLocalAccessLock(listener: () => void): () => void;
  projects(): Promise<AppProject[]>;
  openProject(projectId: string): Promise<{
    project: SnapshotProject;
    freshness: string;
    offline: boolean;
  }>;
  loadCompanionState(projectId: string): Promise<CompanionState>;
  saveCompanionState(projectId: string, value: CompanionState): Promise<void>;
  pending(projectId: string): Promise<PendingItem[]>;
  capture(input: {
    projectId: string;
    operationId?: string;
    baseRevision: string;
    kind: "capture_note" | "dictated_passage" | "story_memory_suggestion" | "change_set_request";
    text: string;
  }): Promise<PendingItem>;
  flush(projectId: string): Promise<{ uploaded: number; remaining: number }>;
  startVoice(input: {
    projectId: string;
    currentSceneId?: string;
    signal?: AbortSignal;
    onEvent(event: MobileVoiceEvent): void;
  }): Promise<VoiceHandle>;
  exportRecoveryKey(projectId: string): Promise<{ keyVersion: number; recoveryKey: string }>;
  importRecoveryKey(projectId: string, keyVersion: number, recoveryKey: string): Promise<void>;
  revokeDeviceAndDeleteLocalData(): Promise<void>;
}
