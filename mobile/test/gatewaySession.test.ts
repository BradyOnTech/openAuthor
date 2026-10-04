import { describe, expect, it, vi } from "vitest";
import { gatewayNegotiator, gatewayVoicePolicy } from "../src/adapters/gatewaySession";

const leaseId = "11111111-1111-4111-8111-111111111111";
function session() {
  return { sdp: "answer", call_id: "call", lease_id: leaseId,
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    lease_expires_at: new Date(Date.now() + 30_000).toISOString(), renew_after_ms: 10_000 };
}

describe("shared mobile voice negotiation", () => {
  it("sends only session-bound identity and SDP, with cancellation", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(session())));
    const abort = new AbortController();
    const negotiate = gatewayNegotiator({ gatewayUrl: "https://voice.example.test", projectId: "p1", deviceId: "d1", accessToken: async () => "test-access", fetchImpl });
    expect(await negotiate("offer", abort.signal)).toMatchObject({ answerSdp: "answer", callId: "call" });
    expect(fetchImpl).toHaveBeenCalledWith("https://voice.example.test/v1/realtime/sessions", expect.objectContaining({ signal: abort.signal, body: JSON.stringify({ project_id: "p1", device_id: "d1", sdp: "offer" }) }));
    abort.abort();
    await expect(negotiate("offer", abort.signal)).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["missing lease", { lease_id: undefined }], ["invalid lease", { lease_id: "../../another" }],
    ["missing call", { call_id: "" }], ["expired hard deadline", { expires_at: "2020-01-01T00:00:00Z" }],
    ["expired lease", { lease_expires_at: "2020-01-01T00:00:00Z" }],
    ["invalid renewal interval", { renew_after_ms: "10000" }],
    ["lease beyond hard deadline", { lease_expires_at: "2099-01-01T00:00:00Z" }],
  ])("refuses %s before opening voice without policy", async (_name, changed) => {
    const negotiate = gatewayNegotiator({ gatewayUrl: "https://voice.example.test", projectId: "p1", deviceId: "d1",
      accessToken: async () => "token", fetchImpl: async () => new Response(JSON.stringify({ ...session(), ...changed })) });
    await expect(negotiate("offer")).rejects.toThrow(/policy|incomplete/i);
  });
  it("rejects insecure endpoints and does not display raw backend failure bodies", async () => {
    const input = { gatewayUrl: "http://192.168.1.10", projectId: "p1", deviceId: "d1", accessToken: async () => "test-access" };
    expect(() => gatewayNegotiator(input)).toThrow("HTTPS");
    const negotiate = gatewayNegotiator({ ...input, gatewayUrl: "https://voice.example.test", fetchImpl: async () => new Response("private provider error body", { status: 502 }) });
    await expect(negotiate("offer")).rejects.toThrow("Voice connection failed (502)");
  });
  it("renews and stops only the reviewed lease with current scope-bound credentials", async () => {
    let token = 0;
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init?.body).toBe(JSON.stringify({ project_id: "p1", device_id: "d1" }));
      return new Response(JSON.stringify(String(_url).endsWith("/stop") ? { stopped: true } : session()));
    });
    const policy = gatewayVoicePolicy({ gatewayUrl: "https://voice.example.test", projectId: "p1", deviceId: "d1",
      accessToken: async () => `fresh-${++token}`, fetchImpl });
    const abort = new AbortController();
    expect(await policy.renew(leaseId, abort.signal)).toMatchObject({ leaseId });
    await policy.stop(leaseId, abort.signal);
    expect(fetchImpl.mock.calls.map(row => row[1]?.headers)).toEqual([
      { authorization: "Bearer fresh-1", "content-type": "application/json" },
      { authorization: "Bearer fresh-2", "content-type": "application/json" },
    ]);
    expect(fetchImpl.mock.calls.map(row => row[0])).toEqual([
      `https://voice.example.test/v1/realtime/sessions/${leaseId}/renew`, `https://voice.example.test/v1/realtime/sessions/${leaseId}/stop`,
    ]);
    abort.abort(); await expect(policy.renew(leaseId, abort.signal)).rejects.toThrow(); expect(token).toBe(2);
  });
  it("does not display a rejected policy response body or acknowledge malformed stop", async () => {
    const base = { gatewayUrl: "https://voice.example.test", projectId: "p1", deviceId: "d1", accessToken: async () => "token" };
    const abort = new AbortController();
    await expect(gatewayVoicePolicy({ ...base, fetchImpl: async () => new Response("private", { status: 403 }) }).renew(leaseId, abort.signal)).rejects.toThrow("(403)");
    await expect(gatewayVoicePolicy({ ...base, fetchImpl: async () => new Response("{}") }).stop(leaseId, abort.signal)).rejects.toThrow("could not be confirmed");
  });
});
