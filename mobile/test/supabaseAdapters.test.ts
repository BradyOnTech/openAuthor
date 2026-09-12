import { describe, expect, it, vi } from "vitest";

import type { OutboxEnvelope } from "../src/core/outbox";
import {
  SupabaseAuth,
  SupabaseDeviceEnrollmentTransport,
  SupabaseOutboxTransport,
  SupabaseProjects,
  SupabaseSnapshotSyncTransport,
  type MobileSupabaseClient,
} from "../src/adapters/supabaseAdapters";

const DEVICE_ID = "40000000-0000-4000-8000-000000000001";
const KEY_ID = "41000000-0000-4000-8000-000000000001";
const PROJECT_ID = "30000000-0000-4000-8000-000000000001";
const SNAPSHOT_ID = "60000000-0000-4000-8000-000000000001";
const SNAPSHOT_CIPHERTEXT = "AQEBAQEBAQEBAQEBAgICAgICAgICAgICAgICAgI=";

function bytea(byte: string, count: number): string {
  return `\\x${byte.repeat(count)}`;
}

class FakeClient implements MobileSupabaseClient {
  deviceClaim: string | null = DEVICE_ID;
  refreshedDeviceClaim: string | null = DEVICE_ID;
  readonly rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];
  downloadedPath = "";
  snapshotObjectSha256 = "b".repeat(64);

  readonly auth = {
    getSession: async () => ({
      data: {
        session: {
          access_token: "signed-access-token",
          user: { id: "10000000-0000-4000-8000-000000000001", email: "author@example.com" },
        },
      },
      error: null,
    }),
    getClaims: async () => ({
      data: {
        claims: {
          sub: "10000000-0000-4000-8000-000000000001",
          role: "authenticated",
          device_id: this.deviceClaim,
          email: "author@example.com",
        },
      },
      error: null,
    }),
    signInWithPassword: async () => ({
      data: {
        session: {
          access_token: "signed-access-token",
          user: { id: "10000000-0000-4000-8000-000000000001", email: "author@example.com" },
        },
      },
      error: null,
    }),
    refreshSession: async () => {
      this.deviceClaim = this.refreshedDeviceClaim;
      return {
        data: {
          session: {
            access_token: "refreshed-signed-access-token",
            user: { id: "10000000-0000-4000-8000-000000000001", email: "author@example.com" },
          },
        },
        error: null,
      };
    },
    signOut: async () => ({ error: null }),
  };

  from() {
    return {
      select: () => ({
        order: async () => ({
          data: [{
            id: PROJECT_ID,
            workspace_id: "20000000-0000-4000-8000-000000000001",
            name: "The Brass Key",
            slug: "the-brass-key",
            kind: "book",
            status: "active",
            updated_at: "2026-08-30T12:00:00.000Z",
          }],
          error: null,
        }),
      }),
    };
  }

  async rpc(name: string, params: Record<string, unknown>) {
    this.rpcCalls.push({ name, params });
    if (name === "mobile_register_device") {
      return { data: {
        id: DEVICE_ID,
        enrolled_at: "2026-08-30T12:01:00.000Z",
      }, error: null };
    }
    if (name === "mobile_get_project_key_envelopes") {
      return { data: [{
        id: "50000000-0000-4000-8000-000000000001",
        project_id: PROJECT_ID,
        key_version: 4,
        recipient_device_id: DEVICE_ID,
        recipient_key_id: KEY_ID,
        algorithm: "x25519-xsalsa20-poly1305-sealedbox-v1",
        sealed_project_key: bytea("a1", 80),
        sealed_project_key_sha256: "a".repeat(64),
      }], error: null };
    }
    if (name === "mobile_list_snapshot_manifests") {
      return { data: [{
        snapshot_id: SNAPSHOT_ID,
        project_id: PROJECT_ID,
        project_revision: "revision-0004",
        key_version: 4,
        schema_version: 1,
        object_bucket: "mobile-encrypted-sync",
        object_path: `projects/${PROJECT_ID}/snapshots/${SNAPSHOT_ID}.bin`,
        object_byte_length: SNAPSHOT_CIPHERTEXT.length,
        object_sha256: this.snapshotObjectSha256,
        manifest_algorithm: "aes-256-gcm-v1",
        manifest_nonce: bytea("02", 12),
        manifest_ciphertext: bytea("c1", 40),
        manifest_ciphertext_sha256: "c".repeat(64),
        created_by_device_id: DEVICE_ID,
        created_at: "2026-08-30T12:02:00.000Z",
      }], error: null };
    }
    if (name === "mobile_ack_snapshot") {
      return { data: { acknowledged_at: "2026-08-30T12:03:00.000Z" }, error: null };
    }
    if (name === "mobile_append_outbox") {
      return { data: { received_at: "2026-08-30T12:04:00.000Z" }, error: null };
    }
    if (name === "mobile_enroll_project_device") return { data: {}, error: null };
    if (name === "mobile_revoke_device") return { data: {}, error: null };
    return { data: null, error: { message: `unexpected RPC ${name}` } };
  }

  readonly storage = {
    from: () => ({
      download: async (path: string) => {
        this.downloadedPath = path;
        return { data: new Blob([SNAPSHOT_CIPHERTEXT]), error: null };
      },
    }),
  };
}

