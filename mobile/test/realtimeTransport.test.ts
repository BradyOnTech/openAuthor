import { describe, expect, it, vi } from "vitest";

import {
  MobileRealtimeTransport,
  type DataChannelLike,
  type MobileRealtimeDependencies,
} from "../src/voice/realtimeTransport";

describe("MobileRealtimeTransport", () => {
  it("waits for the data channel and stops playback resources on a disconnect", async () => {
    const channel: DataChannelLike = { readyState: "connecting", send: vi.fn(), close: vi.fn(), addEventListener: vi.fn() };
    const track = { enabled: true, stop: vi.fn() };
    const peer = { ontrack: null, addTrack: vi.fn(), createDataChannel: () => channel,
      createOffer: async () => ({ type: "offer" as const, sdp: "offer" }),
      setLocalDescription: async () => undefined, setRemoteDescription: async () => undefined, close: vi.fn() };
    const cleanup = vi.fn();
    const events = vi.fn();
    const transport = new MobileRealtimeTransport({ createPeerConnection: () => peer,
      getUserMedia: async () => ({ getTracks: () => [track] }), cleanup,
      negotiate: async () => ({ answerSdp: "answer", callId: "call", expiresAt: "later" }) }, events);
    const starting = transport.start();
    await vi.waitFor(() => expect(channel.onopen).toBeTypeOf("function"));
    expect(track.enabled).toBe(false);
    expect(() => transport.sendText("Too soon")).toThrow("not open");
    channel.readyState = "open";
    channel.onopen?.();
    await starting;
    channel.onclose?.();
    expect(events).toHaveBeenCalledWith(expect.objectContaining({ type: "session.error", code: "disconnected" }));
    expect(track.stop).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("times out unanswered microphone permission without keeping the caller waiting", async () => {
    vi.useFakeTimers();
    try {
      let grant!: (stream: { getTracks(): Array<{ enabled: boolean; stop(): void }> }) => void;
      const track = { enabled: true, stop: vi.fn() };
      const peer = { ontrack: null, addTrack: vi.fn(), createDataChannel: vi.fn(),
        createOffer: vi.fn(), setLocalDescription: vi.fn(), setRemoteDescription: vi.fn(), close: vi.fn() };
      const transport = new MobileRealtimeTransport({ createPeerConnection: () => peer,
        getUserMedia: () => new Promise((resolve) => { grant = resolve; }), negotiate: vi.fn() }, vi.fn());
      const rejected = expect(transport.start()).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(30_000);
      await rejected;
      grant({ getTracks: () => [track] });
      await Promise.resolve();
      expect(track.stop).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it("stops a microphone that arrives after the author cancelled permission setup", async () => {
    let grant!: (stream: { getTracks(): Array<{ enabled: boolean; stop(): void }> }) => void;
    const track = { enabled: true, stop: vi.fn() };
    const channel = { readyState: "open", send: vi.fn(), close: vi.fn(), addEventListener: vi.fn() };
    const peer = { ontrack: null, addTrack: vi.fn(), createDataChannel: () => channel,
      createOffer: async () => ({ type: "offer" as const, sdp: "offer" }),
      setLocalDescription: async () => undefined, setRemoteDescription: async () => undefined, close: vi.fn() };
    const negotiate = vi.fn(async () => ({ answerSdp: "answer", callId: "call", expiresAt: "later" }));
    const transport = new MobileRealtimeTransport({ createPeerConnection: () => peer,
      getUserMedia: () => new Promise((resolve) => { grant = resolve; }), negotiate }, vi.fn());
    const starting = transport.start();
    const rejected = expect(starting).rejects.toThrow();
    transport.stop();
    grant({ getTracks: () => [track] });
    await rejected;
    expect(track.stop).toHaveBeenCalledOnce();
    expect(negotiate).not.toHaveBeenCalled();
  });
  it("negotiates through the authenticated gateway and cleans up microphone, channel, and peer", async () => {
    const sent: string[] = [];
    const handlers: { message?: (event: { data: string }) => void } = {};
    const channel = {
      readyState: "open",
      send: (value: string) => sent.push(value),
      close: vi.fn(),
      addEventListener: (_name: "message", handler: (event: { data: string }) => void) => {
        handlers.message = handler;
      },
    };
    const track = { enabled: true, stop: vi.fn() };
    const peer = {
      ontrack: null,
      addTrack: vi.fn(),
      createDataChannel: vi.fn(() => channel),
      createOffer: vi.fn(async () => ({ type: "offer" as const, sdp: "mobile-offer" })),
      setLocalDescription: vi.fn(async () => undefined),
      setRemoteDescription: vi.fn(async () => undefined),
      close: vi.fn(),
    };
    const events: string[] = [];
    const dependencies: MobileRealtimeDependencies = {
      createPeerConnection: () => peer,
      getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })),
      negotiate: vi.fn(async (offer) => {
        expect(offer).toBe("mobile-offer");
        return { answerSdp: "mobile-answer", callId: "call-1", expiresAt: "soon" };
      }),
    };
    const transport = new MobileRealtimeTransport(dependencies, (event) => events.push(event.type));

    expect(await transport.start()).toEqual({ callId: "call-1", expiresAt: "soon" });
    handlers.message?.({
      data: JSON.stringify({
        event_id: "event-1",
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "item-1",
        transcript: "Where is Mara?",
      }),
    });
    expect(events).toEqual(["user.transcript.final"]);

    transport.setMuted(true);
    expect(track.enabled).toBe(false);
    transport.sendToolOutput("call-tool", { scenes: [] });
    expect(JSON.parse(sent[0]!)).toMatchObject({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: "call-tool" },
    });
    transport.sendText("Can Mara trust Elias?");
    expect(JSON.parse(sent[2]!)).toMatchObject({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text: "Can Mara trust Elias?" }] },
    });
    transport.interrupt();
    expect(JSON.parse(sent[4]!)).toEqual({ type: "response.cancel" });

    transport.stop();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(channel.close).toHaveBeenCalledOnce();
    expect(peer.close).toHaveBeenCalledOnce();
  });
});
