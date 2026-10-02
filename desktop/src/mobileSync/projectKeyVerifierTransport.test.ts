import { describe, expect, it, vi } from "vitest";
import { SupabaseMobileSyncTransport } from "./supabaseTransport";
import { createProjectKeyVerifier } from "./projectKeyVerifier";
import { importMobileRecoveryKey } from "./projectKeyProvisioning";
import { recoveryFixtureKey, recoveryFixtureProject, recoveryFixtureDevice } from "./recoverySnapshot.fixture";

function transport(fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  return new SupabaseMobileSyncTransport({ supabaseUrl: "https://synthetic.invalid", publishableKey: "public", userAccessToken: "synthetic", deviceId: recoveryFixtureDevice, fetch });
}
const proof = async () => createProjectKeyVerifier(await importMobileRecoveryKey(recoveryFixtureKey), recoveryFixtureProject, 3);
const rotation = async () => ({ projectId: recoveryFixtureProject, expectedPreviousVersion: 2, reasonCode: "test",
  verifier: await proof(), envelopes: [{ envelopeId: "70000000-0000-4000-8000-000000000001", recipientDeviceId: recoveryFixtureDevice,
    recipientKeyId: "60000000-0000-4000-8000-000000000001", algorithm: "x25519-xsalsa20-poly1305-sealedbox-v1" as const,
    sealedProjectKey: btoa(String.fromCharCode(...new Uint8Array(80))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") }] });

describe("current project-key verifier RPC contract", () => {
  it("reads only exact current project/version and accepts a positively null legacy witness", async () => {
    const verifier = await proof();
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(init!.body as string)).toEqual({ p_requesting_device_id: recoveryFixtureDevice, p_project_id: recoveryFixtureProject, p_expected_key_version: 3 });
      return new Response(JSON.stringify(verifier));
    });
    await expect(transport(fetch).getProjectKeyVerifier(recoveryFixtureProject, 3)).resolves.toEqual(verifier);
    expect(fetch.mock.calls[0][0]).toContain("mobile_get_project_key_verifier");
    await expect(transport(async () => new Response("null")).getProjectKeyVerifier(recoveryFixtureProject, 3)).resolves.toBeNull();
  });
  it.each(["project", "version", "digest", "nonce", "array", "unknown", "unavailable"])("refuses %s verifier responses without treating them as missing legacy proof", async kind => {
    const verifier: Record<string, unknown> = { ...await proof() };
    if (kind === "project") verifier.project_id = recoveryFixtureProject.replace(/1$/, "2");
    if (kind === "version") verifier.key_version = 4;
    if (kind === "digest") verifier.ciphertext_sha256 = "wrong";
    if (kind === "nonce") verifier.nonce_hex = "ab";
    if (kind === "unknown") verifier.prose = "extra";
    const fetch = vi.fn(async () => new Response(JSON.stringify(kind === "array" ? [] : verifier), { status: kind === "unavailable" ? 500 : 200 }));
    await expect(transport(fetch).getProjectKeyVerifier(recoveryFixtureProject, 3)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("submits proof and exact envelopes in one RPC and confirms the complete immutable verifier", async () => {
    const input = await rotation();
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string);
      expect(body.p_verifier).toEqual(input.verifier);
      expect(body.p_envelopes).toHaveLength(1);
      expect(init!.body).not.toContain("OA1-");
      return new Response(JSON.stringify({ project_id: recoveryFixtureProject, key_version: 3, recovery_verifier: input.verifier }));
    });
    await expect(transport(fetch).rotateProjectKeyWithEnvelopes(input)).resolves.toEqual({ keyVersion: 3 });
    expect(fetch.mock.calls[0][0]).toContain("mobile_rotate_project_key_with_verifier");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["missing", "different", "version"])("keeps %s rotation receipts unconfirmed without retrying the mutation", async kind => {
    const input = await rotation();
    const row = { project_id: recoveryFixtureProject, key_version: kind === "version" ? 4 : 3,
      recovery_verifier: kind === "missing" ? undefined : { ...input.verifier, ...(kind === "different" ? { nonce_hex: "00".repeat(12) } : {}) } };
    const fetch = vi.fn(async () => new Response(JSON.stringify(row)));
    await expect(transport(fetch).rotateProjectKeyWithEnvelopes(input)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
