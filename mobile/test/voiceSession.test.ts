import { describe, expect, it } from "vitest";

import {
  initialVoiceSession,
  reduceVoiceSession,
} from "../src/voice/voiceSession";

describe("mobile voice session state", () => {
  it("tracks transcripts and natural interruption without losing the interrupted response identity", () => {
    let state = reduceVoiceSession(initialVoiceSession(), { type: "start", callId: "call-1" });
    state = reduceVoiceSession(state, {
      providerEventId: "event-1",
      type: "session.ready",
      sessionId: "session-1",
    });
    state = reduceVoiceSession(state, {
      providerEventId: "event-2",
      type: "response.started",
      responseId: "response-1",
    });
    state = reduceVoiceSession(state, {
      providerEventId: "event-3",
      type: "assistant.transcript.delta",
      itemId: "assistant-1",
      text: "Mara is ",
    });
    state = reduceVoiceSession(state, {
      providerEventId: "event-4",
      type: "speech.started",
      itemId: "user-2",
    });
    state = reduceVoiceSession(state, {
      providerEventId: "event-5",
      type: "user.transcript.final",
      itemId: "user-2",
      text: "Stop, which tower?",
    });

    expect(state.status).toBe("thinking");
    expect(state.interruptedResponseId).toBe("response-1");
    expect(state.userTranscript).toBe("Stop, which tower?");
    expect(state.assistantTranscript).toBe("Mara is ");
  });
});
