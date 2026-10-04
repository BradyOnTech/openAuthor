import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaStreamLike } from "../src/voice/realtimeTransport";
import type { MobileSnapshot } from "../src/core/snapshotProject";

const state = vi.hoisted(() => ({
  userId: "user1", deviceId: "device1", keyId: "key1", offline: false,
  keys: new Map<string, string>(), books: new Map<string, unknown>(),
  appListeners: new Set<(state: string) => void>(), accessListeners: new Set<() => void>(),
  tracks: [] as Array<{ enabled: boolean; stop: ReturnType<typeof vi.fn> }>,
  channels: [] as Array<{ readyState: string; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; receive: ((event: { data: string }) => void) | undefined }>,
  permission: null as null | (() => Promise<MediaStreamLike>),
  issue: null as null | (() => Promise<Response>), sessionGate: null as null | (() => Promise<void>),
  snapshot: null as MobileSnapshot | null, queue: vi.fn(), fetch: vi.fn(), remote: vi.fn(), signOut: vi.fn(),
}));

vi.mock("react-native", () => ({ Platform: { OS: "web" }, AppState: { addEventListener: (_name: string, handler: (state: string) => void) => {
  state.appListeners.add(handler); return { remove: () => state.appListeners.delete(handler) };
} } }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "operation1" }));
vi.mock("expo-network", () => ({ getNetworkStateAsync: async () => ({ isConnected: !state.offline, isInternetReachable: !state.offline }) }));
vi.mock("../src/adapters/expoSecrets", () => ({
  ExpoDeviceStore: class { async current() { return device(); } },
  ExpoSecretStore: class {
    async get(key: string) { return state.keys.get(key) ?? null; }
    async set(key: string, value: string) { state.keys.set(key, value); }
    async setLocalAccessIfCurrent(value: string, current: () => void) { current(); state.keys.set("openauthor.mobile.local-access.v1", value); current(); }
    async create(key: string, value: string) { if (!state.keys.has(key)) state.keys.set(key, value); return state.keys.get(key)!; }
    subscribeLocalAccessChanges(handler: () => void) { state.accessListeners.add(handler); return () => state.accessListeners.delete(handler); }
  },
}));
vi.mock("../src/core/deviceEnrollment", () => ({ DeviceEnrollment: class {
  async localDevice() { return device(); } async enroll() { return device(); }
  async localProjectKey() { return "key"; } async projectKey() { return "key"; }
} }));
vi.mock("../src/adapters/downloadedBookStore", () => ({ EncryptedDownloadedBookStore: class {
  async get(id: string) { return state.books.get(id); } async list() { return [...state.books.values()]; }
  async put(value: { projectId: string }) { state.books.set(value.projectId, value); } async clear() { state.books.clear(); }
} }));
vi.mock("../src/adapters/encryptedSnapshotCache", () => ({ EncryptedFileSnapshotCache: class {
  async load(id: string) { return { snapshot: { ...state.snapshot, project_id: id }, manifest: { revision: "revision1", keyVersion: 1 }, cachedAt: "2026-10-02T12:00:00Z" }; }
} }));
vi.mock("../src/adapters/expoProjectCipher", () => ({ ExpoOutboxCipher: class {}, ExpoSnapshotCipher: class {} }));
vi.mock("../src/adapters/sodiumDeviceCrypto", () => ({ SodiumDeviceCrypto: class {} }));
vi.mock("../src/adapters/sqliteOutboxStore", () => ({ SQLiteOutboxStore: class {} }));
vi.mock("../src/core/outbox", () => ({ MobileOutbox: class { enqueue = state.queue; } }));
vi.mock("../src/core/snapshotSync", () => ({ SnapshotSync: class { async refresh() {} } }));
vi.mock("../src/adapters/supabaseClient", () => ({
  createMobileSupabaseClient: () => ({ auth: {
    getSession: async () => { await state.sessionGate?.(); return { data: { session: { user: { id: state.userId, email: "author@example.test" } } }, error: null }; },
    startAutoRefresh: async () => {}, stopAutoRefresh: async () => {}, dispose: async () => {},
  } }), asMobileSupabaseClient: (client: unknown) => client, clearMobileAuthSession: async () => {},
}));
vi.mock("../src/adapters/supabaseAdapters", () => ({
  SupabaseAuth: class {
    async accessToken(id: string) { if (id !== state.deviceId) throw new Error("wrong device"); return "fresh-token"; }
    async recoveryIdentity() { return { userId: state.userId, sessionId: "session1" }; }
    observeRecoveryIdentity() { return () => {}; }
    async signInWithPassword() { return { userId: state.userId, email: "author@example.test" }; }
    signOut = state.signOut;
  },
  SupabaseDeviceEnrollmentTransport: class { async enrollProject() {} }, SupabaseSnapshotSyncTransport: class {},
}));
vi.mock("../src/adapters/gatewayRealtime", async () => {
  const { gatewayNegotiator } = await import("../src/adapters/gatewaySession");
  return { gatewayRealtimeDependencies: (input: Parameters<typeof gatewayNegotiator>[0]) => ({
    negotiate: gatewayNegotiator(input),
    getUserMedia: async () => state.permission ? state.permission() : stream(),
    createPeerConnection: () => {
      const channel = { readyState: "open", send: vi.fn(), close: vi.fn(), addEventListener: (_name: string, receive: (event: { data: string }) => void) => { channel.receive = receive; }, receive: undefined as undefined | ((event: { data: string }) => void) };
      state.channels.push(channel);
      return { ontrack: null, addTrack: vi.fn(), createDataChannel: () => channel,
        createOffer: async () => ({ type: "offer", sdp: "offer" }), setLocalDescription: async () => {},
        setRemoteDescription: state.remote, close: vi.fn() };
    },
  }) };
});

