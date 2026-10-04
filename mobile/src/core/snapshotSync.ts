import { SnapshotProject, type MobileSnapshot } from "./snapshotProject";
import { parseMobileSnapshotManifest } from "@openauthor/contracts";

export type HostedSnapshotManifest = {
  snapshotId: string;
  projectId: string;
  revision: string;
  objectPath: string;
  keyVersion: number;
  ciphertextDigest: string;
  plaintextDigest: string;
  byteLength: number;
  createdAt: string;
};

export type CachedSnapshot = {
  manifest: HostedSnapshotManifest;
  snapshot: MobileSnapshot;
  cachedAt: string;
};

export interface SnapshotSyncTransport {
  latestManifest(projectId: string, deviceId: string): Promise<HostedSnapshotManifest | null>;
  download(objectPath: string): Promise<string>;
  acknowledge(snapshotId: string, deviceId: string): Promise<void>;
}

export interface SnapshotCipher {
  digest(value: string): Promise<string>;
  open(
    ciphertext: string,
    projectKey: string,
    context: { projectId: string; revision: string; keyVersion: number },
  ): Promise<string>;
}

export interface SnapshotCache {
  load(projectId: string): Promise<CachedSnapshot | null>;
  replace(projectId: string, value: CachedSnapshot): Promise<void>;
  delete(projectId: string): Promise<void>;
  deleteAll(): Promise<void>;
}

function cloneCached(value: CachedSnapshot): CachedSnapshot {
  return JSON.parse(JSON.stringify(value)) as CachedSnapshot;
}

export class InMemorySnapshotCache implements SnapshotCache {
  readonly #items = new Map<string, CachedSnapshot>();

  async load(projectId: string): Promise<CachedSnapshot | null> {
    const item = this.#items.get(projectId);
    return item ? cloneCached(item) : null;
  }

  async replace(projectId: string, value: CachedSnapshot): Promise<void> {
    if (value.snapshot.project_id !== projectId || value.manifest.projectId !== projectId) {
      throw new Error("Cached snapshot project identity mismatch.");
    }
    this.#items.set(projectId, cloneCached(value));
  }

  async delete(projectId: string): Promise<void> {
    this.#items.delete(projectId);
  }

  async deleteAll(): Promise<void> {
    this.#items.clear();
  }
}

function parsePlaintextEnvelope(
  plaintext: string,
  hosted: HostedSnapshotManifest,
): MobileSnapshot {
  let decoded: unknown;
  try {
    decoded = JSON.parse(plaintext);
  } catch {
    throw new Error("Decrypted mobile snapshot is invalid JSON.");
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new Error("Decrypted mobile snapshot envelope is invalid.");
  }
  const record = decoded as Record<string, unknown>;
  const manifest = record.manifest;
  const snapshot = record.snapshot;
  if (
    !manifest || typeof manifest !== "object" || Array.isArray(manifest)
    || !snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
  ) {
    throw new Error("Decrypted mobile snapshot envelope is incomplete.");
  }
  const manifestRecord = manifest as Record<string, unknown>;
  const snapshotRecord = snapshot as Record<string, unknown>;
  const contractManifest = parseMobileSnapshotManifest(manifestRecord);
  if (
    contractManifest.project_id !== hosted.projectId
    || contractManifest.revision !== hosted.revision
    || snapshotRecord.project_id !== hosted.projectId
    || snapshotRecord.revision !== hosted.revision
  ) {
    throw new Error("Decrypted mobile snapshot identity mismatch.");
  }
  const typed = snapshot as MobileSnapshot;
  SnapshotProject.open(typed);
  return typed;
}

export class SnapshotSync {
  readonly #transport: SnapshotSyncTransport;
  readonly #cipher: SnapshotCipher;
  readonly #cache: SnapshotCache;
  readonly #projectKey: (projectId: string, keyVersion: number) => Promise<string>;
  readonly #now: () => string;

  constructor(input: {
    transport: SnapshotSyncTransport;
    cipher: SnapshotCipher;
    cache: SnapshotCache;
    projectKey: (projectId: string, keyVersion: number) => Promise<string>;
    now?: () => string;
  }) {
    this.#transport = input.transport;
    this.#cipher = input.cipher;
    this.#cache = input.cache;
    this.#projectKey = input.projectKey;
    this.#now = input.now ?? (() => new Date().toISOString());
  }

  async refresh(
    projectId: string,
    deviceId: string,
  ): Promise<{ status: "missing" | "current" | "updated"; revision: string }> {
    const hosted = await this.#transport.latestManifest(projectId, deviceId);
    if (!hosted) return { status: "missing", revision: "" };
    if (hosted.projectId !== projectId) throw new Error("Hosted snapshot identity mismatch.");
    const cached = await this.#cache.load(projectId);
    if (cached?.manifest.snapshotId === hosted.snapshotId) {
      return { status: "current", revision: hosted.revision };
    }

    const ciphertext = await this.#transport.download(hosted.objectPath);
    if (await this.#cipher.digest(ciphertext) !== hosted.ciphertextDigest) {
      throw new Error("Encrypted mobile snapshot integrity check failed.");
    }
    const key = await this.#projectKey(projectId, hosted.keyVersion);
    if (!key) throw new Error("Project key is unavailable for this device.");
    const plaintext = await this.#cipher.open(ciphertext, key, {
      projectId,
      revision: hosted.revision,
      keyVersion: hosted.keyVersion,
    });
    if (await this.#cipher.digest(plaintext) !== hosted.plaintextDigest) {
      throw new Error("Decrypted mobile snapshot integrity check failed.");
    }
    const snapshot = parsePlaintextEnvelope(plaintext, hosted);
    await this.#cache.replace(projectId, {
      manifest: hosted,
      snapshot,
      cachedAt: this.#now(),
    });
    await this.#transport.acknowledge(hosted.snapshotId, deviceId);
    return { status: "updated", revision: hosted.revision };
  }
}
