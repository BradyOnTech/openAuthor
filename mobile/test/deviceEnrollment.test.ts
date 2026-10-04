import { describe, expect, it, vi } from "vitest";

import {
  DeviceEnrollment,
  InMemoryDeviceStore,
  type DeviceCrypto,
  type DeviceEnrollmentTransport,
  type SecretStore,
  decodeEnrolledDevice,
} from "../src/core/deviceEnrollment";

class FakeDeviceCrypto implements DeviceCrypto {
  async generateKeyPair() {
    return { publicKey: "public-device-key", privateKey: "private-device-key" };
  }

  async openSealedProjectKey(input: {
    envelope: string;
    publicKey: string;
    privateKey: string;
  }): Promise<string> {
    expect(input).toEqual({
      envelope: "sealed-project-key-v4",
      publicKey: "public-device-key",
      privateKey: "private-device-key",
    });
    return "project-key-v4";
  }
}

class MemorySecrets implements SecretStore {
  values = new Map<string, string>();

  async get(key: string) { return this.values.get(key) ?? null; }
  async set(key: string, value: string) { this.values.set(key, value); }
  async delete(key: string) { this.values.delete(key); }
  async create(key: string, value: string) {
    if (!this.values.has(key)) this.values.set(key, value);
    return this.values.get(key)!;
  }
}

class FakeEnrollmentTransport implements DeviceEnrollmentTransport {
  registeredPublicKey = "";
  rebound: Parameters<DeviceEnrollmentTransport["rebind"]>[0] | null = null;
  revokeError: Error | null = null;

  async register(input: Parameters<DeviceEnrollmentTransport["register"]>[0]) {
    this.registeredPublicKey = input.publicKey;
    return {
      deviceId: input.deviceId,
      keyId: input.keyId,
      enrolledAt: "2026-08-30T17:00:00.000Z",
    };
  }

  async rebind(input: Parameters<DeviceEnrollmentTransport["rebind"]>[0]) {
    this.rebound = input;
    return { deviceId: input.deviceId, enrolledAt: "2026-08-30T17:00:00.000Z" };
  }

  async projectKeyEnvelope() {
    return { keyVersion: 4, envelope: "sealed-project-key-v4" };
  }

  async revoke(): Promise<void> {
    if (this.revokeError) throw this.revokeError;
  }
}

