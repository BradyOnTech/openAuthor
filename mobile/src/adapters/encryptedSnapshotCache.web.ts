import type { CachedSnapshot, SnapshotCache } from "../core/snapshotSync";
import { SnapshotProject } from "../core/snapshotProject";
import { browserStorage } from "./browserStorage";

export class EncryptedFileSnapshotCache implements SnapshotCache {
  async load(projectId: string): Promise<CachedSnapshot | null> {
    const value = await browserStorage.get(`snapshot:${projectId}`);
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
    await browserStorage.set(`snapshot:${projectId}`, JSON.stringify(value));
  }
  delete(projectId: string): Promise<void> { return browserStorage.delete(`snapshot:${projectId}`); }
  deleteAll(): Promise<void> { return browserStorage.deletePrefix("snapshot:"); }
}
