import {
  mediaDevices,
  RTCPeerConnection,
  RTCSessionDescription,
} from "react-native-webrtc";

import type {
  MediaStreamLike,
  MobileRealtimeDependencies,
  PeerConnectionLike,
} from "../voice/realtimeTransport";
import { gatewayNegotiator, type GatewaySessionInput } from "./gatewaySession";

export function gatewayRealtimeDependencies(input: GatewaySessionInput): MobileRealtimeDependencies {
  return {
    createPeerConnection: () => {
      const peer = new RTCPeerConnection();
      return {
        get ontrack() {
          return peer.ontrack as unknown as PeerConnectionLike["ontrack"];
        },
        set ontrack(handler: PeerConnectionLike["ontrack"]) {
          peer.ontrack = handler as typeof peer.ontrack;
        },
        addTrack: (track, stream) => {
          peer.addTrack(track as never, stream as never);
        },
        createDataChannel: (name) => peer.createDataChannel(name) as never,
        createOffer: async () => {
          const offer = await peer.createOffer();
          if (!offer.sdp) throw new Error("WebRTC did not produce a local offer.");
          return { type: "offer", sdp: offer.sdp };
        },
        setLocalDescription: async (description) => {
          if (!description.sdp) throw new Error("WebRTC local description has no SDP.");
          await peer.setLocalDescription({ type: "offer", sdp: description.sdp });
        },
        setRemoteDescription: async (description) => {
          await peer.setRemoteDescription(new RTCSessionDescription(description));
        },
        close: () => peer.close(),
      };
    },
    getUserMedia: async () => await mediaDevices.getUserMedia({
      audio: true,
      video: false,
    }) as unknown as MediaStreamLike,
    negotiate: gatewayNegotiator(input),
  };
}