describe("Supabase mobile adapters", () => {
  it("signs out only the current session instead of every device", async () => {
    const client = new FakeClient();
    const signOut = vi.spyOn(client.auth, "signOut");
    await new SupabaseAuth(client).signOut();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("verifies auth claims and refuses a mismatched signed device binding", async () => {
    const client = new FakeClient();
    const auth = new SupabaseAuth(client);
    expect(await auth.signInWithPassword("author@example.com", "password")).toEqual({
      userId: "10000000-0000-4000-8000-000000000001",
      email: "author@example.com",
    });
    expect(await auth.accessToken(DEVICE_ID)).toBe("signed-access-token");

    client.deviceClaim = "40000000-0000-4000-8000-000000000099";
    await expect(auth.accessToken(DEVICE_ID)).rejects.toThrow("device-bound");

    client.refreshedDeviceClaim = DEVICE_ID;
    expect(await auth.refreshAfterEnrollment(DEVICE_ID)).toBe("refreshed-signed-access-token");
  });

  it("lists RLS-authorized projects and registers only public device material", async () => {
    const client = new FakeClient();
    expect(await new SupabaseProjects(client, DEVICE_ID).list()).toEqual([{
      id: PROJECT_ID,
      workspaceId: "20000000-0000-4000-8000-000000000001",
      name: "The Brass Key",
      slug: "the-brass-key",
      kind: "book",
      status: "active",
      updatedAt: "2026-08-30T12:00:00.000Z",
    }]);

    client.deviceClaim = null;
    const transport = new SupabaseDeviceEnrollmentTransport(client);
    expect(await transport.register({
      deviceId: DEVICE_ID,
      keyId: KEY_ID,
      name: "Owner phone",
      platform: "ios",
      publicKey: "ERERERERERERERERERERERERERERERERERERERERERE=",
    })).toEqual({
      deviceId: DEVICE_ID,
      keyId: KEY_ID,
      enrolledAt: "2026-08-30T12:01:00.000Z",
    });
    expect(client.rpcCalls.at(-1)).toEqual({
      name: "mobile_register_device",
      params: {
        p_device_id: DEVICE_ID,
        p_key_id: KEY_ID,
        p_platform: "ios",
        p_device_label: "Owner phone",
        p_key_algorithm: "x25519-v1",
        p_public_key: bytea("11", 32),
      },
    });

    await transport.rebind({
      deviceId: DEVICE_ID,
      keyId: KEY_ID,
      name: "Owner phone",
      platform: "ios",
      publicKey: "ERERERERERERERERERERERERERERERERERERERERERE=",
    });
    expect(client.rpcCalls.at(-1)).toEqual({
      name: "mobile_register_device",
      params: {
        p_device_id: DEVICE_ID,
        p_key_id: KEY_ID,
        p_platform: "ios",
        p_device_label: "Owner phone",
        p_key_algorithm: "x25519-v1",
        p_public_key: bytea("11", 32),
      },
    });

    client.deviceClaim = DEVICE_ID;
    await transport.enrollProject(PROJECT_ID, DEVICE_ID);
    expect(client.rpcCalls.at(-1)).toEqual({
      name: "mobile_enroll_project_device",
      params: {
        p_requesting_device_id: DEVICE_ID,
        p_project_id: PROJECT_ID,
        p_target_device_id: DEVICE_ID,
      },
    });
  });

  it("retrieves only the bound device envelope and maps the latest encrypted snapshot", async () => {
    const client = new FakeClient();
    const enrollment = new SupabaseDeviceEnrollmentTransport(client);
    const envelope = await enrollment.projectKeyEnvelope({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
      keyVersion: 4,
    });
    expect(envelope.keyVersion).toBe(4);
    expect(envelope.envelope).toBe(
      btoa(String.fromCharCode(...new Uint8Array(80).fill(0xa1))).replace(/=+$/, ""),
    );

    const snapshots = new SupabaseSnapshotSyncTransport(client, {
      deviceId: DEVICE_ID,
      decodeManifest: async (input) => {
        expect(input.projectId).toBe(PROJECT_ID);
        expect(input.keyVersion).toBe(4);
        return { plaintextDigest: "d".repeat(64) };
      },
    });
    const manifest = await snapshots.latestManifest(PROJECT_ID, DEVICE_ID);
    expect(manifest).toMatchObject({
      snapshotId: SNAPSHOT_ID,
      projectId: PROJECT_ID,
      revision: "revision-0004",
      keyVersion: 4,
      ciphertextDigest: "b".repeat(64),
      plaintextDigest: "d".repeat(64),
    });
    expect(await snapshots.download(manifest!.objectPath)).toBe(SNAPSHOT_CIPHERTEXT);
    await snapshots.acknowledge(SNAPSHOT_ID, DEVICE_ID);
    expect(client.rpcCalls.at(-1)).toEqual({
      name: "mobile_ack_snapshot",
      params: {
        p_requesting_device_id: DEVICE_ID,
        p_snapshot_id: SNAPSHOT_ID,
        p_acknowledgement: "verified",
      },
    });
  });

  it("uploads ciphertext-only outbox fields through the immutable append RPC", async () => {
    const client = new FakeClient();
    const transport = new SupabaseOutboxTransport(client, DEVICE_ID);
    const ciphertext = btoa(`${"\u0001".repeat(12)}sealed-content-with-tag`);
    const envelope: OutboxEnvelope = {
      schemaVersion: 1,
      operationId: "70000000-0000-4000-8000-000000000001",
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
      baseRevision: "revision-0004",
      kind: "capture_note",
      createdAt: "2026-08-30T12:04:00.000Z",
      keyVersion: 4,
      requestDigest: "e".repeat(64),
      ciphertextDigest: "f".repeat(64),
      ciphertext,
    };

    expect(await transport.upload(envelope)).toEqual({
      acknowledgedAt: "2026-08-30T12:04:00.000Z",
    });
    const call = client.rpcCalls.at(-1)!;
    expect(call.name).toBe("mobile_append_outbox");
    expect(call.params).toMatchObject({
      p_requesting_device_id: DEVICE_ID,
      p_operation_id: envelope.operationId,
      p_project_id: PROJECT_ID,
      p_key_version: 4,
      p_base_project_revision: "revision-0004",
      p_operation_type: "capture_note",
      p_client_created_at: envelope.createdAt,
      p_algorithm: "aes-256-gcm-v1",
      p_nonce: bytea("01", 12),
    });
    expect(JSON.stringify(call.params)).not.toContain("requestDigest");
  });

  it("rejects an outbox envelope outside the canonical hosted contract", async () => {
    const client = new FakeClient();
    const transport = new SupabaseOutboxTransport(client, DEVICE_ID);
    const ciphertext = btoa(`${"\u0001".repeat(12)}sealed-content-with-tag`);
    const envelope: OutboxEnvelope = {
      schemaVersion: 1,
      operationId: "70000000-0000-4000-8000-000000000001",
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
      baseRevision: "revision-0004",
      kind: "capture_note",
      createdAt: "2026-08-30T12:04:00.000Z",
      keyVersion: 4,
      requestDigest: "e".repeat(64),
      ciphertextDigest: "F".repeat(64),
      ciphertext,
    };

    await expect(transport.upload(envelope)).rejects.toThrow(
      "Immutable Outbox Envelope v1 validation failed."
    );
    expect(client.rpcCalls).toEqual([]);
  });

  it("rejects an oversized snapshot manifest before downloading the object", async () => {
    const client = new FakeClient();
    const snapshots = new SupabaseSnapshotSyncTransport(client, {
      deviceId: DEVICE_ID,
      maxObjectBytes: 16,
      decodeManifest: async () => ({ plaintextDigest: "d".repeat(64) }),
    });
    await expect(snapshots.latestManifest(PROJECT_ID, DEVICE_ID)).rejects.toThrow("size limit");
    expect(client.downloadedPath).toBe("");
  });

  it("rejects hosted snapshot metadata outside the canonical contract", async () => {
    const client = new FakeClient();
    client.snapshotObjectSha256 = "B".repeat(64);
    const snapshots = new SupabaseSnapshotSyncTransport(client, {
      deviceId: DEVICE_ID,
      decodeManifest: async () => ({ plaintextDigest: "d".repeat(64) }),
    });

    await expect(snapshots.latestManifest(PROJECT_ID, DEVICE_ID)).rejects.toThrow(
      "Encrypted Snapshot Blob Metadata v1 validation failed."
    );
    expect(client.downloadedPath).toBe("");
  });
});
