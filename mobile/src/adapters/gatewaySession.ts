import { readVoiceLease } from "../voice/voiceLease";

export type GatewaySessionInput = {
  gatewayUrl: string;
  projectId: string;
  deviceId: string;
  accessToken: () => Promise<string>;
  stopAccessToken?: () => Promise<string>;
  fetchImpl?: typeof fetch;
};

function gatewayUrl(input: GatewaySessionInput): string {
  const url = new URL(input.gatewayUrl);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Session Gateway URL must use HTTPS outside localhost.");
  if (url.username || url.password || url.search || url.hash) throw new Error("Session Gateway URL is invalid.");
  return url.toString().replace(/\/$/, "");
}

export function gatewayNegotiator(input: GatewaySessionInput) {
  const url = gatewayUrl(input);
  return async (offerSdp: string, signal?: AbortSignal) => {
    const token = await input.accessToken();
    signal?.throwIfAborted();
    if (!token) throw new Error("Authentication is required for mobile voice.");
    const response = await (input.fetchImpl ?? fetch)(`${url}/v1/realtime/sessions`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ project_id: input.projectId, device_id: input.deviceId, sdp: offerSdp }),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new Error(`Voice connection failed (${response.status}). Try again or check your account access.`);
    const body = await response.json() as { sdp?: unknown; call_id?: unknown };
    signal?.throwIfAborted();
    if (!body || typeof body.sdp !== "string" || !body.sdp.trim() || typeof body.call_id !== "string" || !body.call_id.trim()) throw new Error("Session Gateway returned an incomplete voice session.");
    return { answerSdp: body.sdp, callId: body.call_id, ...readVoiceLease(body) };
  };
}

export function gatewayVoicePolicy(input: GatewaySessionInput) {
  const url = gatewayUrl(input);
  const request = async (leaseId: string, action: "renew" | "stop", signal: AbortSignal) => {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(leaseId)) throw new Error("Voice policy identity is invalid.");
    signal.throwIfAborted();
    const token = await (action === "stop" ? input.stopAccessToken ?? input.accessToken : input.accessToken)();
    signal.throwIfAborted();
    if (!token) throw new Error("Authentication is required for mobile voice.");
    const response = await (input.fetchImpl ?? fetch)(`${url}/v1/realtime/sessions/${leaseId}/${action}`, {
      method: "POST", signal,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ project_id: input.projectId, device_id: input.deviceId }),
    });
    if (!response.ok) throw new Error(`Voice policy ${action} could not be confirmed (${response.status}).`);
    const body: unknown = await response.json();
    signal.throwIfAborted();
    return body;
  };
  return {
    renew: async (leaseId: string, signal: AbortSignal) => readVoiceLease(await request(leaseId, "renew", signal)),
    stop: async (leaseId: string, signal: AbortSignal): Promise<void> => {
      const value = await request(leaseId, "stop", signal);
      if (!value || typeof value !== "object" || Array.isArray(value) || (value as Record<string, unknown>).stopped !== true) {
        throw new Error("Remote voice closure could not be confirmed. The gateway lease remains responsible for closure.");
      }
    },
  };
}
