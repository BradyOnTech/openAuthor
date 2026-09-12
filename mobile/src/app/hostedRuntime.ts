import { Platform } from "react-native";
import { randomUUID } from "expo-crypto";
import { getNetworkStateAsync } from "expo-network";

import type { MobileConfig } from "../config";
import { EncryptedFileSnapshotCache } from "../adapters/encryptedSnapshotCache";
import { EncryptedDownloadedBookStore } from "../adapters/downloadedBookStore";
import { ExpoOutboxCipher, ExpoSnapshotCipher } from "../adapters/expoProjectCipher";
import { ExpoDeviceStore, ExpoSecretStore } from "../adapters/expoSecrets";
import { gatewayRealtimeDependencies } from "../adapters/gatewayRealtime";
import { SodiumDeviceCrypto } from "../adapters/sodiumDeviceCrypto";
import { decryptHostedSnapshotManifest } from "../adapters/snapshotManifest";
import {
  SupabaseAuth,
  SupabaseDeviceEnrollmentTransport,
  SupabaseOutboxTransport,
  SupabaseProjects,
  SupabaseSnapshotSyncTransport,
} from "../adapters/supabaseAdapters";
import { asMobileSupabaseClient, clearMobileAuthSession, createMobileSupabaseClient } from "../adapters/supabaseClient";
import { SQLiteOutboxStore } from "../adapters/sqliteOutboxStore";
import { DeviceEnrollment, type EnrolledDevice } from "../core/deviceEnrollment";
import { revokeAndDeleteHostedLocalData } from "../core/hostedLifecycle";
import { MobileOutbox, type OutboxKind } from "../core/outbox";
import { readPendingOutbox } from "../core/outboxReview";
import { LocalCompanion } from "../core/localCompanion";
import { SnapshotProject } from "../core/snapshotProject";
import { SnapshotSync } from "../core/snapshotSync";
import { encodeRecoveryKey } from "../core/recoveryKey";
import { verifyAndImportRecoveryKey } from "../core/projectRecovery";
import { MobileRealtimeTransport } from "../voice/realtimeTransport";
import { MobileVoiceController } from "../voice/voiceController";
import type { AppProject, AppRuntime, AppSession, PendingItem, VoiceHandle } from "./types";

function capturePayload(kind: OutboxKind, text: string): Record<string, unknown> {
  if (kind === "change_set_request") return { title: "Mobile change request", instruction: text };
  if (kind === "dictated_passage") return { title: "Mobile dictation", content: text };
  if (kind === "story_memory_suggestion") return { title: "Mobile Story Memory suggestion", content: text };
  return { title: "Mobile note", content: text };
}

async function disconnected(): Promise<boolean> {
  const network = await getNetworkStateAsync();
  return network.isConnected === false || network.isInternetReachable === false;
}

export class HostedRuntime implements AppRuntime {
  readonly mode = "hosted" as const;
  #clientInstance: ReturnType<typeof createMobileSupabaseClient> | null = null;
  #downloadedOnly = false;
  #modeAttempt = 0;
  #modeWrite: Promise<void> = Promise.resolve();
  readonly #projectTitles = new Map<string, string>();
  readonly #devices = new ExpoDeviceStore();
  readonly #secrets = new ExpoSecretStore();
  readonly #enrollment;
  readonly #books = new EncryptedDownloadedBookStore();
  readonly #local;
  readonly #cache = new EncryptedFileSnapshotCache();
  readonly #outboxStore = new SQLiteOutboxStore();

