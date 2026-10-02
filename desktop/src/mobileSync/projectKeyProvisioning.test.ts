import { describe, expect, it, vi } from "vitest";
import {
  createMobileProjectKeyProvisioningService,
  libsodiumSealedBox,
  type MobileProjectKeyProvisioningTransport,
} from "./projectKeyProvisioning";
import { verifyProjectKeyVerifier } from "./projectKeyVerifier";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const DEVICE_ONE = "20000000-0000-4000-8000-000000000001";
const DEVICE_TWO = "20000000-0000-4000-8000-000000000002";
const KEY_ONE = "30000000-0000-4000-8000-000000000001";
const KEY_TWO = "30000000-0000-4000-8000-000000000002";

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deterministicCrypto() {
  const ids = [
    "40000000-0000-4000-8000-000000000001",
    "40000000-0000-4000-8000-000000000002",
  ];
  return {
    subtle: crypto.subtle,
    getRandomValues<T extends ArrayBufferView | null>(array: T): T {
      if (array instanceof Uint8Array) {
        array.set(Uint8Array.from({ length: array.length }, (_, index) => index));
      }
      return array;
    },
    randomUUID: () => ids.shift() as `${string}-${string}-${string}-${string}-${string}`,
  };
}

describe("mobile project-key provisioning", () => {
  it("records an independently authenticated book/version verifier in the exact envelope rotation", async () => {
    const rotate = vi.fn(async () => ({ keyVersion: 4 }));
    const transport: MobileProjectKeyProvisioningTransport = {
      listProjectDevices: async () => [{ deviceId: DEVICE_ONE, keyId: KEY_ONE, keyAlgorithm: "x25519-v1", publicKey: base64Url(new Uint8Array(32)), projectEnrolledAt: "now", projectRevokedAt: null }],
      rotateProjectKeyWithEnvelopes: rotate,
    };
    const service = createMobileProjectKeyProvisioningService({ transport, sealedBox: { seal: () => new Uint8Array(80) }, cryptoProvider: deterministicCrypto() });
    const result = await service.provisionProjectKey({ projectId: PROJECT_ID, expectedPreviousVersion: 3, reasonCode: "test" });
    const submitted = (rotate.mock.calls[0] as unknown as [{ verifier: unknown }])[0];
    await expect(verifyProjectKeyVerifier(result.projectKey, submitted.verifier, PROJECT_ID, 4)).resolves.toBeUndefined();
    expect(JSON.stringify(submitted)).not.toContain(result.recoveryKey);
  });

  it("refuses a changed reviewed device/key set before creating or sending envelopes", async () => {
    const current = { deviceId: DEVICE_ONE, keyId: KEY_TWO, keyAlgorithm: "x25519-v1", publicKey: base64Url(new Uint8Array(32)), projectEnrolledAt: "now", projectRevokedAt: null };
    const transport: MobileProjectKeyProvisioningTransport = {
      listProjectDevices: vi.fn(async () => [current]), rotateProjectKeyWithEnvelopes: vi.fn(),
    };
    const seal = vi.fn();
    const service = createMobileProjectKeyProvisioningService({ transport, sealedBox: { seal } });
    await expect(service.provisionProjectKey({ projectId: PROJECT_ID, expectedPreviousVersion: 3, reasonCode: "lost-device", reviewedRecipients: [{ deviceId: DEVICE_ONE, keyId: KEY_ONE }] })).rejects.toThrow("remaining device keys changed");
    expect(seal).not.toHaveBeenCalled(); expect(transport.rotateProjectKeyWithEnvelopes).not.toHaveBeenCalled();
  });
  it("seals one random project key independently for every active device", async () => {
    const publicKeyOne = base64Url(Uint8Array.from({ length: 32 }, () => 11));
    const publicKeyTwo = base64Url(Uint8Array.from({ length: 32 }, () => 22));
    const transport: MobileProjectKeyProvisioningTransport = {
      listProjectDevices: vi.fn(async () => [
        {
          deviceId: DEVICE_ONE,
          keyId: KEY_ONE,
          keyAlgorithm: "x25519-v1",
          publicKey: publicKeyOne,
          projectEnrolledAt: "2026-08-30T12:00:00Z",
          projectRevokedAt: null,
        },
        {
          deviceId: DEVICE_TWO,
          keyId: KEY_TWO,
          keyAlgorithm: "x25519-v1",
          publicKey: publicKeyTwo,
          projectEnrolledAt: "2026-08-30T12:01:00Z",
          projectRevokedAt: null,
        },
      ]),
      rotateProjectKeyWithEnvelopes: vi.fn(async () => ({ keyVersion: 4 })),
    };
    const seal = vi.fn((_projectKey: Uint8Array, recipientKey: Uint8Array) => {
      return Uint8Array.from({ length: 80 }, (_, index) => recipientKey[0] + index);
    });
    const service = createMobileProjectKeyProvisioningService({
      transport,
      cryptoProvider: deterministicCrypto(),
      sealedBox: { seal },
    });

    const result = await service.provisionProjectKey({
      projectId: PROJECT_ID,
      expectedPreviousVersion: 3,
      reasonCode: "desktop-provisioning",
    });

    expect(result.keyVersion).toBe(4);
    expect(result.envelopeCount).toBe(2);
    expect(result.recoveryKey).toBe(
      "OA1-AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8.EFAAEC69"
    );
    expect(result.projectKey).toMatchObject({
      type: "secret",
      extractable: false,
      algorithm: { name: "AES-GCM", length: 256 },
    });
    expect(result.projectKey.usages).toEqual(["encrypt", "decrypt"]);
    await expect(crypto.subtle.exportKey("raw", result.projectKey)).rejects.toThrow();
    expect(seal).toHaveBeenCalledTimes(2);
    expect(Array.from(seal.mock.calls[0][0])).toEqual(
      Array.from({ length: 32 }, (_, index) => index)
    );
    expect(seal.mock.calls[0][0]).not.toBe(seal.mock.calls[1][0]);
    expect(Array.from(seal.mock.calls[1][0])).toEqual(
      Array.from({ length: 32 }, (_, index) => index)
    );
    expect(Array.from(seal.mock.calls[0][1])).toEqual(Array(32).fill(11));
    expect(Array.from(seal.mock.calls[1][1])).toEqual(Array(32).fill(22));
    expect(transport.rotateProjectKeyWithEnvelopes).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      expectedPreviousVersion: 3,
      reasonCode: "desktop-provisioning",
      verifier: expect.objectContaining({ project_id: PROJECT_ID, key_version: 4, schema_version: 1 }),
      envelopes: [
        {
          envelopeId: "40000000-0000-4000-8000-000000000001",
          recipientDeviceId: DEVICE_ONE,
          recipientKeyId: KEY_ONE,
          algorithm: "x25519-xsalsa20-poly1305-sealedbox-v1",
          sealedProjectKey: base64Url(
            Uint8Array.from({ length: 80 }, (_, index) => 11 + index)
          ),
        },
        {
          envelopeId: "40000000-0000-4000-8000-000000000002",
          recipientDeviceId: DEVICE_TWO,
          recipientKeyId: KEY_TWO,
          algorithm: "x25519-xsalsa20-poly1305-sealedbox-v1",
          sealedProjectKey: base64Url(
            Uint8Array.from({ length: 80 }, (_, index) => 22 + index)
          ),
        },
      ],
    });
  });

  it("uses a libsodium sealed box that mobile can open", async () => {
    const sodium = (await import("libsodium-wrappers")).default;
    await sodium.ready;
    const recipient = sodium.crypto_box_keypair();
    const projectKey = Uint8Array.from({ length: 32 }, (_, index) => index);

    const envelope = await libsodiumSealedBox.seal(projectKey, recipient.publicKey);
    const opened = sodium.crypto_box_seal_open(
      envelope,
      recipient.publicKey,
      recipient.privateKey
    );

    expect(envelope).toHaveLength(80);
    expect(Array.from(opened)).toEqual(Array.from(projectKey));
    expect(base64Url(envelope)).toMatch(/^[A-Za-z0-9_-]{107}$/);
  });

  it("fails before rotation when no active enrolled X25519 device exists", async () => {
    const transport: MobileProjectKeyProvisioningTransport = {
      listProjectDevices: vi.fn(async () => [
        {
          deviceId: DEVICE_ONE,
          keyId: KEY_ONE,
          keyAlgorithm: "x25519-v1",
          publicKey: base64Url(new Uint8Array(32)),
          projectEnrolledAt: null,
          projectRevokedAt: null,
        },
        {
          deviceId: DEVICE_TWO,
          keyId: KEY_TWO,
          keyAlgorithm: "future-algorithm",
          publicKey: base64Url(new Uint8Array(32)),
          projectEnrolledAt: "2026-08-30T12:01:00Z",
          projectRevokedAt: null,
        },
      ]),
      rotateProjectKeyWithEnvelopes: vi.fn(async () => ({ keyVersion: 1 })),
    };
    const seal = vi.fn(() => new Uint8Array(80));
    const service = createMobileProjectKeyProvisioningService({
      transport,
      sealedBox: { seal },
      cryptoProvider: deterministicCrypto(),
    });

    await expect(service.provisionProjectKey({
      projectId: PROJECT_ID,
      expectedPreviousVersion: 0,
      reasonCode: "initial-provisioning",
    })).rejects.toThrow("No active X25519 project device");
    expect(seal).not.toHaveBeenCalled();
    expect(transport.rotateProjectKeyWithEnvelopes).not.toHaveBeenCalled();
  });

  it("returns no key when a hosted rotation RPC fails", async () => {
    const transport: MobileProjectKeyProvisioningTransport = {
      listProjectDevices: vi.fn(async () => [{
        deviceId: DEVICE_ONE,
        keyId: KEY_ONE,
        keyAlgorithm: "x25519-v1",
        publicKey: base64Url(new Uint8Array(32)),
        projectEnrolledAt: "2026-08-30T12:00:00Z",
        projectRevokedAt: null,
      }]),
      rotateProjectKeyWithEnvelopes: vi.fn(async () => {
        throw new Error("Supabase mobile sync RPC failed (409).");
      }),
    };
    const service = createMobileProjectKeyProvisioningService({
      transport,
      sealedBox: { seal: () => new Uint8Array(80) },
      cryptoProvider: deterministicCrypto(),
    });

    await expect(service.provisionProjectKey({
      projectId: PROJECT_ID,
      expectedPreviousVersion: 3,
      reasonCode: "desktop-provisioning",
    })).rejects.toThrow("Supabase mobile sync RPC failed (409).");
    expect(transport.rotateProjectKeyWithEnvelopes).toHaveBeenCalledTimes(1);
  });
});
