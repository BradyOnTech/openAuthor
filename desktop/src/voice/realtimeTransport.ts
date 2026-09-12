import { translateRealtimeEvent, type VoiceRealtimeEvent } from "./realtimeEvents";

export type MediaTrackLike = {
  enabled: boolean;
  stop(): void;
};

export type MediaStreamLike = {
  getTracks(): MediaTrackLike[];
};

export type DataChannelLike = {
  readyState: string;
  send(value: string): void;
  close(): void;
  addEventListener(name: "message", handler: (event: { data: string }) => void): void;
};

export type PeerConnectionLike = {
  ontrack: ((event: { streams: MediaStreamLike[] }) => void) | null;
  addTrack(track: MediaTrackLike, stream?: MediaStreamLike): void;
  createDataChannel(name: string): DataChannelLike;
  createOffer(): Promise<{ type: "offer"; sdp?: string }>;
  setLocalDescription(description: { type: "offer"; sdp?: string }): Promise<void>;
  setRemoteDescription(description: { type: "answer"; sdp: string }): Promise<void>;
  close(): void;
};

export type AudioSinkLike = {
  autoplay: boolean;
  srcObject: MediaStreamLike | null;
};

export type RealtimeTransportDependencies = {
  createPeerConnection(): PeerConnectionLike;
  getUserMedia(): Promise<MediaStreamLike>;
  createAudioSink(): AudioSinkLike;
  negotiate(offerSdp: string): Promise<string>;
};

export function browserRealtimeDependencies(
  negotiate: (offerSdp: string) => Promise<string>
): RealtimeTransportDependencies {
  return {
    createPeerConnection: () => new RTCPeerConnection() as unknown as PeerConnectionLike,
    getUserMedia: async () =>
      (await navigator.mediaDevices.getUserMedia({ audio: true })) as unknown as MediaStreamLike,
    createAudioSink: () => {
      const audio = document.createElement("audio");
      audio.autoplay = true;
      return audio as unknown as AudioSinkLike;
    },
    negotiate
  };
}

export class RealtimeTransport {
  private peer: PeerConnectionLike | null = null;
  private channel: DataChannelLike | null = null;
  private microphone: MediaStreamLike | null = null;
  private audio: AudioSinkLike | null = null;

  constructor(
    private readonly dependencies: RealtimeTransportDependencies,
    private readonly onEvent: (event: VoiceRealtimeEvent) => void
  ) {}

  async start(): Promise<void> {
    if (this.peer !== null) throw new Error("Realtime transport is already started.");
    const peer = this.dependencies.createPeerConnection();
    const audio = this.dependencies.createAudioSink();
    audio.autoplay = true;
    peer.ontrack = (event) => {
      audio.srcObject = event.streams[0] ?? null;
    };
    const microphone = await this.dependencies.getUserMedia();
    const track = microphone.getTracks()[0];
    if (!track) {
      peer.close();
      throw new Error("No microphone audio track is available.");
    }
    peer.addTrack(track, microphone);
    const channel = peer.createDataChannel("oai-events");
    channel.addEventListener("message", (message) => {
      try {
        const translated = translateRealtimeEvent(JSON.parse(message.data));
        if (translated) this.onEvent(translated);
      } catch {
        // Malformed or future provider events are ignored at the transport seam.
      }
    });
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    const offerSdp = offer.sdp?.trim() ?? "";
    if (offerSdp === "") {
      track.stop();
      peer.close();
      throw new Error("WebRTC did not produce an SDP offer.");
    }
    const answerSdp = await this.dependencies.negotiate(offerSdp);
    await peer.setRemoteDescription({ type: "answer", sdp: answerSdp });
    this.peer = peer;
    this.channel = channel;
    this.microphone = microphone;
    this.audio = audio;
  }

  setMuted(muted: boolean): void {
    for (const track of this.microphone?.getTracks() ?? []) track.enabled = !muted;
  }

  send(event: Record<string, unknown>): void {
    if (this.channel?.readyState !== "open") {
      throw new Error("Realtime event channel is not open.");
    }
    this.channel.send(JSON.stringify(event));
  }

  sendToolOutput(callId: string, output: unknown): void {
    this.send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(output)
      }
    });
    this.send({ type: "response.create" });
  }

  interrupt(): void {
    this.send({ type: "response.cancel" });
  }

  stop(): void {
    for (const track of this.microphone?.getTracks() ?? []) track.stop();
    this.channel?.close();
    this.peer?.close();
    if (this.audio) this.audio.srcObject = null;
    this.peer = null;
    this.channel = null;
    this.microphone = null;
    this.audio = null;
  }
}
