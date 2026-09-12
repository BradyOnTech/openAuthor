import type { MobileOutboxImportResult } from "../api";
import {
  createMobileSyncService,
  type EncryptedMobileSnapshot,
  type MobileProjectKeyResolver,
} from "./mobileSync";
import {
  createMobileProjectKeyProvisioningService,
  importMobileRecoveryKey,
} from "./projectKeyProvisioning";
import { SupabaseMobileSyncTransport } from "./supabaseTransport";

export type HostedMobileSyncState = {
  status: "setup_required" | "locked" | "ready";
  activeKeyVersion: number | null;
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
    }): Promise<{
      projectKey: CryptoKey;
      keyVersion: number;
      recoveryKey: string;
      envelopeCount: number;
    }>;
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
  provisionProjectKey(expectedPreviousVersion: number, reasonCode: string): Promise<{
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
          provisioning: createMobileProjectKeyProvisioningService({ transport }),
          sync: createMobileSyncService({ transport }),
        };
      }
    }
  }

  const projectKeys = new Map(options.projectKeys);
  if (services && projectKeys.size > 0) {
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

  return {
    getState() {
      return { ...state };
    },

    async provisionProjectKey(expectedPreviousVersion, reasonCode) {
      const provisioned = await requireServices().provisioning.provisionProjectKey({
        projectId,
        expectedPreviousVersion,
        reasonCode,
      });
      projectKeys.set(provisioned.keyVersion, provisioned.projectKey);
      state = {
        status: "ready",
        activeKeyVersion: provisioned.keyVersion,
        message: `Mobile sync key version ${provisioned.keyVersion} is unlocked in memory.`,
      };
      return {
        keyVersion: provisioned.keyVersion,
        recoveryKey: provisioned.recoveryKey,
        envelopeCount: provisioned.envelopeCount,
      };
    },

    async unlockRecoveryKey(keyVersion, recoveryKey) {
      requireServices();
      const version = requiredVersion(keyVersion);
      const projectKey = await importMobileRecoveryKey(recoveryKey);
      projectKeys.set(version, projectKey);
      state = {
        status: "ready",
        activeKeyVersion: version,
        message: `Mobile sync key version ${version} is unlocked in memory.`,
      };
    },

    async publishSnapshot() {
      const active = activeProjectKey();
      return requireServices().sync.publishSnapshot({
        projectRoot,
        projectId,
        ...active,
      });
    },

    async importOutbox() {
      const runtime = requireServices();
      if (state.status !== "ready") {
        throw new Error("Provision or unlock a mobile project key before syncing.");
      }
      return runtime.sync.importOutbox({
        projectRoot,
        projectId,
        resolveProjectKey: (version) => projectKeys.get(version) ?? null,
      });
    },
  };
}
