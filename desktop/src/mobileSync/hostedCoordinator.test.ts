import { describe, expect, it, vi } from "vitest";
import {
  createHostedMobileSyncCoordinator,
  type HostedMobileSyncServices,
} from "./hostedCoordinator";
import { importMobileRecoveryKey } from "./projectKeyProvisioning";

function jwt(claims: Record<string, unknown>): string {
  const encode = (value: object) => btoa(JSON.stringify(value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(claims)}.signature`;
}

async function projectKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

const runtime = {
  supabaseUrl: "https://example.supabase.co",
  publishableKey: "publishable-key",
  projectId: "10000000-0000-4000-8000-000000000001",
  projectRoot: "/project",
};

describe("HostedMobileSyncCoordinator", () => {
  it("rejects a checksum-valid recovery key from another book without replacing its verified envelope key", async () => {
    const verified = await crypto.subtle.importKey("raw", new Uint8Array(32).fill(8), "AES-GCM", false, ["encrypt", "decrypt"]);
    const services: HostedMobileSyncServices = {
      devices: { getProjectKeyState: vi.fn(async () => ({ latestKeyVersion: 3, activeKeyVersion: 3 })), listProjectDevices: vi.fn(async () => []), revokeProjectDevice: vi.fn() },
      provisioning: { provisionProjectKey: vi.fn() }, sync: { publishSnapshot: vi.fn(async () => ({ snapshot_id: "verified" } as never)), importOutbox: vi.fn() },
    };
    const coordinator = createHostedMobileSyncCoordinator({ ...runtime, services, projectKeys: new Map([[3, verified]]), accessToken: jwt({ role: "authenticated", sub: "account-one", device_id: "40000000-0000-4000-8000-000000000001" }) });
    await coordinator.refreshKeyState();
    await expect(coordinator.unlockRecoveryKey(3, "OA1-AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8.EFAAEC69")).rejects.toThrow("does not match");
    await coordinator.publishSnapshot();
    expect(services.sync.publishSnapshot).toHaveBeenCalledWith(expect.objectContaining({ projectKey: verified, keyVersion: 3 }));
  });

  it("refuses standalone recovery input without a verified current envelope key", async () => {
    const services: HostedMobileSyncServices = {
      devices: { getProjectKeyState: vi.fn(async () => ({ latestKeyVersion: 3, activeKeyVersion: 3 })), listProjectDevices: vi.fn(async () => []), revokeProjectDevice: vi.fn() },
      provisioning: { provisionProjectKey: vi.fn() }, sync: { publishSnapshot: vi.fn(), importOutbox: vi.fn() },
    };
    const coordinator = createHostedMobileSyncCoordinator({ ...runtime, services, accessToken: jwt({ role: "authenticated", sub: "account-one", device_id: "40000000-0000-4000-8000-000000000001" }) });
    await expect(coordinator.unlockRecoveryKey(3, "OA1-AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8.EFAAEC69")).rejects.toThrow("verified current book key is unavailable");
    expect(coordinator.getState().status).toBe("locked"); expect(services.sync.publishSnapshot).not.toHaveBeenCalled();
  });

  it("accepts the matching nonextractable recovery key against an independently verified hosted key", async () => {
    const recoveryKey = "OA1-AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8.EFAAEC69";
    const verified = await importMobileRecoveryKey(recoveryKey);
    const services: HostedMobileSyncServices = {
      devices: { getProjectKeyState: vi.fn(async () => ({ latestKeyVersion: 3, activeKeyVersion: 3 })), listProjectDevices: vi.fn(async () => []), revokeProjectDevice: vi.fn() },
      provisioning: { provisionProjectKey: vi.fn() }, sync: { publishSnapshot: vi.fn(async input => {
        const nonce = new Uint8Array(12);
        const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, input.projectKey, new TextEncoder().encode("matching book"));
        expect(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, verified, cipher))).toBe("matching book");
        expect(input.projectKey.extractable).toBe(false);
        return { snapshot_id: "matching" } as never;
      }), importOutbox: vi.fn() },
    };
    const coordinator = createHostedMobileSyncCoordinator({ ...runtime, services, projectKeys: new Map([[3, verified]]), accessToken: jwt({ role: "authenticated", sub: "account-one", device_id: "40000000-0000-4000-8000-000000000001" }) });
    await coordinator.unlockRecoveryKey(3, recoveryKey); await coordinator.publishSnapshot();
    expect(services.sync.publishSnapshot).toHaveBeenCalledTimes(1);
  });
  it("locks publication immediately after an unconfirmed mutation until current authority is refreshed", async () => {
    const key = await projectKey();
    const services: HostedMobileSyncServices = {
      devices: { getProjectKeyState: vi.fn(async () => ({ latestKeyVersion: 3, activeKeyVersion: 3 })), listProjectDevices: vi.fn(async () => []), revokeProjectDevice: vi.fn(async () => { throw new Error("Revocation response lost"); }) },
      provisioning: { provisionProjectKey: vi.fn(async () => { throw new Error("Rotation response lost"); }) },
      sync: { publishSnapshot: vi.fn(), importOutbox: vi.fn() },
    };
    const coordinator = createHostedMobileSyncCoordinator({ ...runtime, services, projectKeys: new Map([[3, key]]), accessToken: jwt({ role: "authenticated", sub: "account-one", device_id: "40000000-0000-4000-8000-000000000001" }) });
    await coordinator.refreshKeyState();
    await expect(coordinator.revokeDevice("other", "lost-device")).rejects.toThrow("response lost");
    expect(coordinator.getState()).toMatchObject({ status: "locked", activeKeyVersion: null, message: expect.stringContaining("unconfirmed") });
    await coordinator.refreshKeyState();
    expect(coordinator.getState().status).toBe("ready");
    await expect(coordinator.provisionProjectKey(3, "lost-device", [])).rejects.toThrow("response lost");
    expect(coordinator.getState()).toMatchObject({ status: "locked", activeKeyVersion: null, message: expect.stringContaining("unconfirmed") });
    expect(services.sync.publishSnapshot).not.toHaveBeenCalled();
  });
  it("locks historical keys after revocation/restart and refuses recovery or publication until guarded rotation", async () => {
    const key = await projectKey();
    let hosted = { latestKeyVersion: 3, activeKeyVersion: 3 as number | null };
    const publish = vi.fn(async () => ({ snapshot_id: "new" } as never));
    const provision = vi.fn(async () => { hosted = { latestKeyVersion: 4, activeKeyVersion: 4 }; return { projectKey: key, keyVersion: 4, recoveryKey: "secret", envelopeCount: 1 }; });
    const devices = {
      getProjectKeyState: vi.fn(async () => hosted), listProjectDevices: vi.fn(async () => []),
      revokeProjectDevice: vi.fn(async () => { hosted = { ...hosted, activeKeyVersion: null }; }),
    };
    const coordinator = createHostedMobileSyncCoordinator({ ...runtime,
      accessToken: jwt({ role: "authenticated", sub: "account-one", device_id: "40000000-0000-4000-8000-000000000001" }),
      projectKeys: new Map([[3, key]]), services: { devices, provisioning: { provisionProjectKey: provision }, sync: { publishSnapshot: publish, importOutbox: vi.fn() } },
    });
    expect(coordinator.getIdentity()).toEqual({ userId: "account-one", deviceId: "40000000-0000-4000-8000-000000000001" });
    await coordinator.refreshKeyState();
    await coordinator.revokeDevice("40000000-0000-4000-8000-000000000002", "lost-device");
    expect(coordinator.getState().status).toBe("locked");
    await expect(coordinator.publishSnapshot()).rejects.toThrow("Provision or unlock");
    await expect(coordinator.unlockRecoveryKey(3, "unused")).rejects.toThrow("current active");
    expect(publish).not.toHaveBeenCalled();
    await expect(coordinator.provisionProjectKey(2, "lost-device", [])).rejects.toThrow("previous book key version changed");
    expect(provision).not.toHaveBeenCalled();
    const recipients = [{ deviceId: "remaining", keyId: "key" }];
    await coordinator.provisionProjectKey(3, "lost-device", recipients);
    expect(provision).toHaveBeenCalledWith({ projectId: runtime.projectId, expectedPreviousVersion: 3, reasonCode: "lost-device", reviewedRecipients: recipients });
    expect(publish).not.toHaveBeenCalled();
    await coordinator.publishSnapshot();
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ keyVersion: 4 }));
    hosted = { latestKeyVersion: 4, activeKeyVersion: null };
    const restarted = createHostedMobileSyncCoordinator({ ...runtime,
      accessToken: jwt({ role: "authenticated", sub: "account-one", device_id: "40000000-0000-4000-8000-000000000001" }),
      projectKeys: new Map([[3, key], [4, key]]), services: { devices, provisioning: { provisionProjectKey: provision }, sync: { publishSnapshot: publish, importOutbox: vi.fn() } },
    });
    await restarted.refreshKeyState();
    expect(restarted.getState()).toMatchObject({ status: "locked", activeKeyVersion: null, latestKeyVersion: 4 });
  });

  it("retains a revoked locked state when an older key read completes later and blocks overlapping writes", async () => {
    const key = await projectKey();
    let resolveRead!: (value: { latestKeyVersion: number; activeKeyVersion: number | null }) => void;
    let resolveRevoke!: () => void;
    const services: HostedMobileSyncServices = {
      devices: { getProjectKeyState: vi.fn(() => new Promise<{ latestKeyVersion: number; activeKeyVersion: number | null }>(resolve => { resolveRead = resolve; })), listProjectDevices: vi.fn(async () => []), revokeProjectDevice: vi.fn(() => new Promise<void>(resolve => { resolveRevoke = resolve; })) },
      provisioning: { provisionProjectKey: vi.fn() }, sync: { publishSnapshot: vi.fn(), importOutbox: vi.fn() },
    };
    const coordinator = createHostedMobileSyncCoordinator({ ...runtime, services, projectKeys: new Map([[3, key]]), accessToken: jwt({ role: "authenticated", sub: "account-one", device_id: "40000000-0000-4000-8000-000000000001" }) });
    const oldRead = coordinator.refreshKeyState();
    const revocation = coordinator.revokeDevice("other", "lost-device");
    await expect(coordinator.provisionProjectKey(3, "lost-device")).rejects.toThrow("still in progress");
    resolveRevoke(); await revocation;
    resolveRead({ latestKeyVersion: 3, activeKeyVersion: 3 });
    await expect(oldRead).rejects.toThrow("changed during refresh");
    expect(coordinator.getState().status).toBe("locked");
  });
  it("restores every enrolled key version and publishes with the newest unlocked version", async () => {
    const older = await projectKey();
    const newer = await projectKey();
    const services: HostedMobileSyncServices = {
      provisioning: { provisionProjectKey: vi.fn() },
      sync: {
        publishSnapshot: vi.fn(async () => ({ snapshot_id: "restored" } as never)),
        importOutbox: vi.fn(async (input) => {
          expect(await input.resolveProjectKey(1)).toBe(older);
          expect(await input.resolveProjectKey(3)).toBe(newer);
          expect(await input.resolveProjectKey(2)).toBeNull();
          return { imported: [], failures: [] };
        }),
      },
    };
    const coordinator = createHostedMobileSyncCoordinator({
      ...runtime, services,
      accessToken: jwt({ role: "authenticated", device_id: "40000000-0000-4000-8000-000000000001" }),
      projectKeys: new Map([[1, older], [3, newer]]),
    });
    expect(coordinator.getState().status).toBe("ready");
    await coordinator.publishSnapshot();
    await coordinator.importOutbox();
    expect(services.sync.publishSnapshot).toHaveBeenCalledWith(expect.objectContaining({ projectKey: newer, keyVersion: 3 }));
    expect(services.provisioning.provisionProjectKey).not.toHaveBeenCalled();
  });

  it("fails closed when the current session is not bound to a registered desktop device", async () => {
    const coordinator = createHostedMobileSyncCoordinator({
      ...runtime,
      accessToken: jwt({ role: "authenticated", sub: "user-one" }),
    });

    expect(coordinator.getState()).toEqual({
      status: "setup_required",
      activeKeyVersion: null,
      message: expect.stringContaining("device-bound Supabase session"),
    });
    expect(coordinator.getState().message).toContain("Connect this desktop");
    await expect(coordinator.importOutbox()).rejects.toThrow("device-bound Supabase session");
  });

  it("keeps provisioned keys in memory for manual publish and mixed-version import", async () => {
    const key = await projectKey();
    let resolverResult: CryptoKey | null = null;
    const services: HostedMobileSyncServices = {
      provisioning: {
        provisionProjectKey: vi.fn(async () => ({
          projectKey: key,
          keyVersion: 4,
          recoveryKey: "OA1-recovery-only-returned-to-ui",
          envelopeCount: 2,
        })),
      },
      sync: {
        publishSnapshot: vi.fn(async () => ({ snapshot_id: "snapshot-one" } as never)),
        importOutbox: vi.fn(async (input) => {
          resolverResult = await input.resolveProjectKey(4);
          return { imported: [], failures: [] };
        }),
      },
    };
    const coordinator = createHostedMobileSyncCoordinator({
      ...runtime,
      accessToken: jwt({
        role: "authenticated",
        sub: "user-one",
        device_id: "40000000-0000-4000-8000-000000000001",
      }),
      services,
    });

    const provisioned = await coordinator.provisionProjectKey(3, "desktop-provisioning");
    await coordinator.publishSnapshot();
    await coordinator.importOutbox();

    expect(provisioned.recoveryKey).toBe("OA1-recovery-only-returned-to-ui");
    expect(coordinator.getState()).toEqual({
      status: "ready",
      activeKeyVersion: 4,
      message: "Mobile sync key version 4 is unlocked in memory.",
    });
    expect(services.sync.publishSnapshot).toHaveBeenCalledWith({
      projectRoot: "/project",
      projectId: runtime.projectId,
      projectKey: key,
      keyVersion: 4,
    });
    expect(resolverResult).toBe(key);
    expect(JSON.stringify(coordinator.getState())).not.toContain(provisioned.recoveryKey);
  });

  it("unlocks a mobile recovery key as a non-extractable in-memory key", async () => {
    const publishedKeys: CryptoKey[] = [];
    const services: HostedMobileSyncServices = {
      provisioning: { provisionProjectKey: vi.fn() },
      sync: {
        publishSnapshot: vi.fn(async (input) => {
          publishedKeys.push(input.projectKey);
          return { snapshot_id: "snapshot-one" } as never;
        }),
        importOutbox: vi.fn(),
      },
    };
    const coordinator = createHostedMobileSyncCoordinator({
      ...runtime,
      projectKeys: new Map([[5, await importMobileRecoveryKey("OA1-AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8.EFAAEC69")]]),
      accessToken: jwt({
        role: "authenticated",
        sub: "user-one",
        device_id: "40000000-0000-4000-8000-000000000001",
      }),
      services,
    });

    await coordinator.unlockRecoveryKey(
      5,
      "OA1-AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8.EFAAEC69"
    );
    await coordinator.publishSnapshot();

    expect(publishedKeys).toHaveLength(1);
    expect(publishedKeys[0].extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", publishedKeys[0])).rejects.toThrow();
    expect(coordinator.getState().activeKeyVersion).toBe(5);
  });
});
