import type { VoiceRealtimeEvent } from "./realtimeEvents";

export type VoiceSessionStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error"
  | "ended";

export type VoiceSessionState = {
  sessionId: string;
  status: VoiceSessionStatus;
  muted: boolean;
  userTranscript: string;
  assistantTranscript: string;
  responseId: string;
  interruptedResponseId: string;
  error: { code: string; message: string } | null;
};

export type VoiceSessionAction =
  | { type: "start"; sessionId: string }
  | { type: "mute.changed"; muted: boolean }
  | { type: "end" }
  | VoiceRealtimeEvent;

export function initialVoiceSession(): VoiceSessionState {
  return {
    sessionId: "",
    status: "idle",
    muted: false,
    userTranscript: "",
    assistantTranscript: "",
    responseId: "",
    interruptedResponseId: "",
    error: null
  };
}

export function reduceVoiceSession(
  state: VoiceSessionState,
  action: VoiceSessionAction
): VoiceSessionState {
  if (action.type === "start") {
    return { ...initialVoiceSession(), sessionId: action.sessionId, status: "connecting" };
  }
  if (action.type === "mute.changed") return { ...state, muted: action.muted };
  if (action.type === "end") return { ...state, status: "ended" };
  if (action.type === "session.ready" || action.type === "session.updated") {
    return {
      ...state,
      sessionId: action.sessionId || state.sessionId,
      status: "listening",
      error: null
    };
  }
  if (action.type === "speech.started") {
    return {
      ...state,
      status: "listening",
      userTranscript: "",
      interruptedResponseId: state.status === "speaking" ? state.responseId : state.interruptedResponseId
    };
  }
  if (action.type === "speech.stopped") return { ...state, status: "thinking" };
  if (action.type === "user.transcript.delta") {
    return { ...state, userTranscript: state.userTranscript + action.text };
  }
  if (action.type === "user.transcript.final") {
    return { ...state, userTranscript: action.text, status: "thinking" };
  }
  if (action.type === "response.started") {
    return {
      ...state,
      responseId: action.responseId,
      assistantTranscript: "",
      status: "thinking"
    };
  }
  if (action.type === "assistant.transcript.delta") {
    return {
      ...state,
      assistantTranscript: state.assistantTranscript + action.text,
      status: "speaking"
    };
  }
  if (action.type === "assistant.transcript.final") {
    return { ...state, assistantTranscript: action.text, status: "speaking" };
  }
  if (action.type === "response.completed" || action.type === "response.cancelled") {
    return { ...state, status: "listening", responseId: "" };
  }
  if (action.type === "response.failed") {
    return { ...state, status: "error", error: { code: "response_failed", message: "Voice response failed." } };
  }
  if (action.type === "session.error") {
    return { ...state, status: "error", error: { code: action.code, message: action.message } };
  }
  return state;
}
