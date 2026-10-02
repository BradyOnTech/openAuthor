import type { CachedSnapshot, SnapshotCache } from "../core/snapshotSync";
import { SnapshotProject } from "../core/snapshotProject";
import { browserStorage, type BrowserStorage } from "./browserStorage";

export class EncryptedFileSnapshotCache implements SnapshotCache {
  constructor(private readonly storage: BrowserStorage = browserStorage) {}
  async load(projectId: string): Promise<CachedSnapshot | null> {
    const value = await this.storage.get(`snapshot:${projectId}`);
    if (!value) return null;
    const cached = JSON.parse(value) as CachedSnapshot;
    this.#validate(projectId, cached);
    return cached;
  }
  #validate(projectId: string, value: CachedSnapshot): void {
    if (value.snapshot.project_id !== projectId || value.manifest.projectId !== projectId) throw new Error("Snapshot cache identity mismatch.");
    SnapshotProject.open(value.snapshot);
  }
  async replace(projectId: string, value: CachedSnapshot): Promise<void> {
    this.#validate(projectId, value);
    await this.storage.set(`snapshot:${projectId}`, JSON.stringify(value));
  }
  delete(projectId: string): Promise<void> { return this.storage.delete(`snapshot:${projectId}`); }
  loadRecovery(scope: string): Promise<string | null> { return this.storage.get(`companion-recovery:${scope}`); }
  saveRecovery(scope: string, value: string): Promise<void> { return this.storage.set(`companion-recovery:${scope}`, value); }
  deleteRecovery(scope: string): Promise<void> { return this.storage.delete(`companion-recovery:${scope}`); }
  async deleteAll(): Promise<void> {
    await this.storage.deletePrefix("snapshot:");
    await this.storage.deletePrefix("companion-recovery:");
  }
}
