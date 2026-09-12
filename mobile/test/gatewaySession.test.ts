import { describe, expect, it, vi } from "vitest";
import { gatewayNegotiator } from "../src/adapters/gatewaySession";

describe("shared mobile voice negotiation", () => {
  it("sends only session-bound identity and SDP, with cancellation", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ sdp: "answer", call_id: "call", expires_at: "2026-09-07T18:00:00Z" })));
    const abort = new AbortController();
    const negotiate = gatewayNegotiator({ gatewayUrl: "https://voice.example.test", projectId: "p1", deviceId: "d1", accessToken: async () => "test-access", fetchImpl });
    expect(await negotiate("offer", abort.signal)).toMatchObject({ answerSdp: "answer", callId: "call" });
    expect(fetchImpl).toHaveBeenCalledWith("https://voice.example.test/v1/realtime/sessions", expect.objectContaining({ signal: abort.signal, body: JSON.stringify({ project_id: "p1", device_id: "d1", sdp: "offer" }) }));
    abort.abort();
    await expect(negotiate("offer", abort.signal)).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("rejects insecure endpoints and does not display raw backend failure bodies", async () => {
    const input = { gatewayUrl: "http://192.168.1.10", projectId: "p1", deviceId: "d1", accessToken: async () => "test-access" };
    expect(() => gatewayNegotiator(input)).toThrow("HTTPS");
    const negotiate = gatewayNegotiator({ ...input, gatewayUrl: "https://voice.example.test", fetchImpl: async () => new Response("private provider error body", { status: 502 }) });
    await expect(negotiate("offer")).rejects.toThrow("Voice connection failed (502)");
  });
});
