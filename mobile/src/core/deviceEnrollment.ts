export type EnrolledDevice = {
  deviceId: string;
  keyId: string;
  userId: string;
  name: string;
  platform: "ios" | "android" | "web";
  publicKey: string;
  enrolledAt: string;
  projectKeySlots: string[];
};

export interface DeviceCrypto {
  generateKeyPair(): Promise<{ publicKey: string; privateKey: string }>;
  openSealedProjectKey(input: {
    envelope: string;
    publicKey: string;
    privateKey: string;
  }): Promise<string>;
}

export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Atomically return the existing value or persist and return the candidate. */
  create(key: string, candidate: string): Promise<string>;
  setLocalAccessIfCurrent?(value: string, current: () => void): Promise<void>;
}

export interface DeviceStore {
  current(): Promise<EnrolledDevice | null>;
  save(device: EnrolledDevice): Promise<void>;
  clear(): Promise<void>;
}

export interface DeviceEnrollmentTransport {
  register(input: {
    deviceId: string;
    keyId: string;
    name: string;
    platform: "ios" | "android" | "web";
    publicKey: string;
  }): Promise<{ deviceId: string; keyId: string; enrolledAt: string }>;
  rebind(input: {
    deviceId: string;
    keyId: string;
    name: string;
    platform: "ios" | "android" | "web";
    publicKey: string;
  }): Promise<{ deviceId: string; enrolledAt: string }>;
  projectKeyEnvelope(input: {
    projectId: string;
    deviceId: string;
    keyVersion: number;
  }): Promise<{ keyVersion: number; envelope: string }>;
  revoke(deviceId: string): Promise<void>;
}

function cloneDevice(value: EnrolledDevice): EnrolledDevice {
  return { ...value, projectKeySlots: [...value.projectKeySlots] };
}

export class InMemoryDeviceStore implements DeviceStore {
  #device: EnrolledDevice | null = null;

  async current(): Promise<EnrolledDevice | null> {
    return this.#device ? cloneDevice(this.#device) : null;
  }

  async save(device: EnrolledDevice): Promise<void> {
    this.#device = cloneDevice(device);
  }

  async clear(): Promise<void> {
    this.#device = null;
  }
}

function privateKeySlot(deviceId: string): string {
  return `openauthor.device.${deviceId}.private-key`;
}

function projectKeySlot(projectId: string, keyVersion: number): string {
  return `openauthor.project.${projectId}.key.${keyVersion}`;
}

const IDENTITY_SLOT = "openauthor.device.identity.v2";
type StoredIdentity = Omit<EnrolledDevice, "enrolledAt" | "projectKeySlots"> & { version: 1; privateKey: string };

function storedIdentity(encoded: string, userId?: string): StoredIdentity {
  let value: StoredIdentity;
  try { value = JSON.parse(encoded) as StoredIdentity; } catch { throw new Error("Saved device identity is corrupt. No replacement key was created."); }
  if (!value || value.version !== 1 || typeof value.deviceId !== "string" || !/^[a-z0-9-]{1,128}$/i.test(value.deviceId)
    || typeof value.keyId !== "string" || !/^[a-z0-9-]{1,128}$/i.test(value.keyId)
    || typeof value.userId !== "string" || !value.userId || value.userId.length > 128
    || typeof value.name !== "string" || !value.name || value.name.length > 80
    || !["ios", "android", "web"].includes(value.platform)
    || typeof value.publicKey !== "string" || !value.publicKey || value.publicKey.length > 128
    || typeof value.privateKey !== "string" || !value.privateKey || value.privateKey.length > 128) {
    throw new Error("Saved device identity is invalid. No replacement key was created.");
  }
  if (userId !== undefined && value.userId !== userId) throw new Error("This device has saved work for another account. Sign in to that account to sync or remove it first.");
  return value;
}

