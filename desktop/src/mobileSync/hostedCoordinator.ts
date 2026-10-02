import type { MobileOutboxImportResult } from "../api";
import {
  createMobileSyncService,
  type EncryptedMobileSnapshot,
  type MobileProjectKeyResolver,
} from "./mobileSync";
import {
  createMobileProjectKeyProvisioningService,
  importMobileRecoveryKey,
  type MobileProjectDevice,
  type MobileProjectKeyState,
} from "./projectKeyProvisioning";
import { SupabaseMobileSyncTransport } from "./supabaseTransport";

export type HostedMobileSyncState = {
  status: "setup_required" | "locked" | "ready";
  activeKeyVersion: number | null;
  latestKeyVersion?: number;
  message: string;
};

type ImportReport = {
  imported: MobileOutboxImportResult[];
  failures: Array<{
    operationId: string | null;
    classification: "permanent" | "transient";
    error: string;
  }>;
};

export type HostedMobileSyncServices = {
  provisioning: {
    provisionProjectKey(input: {
      projectId: string;
      expectedPreviousVersion: number;
      reasonCode: string;
      reviewedRecipients?: ReadonlyArray<{ deviceId: string; keyId: string }>;
    }): Promise<{
      projectKey: CryptoKey;
      keyVersion: number;
      recoveryKey: string;
      envelopeCount: number;
    }>;
  };
  devices?: {
    listProjectDevices(projectId: string): Promise<MobileProjectDevice[]>;
    revokeProjectDevice(input: { projectId: string; targetDeviceId: string; reasonCode: string }): Promise<void>;
    getProjectKeyState(projectId: string): Promise<MobileProjectKeyState>;
  };
  sync: {
    publishSnapshot(input: {
      projectRoot: string;
      projectId: string;
      projectKey: CryptoKey;
      keyVersion: number;
    }): Promise<EncryptedMobileSnapshot>;
    importOutbox(input: {
      projectRoot: string;
      projectId: string;
      resolveProjectKey: MobileProjectKeyResolver;
    }): Promise<ImportReport>;
  };
};

export type HostedMobileSyncCoordinator = {
  getState(): HostedMobileSyncState;
  getIdentity(): { userId: string; deviceId: string } | null;
  listDevices(): Promise<MobileProjectDevice[]>;
  refreshKeyState(): Promise<MobileProjectKeyState>;
  revokeDevice(targetDeviceId: string, reasonCode: string): Promise<void>;
  provisionProjectKey(expectedPreviousVersion: number, reasonCode: string, reviewedRecipients?: ReadonlyArray<{ deviceId: string; keyId: string }>): Promise<{
    keyVersion: number;
    recoveryKey: string;
    envelopeCount: number;
  }>;
  unlockRecoveryKey(keyVersion: number, recoveryKey: string): Promise<void>;
  publishSnapshot(): Promise<EncryptedMobileSnapshot>;
  importOutbox(): Promise<ImportReport>;
};

type CoordinatorOptions = {
  supabaseUrl?: string | null;
  publishableKey?: string | null;
  accessToken?: string | null;
  getAccessToken?: () => Promise<string>;
  projectKeys?: ReadonlyMap<number, CryptoKey>;
  projectId?: string | null;
  projectRoot?: string | null;
  services?: HostedMobileSyncServices;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    const value: unknown = JSON.parse(decoded);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function setupState(message: string): HostedMobileSyncState {
  return { status: "setup_required", activeKeyVersion: null, message };
}

function requiredVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Mobile project key version must be a positive integer.");
  }
  return value;
}

