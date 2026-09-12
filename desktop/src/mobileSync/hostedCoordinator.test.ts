import { describe, expect, it, vi } from "vitest";
import {
  createHostedMobileSyncCoordinator,
  type HostedMobileSyncServices,
} from "./hostedCoordinator";

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
