import type { MobileRealtimeDependencies, PeerConnectionLike } from "../voice/realtimeTransport";
import { gatewayNegotiator, type GatewaySessionInput } from "./gatewaySession";

export function gatewayRealtimeDependencies(input: GatewaySessionInput): MobileRealtimeDependencies {
  if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia || !globalThis.RTCPeerConnection) {
    throw new Error("Voice requires an HTTPS connection and a browser with microphone support.");
  }
  const audio = document.createElement("audio");
  audio.autoplay = true;
  audio.setAttribute("playsinline", "");
  let peer: RTCPeerConnection | null = null;
  return {
    createPeerConnection: () => {
      peer = new RTCPeerConnection();
      return peer as unknown as PeerConnectionLike;
    },
    getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }),
    negotiate: gatewayNegotiator(input),
    playRemote: async (stream) => {
      audio.srcObject = stream as MediaStream;
      try { await audio.play(); }
      catch { throw new Error("Your browser blocked voice playback. Tap Start voice to try again."); }
    },
    cleanup: () => { audio.pause(); audio.srcObject = null; peer = null; },
  };
}
