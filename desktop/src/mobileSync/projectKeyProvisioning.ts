export const MOBILE_PROJECT_KEY_ENVELOPE_ALGORITHM =
  "x25519-xsalsa20-poly1305-sealedbox-v1" as const;

export type MobileProjectDevice = {
  deviceId: string;
  userId?: string;
  platform?: string;
  deviceKeyVersion?: number;
  keyId: string;
  keyAlgorithm: string;
  publicKey: string;
  projectEnrolledAt: string | null;
  projectRevokedAt: string | null;
};
export type MobileProjectKeyState = { latestKeyVersion: number; activeKeyVersion: number | null };

export type MobileProjectKeyEnvelope = {
  envelopeId: string;
  recipientDeviceId: string;
  recipientKeyId: string;
  algorithm: typeof MOBILE_PROJECT_KEY_ENVELOPE_ALGORITHM;
  sealedProjectKey: string;
};

export type MobileProjectKeyProvisioningTransport = {
  listProjectDevices(projectId: string): Promise<MobileProjectDevice[]>;
  rotateProjectKeyWithEnvelopes(input: {
    projectId: string;
    expectedPreviousVersion: number;
    reasonCode: string;
    envelopes: MobileProjectKeyEnvelope[];
    verifier: ProjectKeyVerifier;
  }): Promise<{ keyVersion: number }>;
};

export type MobileSealedBox = {
  seal(projectKey: Uint8Array, recipientPublicKey: Uint8Array):
    Uint8Array | Promise<Uint8Array>;
};

export const libsodiumSealedBox: MobileSealedBox = {
  async seal(projectKey, recipientPublicKey) {
    const { default: sodium } = await import("libsodium-wrappers");
    await sodium.ready;
    return sodium.crypto_box_seal(projectKey, recipientPublicKey);
  },
};

type ProvisioningCrypto = Pick<Crypto, "getRandomValues" | "randomUUID" | "subtle">;

function bytesBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlToBytes(
  value: string,
  expectedLength: number,
  label = "Mobile device public key"
): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.includes("=")) {
    throw new Error(`${label} is not unpadded base64url.`);
  }
  const canonical = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = canonical.padEnd(Math.ceil(canonical.length / 4) * 4, "=");
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error(`${label} is invalid base64url.`);
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.byteLength !== expectedLength || bytesToBase64Url(bytes) !== value) {
    throw new Error(`${label} must be ${expectedLength} bytes.`);
  }
  return bytes;
}