  constructor(private readonly config: MobileConfig) {
    this.#enrollment = new DeviceEnrollment({
      crypto: new SodiumDeviceCrypto(),
      secrets: this.#secrets,
      devices: this.#devices,
      // Keep the SDK uninitialized on an offline cold start. These callbacks
      // are only invoked by online enrollment/key/revocation operations.
      transport: {
        register: (input) => this.#enrollmentTransport.register(input),
        rebind: (input) => this.#enrollmentTransport.rebind(input),
        projectKeyEnvelope: (input) => this.#enrollmentTransport.projectKeyEnvelope(input),
        revoke: (id) => this.#enrollmentTransport.revoke(id),
      },
      uuid: randomUUID,
    });
    this.#local = new LocalCompanion({
      deployment: config.supabaseUrl, secrets: this.#secrets, books: this.#books,
      localDevice: (userId) => this.#enrollment.localDevice(userId),
    });
  }

  get #client() { return this.#clientInstance ??= createMobileSupabaseClient(this.config); }
  get #mobileClient() { return asMobileSupabaseClient(this.#client); }
  get #auth() { return new SupabaseAuth(this.#mobileClient); }
  get #enrollmentTransport() { return new SupabaseDeviceEnrollmentTransport(this.#mobileClient); }

  async #setLibraryMode(attempt: number, downloadedOnly: boolean): Promise<void> {
    const write = this.#modeWrite.catch(() => {}).then(async () => {
      if (attempt !== this.#modeAttempt) throw new Error("Library selection was superseded.");
      await this.#local.preferDownloaded(downloadedOnly);
      if (attempt !== this.#modeAttempt) throw new Error("Library selection was superseded.");
      if (downloadedOnly) await this.#clientInstance?.auth.stopAutoRefresh();
      else await this.#client.auth.startAutoRefresh();
      if (attempt !== this.#modeAttempt) throw new Error("Library selection was superseded.");
      this.#downloadedOnly = downloadedOnly;
    });
    this.#modeWrite = write;
    await write;
  }

  async #session(): Promise<AppSession | null> {
    if (await this.#local.isLocked()) return null;
    const result = await this.#client.auth.getSession();
    if (result.error) throw new Error("The hosted session could not be restored. You can still open previously downloaded books.");
    const session = result.data.session;
    if (!session) return null;
    return { userId: session.user.id, email: session.user.email ?? "" };
  }

  // Device-bound access is checked before every hosted operation, so a new
  // Supabase session cannot silently inherit a stale device claim.
  async #ensureDevice(userId: string): Promise<EnrolledDevice> {
    const current = await this.#devices.current();
    if (current) {
      if (current.userId !== userId) {
        throw new Error("This device has saved work for another account. Sign in to that account to sync or explicitly remove its data first.");
      } else {
        // Check local key availability even when the JWT is already bound.
        await this.#enrollment.enroll({ userId, name: current.name, platform: current.platform });
        try {
          await this.#auth.accessToken(current.deviceId);
        } catch {
          await this.#enrollment.rebindCurrent(userId);
          await this.#auth.refreshAfterEnrollment(current.deviceId);
        }
        return current;
      }
    }
    const device = await this.#enrollment.enroll({
      userId,
      name: `${Platform.OS === "web" ? "Browser" : Platform.OS === "ios" ? "iOS" : "Android"} openAuthor device`,
      platform: Platform.OS === "web" ? "web" : Platform.OS === "ios" ? "ios" : "android",
    });
    await this.#auth.refreshAfterEnrollment(device.deviceId);
    return device;
  }

  async restoreSession(options: { online?: boolean } = {}): Promise<AppSession | null> {
    const attempt = ++this.#modeAttempt;
    if (await this.#local.isLocked()) return null;
    if (!options.online && await this.#local.prefersDownloaded()) return this.openDownloadedLibrary();
    if (await disconnected()) {
      if (options.online) throw new Error("An internet connection is required to reconnect. Your downloaded library remains available.");
      try { return await this.openDownloadedLibrary(); }
      catch { return null; }
    }
    const session = await this.#session();
    if (!session) return null;
    const device = await this.#ensureDevice(session.userId);
    await this.#local.authorize(session, device);
    if (attempt !== this.#modeAttempt) throw new Error("Session restore was superseded.");
    await this.#setLibraryMode(attempt, false);
    return session;
  }

  async openDownloadedLibrary(): Promise<AppSession> {
    const attempt = ++this.#modeAttempt;
    const identity = await this.#local.require();
    if (attempt !== this.#modeAttempt) throw new Error("Local access request was superseded.");
    await this.#setLibraryMode(attempt, true);
    return { userId: identity.userId, email: identity.email, downloadedOnly: true };
  }

  async #onlineIdentity(): Promise<{ session: AppSession; device: EnrolledDevice }> {
    if (this.#downloadedOnly) throw new Error("Reconnect to the online library to use sync, voice or key recovery. Downloaded reading and captures remain available.");
    if (await disconnected()) throw new Error("An internet connection and a verified sign-in are required for sync, voice and key recovery. Downloaded reading and captures remain available.");
    const session = await this.#session();
    if (!session) throw new Error("Sign in again to use the online library, sync or voice. Saved captures have not been deleted.");
    const device = await this.#ensureDevice(session.userId);
    await this.#local.authorize(session, device);
    return { session, device };
  }

  async signIn(email: string, password: string): Promise<AppSession> {
    const attempt = ++this.#modeAttempt;
    if (await disconnected()) throw new Error("Sign-in needs an internet connection. Use downloaded books if this device was previously signed in.");
    const session = await this.#auth.signInWithPassword(email, password);
    const device = await this.#ensureDevice(session.userId);
    if (attempt !== this.#modeAttempt) throw new Error("Sign-in was superseded.");
    await this.#local.authorize(session, device, true);
    await this.#setLibraryMode(attempt, false);
    return session;
  }

  async signOut(): Promise<void> {
    this.#modeAttempt++;
    const localOnly = this.#downloadedOnly;
    // Normal sign-out intentionally retains this account's encrypted local
    // state. A same-user sign-in rebinds the exact persisted device/key; a
    // different user cannot silently delete or inherit that account's work.
    await this.#local.lock();
    await this.#modeWrite.catch(() => {});
    this.#projectTitles.clear();
    this.#downloadedOnly = false;
    await this.#clientInstance?.auth.stopAutoRefresh();
    try {
      if (!localOnly && !await disconnected()) await this.#auth.signOut();
    } finally {
      await clearMobileAuthSession(this.config);
    }
  }

  async projects(): Promise<AppProject[]> {
    if (this.#downloadedOnly || await disconnected()) {
      return (await this.#local.books()).map((book) => ({
        id: book.projectId, title: book.title, role: "member", lastPublishedAt: book.downloadedAt, downloaded: true,
      }));
    }
    const { device } = await this.#onlineIdentity();
    const projects = (await new SupabaseProjects(this.#mobileClient, device.deviceId).list())
      .filter((project) => project.status === "active")
      .map((project) => ({
        id: project.id,
        title: project.name,
        role: "member" as const,
        lastPublishedAt: project.updatedAt,
      }));
    for (const project of projects) this.#projectTitles.set(project.id, project.title);
    return projects;
  }

  async #sync(projectId: string, device: EnrolledDevice): Promise<void> {
    try {
      await this.#enrollmentTransport.enrollProject(projectId, device.deviceId);
    } catch {
      // A viewer may already have been enrolled by a project editor. The key
      // envelope and snapshot RPCs remain the authoritative fail-closed checks.
    }
    const transport = new SupabaseSnapshotSyncTransport(this.#mobileClient, {
      deviceId: device.deviceId,
      decodeManifest: async (manifest) => decryptHostedSnapshotManifest(
        manifest,
        await this.#enrollment.projectKey(projectId, manifest.keyVersion),
      ),
    });
    await new SnapshotSync({
      transport,
      cipher: new ExpoSnapshotCipher(),
      cache: this.#cache,
      projectKey: (id, version) => this.#enrollment.projectKey(id, version),
    }).refresh(projectId, device.deviceId);
  }

  async openProject(projectId: string): Promise<{ project: SnapshotProject; freshness: string; offline: boolean }> {
    let offline = this.#downloadedOnly || await disconnected();
    if (!offline) {
      try {
        const { device } = await this.#onlineIdentity();
        await this.#sync(projectId, device);
      } catch (error) {
        if (!await disconnected()) throw error;
        offline = true;
      }
    }
    if (offline) await this.#local.requireBook(projectId);
    const cached = await this.#cache.load(projectId);
    if (!cached) throw new Error(offline ? "The downloaded snapshot is missing from this device. Reconnect and open the book to download it again." : "No encrypted mobile snapshot has been published for this project.");
    await this.#enrollment.localProjectKey(projectId, cached.manifest.keyVersion);
    if (!offline) await this.#local.remember({
      projectId, title: this.#projectTitles.get(projectId) ?? "Downloaded book",
      downloadedAt: cached.cachedAt, revision: cached.manifest.revision, keyVersion: cached.manifest.keyVersion,
    });
    return {
      project: SnapshotProject.open(cached.snapshot),
      freshness: `Snapshot ${cached.manifest.revision.slice(0, 8)} · ${new Date(cached.cachedAt).toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      })}`,
      offline,
    };
  }

  async pending(projectId: string): Promise<PendingItem[]> {
    const book = await this.#local.requireBook(projectId);
    return readPendingOutbox({
      projectId,
      deviceId: book.deviceId,
      store: this.#outboxStore,
      cipherForKeyVersion: async (version) => new ExpoOutboxCipher(
        await this.#enrollment.localProjectKey(projectId, version), version,
      ),
    });
  }

  async #mobileOutbox(projectId: string): Promise<{ outbox: MobileOutbox; device: EnrolledDevice; revision: string }> {
    const book = await this.#local.requireBook(projectId);
    const device = await this.#enrollment.localDevice(book.userId);
    const cached = await this.#cache.load(projectId);
    if (!cached) throw new Error("A current project snapshot is required before capturing mobile work.");
    const key = await this.#enrollment.localProjectKey(projectId, cached.manifest.keyVersion);
    return {
      device,
      revision: cached.manifest.revision,
      outbox: new MobileOutbox({
        store: this.#outboxStore,
        cipher: new ExpoOutboxCipher(key, cached.manifest.keyVersion),
        transport: { upload: async (envelope) => {
          const current = await this.#onlineIdentity();
          if (current.device.deviceId !== device.deviceId) throw new Error("The upload device has changed. Sign in again.");
          return new SupabaseOutboxTransport(this.#mobileClient, device.deviceId).upload(envelope);
        } },
      }),
    };
  }

  async #queue(projectId: string, kind: OutboxKind, payload: Record<string, unknown>, baseRevision: string): Promise<string> {
    const current = await this.#mobileOutbox(projectId);
    const operationId = randomUUID();
    await current.outbox.enqueue({
      operationId,
      projectId,
      deviceId: current.device.deviceId,
      baseRevision,
      kind,
      payload,
    });
    return operationId;
  }

  async capture(input: {
    projectId: string;
    baseRevision: string;
    kind: "capture_note" | "dictated_passage" | "story_memory_suggestion" | "change_set_request";
    text: string;
  }): Promise<PendingItem> {
    if (!input.text.trim()) throw new Error("Capture text is required.");
    const operationId = await this.#queue(input.projectId, input.kind, capturePayload(input.kind, input.text.trim()), input.baseRevision);
    return { operationId, kind: input.kind, summary: input.text.trim(), createdAt: new Date().toISOString(), status: "local" };
  }

  async flush(projectId: string): Promise<{ uploaded: number; remaining: number }> {
    await this.#onlineIdentity();
    return (await this.#mobileOutbox(projectId)).outbox.flush(projectId);
  }

  async startVoice(input: {
    projectId: string;
    currentSceneId?: string;
    signal?: AbortSignal;
    onEvent: Parameters<AppRuntime["startVoice"]>[0]["onEvent"];
  }): Promise<VoiceHandle> {
    const { device } = await this.#onlineIdentity();
    await this.#local.requireBook(input.projectId);
    const cached = await this.#cache.load(input.projectId);
    if (!cached) throw new Error("Download a current project snapshot before starting voice.");
    input.signal?.throwIfAborted();
    const controller = new MobileVoiceController({
      project: SnapshotProject.open(cached.snapshot),
      threadId: `mobile-${input.projectId}`,
      ...(input.currentSceneId ? { currentSceneId: input.currentSceneId } : {}),
      queue: (kind, payload) => this.#queue(input.projectId, kind, payload, cached.manifest.revision),
      onEvent: input.onEvent,
      createTransport: (onEvent) => new MobileRealtimeTransport(
        gatewayRealtimeDependencies({
          gatewayUrl: this.config.gatewayUrl,
          projectId: input.projectId,
          deviceId: device.deviceId,
          accessToken: async () => {
            await this.#onlineIdentity();
            return this.#auth.accessToken(device.deviceId);
          },
        }),
        (event) => { void onEvent(event); },
      ),
    });
    const cancel = () => controller.stop();
    input.signal?.addEventListener("abort", cancel, { once: true });
    try {
      await controller.start();
      input.signal?.throwIfAborted();
    } catch (error) {
      input.signal?.removeEventListener("abort", cancel);
      controller.stop();
      throw error;
    }
    return {
      mute: (muted) => controller.mute(muted),
      sendText: (text) => controller.sendText(text),
      interrupt: () => controller.interrupt(),
      stop: () => { input.signal?.removeEventListener("abort", cancel); controller.stop(); },
    };
  }

  async exportRecoveryKey(projectId: string): Promise<{ keyVersion: number; recoveryKey: string }> {
    await this.#local.requireBook(projectId);
    const cached = await this.#cache.load(projectId);
    if (!cached) throw new Error("Download this project before exporting its recovery key.");
    const keyVersion = cached.manifest.keyVersion;
    const key = await this.#enrollment.localProjectKey(projectId, keyVersion);
    return { keyVersion, recoveryKey: await encodeRecoveryKey(key) };
  }

  async importRecoveryKey(projectId: string, keyVersion: number, recoveryKey: string): Promise<void> {
    const { device } = await this.#onlineIdentity();
    try { await this.#enrollmentTransport.enrollProject(projectId, device.deviceId); }
    catch { /* Existing viewer enrollment is checked by the manifest RPC. */ }
    await verifyAndImportRecoveryKey({
      projectId, keyVersion, recoveryKey,
      verify: async (key) => {
        const transport = new SupabaseSnapshotSyncTransport(this.#mobileClient, {
          deviceId: device.deviceId,
          decodeManifest: async (manifest) => {
            if (manifest.keyVersion !== keyVersion) {
              throw new Error(`This book currently uses key version ${manifest.keyVersion}. Use that version's recovery key from desktop.`);
            }
            try { return await decryptHostedSnapshotManifest(manifest, key); }
            catch { throw new Error("This recovery key cannot unlock the selected book. Check the key and version on desktop."); }
          },
        });
        return transport.latestManifest(projectId, device.deviceId);
      },
      persist: (key) => this.#enrollment.importProjectKey(projectId, keyVersion, key),
    });
  }

  async revokeDeviceAndDeleteLocalData(): Promise<void> {
    await this.#local.lock();
    await revokeAndDeleteHostedLocalData({
      revokeDevice: async () => {
        if (await disconnected()) {
          await this.#enrollment.clearCurrentLocal();
          throw new Error("Remote revocation requires an internet connection.");
        }
        await this.#enrollment.revokeCurrent();
      },
      deleteCache: async () => { try { await this.#cache.deleteAll(); } finally { await this.#books.clear(); } },
      deleteOutbox: () => this.#outboxStore.deleteAll(),
      signOut: () => this.signOut(),
    });
  }
}