export function decodeEnrolledDevice(encoded: string | null): EnrolledDevice | null {
  if (encoded === null) return null;
  let value: EnrolledDevice;
  try { value = JSON.parse(encoded) as EnrolledDevice; } catch { throw new Error("Saved device enrollment is corrupt."); }
  if (!value || !["deviceId", "keyId", "userId", "name", "publicKey", "enrolledAt"].every((key) =>
    typeof value[key as keyof EnrolledDevice] === "string" && (value[key as keyof EnrolledDevice] as string).length > 0)
    || !["ios", "android", "web"].includes(value.platform) || !Array.isArray(value.projectKeySlots)
    || !value.projectKeySlots.every((slot) => typeof slot === "string" && /^openauthor\.project\.[a-z0-9-]+\.key\.[1-9][0-9]*$/i.test(slot))) {
    throw new Error("Saved device enrollment is invalid.");
  }
  return value;
}

export class DeviceEnrollment {
  readonly #crypto: DeviceCrypto;
  readonly #secrets: SecretStore;
  readonly #devices: DeviceStore;
  readonly #transport: DeviceEnrollmentTransport;
  readonly #uuid: () => string;

  constructor(input: {
    crypto: DeviceCrypto;
    secrets: SecretStore;
    devices: DeviceStore;
    transport: DeviceEnrollmentTransport;
    uuid?: () => string;
  }) {
    this.#crypto = input.crypto;
    this.#secrets = input.secrets;
    this.#devices = input.devices;
    this.#transport = input.transport;
    this.#uuid = input.uuid ?? (() => globalThis.crypto.randomUUID());
  }