describe("DeviceEnrollment", () => {
  function fixture() {
    const secrets = new MemorySecrets();
    const devices = new InMemoryDeviceStore();
    const transport = new FakeEnrollmentTransport();
    const deviceCrypto = new FakeDeviceCrypto();
    const create = () => new DeviceEnrollment({ crypto: deviceCrypto, secrets, devices, transport });
    const input = { userId: "user-owner", name: "Original phone", platform: "web" as const };
    return { secrets, devices, transport, deviceCrypto, create, input };
  }

  it("opens only already-downloaded keys locally without enrollment or network fallbacks", async () => {
    const f = fixture();
    const device = await f.create().enroll(f.input);
    await f.create().importProjectKey("book", 1, "downloaded-key");
    const register = vi.spyOn(f.transport, "register");
    const keyEnvelope = vi.spyOn(f.transport, "projectKeyEnvelope");
    expect((await f.create().localDevice(f.input.userId)).deviceId).toBe(device.deviceId);
    expect(await f.create().localProjectKey("book", 1)).toBe("downloaded-key");
    await expect(f.create().localProjectKey("book", 2)).rejects.toThrow("not downloaded");
    await expect(f.create().localDevice("another-author")).rejects.toThrow("does not belong");
    await f.secrets.delete(`openauthor.device.${device.deviceId}.private-key`);
    await expect(f.create().localProjectKey("book", 1)).rejects.toThrow("device key is unavailable");
    expect(register).not.toHaveBeenCalled();
    expect(keyEnvelope).not.toHaveBeenCalled();
  });

  it("persists the private identity before remote registration and retries a lost response unchanged", async () => {
    const f = fixture();
    const registered = vi.spyOn(f.transport, "register").mockImplementationOnce(async (input) => {
      expect(f.secrets.values.get(`openauthor.device.${input.deviceId}.private-key`)).toBe("private-device-key");
      expect(f.secrets.values.get("openauthor.device.identity.v2")).toContain(input.deviceId);
      expect(JSON.stringify(input)).not.toContain("private-device-key");
      throw new Error("response lost");
    });
    await expect(f.create().enroll(f.input)).rejects.toThrow("response lost");
    expect(await f.devices.current()).toBeNull();
    const retried = await f.create().enroll({ ...f.input, name: "Changed label after restart" });
    expect(registered.mock.calls[0]![0]).toEqual(registered.mock.calls[1]![0]);
    expect(retried.name).toBe("Original phone");
  });

  it("retries metadata-write failure without changing the already registered device", async () => {
    const f = fixture();
    const registered = vi.spyOn(f.transport, "register");
    vi.spyOn(f.devices, "save").mockRejectedValueOnce(new Error("storage full"));
    await expect(f.create().enroll(f.input)).rejects.toThrow("storage full");
    await f.create().enroll(f.input);
    expect(registered.mock.calls[0]![0]).toEqual(registered.mock.calls[1]![0]);
  });

  it("chooses one canonical device for overlapping enrollment attempts", async () => {
    const f = fixture();
    const registered = vi.spyOn(f.transport, "register");
    const [first, second] = await Promise.all([f.create().enroll(f.input), f.create().enroll(f.input)]);
    expect(first.deviceId).toBe(second.deviceId);
    expect(first.keyId).toBe(second.keyId);
    expect(registered.mock.calls[0]![0]).toEqual(registered.mock.calls[1]![0]);
  });

  it("makes no remote call when secure creation fails and does not replace corrupt identities", async () => {
    const f = fixture();
    const registered = vi.spyOn(f.transport, "register");
    vi.spyOn(f.secrets, "create").mockRejectedValueOnce(new Error("vault locked"));
    await expect(f.create().enroll(f.input)).rejects.toThrow("vault locked");
    f.secrets.values.set("openauthor.device.identity.v2", "broken");
    const generate = vi.spyOn(f.deviceCrypto, "generateKeyPair");
    await expect(f.create().enroll(f.input)).rejects.toThrow("corrupt");
    expect(generate).not.toHaveBeenCalled();
    expect(registered).not.toHaveBeenCalled();
    expect(() => decodeEnrolledDevice("broken")).toThrow("corrupt");
    expect(decodeEnrolledDevice(null)).toBeNull();
  });

  it("preserves pending work on account mismatch and refuses to rebind a missing private key", async () => {
    const f = fixture();
    const first = await f.create().enroll(f.input);
    const before = [...f.secrets.values.entries()];
    await expect(f.create().enroll({ ...f.input, userId: "different-user" })).rejects.toThrow("different account");
    expect([...f.secrets.values.entries()]).toEqual(before);
    f.secrets.values.delete(`openauthor.device.${first.deviceId}.private-key`);
    const rebound = vi.spyOn(f.transport, "rebind");
    await expect(f.create().rebindCurrent(f.input.userId)).rejects.toThrow("unavailable");
    expect(rebound).not.toHaveBeenCalled();
  });

  it("cleans up incomplete enrollment, retaining its index if deleting a secret fails", async () => {
    const f = fixture();
    vi.spyOn(f.transport, "register").mockRejectedValueOnce(new Error("response lost"));
    await expect(f.create().enroll(f.input)).rejects.toThrow();
    vi.spyOn(f.secrets, "delete").mockRejectedValueOnce(new Error("vault locked"));
    await expect(f.create().clearCurrentLocal()).rejects.toThrow("could not be cleared");
    expect(f.secrets.values.has("openauthor.device.identity.v2")).toBe(true);
    await f.create().clearCurrentLocal();
    expect(f.secrets.values.size).toBe(0);
  });

  it("registers only the public key and unwraps project keys with the device-only private key", async () => {
    const secrets = new MemorySecrets();
    const transport = new FakeEnrollmentTransport();
    const enrollment = new DeviceEnrollment({
      crypto: new FakeDeviceCrypto(),
      secrets,
      devices: new InMemoryDeviceStore(),
      transport,
    });

    const device = await enrollment.enroll({
      userId: "user-owner",
      name: "Author's iPhone",
      platform: "ios",
    });

    expect(device.deviceId).toBeTruthy();
    expect(device.keyId).toBeTruthy();
    expect(device.userId).toBe("user-owner");
    expect(transport.registeredPublicKey).toBe("public-device-key");
    expect(JSON.stringify(device)).not.toContain("private-device-key");
    expect(await enrollment.projectKey("project-mobile", 4)).toBe("project-key-v4");
    expect(secrets.values.get(`openauthor.device.${device.deviceId}.private-key`)).toBe("private-device-key");
  });

  it("deletes device secrets and local identity after revocation", async () => {
    const secrets = new MemorySecrets();
    const devices = new InMemoryDeviceStore();
    const enrollment = new DeviceEnrollment({
      crypto: new FakeDeviceCrypto(),
      secrets,
      devices,
      transport: new FakeEnrollmentTransport(),
    });
    await enrollment.enroll({ userId: "user-owner", name: "Phone", platform: "ios" });

    await enrollment.revokeCurrent();

    expect(await devices.current()).toBeNull();
    expect(secrets.values.size).toBe(0);
  });

  it("rebinds a persisted device only for the same user with its exact public identity", async () => {
    const transport = new FakeEnrollmentTransport();
    const enrollment = new DeviceEnrollment({
      crypto: new FakeDeviceCrypto(),
      secrets: new MemorySecrets(),
      devices: new InMemoryDeviceStore(),
      transport,
      uuid: (() => { const ids = ["device-ios", "key-ios"]; return () => ids.shift()!; })(),
    });
    await enrollment.enroll({ userId: "user-owner", name: "Phone", platform: "ios" });

    await enrollment.rebindCurrent("user-owner");

    expect(transport.rebound).toEqual({
      deviceId: "device-ios",
      keyId: "key-ios",
      name: "Phone",
      platform: "ios",
      publicKey: "public-device-key",
    });
    await expect(enrollment.rebindCurrent("different-user")).rejects.toThrow("different account");
  });

  it("clears every local secret even when remote revocation fails, then reports a safe error", async () => {
    const secrets = new MemorySecrets();
    const devices = new InMemoryDeviceStore();
    const transport = new FakeEnrollmentTransport();
    transport.revokeError = new Error("backend leaked details");
    const enrollment = new DeviceEnrollment({
      crypto: new FakeDeviceCrypto(), secrets, devices, transport,
    });
    await enrollment.enroll({ userId: "user-owner", name: "Phone", platform: "ios" });
    await enrollment.importProjectKey("project-mobile", 4, "project-key-v4");

    await expect(enrollment.revokeCurrent()).rejects.toThrow(
      "Device revocation could not be completed safely.",
    );

    expect(await devices.current()).toBeNull();
    expect(secrets.values.size).toBe(0);
  });

  it("restores an explicitly supplied recovery project key into secure storage", async () => {
    const secrets = new MemorySecrets();
    const devices = new InMemoryDeviceStore();
    const enrollment = new DeviceEnrollment({
      crypto: new FakeDeviceCrypto(), secrets, devices, transport: new FakeEnrollmentTransport(),
    });
    await enrollment.enroll({ userId: "user-owner", name: "Phone", platform: "ios" });
    await enrollment.importProjectKey("project-mobile", 4, "recovered-project-key");
    expect(await enrollment.projectKey("project-mobile", 4)).toBe("recovered-project-key");
    expect((await devices.current())?.projectKeySlots).toContain("openauthor.project.project-mobile.key.4");
  });
});