export function createHostedMobileSyncCoordinator(
  options: CoordinatorOptions
): HostedMobileSyncCoordinator {
  const supabaseUrl = options.supabaseUrl?.trim() ?? "";
  const publishableKey = options.publishableKey?.trim() ?? "";
  const accessToken = options.accessToken?.trim() ?? "";
  const projectId = options.projectId?.trim() ?? "";
  const projectRoot = options.projectRoot?.trim() ?? "";

  let state: HostedMobileSyncState;
  let services: HostedMobileSyncServices | null = null;
  let identity: { userId: string; deviceId: string } | null = null;
  if (!supabaseUrl || !publishableKey) {
    state = setupState(
      "Hosted mobile sync is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
    );
  } else if (!accessToken) {
    state = setupState("Sign in to Supabase before using hosted mobile sync.");
  } else if (!projectId || !projectRoot) {
    state = setupState("Open and attach an active project before using hosted mobile sync.");
  } else {
    const claims = decodeJwtClaims(accessToken);
    const deviceId = typeof claims?.device_id === "string" ? claims.device_id : "";
    if (claims?.role !== "authenticated" || !UUID.test(deviceId)) {
      state = setupState(
        "A device-bound Supabase session is required. Connect this desktop to securely register its encryption identity."
      );
    } else {
      if (typeof claims.sub === "string") identity = { userId: claims.sub, deviceId };
      state = {
        status: "locked",
        activeKeyVersion: null,
        message: "Desktop connected. No project key is available for this device yet. Provision a new book key or unlock a recovery key.",
      };
      if (options.services) {
        services = options.services;
      } else {
        const transport = new SupabaseMobileSyncTransport({
          supabaseUrl,
          publishableKey,
          userAccessToken: accessToken,
          getAccessToken: options.getAccessToken,
          deviceId,
        });
        services = {
          devices: transport,
          provisioning: createMobileProjectKeyProvisioningService({ transport }),
          sync: createMobileSyncService({ transport }),
        };
      }
    }
  }

  const projectKeys = new Map(options.projectKeys);
  if (services && !services.devices && projectKeys.size > 0) {
    const version = Math.max(...projectKeys.keys());
    requiredVersion(version);
    state = {
      status: "ready", activeKeyVersion: version,
      message: `Desktop connected. Mobile sync key version ${version} was unlocked with this device's Keychain identity.`,
    };
  }

  const requireServices = (): HostedMobileSyncServices => {
    if (!services) throw new Error(state.message);
    return services;
  };

  const activeProjectKey = (): { projectKey: CryptoKey; keyVersion: number } => {
    const keyVersion = state.activeKeyVersion;
    if (state.status !== "ready" || keyVersion === null) {
      throw new Error("Provision or unlock a mobile project key before syncing.");
    }
    const projectKey = projectKeys.get(keyVersion);
    if (!projectKey) throw new Error("The active mobile project key is unavailable.");
    return { projectKey, keyVersion };
  };
  let inFlight = false;
  let mutationGeneration = 0;
  let rotationRequired = false;
  const refreshKeyState = async (): Promise<MobileProjectKeyState> => {
    const generation = mutationGeneration;
    const devices = requireServices().devices;
    if (!devices) throw new Error("Hosted book key state is unavailable. Reconnect this desktop.");
    let keyState: MobileProjectKeyState;
    try { keyState = await devices.getProjectKeyState(projectId); }
    catch (reason) {
      if (generation === mutationGeneration) state = { ...state, status: "locked", activeKeyVersion: null, message: "The current hosted book key could not be verified. Reconnect and refresh before syncing." };
      throw reason;
    }
    if (generation !== mutationGeneration) throw new Error("The book key changed during refresh. Refresh and review again.");
    rotationRequired = keyState.latestKeyVersion > 0 && keyState.activeKeyVersion === null;
    const ready = keyState.activeKeyVersion !== null && projectKeys.has(keyState.activeKeyVersion);
    state = { status: ready ? "ready" : "locked", activeKeyVersion: ready ? keyState.activeKeyVersion : null,
      latestKeyVersion: keyState.latestKeyVersion,
      message: ready ? `Desktop connected. Current book key ${keyState.activeKeyVersion} is unlocked.`
        : rotationRequired ? "The book key was retired. Review a rotation for remaining devices, then publish a new snapshot."
        : keyState.activeKeyVersion !== null ? `Current book key ${keyState.activeKeyVersion} is unavailable on this desktop. Reconnect for its envelope or unlock that version's recovery key.`
        : "No active book key exists. Review the first key for trusted devices before publishing.",
    };
    return keyState;
  };
  const exclusive = async <T>(action: () => Promise<T>): Promise<T> => {
    if (inFlight) throw new Error("A companion operation is still in progress for this book.");
    inFlight = true;
    mutationGeneration++;
    try { return await action(); } finally { inFlight = false; }
  };

  return {
    getState() {
      return { ...state };
    },
    getIdentity() { return identity ? { ...identity } : null; },
    refreshKeyState,
    async listDevices() {
      const devices = requireServices().devices;
      if (!devices) throw new Error("Trusted-device management is unavailable. Reconnect this desktop.");
      const [listed] = await Promise.all([devices.listProjectDevices(projectId), refreshKeyState()]);
      return listed;
    },
    async revokeDevice(targetDeviceId, reasonCode) {
      return exclusive(async () => {
        const devices = requireServices().devices;
        if (!devices) throw new Error("Trusted-device management is unavailable. Reconnect this desktop.");
        if (targetDeviceId === identity?.deviceId) throw new Error("Use another trusted desktop to revoke this desktop's access.");
        try { await devices.revokeProjectDevice({ projectId, targetDeviceId, reasonCode }); }
        catch (reason) {
          mutationGeneration++;
          state = { ...state, status: "locked", activeKeyVersion: null, message: "Device revocation is unconfirmed. Refresh current book key and device access before syncing." };
          throw reason;
        }
        mutationGeneration++;
        rotationRequired = true;
        // The hosted transaction retires all current book keys. Old keys remain
        // in memory for historical imports, but cannot authorize publication.
        state = { ...state, status: "locked", activeKeyVersion: null, message: "Device access revoked for this book. Rotate the book key for remaining devices, then publish a new snapshot." };
      });
    },

    async provisionProjectKey(expectedPreviousVersion, reasonCode, reviewedRecipients) {
      return exclusive(async () => {
        if (requireServices().devices) {
          const current = await refreshKeyState();
          if (current.latestKeyVersion !== expectedPreviousVersion) throw new Error("The previous book key version changed. Refresh and review before rotating.");
        }
        let provisioned: Awaited<ReturnType<HostedMobileSyncServices["provisioning"]["provisionProjectKey"]>>;
        try {
          provisioned = await requireServices().provisioning.provisionProjectKey({
            projectId,
            expectedPreviousVersion,
            reasonCode,
            ...(reviewedRecipients !== undefined ? { reviewedRecipients } : {}),
          });
        } catch (reason) {
          mutationGeneration++;
          state = { ...state, status: "locked", activeKeyVersion: null, message: "Book key rotation is unconfirmed. Reconnect and refresh current key access before syncing." };
          throw reason;
        }
        projectKeys.set(provisioned.keyVersion, provisioned.projectKey);
        mutationGeneration++;
        rotationRequired = false;
        state = {
          status: "ready",
          activeKeyVersion: provisioned.keyVersion,
          ...(services?.devices ? { latestKeyVersion: provisioned.keyVersion } : {}),
          message: `Mobile sync key version ${provisioned.keyVersion} is unlocked in memory.`,
        };
        // A confirmed rotation can be superseded before its response arrives.
        // Return its recovery key, but only current authority permits publish.
        if (services?.devices) {
          try { await refreshKeyState(); } catch { /* refreshKeyState locks publication on uncertainty. */ }
        }
        return {
          keyVersion: provisioned.keyVersion,
          recoveryKey: provisioned.recoveryKey,
          envelopeCount: provisioned.envelopeCount,
        };
      });
    },

    async unlockRecoveryKey(keyVersion, recoveryKey) {
      return exclusive(async () => {
        requireServices();
        const version = requiredVersion(keyVersion);
        if (services?.devices) {
          const current = await refreshKeyState();
          if (current.activeKeyVersion !== version) throw new Error("Only the current active book key can unlock publication. A retired or older key cannot restore access.");
        }
        if (rotationRequired) throw new Error("Rotate the retired book key before publishing. Recovery unlock cannot bypass revocation.");
        const verifiedKey = projectKeys.get(version);
        if (!verifiedKey) {
          throw new Error("A verified current book key is unavailable. Reconnect for its device envelope or explicitly review a new key rotation; this recovery input cannot establish publication access on its own.");
        }
        const projectKey = await importMobileRecoveryKey(recoveryKey);
        // OA1's checksum detects typing mistakes, not the book a key belongs to.
        // Authenticate a fresh challenge against the independently unwrapped
        // envelope/provisioned key without extracting either key's bytes.
        try {
          const nonce = crypto.getRandomValues(new Uint8Array(12));
          const challenge = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, verifiedKey, new Uint8Array(0));
          await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, projectKey, challenge);
        } catch {
          throw new Error("The recovery key does not match this book's verified current key. The previous key remains available; check the account, book and recovery key.");
        }
        projectKeys.set(version, projectKey);
        if (services?.devices) {
          const current = await refreshKeyState();
          if (current.activeKeyVersion !== version) throw new Error("The book key changed during recovery unlock. Reconnect and review its current version.");
        }
        state = {
          status: "ready",
          activeKeyVersion: version,
          ...(services?.devices ? { latestKeyVersion: version } : {}),
          message: `Mobile sync key version ${version} is unlocked in memory.`,
        };
      });
    },

    async publishSnapshot() {
      return exclusive(async () => {
        if (requireServices().devices) await refreshKeyState();
        const active = activeProjectKey();
        return requireServices().sync.publishSnapshot({
          projectRoot,
          projectId,
          ...active,
        });
      });
    },

    async importOutbox() {
      return exclusive(async () => {
        const runtime = requireServices();
        if (state.status !== "ready") {
          throw new Error("Provision or unlock a mobile project key before syncing.");
        }
        return runtime.sync.importOutbox({
          projectRoot,
          projectId,
          resolveProjectKey: (version) => projectKeys.get(version) ?? null,
        });
      });
    },
  };
}