function crc32(value: string): string {
  let crc = 0xffffffff;
  for (let index = 0; index < value.length; index += 1) {
    crc ^= value.charCodeAt(index);
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ((crc ^ 0xffffffff) >>> 0)
    .toString(16)
    .padStart(8, "0")
    .toUpperCase();
}

function recoveryKey(projectKey: Uint8Array): string {
  const body = bytesToBase64Url(projectKey);
  return `OA1-${body}.${crc32(body)}`;
}

function recoveryBytes(value: string): Uint8Array {
  const compact = value.trim();
  if (!compact.startsWith("OA1-")) {
    throw new Error("Recovery key version is unsupported.");
  }
  const separator = compact.lastIndexOf(".");
  if (separator < 5) throw new Error("Recovery key is incomplete.");
  const body = compact.slice(4, separator);
  const checksum = compact.slice(separator + 1);
  if (!/^[A-Za-z0-9_-]{43}$/.test(body)) {
    throw new Error("Recovery key format is invalid.");
  }
  if (crc32(body) !== checksum.toUpperCase()) {
    throw new Error("Recovery key checksum does not match.");
  }
  return base64UrlToBytes(body, 32, "Recovery key");
}

export async function sealMobileRecoveryKey(value: string, recipientPublicKey: string, sealedBox: MobileSealedBox = libsodiumSealedBox): Promise<string> {
  const rawKey = recoveryBytes(value);
  try {
    const sealed = await sealedBox.seal(rawKey, base64UrlToBytes(recipientPublicKey, 32));
    if (sealed.byteLength !== 80) throw new Error("Sealed project key must be exactly 80 bytes.");
    return bytesToBase64Url(sealed);
  } finally { rawKey.fill(0); }
}

export async function importMobileRecoveryKey(
  value: string,
  cryptoProvider: Pick<Crypto, "subtle"> = crypto
): Promise<CryptoKey> {
  const rawKey = recoveryBytes(value);
  try {
    return await cryptoProvider.subtle.importKey(
      "raw",
      bytesBuffer(rawKey),
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  } finally {
    rawKey.fill(0);
  }
}

function positiveVersion(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

export function createMobileProjectKeyProvisioningService(options: {
  transport: MobileProjectKeyProvisioningTransport;
  sealedBox?: MobileSealedBox;
  cryptoProvider?: ProvisioningCrypto;
}) {
  const cryptoProvider = options.cryptoProvider ?? crypto;
  const sealedBox = options.sealedBox ?? libsodiumSealedBox;

  return {
    async provisionProjectKey(input: {
      projectId: string;
      expectedPreviousVersion: number;
      reasonCode: string;
      reviewedRecipients?: ReadonlyArray<{ deviceId: string; keyId: string }>;
    }): Promise<{
      projectKey: CryptoKey;
      keyVersion: number;
      recoveryKey: string;
      envelopeCount: number;
    }> {
      const expectedPreviousVersion = positiveVersion(
        input.expectedPreviousVersion,
        "Expected previous project key version"
      );
      const listedDevices = await options.transport.listProjectDevices(input.projectId);
      const recipients = listedDevices.filter((device) => (
        device.projectEnrolledAt !== null
        && device.projectRevokedAt === null
        && device.keyAlgorithm === "x25519-v1"
      ));
      if (input.reviewedRecipients !== undefined) {
        const identity = (rows: ReadonlyArray<{ deviceId: string; keyId: string }>) =>
          rows.map(row => `${row.deviceId}:${row.keyId}`).sort();
        if (JSON.stringify(identity(recipients)) !== JSON.stringify(identity(input.reviewedRecipients))) {
          throw new Error("The remaining device keys changed. Refresh and review the recipients before rotating.");
        }
      }
      if (recipients.length === 0) {
        throw new Error("No active X25519 project device is available for key provisioning.");
      }

      const rawProjectKey = new Uint8Array(32);
      cryptoProvider.getRandomValues(rawProjectKey);
      let sealedRecipients: Array<{
        recipient: MobileProjectDevice;
        sealedProjectKey: Uint8Array;
      }>;
      let printableRecoveryKey: string;
      let projectKey: CryptoKey;
      try {
        sealedRecipients = await Promise.all(recipients.map(async (recipient) => {
          const publicKey = base64UrlToBytes(recipient.publicKey, 32);
          const sealedProjectKey = new Uint8Array(
            await sealedBox.seal(new Uint8Array(rawProjectKey), publicKey)
          );
          if (sealedProjectKey.byteLength !== 80) {
            throw new Error("Sealed project key must be exactly 80 bytes.");
          }
          return { recipient, sealedProjectKey };
        }));
        printableRecoveryKey = recoveryKey(rawProjectKey);
        projectKey = await cryptoProvider.subtle.importKey(
          "raw",
          bytesBuffer(rawProjectKey),
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"]
        );
      } finally {
        rawProjectKey.fill(0);
      }

      const rotation = await options.transport.rotateProjectKeyWithEnvelopes({
        projectId: input.projectId,
        expectedPreviousVersion,
        reasonCode: input.reasonCode,
        verifier: await createProjectKeyVerifier(projectKey, input.projectId, expectedPreviousVersion + 1, cryptoProvider),
        envelopes: sealedRecipients.map((sealed) => ({
          envelopeId: cryptoProvider.randomUUID(),
          recipientDeviceId: sealed.recipient.deviceId,
          recipientKeyId: sealed.recipient.keyId,
          algorithm: MOBILE_PROJECT_KEY_ENVELOPE_ALGORITHM,
          sealedProjectKey: bytesToBase64Url(sealed.sealedProjectKey),
        })),
      });
      if (rotation.keyVersion !== expectedPreviousVersion + 1) {
        throw new Error("Hosted project key version is invalid.");
      }

      return {
        projectKey,
        keyVersion: rotation.keyVersion,
        recoveryKey: printableRecoveryKey,
        envelopeCount: sealedRecipients.length,
      };
    },
  };
}
import type { ProjectKeyVerifier } from "@openauthor/contracts";
import { createProjectKeyVerifier } from "./projectKeyVerifier";
