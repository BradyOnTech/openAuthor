import sodium from "libsodium-wrappers";
import { UUID, type CompanionAccount } from "./account";
import type { DesktopSecretStore } from "./secretStore";

type Identity = {
  version: 1;
  userId: string;
  deviceId: string;
  keyId: string;
  name: string;
  publicKey: string;
  privateKey: string;
};

function encode(value: Uint8Array): string {
  return sodium.to_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING);
}

function decode(value: unknown, length: number): Uint8Array {
  if (typeof value !== "string") throw new Error("Device encryption material is invalid.");
  const decoded = sodium.from_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING);
  if (decoded.length !== length || encode(decoded) !== value) {
    throw new Error("Device encryption material is invalid.");
  }
  return decoded;
}

function identity(raw: string, userId: string): Identity {
  let value: Identity;
  try { value = JSON.parse(raw) as Identity; } catch { throw new Error("The saved device identity is invalid."); }
  if (!value || value.version !== 1 || value.userId !== userId || !UUID.test(value.deviceId)
    || !UUID.test(value.keyId) || typeof value.name !== "string" || !value.name || value.name.length > 80) {
    throw new Error("The saved device identity does not match this account.");
  }
  const privateKey = decode(value.privateKey, 32);
  try {
    const publicKey = decode(value.publicKey, 32);
    if (!sodium.memcmp(sodium.crypto_scalarmult_base(privateKey), publicKey)) {
      throw new Error("The saved device key pair does not match.");
    }
  } finally { privateKey.fill(0); }
  return value;
}

function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid companion enrollment response.");
  return value as Record<string, unknown>;
}

function bytea(value: unknown, length: number): Uint8Array {
  if (typeof value !== "string" || !new RegExp(`^\\\\x[0-9a-f]{${length * 2}}$`, "i").test(value)) {
    throw new Error("Invalid project key envelope.");
  }
  return sodium.from_hex(value.slice(2));
}

export type DesktopEnrollment = {
  deviceId: string;
  projectKeys: Map<number, CryptoKey>;
  accessToken(): Promise<string>;
};

export async function enrollDesktopForProject(input: {
  scope: string;
  projectId: string;
  account: CompanionAccount;
  secrets: DesktopSecretStore;
}): Promise<DesktopEnrollment> {
  if (!UUID.test(input.projectId)) throw new Error("This book needs a hosted project identity before companion sync.");
  if (!/^[0-9a-f]{64}$/.test(input.scope)) throw new Error("Invalid companion deployment scope.");
  const { account, secrets } = input;
  const session = await account.session();
  if (!session || !UUID.test(session.userId)) throw new Error("Sign in before connecting this desktop.");
  await sodium.ready;
  const slot = `device-${input.scope}-${session.userId}`;
  let stored = await secrets.get(slot);
  if (stored === null) {
    const pair = sodium.crypto_box_keypair();
    try {
      // A durable, atomic write precedes all remote mutation. An ambiguous
      // registration response can always be retried using these same IDs/keys.
      stored = await secrets.create(slot, JSON.stringify({
        version: 1, userId: session.userId, deviceId: crypto.randomUUID(), keyId: crypto.randomUUID(),
        name: "openAuthor desktop", publicKey: encode(pair.publicKey), privateKey: encode(pair.privateKey),
      } satisfies Identity));
    } finally { pair.privateKey.fill(0); }
  }
  const device = identity(stored, session.userId);
  if (!await account.session({ userId: device.userId })) throw new Error("Sign in before connecting this desktop.");
  const registered = row(await account.rpc("mobile_register_device", {
    p_device_id: device.deviceId, p_key_id: device.keyId,
    p_platform: "desktop", p_device_label: device.name,
    p_key_algorithm: "x25519-v1", p_public_key: `\\x${sodium.to_hex(decode(device.publicKey, 32))}`,
  }));
  if (registered.id !== device.deviceId) throw new Error("Desktop registration identity mismatch.");
  await account.refresh();
  const accessToken = async () => {
    const verified = await account.session({ userId: device.userId, deviceId: device.deviceId });
    if (!verified) throw new Error("Your companion session ended. Reconnect to continue.");
    return verified.accessToken;
  };
  await accessToken();
  await account.rpc("mobile_enroll_project_device", {
    p_requesting_device_id: device.deviceId, p_project_id: input.projectId, p_target_device_id: device.deviceId,
  });
  await accessToken();
  const envelopes = await account.rpc("mobile_get_project_key_envelopes", {
    p_requesting_device_id: device.deviceId, p_project_id: input.projectId,
  });
  if (!Array.isArray(envelopes)) throw new Error("Invalid project key envelope collection.");
  const projectKeys = new Map<number, CryptoKey>();
  const privateKey = decode(device.privateKey, 32);
  try {
    for (const value of envelopes) {
      const envelope = row(value);
      const version = envelope.key_version;
      if (envelope.project_id !== input.projectId || envelope.recipient_device_id !== device.deviceId
        || envelope.recipient_key_id !== device.keyId
        || envelope.algorithm !== "x25519-xsalsa20-poly1305-sealedbox-v1"
        || typeof version !== "number" || !Number.isSafeInteger(version) || version < 1 || projectKeys.has(version)) {
        throw new Error("Project key envelope identity mismatch.");
      }
      const sealed = bytea(envelope.sealed_project_key, 80);
      const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(sealed).buffer);
      if (sodium.to_hex(new Uint8Array(hash)) !== envelope.sealed_project_key_sha256) {
        throw new Error("Project key envelope checksum mismatch.");
      }
      const raw = sodium.crypto_box_seal_open(sealed, decode(device.publicKey, 32), privateKey);
      try {
        if (raw.length !== 32) throw new Error("Invalid decrypted project key.");
        const key = await crypto.subtle.importKey("raw", new Uint8Array(raw).buffer, "AES-GCM", false, ["encrypt", "decrypt"]);
        projectKeys.set(version, key);
      } finally { raw.fill(0); }
    }
  } finally { privateKey.fill(0); }
  return { deviceId: device.deviceId, projectKeys, accessToken };
}
