import { AppState, Platform } from "react-native";
import { randomUUID } from "expo-crypto";
import { getNetworkStateAsync } from "expo-network";

import type { MobileConfig } from "../config";
import { EncryptedFileSnapshotCache } from "../adapters/encryptedSnapshotCache";
import { EncryptedDownloadedBookStore } from "../adapters/downloadedBookStore";
import { ExpoOutboxCipher, ExpoSnapshotCipher } from "../adapters/expoProjectCipher";
import { ExpoDeviceStore, ExpoSecretStore } from "../adapters/expoSecrets";
import { gatewayRealtimeDependencies } from "../adapters/gatewayRealtime";
import { gatewayVoicePolicy } from "../adapters/gatewaySession";
import { SodiumDeviceCrypto } from "../adapters/sodiumDeviceCrypto";
import { decryptHostedSnapshotManifest } from "../adapters/snapshotManifest";
import { verifyProjectKeyVerifier } from "../adapters/projectKeyVerifier";
import {
  SupabaseAuth,
  SupabaseDeviceEnrollmentTransport,
  SupabaseOutboxTransport,
  SupabaseProjects,
  SupabaseProjectKeyVerifier,
  SupabaseSnapshotSyncTransport,
} from "../adapters/supabaseAdapters";
import { asMobileSupabaseClient, clearMobileAuthSession, createMobileSupabaseClient } from "../adapters/supabaseClient";
import { SQLiteOutboxStore } from "../adapters/sqliteOutboxStore";
import { DeviceEnrollment, type EnrolledDevice } from "../core/deviceEnrollment";
import { revokeAndDeleteHostedLocalData } from "../core/hostedLifecycle";
import { MobileOutbox, type OutboxKind } from "../core/outbox";
import { readPendingOutbox } from "../core/outboxReview";
import { LocalCompanion } from "../core/localCompanion";
import { CompanionRecovery, type CompanionState } from "../core/companionRecovery";
import { SnapshotProject } from "../core/snapshotProject";
import { SnapshotSync } from "../core/snapshotSync";
import { encodeRecoveryKey } from "../core/recoveryKey";
import { verifyAndImportRecoveryKey } from "../core/projectRecovery";
import { MobileRealtimeTransport } from "../voice/realtimeTransport";
import { MobileVoiceController } from "../voice/voiceController";
import { VoicePolicySession } from "../voice/voicePolicySession";
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

type VoiceAttempt = { abort: AbortController; controller?: MobileVoiceController; closeAccess?(): void; cleanup(): void };

export class HostedRuntime implements AppRuntime {
  readonly mode = "hosted" as const;
  #clientInstance: ReturnType<typeof createMobileSupabaseClient> | null = null;
  #downloadedOnly = false;
  #accessEpoch = 0;
  #authCleanup: Promise<void> = Promise.resolve();
  #modeAttempt = 0;
  #modeWrite: Promise<void> = Promise.resolve();
  #voice: VoiceAttempt | null = null;
  #identityUnsubscribe: (() => void) | null = null;
  #onlineContext: { client: ReturnType<typeof createMobileSupabaseClient>; userId: string; deviceId: string; keyId: string; sessionId: string } | null = null;
  #viewClosed = false;
  readonly #accessListeners = new Set<() => void>();
  readonly #projectTitles = new Map<string, string>();
  readonly #devices = new ExpoDeviceStore();
  readonly #secrets = new ExpoSecretStore();
  readonly #enrollment;
  readonly #books = new EncryptedDownloadedBookStore();
  readonly #local;
  readonly #cache = new EncryptedFileSnapshotCache();
  readonly #outboxStore = new SQLiteOutboxStore();
  readonly #recovery = new CompanionRecovery(this.#cache);

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

