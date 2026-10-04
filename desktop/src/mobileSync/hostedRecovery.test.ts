import { describe, expect, it, vi } from "vitest";
import sodium from "libsodium-wrappers";
import { createHostedMobileSyncCoordinator, type HostedMobileSyncServices } from "./hostedCoordinator";
import { recoveryFixtureDevice, recoveryFixtureDeviceKey, recoveryFixtureKey, recoveryFixtureProject, recoveryMetadata, recoverySnapshotFixture } from "./recoverySnapshot.fixture";
import { createProjectKeyVerifier } from "./projectKeyVerifier";
import { importMobileRecoveryKey } from "./projectKeyProvisioning";
import type { ProjectKeyVerifier } from "@openauthor/contracts";

async function fixture() {
  await sodium.ready;
  const pair = sodium.crypto_box_keypair();
  const snapshot = await recoverySnapshotFixture();
  const identity = { role: "authenticated", sub: "30000000-0000-4000-8000-000000000001", device_id: recoveryFixtureDevice,
    session_id: "80000000-0000-4000-8000-000000000001", exp: 3000000000 };
  const token = () => `${btoa("{}")} .${btoa(JSON.stringify(identity))}.synthetic`.replace(" ", "");
  let ended = false;
  let authority = { latestKeyVersion: 3, activeKeyVersion: 3 as number | null };
  const getAccessToken = vi.fn(async () => { if (ended) throw new Error("Signed out"); return token(); });
  const recovery = { getProjectKeyVerifier: vi.fn(async (): Promise<ProjectKeyVerifier | null> => null), getRecoverySnapshot: vi.fn(async () => recoveryMetadata(snapshot)),
    downloadRecoverySnapshot: vi.fn(async () => snapshot.ciphertext_base64), recoverProjectKeyEnvelope: vi.fn(async () => undefined) };
  const services: HostedMobileSyncServices = { recovery,
    devices: { getProjectKeyState: vi.fn(async () => ({ ...authority })), listProjectDevices: vi.fn(async () => []), revokeProjectDevice: vi.fn() },
    provisioning: { provisionProjectKey: vi.fn() }, sync: { publishSnapshot: vi.fn(async () => ({ snapshot_id: "explicit" } as never)), importOutbox: vi.fn() } };
  const coordinator = createHostedMobileSyncCoordinator({ supabaseUrl: "https://synthetic.invalid", publishableKey: "public", accessToken: token(), getAccessToken,
    projectId: recoveryFixtureProject, projectRoot: "/synthetic", services,
    recoveryDeviceKey: { keyId: recoveryFixtureDeviceKey, publicKey: sodium.to_base64(pair.publicKey, sodium.base64_variants.URLSAFE_NO_PADDING) } });
  return { coordinator, recovery, services, identity, snapshot, getAccessToken, authority: (next: typeof authority) => { authority = next; }, end: () => { ended = true; } };
}

