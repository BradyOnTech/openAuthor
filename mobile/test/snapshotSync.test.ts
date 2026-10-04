import { describe, expect, it } from "vitest";

import { SnapshotProject } from "../src/core/snapshotProject";
import {
  InMemorySnapshotCache,
  SnapshotSync,
  type SnapshotCipher,
  type SnapshotSyncTransport,
} from "../src/core/snapshotSync";

const SNAPSHOT = {
  schema: "openauthor.mobile.snapshot",
  schema_version: 1,
  project_id: "project-mobile",
  revision: "rev-42",
  scenes: [],
  codex: { entities: [], relationships: [] },
  evidence: [],
} as const;

const PLAINTEXT = JSON.stringify({
  manifest: {
    schema: "openauthor.mobile.snapshot.manifest",
    schema_version: 1,
    project_id: "project-mobile",
    revision: "rev-42",
    content_sha256: "c".repeat(64),
    byte_length: 200,
  },
  snapshot: SNAPSHOT,
});

class FakeTransport implements SnapshotSyncTransport {
  acknowledgements: string[] = [];

  async latestManifest() {
    return {
      snapshotId: "snapshot-1",
      projectId: "project-mobile",
      revision: "rev-42",
      objectPath: "project-mobile/rev-42.bin",
      keyVersion: 2,
      ciphertextDigest: "cipher-digest",
      plaintextDigest: "plain-digest",
      byteLength: PLAINTEXT.length,
      createdAt: "2026-08-30T16:00:00.000Z",
    };
  }

  async download(): Promise<string> {
    return "encrypted-snapshot";
  }

  async acknowledge(snapshotId: string): Promise<void> {
    this.acknowledgements.push(snapshotId);
  }
}

class FakeCipher implements SnapshotCipher {
  readonly plaintext: string;

  constructor(plaintext = PLAINTEXT) {
    this.plaintext = plaintext;
  }

  async digest(value: string): Promise<string> {
    if (value === "encrypted-snapshot") return "cipher-digest";
    if (value === this.plaintext) return "plain-digest";
    return "unexpected-digest";
  }

  async open(): Promise<string> {
    return this.plaintext;
  }
}

describe("SnapshotSync", () => {
  it("verifies both encrypted and plaintext identities before atomically caching and acknowledging", async () => {
    const transport = new FakeTransport();
    const cache = new InMemorySnapshotCache();
    const sync = new SnapshotSync({
      transport,
      cipher: new FakeCipher(),
      cache,
      projectKey: async () => "project-key-v2",
    });

    const result = await sync.refresh("project-mobile", "device-ios");

    expect(result.status).toBe("updated");
    expect(result.revision).toBe("rev-42");
    expect(transport.acknowledgements).toEqual(["snapshot-1"]);
    expect(SnapshotProject.open((await cache.load("project-mobile"))!.snapshot).identity()).toEqual({
      projectId: "project-mobile",
      revision: "rev-42",
    });
  });

  it("does not replace a cached project when decrypted identity is wrong", async () => {
    const cache = new InMemorySnapshotCache();
    const wrong = PLAINTEXT.replaceAll("project-mobile", "project-other");
    const sync = new SnapshotSync({
      transport: new FakeTransport(),
      cipher: new FakeCipher(wrong),
      cache,
      projectKey: async () => "project-key-v2",
    });

    await expect(sync.refresh("project-mobile", "device-ios")).rejects.toThrow("identity mismatch");
    expect(await cache.load("project-mobile")).toBeNull();
  });
});