  #stopVoice(): void {
    const current = this.#voice;
    this.#voice = null;
    current?.abort.abort(new Error("Voice session was stopped because its access or context changed."));
    current?.controller?.stop();
    current?.cleanup();
  }

  #closeLocalView(): void {
    if (this.#viewClosed) return;
    this.#viewClosed = true;
    this.#accessEpoch++;
    this.#modeAttempt++;
    try { this.#voice?.closeAccess?.(); } catch { /* The local view still closes if an event consumer fails. */ }
    this.#stopVoice();
    this.#identityUnsubscribe?.();
    this.#identityUnsubscribe = null;
    this.#onlineContext = null;
    const client = this.#clientInstance;
    this.#clientInstance = null;
    const lock = this.#authCleanup.then(() => this.#local.lock());
    this.#authCleanup = lock.catch(() => {});
    void client?.auth.dispose().catch(() => {});
    for (const listener of this.#accessListeners) listener();
  }

  async #watchOnlineIdentity(session: AppSession, device: EnrolledDevice): Promise<void> {
    const client = this.#client;
    const identity = await new SupabaseAuth(asMobileSupabaseClient(client)).recoveryIdentity(device.deviceId);
    if (identity.userId !== session.userId || this.#clientInstance !== client) {
      throw new Error("The online account identity changed. Sign in again.");
    }
    const previous = this.#onlineContext;
    if (previous && (previous.client !== client || previous.userId !== identity.userId || previous.deviceId !== device.deviceId
      || previous.keyId !== device.keyId || previous.sessionId !== identity.sessionId)) {
      this.#closeLocalView();
      throw new Error("The online sign-in session changed. Sign in again.");
    }
    if (previous) return;
    this.#viewClosed = false;
    this.#onlineContext = { client, ...identity, deviceId: device.deviceId, keyId: device.keyId };
    this.#identityUnsubscribe = new SupabaseAuth(asMobileSupabaseClient(client)).observeRecoveryIdentity(
      { ...identity, deviceId: device.deviceId }, () => this.#closeLocalView());
  }

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
    this.#stopVoice();
    await this.#authCleanup;
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
    await this.#watchOnlineIdentity(session, device);
    await this.#local.authorize(session, device);
    if (attempt !== this.#modeAttempt) throw new Error("Session restore was superseded.");
    await this.#setLibraryMode(attempt, false);
    return session;
  }

  async openDownloadedLibrary(): Promise<AppSession> {
    this.#accessEpoch++;
    this.#stopVoice();
    // Downloaded access is governed by the persistent local lock, not by an
    // expired or unavailable online Auth session. Reconnection attaches a new
    // verified online identity watch before any hosted operation.
    this.#identityUnsubscribe?.(); this.#identityUnsubscribe = null; this.#onlineContext = null;
    await this.#authCleanup;
    const attempt = ++this.#modeAttempt;
    const identity = await this.#local.require();
    if (attempt !== this.#modeAttempt) throw new Error("Local access request was superseded.");
    await this.#setLibraryMode(attempt, true);
    return { userId: identity.userId, email: identity.email, downloadedOnly: true };
  }

  async #onlineIdentity(): Promise<{ session: AppSession; device: EnrolledDevice }> {
    const epoch = this.#accessEpoch;
    if (this.#downloadedOnly) throw new Error("Reconnect to the online library to use sync, voice or key recovery. Downloaded reading and captures remain available.");
    if (await disconnected()) throw new Error("An internet connection and a verified sign-in are required for sync, voice and key recovery. Downloaded reading and captures remain available.");
    const session = await this.#session();
    if (!session) throw new Error("Sign in again to use the online library, sync or voice. Saved captures have not been deleted.");
    const device = await this.#ensureDevice(session.userId);
    await this.#watchOnlineIdentity(session, device);
    await this.#local.authorize(session, device);
    if (epoch !== this.#accessEpoch) throw new Error("Online access changed. Sign in again.");
    return { session, device };
  }

  async signIn(email: string, password: string): Promise<AppSession> {
    this.#accessEpoch++;
    const epoch = this.#accessEpoch;
    this.#stopVoice();
    this.#identityUnsubscribe?.(); this.#identityUnsubscribe = null; this.#onlineContext = null;
    await this.#authCleanup;
    const attempt = ++this.#modeAttempt;
    if (await disconnected()) throw new Error("Sign-in needs an internet connection. Use downloaded books if this device was previously signed in.");
    const session = await this.#auth.signInWithPassword(email, password);
    const device = await this.#ensureDevice(session.userId);
    await this.#watchOnlineIdentity(session, device);
    if (attempt !== this.#modeAttempt) throw new Error("Sign-in was superseded.");
    await this.#local.authorize(session, device, true, () => {
      if (epoch !== this.#accessEpoch || attempt !== this.#modeAttempt) throw new Error("Sign-in identity changed. Sign in again.");
    });
    await this.#setLibraryMode(attempt, false);
    return session;
  }

  subscribeLocalAccessLock(listener: () => void): () => void {
    this.#accessListeners.add(listener);
    const check = () => { void this.#local.require().catch(() => {
      this.#closeLocalView();
    }); };
    const unsubscribe = this.#secrets.subscribeLocalAccessChanges(check);
    const foreground = AppState.addEventListener("change", (state) => { if (state === "active") check(); });
    return () => { this.#accessListeners.delete(listener); unsubscribe(); foreground.remove(); };
  }

  async signOut(): Promise<void> {
    this.#modeAttempt++;
    this.#accessEpoch++;
    this.#stopVoice();
    this.#identityUnsubscribe?.(); this.#identityUnsubscribe = null; this.#onlineContext = null;
    const localOnly = this.#downloadedOnly;
    const client = this.#clientInstance;
    this.#clientInstance = null;
    // Normal sign-out intentionally retains this account's encrypted local
    // state. A same-user sign-in rebinds the exact persisted device/key; a
    // different user cannot silently delete or inherit that account's work.
    const cleanup = this.#authCleanup.then(async () => {
      try {
        await this.#local.lock();
        await this.#recovery.drain().catch(() => {});
        await this.#modeWrite.catch(() => {});
        this.#projectTitles.clear();
        this.#downloadedOnly = false;
        await client?.auth.stopAutoRefresh();
        if (client && !localOnly && !await disconnected()) await new SupabaseAuth(asMobileSupabaseClient(client)).signOut();
      } finally {
        this.#projectTitles.clear();
        this.#downloadedOnly = false;
        await this.#modeWrite.catch(() => {});
        // Closing storage's lease fences in-flight refresh commits. A new
        // deliberate sign-in waits for cleanup and creates a fresh SDK client.
        try { await client?.auth.dispose(); }
        finally { await clearMobileAuthSession(this.config); }
      }
    });
    this.#authCleanup = cleanup.catch(() => {});
    await cleanup;
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
        // Project metadata updates are not snapshot publication receipts.
        lastPublishedAt: null,
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
    // A refresh can replace the snapshot or Writing Voice even for the same
    // book. A new call must review the newly opened immutable context.
    this.#stopVoice();
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

  async loadCompanionState(projectId: string): Promise<CompanionState> {
    const epoch = this.#accessEpoch;
    const identity = await this.#local.requireBook(projectId);
    const value = await this.#recovery.load(identity, projectId);
    await this.#local.requireBook(projectId);
    if (epoch !== this.#accessEpoch) throw new Error("Recovery access was superseded.");
    return value;
  }

  async saveCompanionState(projectId: string, value: CompanionState): Promise<void> {
    const epoch = this.#accessEpoch;
    const identity = await this.#local.requireBook(projectId);
    if (epoch !== this.#accessEpoch) throw new Error("Recovery access was superseded.");
    await this.#recovery.save(identity, projectId, value);
    await this.#local.requireBook(projectId);
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

  async #queue(projectId: string, kind: OutboxKind, payload: Record<string, unknown>, baseRevision: string, retainedOperationId?: string): Promise<string> {
    const current = await this.#mobileOutbox(projectId);
    const operationId = retainedOperationId ?? randomUUID();
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
    operationId?: string;
    baseRevision: string;
    kind: "capture_note" | "dictated_passage" | "story_memory_suggestion" | "change_set_request";
    text: string;
  }): Promise<PendingItem> {
    if (!input.text.trim()) throw new Error("Capture text is required.");
    const operationId = await this.#queue(input.projectId, input.kind, capturePayload(input.kind, input.text.trim()), input.baseRevision, input.operationId);
    const saved = await this.#outboxStore.get(operationId);
    return { operationId, kind: input.kind, summary: input.text.trim(),
      createdAt: saved?.createdAt ?? new Date().toISOString(), status: saved?.acknowledgedAt ? "uploaded" : "local" };
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
    if (this.#downloadedOnly) throw new Error("Reconnect to the online library to use sync, voice or key recovery. Downloaded reading and captures remain available.");
    this.#stopVoice();
    const epoch = this.#accessEpoch;
    const config = { ...this.config };
    const abort = new AbortController();
    const cancel = () => { if (this.#voice === attempt) this.#stopVoice(); };
    const foreground = AppState.addEventListener("change", state => { if (state !== "active") cancel(); });
    const attempt: VoiceAttempt = { abort, cleanup: () => {
      input.signal?.removeEventListener("abort", cancel); foreground.remove();
    } };
    this.#voice = attempt;
    input.signal?.addEventListener("abort", cancel, { once: true });
    const reportClosed = (message: string) => {
      if (this.#voice !== attempt) return;
      cancel();
      if (!input.signal?.aborted) input.onEvent({ type: "session.error", code: "disconnected", providerEventId: "local-policy", param: "", message });
    };
    attempt.closeAccess = () => reportClosed("Voice identity changed. Audio is closed; sign in again before starting a new session.");
    const current = () => {
      input.signal?.throwIfAborted(); abort.signal.throwIfAborted();
      if (epoch !== this.#accessEpoch || this.#voice !== attempt || this.#downloadedOnly
        || config.gatewayUrl !== this.config.gatewayUrl || config.supabaseUrl !== this.config.supabaseUrl
        || config.supabasePublishableKey !== this.config.supabasePublishableKey) {
        reportClosed("Voice access or configuration changed. Audio is closed; start a new session to continue.");
        throw new Error("Voice access or configuration changed. Start a new session to continue.");
      }
    };
    try {
      current();
      const { device, session } = await this.#onlineIdentity(); current();
      await this.#local.requireBook(input.projectId); current();
      const cached = await this.#cache.load(input.projectId); current();
      if (!cached) throw new Error("Download a current project snapshot before starting voice.");
      const sameScope = () => {
        if (epoch !== this.#accessEpoch || this.#downloadedOnly
          || config.gatewayUrl !== this.config.gatewayUrl || config.supabaseUrl !== this.config.supabaseUrl
          || config.supabasePublishableKey !== this.config.supabasePublishableKey) throw new Error("Voice identity or configuration changed.");
      };
      const scopedToken = async (active: boolean) => {
        if (active) current(); else sameScope();
        const identity = await this.#onlineIdentity();
        if (active) current(); else sameScope();
        if (identity.session.userId !== session.userId || identity.device.deviceId !== device.deviceId || identity.device.keyId !== device.keyId) {
          reportClosed("Voice identity changed. Audio is closed; start a new session to continue.");
          throw new Error("Voice identity changed. Start a new session to continue.");
        }
        const token = await this.#auth.accessToken(device.deviceId);
        if (active) current(); else sameScope();
        return token;
      };
      const gateway = {
        gatewayUrl: config.gatewayUrl, projectId: input.projectId, deviceId: device.deviceId,
        accessToken: () => scopedToken(true),
        // A deliberate End may stop its old lease after the active registry is
        // cleared. Sign-out/downloaded mode fence this before any network work.
        stopAccessToken: () => scopedToken(false),
      };
      let policy: VoicePolicySession;
      const controller = new MobileVoiceController({
        project: SnapshotProject.open(cached.snapshot),
        threadId: `mobile-${input.projectId}`,
        ...(input.currentSceneId ? { currentSceneId: input.currentSceneId } : {}),
        queue: (kind, payload) => this.#queue(input.projectId, kind, payload, cached.manifest.revision),
        onEvent: event => { current(); input.onEvent(event); },
        createTransport: onEvent => {
          policy = new VoicePolicySession({
            transport: new MobileRealtimeTransport(gatewayRealtimeDependencies(gateway), event => {
              try { current(); if (policy.active) void onEvent(event); } catch { cancel(); }
            }),
            policy: gatewayVoicePolicy(gateway),
            onClosed: reportClosed,
          });
          return policy;
        },
      });
      attempt.controller = controller;
      abort.signal.addEventListener("abort", () => controller.stop(), { once: true });
      await controller.start(); current();
      return {
        mute: muted => { current(); controller.mute(muted); },
        sendText: text => { current(); controller.sendText(text); },
        interrupt: () => { current(); controller.interrupt(); },
        stop: cancel,
      };
    } catch (error) {
      cancel();
      throw error;
    }
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
    const epoch = this.#accessEpoch;
    const deployment = this.config.supabaseUrl;
    const publishableKey = this.config.supabasePublishableKey;
    const { device, session } = await this.#onlineIdentity();
    const client = this.#client;
    const mobileClient = asMobileSupabaseClient(client);
    let identityChanged = false;
    const current = () => {
      if (identityChanged || epoch !== this.#accessEpoch || this.#clientInstance !== client || this.#downloadedOnly
        || this.config.supabaseUrl !== deployment || this.config.supabasePublishableKey !== publishableKey) {
        throw new Error("Access changed during book key recovery. Reconnect and try again.");
      }
    };
    current();
    const auth = new SupabaseAuth(mobileClient);
    const original = await auth.recoveryIdentity(device.deviceId);
    current();
    if (original.userId !== session.userId) throw new Error("The recovery sign-in identity changed. Sign in again.");
    const unsubscribe = auth.observeRecoveryIdentity({ ...original, deviceId: device.deviceId }, () => { identityChanged = true; });
    try {
      const normalizedProjectId = projectId.toLowerCase();
      const expectedKey = await this.#secrets.get(`openauthor.project.${normalizedProjectId}.key.${keyVersion}`);
      current();
      try { await this.#enrollmentTransport.enrollProject(projectId, device.deviceId); }
      catch { /* Existing viewer enrollment is checked by the verifier/manifest RPC. */ }
      current();
      const verifierTransport = new SupabaseProjectKeyVerifier(mobileClient, device.deviceId);
      const identity = async () => {
        current();
        const local = await this.#local.require(); current();
        const confirmed = await auth.recoveryIdentity(device.deviceId); current();
        const saved = await this.#enrollment.localDevice(session.userId); current();
        if (confirmed.userId !== original.userId || confirmed.sessionId !== original.sessionId
          || saved.deviceId !== device.deviceId || saved.keyId !== device.keyId || saved.publicKey !== device.publicKey
          || local.userId !== original.userId || local.deviceId !== device.deviceId || local.keyId !== device.keyId) {
          throw new Error("The recovery account, device or sign-in session changed. Sign in again.");
        }
        return local;
      };
      let reviewed: string | null = null;
      await verifyAndImportRecoveryKey({
        projectId: normalizedProjectId, keyVersion, recoveryKey,
        verify: async (key) => {
          const verifier = await verifierTransport.get(normalizedProjectId, keyVersion); current();
          await identity();
          if (verifier) {
            const proof = await verifyProjectKeyVerifier(verifier, key, { projectId: normalizedProjectId, keyVersion }); current();
            reviewed = JSON.stringify([verifier.nonce_hex, verifier.ciphertext_hex, verifier.ciphertext_sha256]);
            return proof;
          }
          const transport = new SupabaseSnapshotSyncTransport(mobileClient, {
            deviceId: device.deviceId,
            decodeManifest: async (manifest) => {
              if (manifest.keyVersion !== keyVersion) {
                throw new Error(`This book currently uses key version ${manifest.keyVersion}. Use that version's recovery key from desktop.`);
              }
              try { return await decryptHostedSnapshotManifest(manifest, key); }
              catch { throw new Error("This recovery key cannot unlock the selected book. Check the key and version on desktop."); }
            },
          });
          const manifest = await transport.latestManifest(normalizedProjectId, device.deviceId); current();
          return manifest;
        },
        persist: async (key) => {
          await identity();
          // This RPC also checks current live Auth, enrollment and active key
          // version for legacy keys, for which the value remains null.
          const latest = await verifierTransport.get(normalizedProjectId, keyVersion); current();
          // Exact schema, algorithm, selected project/version and AAD version
          // were validated on each read. Canonicalize the remaining bytes so
          // JSON object property order cannot invalidate an identical receipt.
          if ((latest ? JSON.stringify([latest.nonce_hex, latest.ciphertext_hex, latest.ciphertext_sha256]) : null) !== reviewed) {
            throw new Error("The book key verifier changed during recovery. Review the current key on desktop.");
          }
          const local = await identity();
          await this.#secrets.setProjectKeyIfCurrent({
            projectId: normalizedProjectId, keyVersion, projectKey: key, expectedKey,
            identity: local, device, current,
          });
          current();
        },
      });
    } finally { unsubscribe(); }
  }

  async revokeDeviceAndDeleteLocalData(): Promise<void> {
    this.#accessEpoch++;
    this.#stopVoice();
    await this.#clientInstance?.auth.stopAutoRefresh();
    await this.#local.lock();
    await this.#recovery.drain().catch(() => {});
    await revokeAndDeleteHostedLocalData({
      revokeDevice: async () => {
        if (await disconnected()) {
          await this.#enrollment.clearCurrentLocal();
          throw new Error("Remote revocation requires an internet connection.");
        }
        await this.#enrollment.revokeCurrent();
      },
      deleteCache: async () => {
        try { await clearMobileAuthSession(this.config); }
        finally { try { await this.#cache.deleteAll(); } finally { await this.#books.clear(); } }
      },
      deleteOutbox: () => this.#outboxStore.deleteAll(),
      signOut: () => this.signOut(),
    });
  }
}
