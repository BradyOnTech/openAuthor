import { describe, expect, it, vi } from "vitest";
import { RealtimeTransport, type RealtimeTransportDependencies } from "./realtimeTransport";

describe("RealtimeTransport", () => {
  it("negotiates WebRTC through the trusted issuer and translates data events", async () => {
    const sent: string[] = [];
    const handlers: { message?: (event: { data: string }) => void } = {};
    const channel = {
      readyState: "open",
      send: (value: string) => sent.push(value),
      close: vi.fn(),
      addEventListener: (name: string, handler: (event: { data: string }) => void) => {
        if (name === "message") handlers.message = handler;
      }
    };
    const track = { enabled: true, stop: vi.fn() };
    const peer = {
      ontrack: null,
      addTrack: vi.fn(),
      createDataChannel: vi.fn(() => channel),
      createOffer: vi.fn(async () => ({ type: "offer" as const, sdp: "offer-sdp" })),
      setLocalDescription: vi.fn(async () => undefined),
      setRemoteDescription: vi.fn(async () => undefined),
      close: vi.fn()
    };
    const events: string[] = [];
    const deps: RealtimeTransportDependencies = {
      createPeerConnection: () => peer,
      getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })),
      createAudioSink: () => ({ autoplay: false, srcObject: null }),
      negotiate: vi.fn(async (offer) => {
        expect(offer).toBe("offer-sdp");
        return "answer-sdp";
      })
    };
    const transport = new RealtimeTransport(deps, (event) => events.push(event.type));

    await transport.start();
    expect(peer.createDataChannel).toHaveBeenCalledWith("oai-events");
    expect(peer.setRemoteDescription).toHaveBeenCalledWith({ type: "answer", sdp: "answer-sdp" });
    handlers.message?.({ data: JSON.stringify({ type: "session.created", session: { id: "session-1" } }) });
    expect(events).toEqual(["session.ready"]);

    transport.setMuted(true);
    expect(track.enabled).toBe(false);
    transport.sendToolOutput("call-1", { title: "Opening" });
    expect(JSON.parse(sent[0])).toMatchObject({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: "call-1" }
    });
    expect(JSON.parse(sent[1])).toEqual({ type: "response.create" });
    transport.stop();
    expect(track.stop).toHaveBeenCalled();
    expect(peer.close).toHaveBeenCalled();
  });
});
