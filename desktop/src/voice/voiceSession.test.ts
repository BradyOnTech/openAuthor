import { describe, expect, it } from "vitest";
import { initialVoiceSession, reduceVoiceSession, type VoiceSessionState } from "./voiceSession";

describe("voice session state", () => {
  it("follows connect, listen, think, speak, and settle states", () => {
    let state = reduceVoiceSession(initialVoiceSession(), { type: "start", sessionId: "voice-1" });
    expect(state.status).toBe("connecting");
    state = reduceVoiceSession(state, { type: "session.ready", providerEventId: "evt-1", sessionId: "voice-1" });
    expect(state.status).toBe("listening");
    state = reduceVoiceSession(state, { type: "speech.stopped", providerEventId: "evt-2", itemId: "user-1" });
    expect(state.status).toBe("thinking");
    state = reduceVoiceSession(state, { type: "response.started", providerEventId: "evt-3", responseId: "response-1" });
    state = reduceVoiceSession(state, {
      type: "assistant.transcript.delta",
      providerEventId: "evt-4",
      itemId: "assistant-1",
      text: "Try the station."
    });
    expect(state.status).toBe("speaking");
    expect(state.assistantTranscript).toBe("Try the station.");
    state = reduceVoiceSession(state, { type: "response.completed", providerEventId: "evt-5", responseId: "response-1" });
    expect(state.status).toBe("listening");
  });

  it("supports barge-in, mute, terminal errors, and end", () => {
    let state: VoiceSessionState = {
      ...initialVoiceSession(),
      sessionId: "voice-1",
      status: "speaking" as const,
      responseId: "response-1"
    };
    state = reduceVoiceSession(state, { type: "speech.started", providerEventId: "evt-1", itemId: "user-2" });
    expect(state.status).toBe("listening");
    expect(state.interruptedResponseId).toBe("response-1");
    state = reduceVoiceSession(state, { type: "mute.changed", muted: true });
    expect(state.muted).toBe(true);
    state = reduceVoiceSession(state, {
      type: "session.error",
      providerEventId: "evt-2",
      code: "network",
      message: "lost",
      param: ""
    });
    expect(state.status).toBe("error");
    state = reduceVoiceSession(state, { type: "end" });
    expect(state.status).toBe("ended");
  });
});
