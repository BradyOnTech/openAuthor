import { describe, expect, it, vi } from "vitest";
import { SupabaseMobileSyncTransport } from "./supabaseTransport";
import { recoveryDigest } from "./snapshotRecovery";
import { recoveryFixtureDevice, recoveryFixtureDeviceKey, recoveryFixtureProject, recoveryManifestRow, recoveryMetadata, recoverySnapshotFixture } from "./recoverySnapshot.fixture";

function transport(fetch: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>, getAccessToken?: () => Promise<string>) {
  return new SupabaseMobileSyncTransport({ supabaseUrl: "https://synthetic.invalid", publishableKey: "public", userAccessToken: "synthetic", deviceId: recoveryFixtureDevice, fetch, getAccessToken });
}
const sealed = new Uint8Array(80).fill(8);
const sealedBase64 = btoa(String.fromCharCode(...sealed)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const input = { projectId: recoveryFixtureProject, expectedKeyVersion: 3, expectedDeviceKeyId: recoveryFixtureDeviceKey,
  envelopeId: "70000000-0000-4000-8000-000000000001", sealedProjectKey: sealedBase64 };
async function envelopeRow() {
  return { project_id: input.projectId, key_version: 3, id: input.envelopeId, recipient_device_id: recoveryFixtureDevice,
    sender_device_id: recoveryFixtureDevice,
    recipient_key_id: input.expectedDeviceKeyId, algorithm: "x25519-xsalsa20-poly1305-sealedbox-v1",
    sealed_project_key: "\\x" + "08".repeat(80), sealed_project_key_sha256: await recoveryDigest(sealed) };
}

describe("snapshot recovery transport", () => {
  it("reads only the exact reviewed current version and scoped, bounded object", async () => {
    const snapshot = await recoverySnapshotFixture();
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes("/rpc/")) {
        expect(JSON.parse(init!.body as string)).toEqual({ p_requesting_device_id: recoveryFixtureDevice, p_project_id: recoveryFixtureProject, p_expected_key_version: 3 });
        return new Response(JSON.stringify([recoveryManifestRow(snapshot)]));
      }
      expect(String(url)).toBe(`https://synthetic.invalid/storage/v1/object/authenticated/mobile-encrypted-sync/${snapshot.object.path}`);
      return new Response(snapshot.ciphertext_base64, { headers: { "Content-Length": String(snapshot.object.byte_length) } });
    });
    const token = vi.fn(async () => "verified-current");
    const adapter = transport(fetch, token);
    const metadata = await adapter.getRecoverySnapshot(recoveryFixtureProject, 3);
    expect(metadata).toEqual(recoveryMetadata(snapshot));
    expect(await adapter.downloadRecoverySnapshot(metadata!)).toBe(snapshot.ciphertext_base64);
    expect(token).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls.every(([, init]) => (init?.headers as Record<string, string>).Authorization === "Bearer verified-current")).toBe(true);
  });

  it.each([null, []])("returns no proof for an absent committed snapshot (%j)", async value => {
    const adapter = transport(async () => new Response(JSON.stringify(value)));
    expect(await adapter.getRecoverySnapshot(recoveryFixtureProject, 3)).toBeNull();
  });

  it.each(["project", "version", "bucket", "path", "size", "nonce", "multiple"])("fails closed on %s metadata before a Storage download", async kind => {
    const row: Record<string, unknown> = recoveryManifestRow(await recoverySnapshotFixture());
    if (kind === "project") row.project_id = "other-project";
    if (kind === "version") row.key_version = 4;
    if (kind === "bucket") row.object_bucket = "other-bucket";
    if (kind === "path") row.object_path = "projects/other/snapshots/file.bin";
    if (kind === "size") row.object_byte_length = 64 * 1024 * 1024 + 1;
    if (kind === "nonce") row.manifest_nonce = "\\x08";
    const fetch = vi.fn(async () => new Response(JSON.stringify(kind === "multiple" ? [row, row] : row)));
    await expect(transport(fetch).getRecoverySnapshot(recoveryFixtureProject, 3)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["short", "oversize", "declared", "missing", "session"])("refuses %s object download without exposing usable proof", async kind => {
    const snapshot = await recoverySnapshotFixture();
    const metadata = recoveryMetadata(snapshot);
    let sessionChecks = 0;
    const adapter = transport(async () => {
      if (kind === "missing") return new Response("", { status: 404 });
      if (kind === "declared") return new Response(snapshot.ciphertext_base64, { headers: { "Content-Length": "999" } });
      return new Response(kind === "short" ? snapshot.ciphertext_base64.slice(1) : kind === "oversize" ? snapshot.ciphertext_base64 + "A" : snapshot.ciphertext_base64);
    }, async () => { if (++sessionChecks > 1 && kind === "session") throw new Error("Session ended"); return "current"; });
    await expect(adapter.downloadRecoverySnapshot(metadata)).rejects.toThrow();
  });

  it("installs only the local device key with an exact expected version and confirms the full immutable envelope", async () => {
    const row = await envelopeRow();
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toContain("mobile_recover_project_key_envelope");
      expect(JSON.parse(init!.body as string)).toEqual({ p_requesting_device_id: recoveryFixtureDevice, p_project_id: recoveryFixtureProject,
        p_expected_key_version: 3, p_expected_device_key_id: recoveryFixtureDeviceKey, p_envelope_id: input.envelopeId, p_sealed_key: "08".repeat(80) });
      expect(init!.body).not.toContain("OA1-");
      return new Response(JSON.stringify(row));
    });
    await transport(fetch).recoverProjectKeyEnvelope(input);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reconciles a lost installation reply only with exact own-envelope readback and never repeats the mutation", async () => {
    const row = await envelopeRow();
    const fetch = vi.fn(async url => {
      if (String(url).endsWith("mobile_recover_project_key_envelope")) throw new Error("Reply lost after commit");
      expect(String(url)).toContain("mobile_get_project_key_envelopes");
      return new Response(JSON.stringify([row]));
    });
    await expect(transport(fetch).recoverProjectKeyEnvelope(input)).resolves.toBeUndefined();
    expect(fetch.mock.calls.filter(([url]) => String(url).includes("recover_project"))).toHaveLength(1);
  });

  it.each(["missing", "device", "sender", "key", "version", "ciphertext", "duplicate", "ended-session"])("keeps %s lost-reply outcome unconfirmed without retry", async kind => {
    const row = await envelopeRow();
    if (kind === "device") row.recipient_device_id = "other-device";
    if (kind === "sender") row.sender_device_id = "other-device";
    if (kind === "key") row.recipient_key_id = "other-key";
    if (kind === "version") row.key_version = 4;
    if (kind === "ciphertext") row.sealed_project_key = "\\x" + "09".repeat(80);
    let sessionChecks = 0;
    const fetch = vi.fn(async url => {
      if (String(url).endsWith("mobile_recover_project_key_envelope")) throw new Error("Reply lost");
      return new Response(JSON.stringify(kind === "missing" ? [] : kind === "duplicate" ? [row, row] : [row]));
    });
    const adapter = transport(fetch, async () => { if (++sessionChecks > 1 && kind === "ended-session") throw new Error("Session ended"); return "current"; });
    await expect(adapter.recoverProjectKeyEnvelope(input)).rejects.toThrow("unconfirmed");
    expect(fetch.mock.calls.filter(([url]) => String(url).includes("recover_project"))).toHaveLength(1);
  });
});
