import { describe, expect, it, vi } from "vitest";
import { SupabaseMobileSyncTransport } from "./supabaseTransport";
import type { EncryptedMobileSnapshot } from "./mobileSync";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function bytea(bytes: Uint8Array): string {
  return "\\x" + Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function snapshotFixture(): Promise<EncryptedMobileSnapshot> {
  const snapshotId = "50000000-0000-4000-8000-000000000001";
  const projectId = "10000000-0000-4000-8000-000000000001";
  const combined = Uint8Array.from({ length: 40 }, (_, index) => index + 1);
  const ciphertextBase64 = bytesToBase64(combined);
  const objectBytes = new TextEncoder().encode(ciphertextBase64);
  const manifestNonce = Uint8Array.from({ length: 12 }, (_, index) => index + 51);
  const manifestCiphertext = Uint8Array.from({ length: 32 }, (_, index) => index + 81);
  return {
    schema_version: 1,
    snapshot_id: snapshotId,
    key_version: 4,
    manifest: {
      schema: "openauthor.mobile.snapshot.manifest",
      schema_version: 1,
      project_id: projectId,
      revision: "revision-one",
      content_sha256: "a".repeat(64),
      byte_length: 123,
    },
    plaintext_sha256: "b".repeat(64),
    object: {
      bucket: "mobile-encrypted-sync",
      path: `projects/${projectId}/snapshots/${snapshotId}.bin`,
      byte_length: objectBytes.byteLength,
      sha256: await sha256(objectBytes),
      content_type: "text/plain;charset=utf-8",
    },
    encryption: {
      algorithm: "AES-256-GCM",
      iv_base64: bytesToBase64(combined.slice(0, 12)),
      associated_data_version: 1,
    },
    ciphertext_base64: ciphertextBase64,
    hosted_manifest: {
      algorithm: "AES-256-GCM",
      nonce_base64: bytesToBase64(manifestNonce),
      ciphertext_base64: bytesToBase64(manifestCiphertext),
      ciphertext_sha256: await sha256(manifestCiphertext),
      associated_data_version: 1,
    },
  };
}

describe("SupabaseMobileSyncTransport", () => {
  it("refreshes authorization for each RPC and stops before fetch when identity verification fails", async () => {
    let token = "first";
    const getAccessToken = vi.fn(async () => token);
    const fetchMock = vi.fn(async () => new Response("[]", { status: 200 }));
    const transport = new SupabaseMobileSyncTransport({
      supabaseUrl: "https://example.supabase.co", publishableKey: "public", userAccessToken: "initial",
      deviceId: "40000000-0000-4000-8000-000000000001", getAccessToken, fetch: fetchMock,
    });
    await transport.listProjectDevices(PROJECT_ID);
    token = "second";
    await transport.listProjectDevices(PROJECT_ID);
    expect(fetchMock).toHaveBeenNthCalledWith(1, expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer first" }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer second" }),
    }));
    getAccessToken.mockRejectedValueOnce(new Error("Session changed"));
    await expect(transport.listProjectDevices(PROJECT_ID)).rejects.toThrow("Session changed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("lists active project device keys with the exact provisioning RPC", async () => {
    const publicKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const row = {
      device_id: "20000000-0000-4000-8000-000000000001",
      key_id: "30000000-0000-4000-8000-000000000001",
      key_algorithm: "x25519-v1",
      public_key: bytea(publicKey),
      public_key_sha256: await sha256(publicKey),
      project_enrolled_at: "2026-08-30T12:00:00Z",
      project_revoked_at: null,
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify([row]), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const transport = new SupabaseMobileSyncTransport({
      supabaseUrl: "https://example.supabase.co",
      publishableKey: "publishable-key",
      userAccessToken: "user-access-token",
      deviceId: "40000000-0000-4000-8000-000000000001",
      fetch: fetchMock,
    });

    await expect(transport.listProjectDevices(PROJECT_ID)).resolves.toEqual([{
      deviceId: row.device_id,
      keyId: row.key_id,
      keyAlgorithm: "x25519-v1",
      publicKey: bytesToBase64(publicKey)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, ""),
      projectEnrolledAt: row.project_enrolled_at,
      projectRevokedAt: null,
    }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.supabase.co/rest/v1/rpc/mobile_list_project_devices");
    expect(JSON.parse(String(init?.body))).toEqual({
      p_requesting_device_id: "40000000-0000-4000-8000-000000000001",
      p_project_id: PROJECT_ID,
    });
    expect(init?.headers).toEqual({
      apikey: "publishable-key",
      Authorization: "Bearer user-access-token",
      "Content-Type": "application/json",
    });
  });

  it("atomically rotates with exact recipient envelope metadata", async () => {
    const sealed = Uint8Array.from({ length: 80 }, (_, index) => index + 10);
    const sealedBase64Url = bytesToBase64(sealed)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      project_id: PROJECT_ID,
      key_version: 4,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const transport = new SupabaseMobileSyncTransport({
      supabaseUrl: "https://example.supabase.co",
      publishableKey: "publishable-key",
      userAccessToken: "user-access-token",
      deviceId: "40000000-0000-4000-8000-000000000001",
      fetch: fetchMock,
    });

    await expect(transport.rotateProjectKeyWithEnvelopes({
      projectId: PROJECT_ID,
      expectedPreviousVersion: 3,
      reasonCode: "desktop-provisioning",
      envelopes: [{
        envelopeId: "50000000-0000-4000-8000-000000000001",
        recipientDeviceId: "20000000-0000-4000-8000-000000000001",
        recipientKeyId: "30000000-0000-4000-8000-000000000001",
        algorithm: "x25519-xsalsa20-poly1305-sealedbox-v1",
        sealedProjectKey: sealedBase64Url,
      }],
    })).resolves.toEqual({ keyVersion: 4 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://example.supabase.co/rest/v1/rpc/mobile_rotate_project_key_with_envelopes"
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      p_requesting_device_id: "40000000-0000-4000-8000-000000000001",
      p_project_id: PROJECT_ID,
      p_expected_previous_version: 3,
      p_reason_code: "desktop-provisioning",
      p_envelopes: [{
        envelope_id: "50000000-0000-4000-8000-000000000001",
        recipient_device_id: "20000000-0000-4000-8000-000000000001",
        recipient_key_id: "30000000-0000-4000-8000-000000000001",
        algorithm: "x25519-xsalsa20-poly1305-sealedbox-v1",
        sealed_project_key_hex: Array.from(sealed)
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join(""),
        sealed_project_key_sha256: await sha256(sealed),
      }],
    });
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("service_role");
  });

  it("lists outbox ciphertext with user auth and verifies PostgreSQL bytea", async () => {
    const iv = Uint8Array.from({ length: 12 }, (_, index) => index + 1);
    const ciphertext = Uint8Array.from({ length: 24 }, (_, index) => index + 31);
    const combined = new Uint8Array(iv.length + ciphertext.length);
    combined.set(iv);
    combined.set(ciphertext, iv.length);
    const combinedBase64 = bytesToBase64(combined);
    const storedCiphertext = new TextEncoder().encode(combinedBase64);
    const row = {
      operation_id: "20000000-0000-4000-8000-000000000001",
      project_id: "10000000-0000-4000-8000-000000000001",
      source_device_id: "30000000-0000-4000-8000-000000000001",
      key_version: 4,
      base_project_revision: "revision-one",
      operation_type: "capture_note",
      algorithm: "aes-256-gcm-v1",
      nonce: bytea(iv),
      ciphertext: bytea(storedCiphertext),
      ciphertext_sha256: await sha256(storedCiphertext),
      client_created_at: "2026-08-30T11:59:00Z",
      received_at: "2026-08-30T12:00:00Z",
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify([row]), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const transport = new SupabaseMobileSyncTransport({
      supabaseUrl: "https://example.supabase.co",
      publishableKey: "publishable-key",
      userAccessToken: "user-access-token",
      deviceId: "40000000-0000-4000-8000-000000000001",
      fetch: fetchMock,
    });

    const [item] = await transport.pullOutbox(row.project_id, {
      after: {
        receivedAt: "2026-08-30T11:00:00Z",
        operationId: "10000000-0000-4000-8000-000000000099",
      },
      limit: 25,
    });

    if ("transport_error" in item) {
      throw new Error("Expected a valid hosted outbox item.");
    }

    expect(item.envelope).toEqual({
      projectId: row.project_id,
      deviceId: row.source_device_id,
      operationId: row.operation_id,
      baseRevision: row.base_project_revision,
      kind: "capture_note",
      keyVersion: 4,
    });
    expect(item.encryption.iv_base64).toBe(bytesToBase64(iv));
    expect(item.ciphertext_base64).toBe(bytesToBase64(ciphertext));
    expect(item.receivedAt).toBe(row.received_at);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.supabase.co/rest/v1/rpc/mobile_list_outbox");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        apikey: "publishable-key",
        Authorization: "Bearer user-access-token",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      p_requesting_device_id: "40000000-0000-4000-8000-000000000001",
      p_project_id: row.project_id,
      p_after_received_at: "2026-08-30T11:00:00Z",
      p_after_operation_id: "10000000-0000-4000-8000-000000000099",
      p_limit: 25,
    });
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("service_role");
  });

  it("returns an acknowledgeable row result when hosted ciphertext framing is malformed", async () => {
    const storedCiphertext = new TextEncoder().encode("not canonical base64");
    const row = {
      operation_id: "20000000-0000-4000-8000-000000000009",
      project_id: "10000000-0000-4000-8000-000000000001",
      source_device_id: "30000000-0000-4000-8000-000000000001",
      key_version: 4,
      base_project_revision: "revision-one",
      operation_type: "capture_note",
      algorithm: "aes-256-gcm-v1",
      nonce: bytea(new Uint8Array(12)),
      ciphertext: bytea(storedCiphertext),
      ciphertext_sha256: await sha256(storedCiphertext),
      client_created_at: "2026-08-30T11:59:00Z",
      received_at: "2026-08-30T12:00:00Z",
    };
    const transport = new SupabaseMobileSyncTransport({
      supabaseUrl: "https://example.supabase.co",
      publishableKey: "publishable-key",
      userAccessToken: "user-access-token",
      deviceId: "40000000-0000-4000-8000-000000000001",
      fetch: vi.fn(async () => new Response(JSON.stringify([row]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })),
    });

    await expect(transport.pullOutbox(row.project_id)).resolves.toEqual([{
      schema_version: 1,
      envelope: {
        projectId: row.project_id,
        deviceId: row.source_device_id,
        operationId: row.operation_id,
        baseRevision: row.base_project_revision,
        kind: row.operation_type,
        keyVersion: row.key_version,
      },
      receivedAt: row.received_at,
      transport_error: "malformed_hosted_ciphertext",
    }]);
  });

  it("acknowledges an imported outbox operation with the desktop device identity", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ acknowledged_at: "2026-08-30T12:00:00Z" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const transport = new SupabaseMobileSyncTransport({
      supabaseUrl: "https://example.supabase.co",
      publishableKey: "publishable-key",
      userAccessToken: "user-access-token",
      deviceId: "40000000-0000-4000-8000-000000000001",
      fetch: fetchMock,
    });

    await transport.acknowledgeOutbox({
      projectId: "10000000-0000-4000-8000-000000000001",
      deviceId: "30000000-0000-4000-8000-000000000001",
      operationId: "20000000-0000-4000-8000-000000000001",
      baseRevision: "revision-one",
      kind: "capture_note",
      keyVersion: 4,
    }, "conflict");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.supabase.co/rest/v1/rpc/mobile_ack_outbox");
    expect(JSON.parse(String(init?.body))).toEqual({
      p_requesting_device_id: "40000000-0000-4000-8000-000000000001",
      p_operation_id: "20000000-0000-4000-8000-000000000001",
      p_status: "conflict",
    });
  });

  it("uploads the encrypted snapshot object before publishing exact RPC metadata", async () => {
    const snapshot = await snapshotFixture();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/storage/v1/object/")) {
        return new Response(JSON.stringify({ Key: snapshot.object.path }), { status: 200 });
      }
      return new Response(JSON.stringify({ snapshot_id: snapshot.snapshot_id }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const transport = new SupabaseMobileSyncTransport({
      supabaseUrl: "https://example.supabase.co",
      publishableKey: "publishable-key",
      userAccessToken: "user-access-token",
      deviceId: "40000000-0000-4000-8000-000000000001",
      fetch: fetchMock,
    });

    await transport.publishSnapshot(snapshot);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [storageUrl, storageInit] = fetchMock.mock.calls[0];
    expect(storageUrl).toBe(
      `https://example.supabase.co/storage/v1/object/mobile-encrypted-sync/${snapshot.object.path}`
    );
    expect(storageInit).toMatchObject({
      method: "POST",
      headers: {
        apikey: "publishable-key",
        Authorization: "Bearer user-access-token",
        "Content-Type": "text/plain;charset=utf-8",
        "x-upsert": "false",
      },
      body: snapshot.ciphertext_base64,
    });
    const [rpcUrl, rpcInit] = fetchMock.mock.calls[1];
    expect(rpcUrl).toBe("https://example.supabase.co/rest/v1/rpc/mobile_publish_snapshot");
    expect(JSON.parse(String(rpcInit?.body))).toEqual({
      p_requesting_device_id: "40000000-0000-4000-8000-000000000001",
      p_snapshot_id: snapshot.snapshot_id,
      p_project_id: snapshot.manifest.project_id,
      p_project_revision: snapshot.manifest.revision,
      p_key_version: 4,
      p_schema_version: 1,
      p_object_bucket: "mobile-encrypted-sync",
      p_object_path: snapshot.object.path,
      p_object_byte_length: snapshot.object.byte_length,
      p_object_sha256: snapshot.object.sha256,
      p_manifest_algorithm: "aes-256-gcm-v1",
      p_manifest_nonce: bytea(base64ToBytes(snapshot.hosted_manifest.nonce_base64)),
      p_manifest_ciphertext: bytea(base64ToBytes(snapshot.hosted_manifest.ciphertext_base64)),
      p_manifest_ciphertext_sha256: snapshot.hosted_manifest.ciphertext_sha256,
    });
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("service_role");
  });

  it("rejects a snapshot object above 64 MiB before any network request", async () => {
    const snapshot = await snapshotFixture();
    snapshot.object.byte_length = 64 * 1024 * 1024 + 1;
    const fetchMock = vi.fn();
    const transport = new SupabaseMobileSyncTransport({
      supabaseUrl: "https://example.supabase.co",
      publishableKey: "publishable-key",
      userAccessToken: "user-access-token",
      deviceId: "40000000-0000-4000-8000-000000000001",
      fetch: fetchMock,
    });

    await expect(transport.publishSnapshot(snapshot)).rejects.toThrow(
      "Encrypted snapshot object exceeds 64 MiB."
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deletes the uploaded object when snapshot metadata publication fails", async () => {
    const snapshot = await snapshotFixture();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST" && String(_input).includes("/storage/v1/object/")) {
        return new Response("{}", { status: 200 });
      }
      if (init?.method === "DELETE") {
        return new Response("", { status: 200 });
      }
      return new Response('{"message":"not authorized"}', { status: 403 });
    });
    const transport = new SupabaseMobileSyncTransport({
      supabaseUrl: "https://example.supabase.co",
      publishableKey: "publishable-key",
      userAccessToken: "user-access-token",
      deviceId: "40000000-0000-4000-8000-000000000001",
      fetch: fetchMock,
    });

    await expect(transport.publishSnapshot(snapshot)).rejects.toThrow(
      "Supabase mobile sync RPC failed (403)."
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[2];
    expect(deleteUrl).toBe(
      `https://example.supabase.co/storage/v1/object/mobile-encrypted-sync/${snapshot.object.path}`
    );
    expect(deleteInit).toMatchObject({
      method: "DELETE",
      headers: {
        apikey: "publishable-key",
        Authorization: "Bearer user-access-token",
      },
    });
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("not authorized");
  });
});
