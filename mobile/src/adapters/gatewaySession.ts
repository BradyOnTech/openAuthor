export type GatewaySessionInput = {
  gatewayUrl: string;
  projectId: string;
  deviceId: string;
  accessToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
};

export function gatewayNegotiator(input: GatewaySessionInput) {
  const url = new URL(input.gatewayUrl);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Session Gateway URL must use HTTPS outside localhost.");
  if (url.username || url.password || url.search || url.hash) throw new Error("Session Gateway URL is invalid.");
  return async (offerSdp: string, signal?: AbortSignal) => {
    const token = await input.accessToken();
    signal?.throwIfAborted();
    if (!token) throw new Error("Authentication is required for mobile voice.");
    const response = await (input.fetchImpl ?? fetch)(`${url.toString().replace(/\/$/, "")}/v1/realtime/sessions`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ project_id: input.projectId, device_id: input.deviceId, sdp: offerSdp }),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new Error(`Voice connection failed (${response.status}). Try again or check your account access.`);
    const body = await response.json() as { sdp?: unknown; call_id?: unknown; expires_at?: unknown };
    if (typeof body.sdp !== "string" || !body.sdp.trim() || typeof body.expires_at !== "string") throw new Error("Session Gateway returned an incomplete voice session.");
    return { answerSdp: body.sdp, callId: typeof body.call_id === "string" ? body.call_id : "", expiresAt: body.expires_at };
  };
}