import { HostedRuntime } from "../src/app/hostedRuntime";

function device() { return { userId: state.userId, deviceId: state.deviceId, keyId: state.keyId, name: "Synthetic browser", platform: "web", publicKey: "public", enrolledAt: "now", projectKeySlots: [] }; }
function stream(): MediaStreamLike {
  const track = { enabled: true, stop: vi.fn() }; track.stop.mockImplementation(() => { track.enabled = false; });
  state.tracks.push(track); return { getTracks: () => [track] };
}
function issued() { return new Response(JSON.stringify({ sdp: "answer", call_id: "call1", lease_id: "11111111-1111-4111-8111-111111111111",
  expires_at: new Date(Date.now() + 600_000).toISOString(), lease_expires_at: new Date(Date.now() + 30_000).toISOString(), renew_after_ms: 10_000 })); }
const config = () => ({ supabaseUrl: "https://db.example.test", supabasePublishableKey: "public", gatewayUrl: "https://voice.example.test" });
const onEvent = vi.fn();
async function runtime() {
  const settings = config(); const value = new HostedRuntime(settings);
  await value.signIn("author@example.test", "synthetic");
  for (const projectId of ["p1", "p2"]) state.books.set(projectId, { projectId, userId: state.userId, deviceId: state.deviceId, keyId: state.keyId, deployment: settings.supabaseUrl });
  return { value, settings };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime("2026-10-02T12:00:00Z"); vi.clearAllMocks();
  state.userId = "user1"; state.deviceId = "device1"; state.keyId = "key1"; state.offline = false;
  state.keys.clear(); state.books.clear(); state.tracks.length = 0; state.channels.length = 0;
  state.appListeners.clear(); state.accessListeners.clear(); state.permission = null; state.issue = null; state.sessionGate = null;
  state.remote.mockImplementation(async () => {});
  state.snapshot = { schema: "openauthor.mobile.snapshot", schema_version: 1, project_id: "p1", revision: "revision1",
    scenes: [{ id: "s1", title: "Scene", body: "A brass key.", summary: "", pov: "", status: "draft", created_at: "now", updated_at: "now" }], codex: { entities: [], relationships: [] }, evidence: [] };
  state.fetch.mockImplementation(async (url: string) => url.endsWith("/stop") ? new Response('{"stopped":true}') : state.issue ? state.issue() : issued());
  vi.stubGlobal("fetch", state.fetch);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("HostedRuntime voice access lifetime", () => {
  it("closes active media synchronously on offline sign-out without gateway requests or deleting work", async () => {
    const { value } = await runtime();
    const voice = await value.startVoice({ projectId: "p1", onEvent });
    state.fetch.mockClear(); state.offline = true;
    const exiting = value.signOut();
    expect(state.tracks[0]!.stop).toHaveBeenCalledOnce();
    expect(() => voice.sendText("Late input")).toThrow(); await exiting;
    expect(state.fetch).not.toHaveBeenCalled(); expect(state.signOut).not.toHaveBeenCalled(); expect(state.books.size).toBe(2);
  });
  it.each(["signout", "downloaded", "project", "background"])("fences pending microphone permission on %s", async action => {
    const { value } = await runtime(); let grant!: (value: MediaStreamLike) => void;
    state.permission = () => new Promise(resolve => { grant = resolve; });
    const starting = value.startVoice({ projectId: "p1", onEvent }); const rejected = expect(starting).rejects.toThrow();
    await vi.waitFor(() => expect(grant).toBeTypeOf("function"));
    if (action === "signout") await value.signOut();
    if (action === "downloaded") await value.openDownloadedLibrary();
    if (action === "project") await value.openProject("p2");
    if (action === "background") for (const listener of state.appListeners) listener("background");
    grant(stream()); await rejected; await Promise.resolve();
    expect(state.tracks[0]!.stop).toHaveBeenCalledOnce(); expect(state.fetch).not.toHaveBeenCalled();
  });
  it("fences an auth check that completes after sign-out before opening any media", async () => {
    const { value } = await runtime(); let resume!: () => void;
    state.sessionGate = () => new Promise(resolve => { resume = resolve; });
    const starting = value.startVoice({ projectId: "p1", onEvent }); const rejected = expect(starting).rejects.toThrow();
    await vi.waitFor(() => expect(resume).toBeTypeOf("function"));
    await value.signOut(); resume(); await rejected;
    expect(state.tracks).toHaveLength(0); expect(state.fetch).not.toHaveBeenCalled();
  });
  it("rejects a negotiated answer completing after the opened project changed", async () => {
    const { value } = await runtime(); let reply!: (value: Response) => void;
    state.issue = () => new Promise(resolve => { reply = resolve; });
    const starting = value.startVoice({ projectId: "p1", onEvent }); const rejected = expect(starting).rejects.toThrow();
    await vi.waitFor(() => expect(reply).toBeTypeOf("function"));
    await value.openProject("p2"); reply(issued()); await rejected;
    expect(state.remote).not.toHaveBeenCalled(); expect(state.channels[0]!.send).not.toHaveBeenCalled();
    expect(state.tracks[0]!.stop).toHaveBeenCalledOnce();
  });
  it.each(["userId", "deviceId", "keyId"] as const)("closes on renewed %s authority change and ignores old provider events", async field => {
    const { value } = await runtime(); await value.startVoice({ projectId: "p1", onEvent });
    const sent = state.channels[0]!.send.mock.calls.length; state[field] = "different-identity";
    await vi.advanceTimersByTimeAsync(10_000);
    expect(state.tracks[0]!.stop).toHaveBeenCalledOnce();
    state.channels[0]!.receive?.({ data: JSON.stringify({ type: "response.function_call_arguments.done", call_id: "old", name: "capture.note", arguments: '{"text":"late"}' }) });
    expect(state.queue).not.toHaveBeenCalled(); expect(state.channels[0]!.send).toHaveBeenCalledTimes(sent);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "session.error", code: "disconnected" }));
  });
  it("closes on configuration change before sending new text", async () => {
    const { value, settings } = await runtime(); const voice = await value.startVoice({ projectId: "p1", onEvent });
    settings.gatewayUrl = "https://other.example.test";
    expect(() => voice.sendText("Wrong endpoint")).toThrow(); expect(state.tracks[0]!.stop).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "session.error", code: "disconnected" }));
  });
  it("replaces a pending call without letting its late permission overlap a new call", async () => {
    const { value } = await runtime(); let grant!: (value: MediaStreamLike) => void;
    state.permission = () => new Promise(resolve => { grant = resolve; });
    const first = value.startVoice({ projectId: "p1", onEvent }); const rejected = expect(first).rejects.toThrow();
    await vi.waitFor(() => expect(grant).toBeTypeOf("function"));
    state.permission = null; const second = await value.startVoice({ projectId: "p1", onEvent });
    grant(stream()); await rejected; await Promise.resolve();
    expect(state.tracks[0]!.enabled).toBe(true); expect(state.tracks[1]!.stop).toHaveBeenCalledOnce();
    expect(state.fetch.mock.calls.filter(call => String(call[0]).endsWith("/sessions"))).toHaveLength(1); second.stop();
  });
  it("closes media after local access is locked in another window", async () => {
    const { value } = await runtime(); const locked = vi.fn(); const unsubscribe = value.subscribeLocalAccessLock(locked);
    await value.startVoice({ projectId: "p1", onEvent });
    state.keys.set("openauthor.mobile.local-access.v1", '{"version":1,"state":"locked"}');
    for (const listener of state.accessListeners) listener();
    await vi.waitFor(() => expect(locked).toHaveBeenCalledOnce());
    expect(state.tracks[0]!.stop).toHaveBeenCalledOnce(); unsubscribe();
  });
  it("refuses oversized selected context before opening media and permits a corrected new call", async () => {
    const { value } = await runtime(); state.snapshot!.scenes[0]!.body = "x".repeat(13_000);
    await expect(value.startVoice({ projectId: "p1", currentSceneId: "s1", onEvent })).rejects.toThrow("selected scene");
    expect(state.tracks).toHaveLength(0); expect(state.fetch).not.toHaveBeenCalled();
    state.snapshot!.scenes[0]!.body = "A short selected scene.";
    const voice = await value.startVoice({ projectId: "p1", currentSceneId: "s1", onEvent }); voice.stop();
  });
  it("reopening a snapshot retires an active call and a deliberate new call uses refreshed context", async () => {
    const { value } = await runtime(); const first = await value.startVoice({ projectId: "p1", currentSceneId: "s1", onEvent });
    state.snapshot!.scenes[0]!.body = "The published scene was refreshed.";
    await value.openProject("p1"); expect(state.tracks[0]!.stop).toHaveBeenCalledOnce();
    expect(() => first.sendText("Old context")).toThrow();
    const next = await value.startVoice({ projectId: "p1", currentSceneId: "s1", onEvent });
    expect(state.channels[1]!.send.mock.calls[0]![0]).toContain("published scene was refreshed"); next.stop();
  });
  it("author End makes one owned stop request while media closes immediately", async () => {
    const { value } = await runtime(); const voice = await value.startVoice({ projectId: "p1", onEvent });
    voice.stop(); expect(state.tracks[0]!.stop).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(state.fetch.mock.calls.filter(call => String(call[0]).endsWith("/stop"))).toHaveLength(1));
    voice.stop(); expect(state.tracks[0]!.stop).toHaveBeenCalledOnce();
  });
});