describe("hosted recovery authority and completion boundaries", () => {
  it("recovers a provisioned current key before any snapshot exists and restores only its own envelope", async () => {
    const f = await fixture();
    f.recovery.getRecoverySnapshot.mockResolvedValue(null as never);
    f.recovery.getProjectKeyVerifier.mockResolvedValue(await createProjectKeyVerifier(await importMobileRecoveryKey(recoveryFixtureKey), recoveryFixtureProject, 3));
    await f.coordinator.unlockRecoveryKey(3, recoveryFixtureKey);
    expect(f.coordinator.getState()).toMatchObject({ status: "ready", activeKeyVersion: 3 });
    expect(f.recovery.getProjectKeyVerifier).toHaveBeenCalledWith(recoveryFixtureProject, 3);
    expect(f.recovery.getRecoverySnapshot).not.toHaveBeenCalled();
    expect(f.recovery.downloadRecoverySnapshot).not.toHaveBeenCalled();
    expect(f.recovery.recoverProjectKeyEnvelope).toHaveBeenCalledTimes(1);
    expect(f.services.sync.publishSnapshot).not.toHaveBeenCalled();
  });

  it("does not fall back to a snapshot when the immutable current verifier rejects the key", async () => {
    const f = await fixture();
    const anotherKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    f.recovery.getProjectKeyVerifier.mockResolvedValue(await createProjectKeyVerifier(anotherKey, recoveryFixtureProject, 3));
    await expect(f.coordinator.unlockRecoveryKey(3, recoveryFixtureKey)).rejects.toThrow("key verifier");
    expect(f.recovery.getRecoverySnapshot).not.toHaveBeenCalled();
    expect(f.recovery.recoverProjectKeyEnvelope).not.toHaveBeenCalled();
    expect(f.coordinator.getState().status).toBe("locked");
  });

  it("does not treat an unavailable verifier RPC as a null legacy witness", async () => {
    const f = await fixture();
    f.recovery.getProjectKeyVerifier.mockRejectedValue(new Error("Verifier read unconfirmed"));
    await expect(f.coordinator.unlockRecoveryKey(3, recoveryFixtureKey)).rejects.toThrow("unconfirmed");
    expect(f.recovery.getRecoverySnapshot).not.toHaveBeenCalled();
    expect(f.recovery.recoverProjectKeyEnvelope).not.toHaveBeenCalled();
  });

  it.each(["rotation", "revocation", "signout", "account", "device", "session"])("refuses %s during verifier read before installation", async kind => {
    const f = await fixture();
    const verifier = await createProjectKeyVerifier(await importMobileRecoveryKey(recoveryFixtureKey), recoveryFixtureProject, 3);
    f.recovery.getRecoverySnapshot.mockResolvedValue(null as never);
    f.recovery.getProjectKeyVerifier.mockImplementation(async () => {
      if (kind === "rotation") f.authority({ latestKeyVersion: 4, activeKeyVersion: 4 });
      if (kind === "revocation") f.authority({ latestKeyVersion: 3, activeKeyVersion: null });
      if (kind === "signout") f.end();
      if (kind === "account") f.identity.sub = "30000000-0000-4000-8000-000000000002";
      if (kind === "device") f.identity.device_id = "40000000-0000-4000-8000-000000000002";
      if (kind === "session") f.identity.session_id = "80000000-0000-4000-8000-000000000002";
      return verifier;
    });
    await expect(f.coordinator.unlockRecoveryKey(3, recoveryFixtureKey)).rejects.toThrow();
    expect(f.recovery.getProjectKeyVerifier).toHaveBeenCalledTimes(1);
    expect(f.recovery.recoverProjectKeyEnvelope).not.toHaveBeenCalled();
    expect(f.coordinator.getState().status).toBe("locked");
  });

  it.each(["rotation", "revocation", "signout", "account", "device", "session"])("refuses %s while snapshot proof is in flight without installing or unlocking", async kind => {
    const f = await fixture();
    f.recovery.downloadRecoverySnapshot.mockImplementation(async () => {
      if (kind === "rotation") f.authority({ latestKeyVersion: 4, activeKeyVersion: 4 });
      if (kind === "revocation") f.authority({ latestKeyVersion: 3, activeKeyVersion: null });
      if (kind === "signout") f.end();
      if (kind === "account") f.identity.sub = "30000000-0000-4000-8000-000000000002";
      if (kind === "device") f.identity.device_id = "40000000-0000-4000-8000-000000000002";
      if (kind === "session") f.identity.session_id = "80000000-0000-4000-8000-000000000002";
      return f.snapshot.ciphertext_base64;
    });
    await expect(f.coordinator.unlockRecoveryKey(3, recoveryFixtureKey)).rejects.toThrow();
    expect(f.recovery.recoverProjectKeyEnvelope).not.toHaveBeenCalled();
    expect(f.coordinator.getState().status).toBe("locked");
    expect(f.services.sync.publishSnapshot).not.toHaveBeenCalled();
  });

  it("allows an ordinary refreshed access token with the same signed session identity", async () => {
    const f = await fixture();
    f.recovery.downloadRecoverySnapshot.mockImplementation(async () => { f.identity.exp++; return f.snapshot.ciphertext_base64; });
    await f.coordinator.unlockRecoveryKey(3, recoveryFixtureKey);
    expect(f.coordinator.getState().status).toBe("ready");
    expect(f.recovery.recoverProjectKeyEnvelope).toHaveBeenCalledTimes(1);
    expect(f.services.sync.publishSnapshot).not.toHaveBeenCalled();
  });

  it.each(["rotation", "revocation", "same-account-session"])("refuses late %s after a confirmed self-envelope install without retaining the candidate", async kind => {
    const f = await fixture();
    f.recovery.recoverProjectKeyEnvelope.mockImplementation(async () => {
      if (kind === "rotation") f.authority({ latestKeyVersion: 4, activeKeyVersion: 4 });
      if (kind === "revocation") f.authority({ latestKeyVersion: 3, activeKeyVersion: null });
      if (kind === "same-account-session") f.identity.session_id = "80000000-0000-4000-8000-000000000002";
    });
    await expect(f.coordinator.unlockRecoveryKey(3, recoveryFixtureKey)).rejects.toThrow();
    expect(f.coordinator.getState().status).toBe("locked");
    expect(f.recovery.recoverProjectKeyEnvelope).toHaveBeenCalledTimes(1);
    // Even restoring authority cannot reveal a candidate cached before the
    // final fence: a later explicit publication still has no unlocked key.
    f.authority({ latestKeyVersion: 3, activeKeyVersion: 3 });
    await expect(f.coordinator.publishSnapshot()).rejects.toThrow("Provision or unlock");
    expect(f.services.sync.publishSnapshot).not.toHaveBeenCalled();
  });

  it("keeps an unconfirmed installation locked and never retries it", async () => {
    const f = await fixture();
    f.recovery.recoverProjectKeyEnvelope.mockRejectedValue(new Error("Installation unconfirmed"));
    await expect(f.coordinator.unlockRecoveryKey(3, recoveryFixtureKey)).rejects.toThrow("unconfirmed");
    expect(f.recovery.recoverProjectKeyEnvelope).toHaveBeenCalledTimes(1);
    expect(f.coordinator.getState()).toMatchObject({ status: "locked", activeKeyVersion: null });
    await expect(f.coordinator.publishSnapshot()).rejects.toThrow("Provision or unlock");
  });

  it("refuses changed current device keys at guarded installation", async () => {
    const f = await fixture();
    f.recovery.recoverProjectKeyEnvelope.mockRejectedValue(new Error("Current device key changed"));
    await expect(f.coordinator.unlockRecoveryKey(3, recoveryFixtureKey)).rejects.toThrow("device key changed");
    expect(f.recovery.recoverProjectKeyEnvelope).toHaveBeenCalledWith(expect.objectContaining({ expectedDeviceKeyId: recoveryFixtureDeviceKey, expectedKeyVersion: 3, projectId: recoveryFixtureProject }));
    expect(f.coordinator.getState().status).toBe("locked");
  });

  it("refuses a missing snapshot and fails proof before any self-envelope mutation", async () => {
    const f = await fixture();
    f.recovery.getRecoverySnapshot.mockResolvedValue(null as never);
    await expect(f.coordinator.unlockRecoveryKey(3, recoveryFixtureKey)).rejects.toThrow("No committed snapshot");
    expect(f.recovery.downloadRecoverySnapshot).not.toHaveBeenCalled();
    f.recovery.getRecoverySnapshot.mockResolvedValue(recoveryMetadata(f.snapshot));
    f.recovery.downloadRecoverySnapshot.mockResolvedValue(f.snapshot.ciphertext_base64.slice(1));
    await expect(f.coordinator.unlockRecoveryKey(3, recoveryFixtureKey)).rejects.toThrow("integrity");
    expect(f.recovery.recoverProjectKeyEnvelope).not.toHaveBeenCalled();
  });

  it("blocks concurrent publication while proof is pending", async () => {
    const f = await fixture();
    let release!: (value: string) => void;
    f.recovery.downloadRecoverySnapshot.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const pending = f.coordinator.unlockRecoveryKey(3, recoveryFixtureKey);
    await vi.waitFor(() => expect(f.recovery.downloadRecoverySnapshot).toHaveBeenCalled());
    await expect(f.coordinator.publishSnapshot()).rejects.toThrow("still in progress");
    release(f.snapshot.ciphertext_base64); await pending;
    expect(f.services.sync.publishSnapshot).not.toHaveBeenCalled();
    await f.coordinator.publishSnapshot();
    expect(f.services.sync.publishSnapshot).toHaveBeenCalledTimes(1);
  });
});