  async enroll(input: {
    userId: string;
    name: string;
    platform: "ios" | "android" | "web";
  }): Promise<EnrolledDevice> {
    const existing = await this.#devices.current();
    if (existing) {
      if (existing.userId !== input.userId) {
        throw new Error("The enrolled device belongs to a different account.");
      }
      if (!await this.#secrets.get(privateKeySlot(existing.deviceId))) {
        throw new Error("The enrolled device key is unavailable. No replacement device was registered.");
      }
      return existing;
    }
    const userId = input.userId.trim();
    if (!userId) throw new Error("Device account identity is invalid.");
    const name = input.name.trim();
    if (!name || name.length > 80) throw new Error("Device name is invalid.");
    let encoded = await this.#secrets.get(IDENTITY_SLOT);
    if (encoded === null) {
      const pair = await this.#crypto.generateKeyPair();
      // Registration may succeed even when its response is lost. Save the
      // complete canonical identity first; retain it to arbitrate browser tabs.
      encoded = await this.#secrets.create(IDENTITY_SLOT, JSON.stringify({
        version: 1, userId, name, platform: input.platform,
        deviceId: this.#uuid(), keyId: this.#uuid(), ...pair,
      } satisfies StoredIdentity));
    }
    const identity = storedIdentity(encoded, userId);
    await this.#secrets.set(privateKeySlot(identity.deviceId), identity.privateKey);
    const registered = await this.#transport.register({
      deviceId: identity.deviceId, keyId: identity.keyId,
      name: identity.name, platform: identity.platform, publicKey: identity.publicKey,
    });
    if (registered.deviceId !== identity.deviceId || registered.keyId !== identity.keyId) {
      throw new Error("Device registration identity mismatch.");
    }
    const device: EnrolledDevice = {
      deviceId: registered.deviceId,
      keyId: registered.keyId,
      userId,
      name: identity.name,
      platform: identity.platform,
      publicKey: identity.publicKey,
      enrolledAt: registered.enrolledAt,
      projectKeySlots: [],
    };
    await this.#devices.save(device);
    return cloneDevice(device);
  }

  async rebindCurrent(userId: string): Promise<EnrolledDevice> {
    const device = await this.#devices.current();
    if (!device) throw new Error("This device is not enrolled.");
    if (device.userId !== userId) {
      throw new Error("The enrolled device belongs to a different account.");
    }
    if (!await this.#secrets.get(privateKeySlot(device.deviceId))) {
      throw new Error("The enrolled device key is unavailable. No replacement device was registered.");
    }
    const rebound = await this.#transport.rebind({
      deviceId: device.deviceId,
      keyId: device.keyId,
      name: device.name,
      platform: device.platform,
      publicKey: device.publicKey,
    });
    if (rebound.deviceId !== device.deviceId) {
      throw new Error("Device re-registration identity mismatch.");
    }
    return cloneDevice(device);
  }

  async projectKey(projectId: string, keyVersion: number): Promise<string> {
    if (!projectId.trim() || !Number.isSafeInteger(keyVersion) || keyVersion < 1) {
      throw new Error("Project key request is invalid.");
    }
    const slot = projectKeySlot(projectId, keyVersion);
    const cached = await this.#secrets.get(slot);
    if (cached) return cached;
    const device = await this.#devices.current();
    if (!device) throw new Error("This device is not enrolled.");
    const privateKey = await this.#secrets.get(privateKeySlot(device.deviceId));
    if (!privateKey) throw new Error("The enrolled device key is unavailable.");
    const wrapped = await this.#transport.projectKeyEnvelope({
      projectId,
      deviceId: device.deviceId,
      keyVersion,
    });
    if (wrapped.keyVersion !== keyVersion) throw new Error("Project key version mismatch.");
    const projectKey = await this.#crypto.openSealedProjectKey({
      envelope: wrapped.envelope,
      publicKey: device.publicKey,
      privateKey,
    });
    await this.#secrets.set(slot, projectKey);
    if (!device.projectKeySlots.includes(slot)) {
      device.projectKeySlots.push(slot);
      await this.#devices.save(device);
    }
    return projectKey;
  }

  /** Local access never registers a device, refreshes a token or downloads a key. */
  async localDevice(userId?: string): Promise<EnrolledDevice> {
    const device = await this.#devices.current();
    if (!device || (userId !== undefined && device.userId !== userId)) {
      throw new Error("The saved device does not belong to this account.");
    }
    if (!await this.#secrets.get(privateKeySlot(device.deviceId))) {
      throw new Error("The saved device key is unavailable. Reconnect to recover this device.");
    }
    return cloneDevice(device);
  }

  async localProjectKey(projectId: string, keyVersion: number): Promise<string> {
    if (!projectId.trim() || !Number.isSafeInteger(keyVersion) || keyVersion < 1) throw new Error("Project key request is invalid.");
    await this.localDevice();
    const key = await this.#secrets.get(projectKeySlot(projectId, keyVersion));
    if (!key) throw new Error("This book key is not downloaded. Reconnect to unlock the book.");
    return key;
  }

  async importProjectKey(projectId: string, keyVersion: number, projectKey: string): Promise<void> {
    if (
      !projectId.trim()
      || !Number.isSafeInteger(keyVersion)
      || keyVersion < 1
      || !projectKey.trim()
      || projectKey.length > 1024
    ) {
      throw new Error("Recovered project key is invalid.");
    }
    const device = await this.#devices.current();
    if (!device) throw new Error("This device must be enrolled before recovery.");
    const slot = projectKeySlot(projectId, keyVersion);
    await this.#secrets.set(slot, projectKey);
    if (!device.projectKeySlots.includes(slot)) {
      device.projectKeySlots.push(slot);
      await this.#devices.save(device);
    }
  }

  async clearCurrentLocal(): Promise<void> {
    const device = await this.#devices.current();
    const pending = !device ? await this.#secrets.get(IDENTITY_SLOT) : null;
    const pendingDevice = pending ? storedIdentity(pending) : null;
    let failed = false;
    for (const slot of (device ? [privateKeySlot(device.deviceId), ...device.projectKeySlots]
      : pendingDevice ? [privateKeySlot(pendingDevice.deviceId)] : [])) {
      try {
        await this.#secrets.delete(slot);
      } catch {
        failed = true;
      }
    }
    // Retain the index when any deletion fails so cleanup can be retried.
    if (!failed) {
      try {
        await this.#secrets.delete(IDENTITY_SLOT);
        await this.#devices.clear();
      } catch { failed = true; }
    }
    if (failed) throw new Error("Local device data could not be cleared safely.");
  }

  async revokeCurrent(): Promise<void> {
    const device = await this.#devices.current();
    if (!device) return;
    let failed = false;
    try {
      await this.#transport.revoke(device.deviceId);
    } catch {
      failed = true;
    }
    try {
      await this.clearCurrentLocal();
    } catch {
      failed = true;
    }
    if (failed) throw new Error("Device revocation could not be completed safely.");
  }
}
