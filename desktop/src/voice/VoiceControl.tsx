import { useReducer, useRef, useState } from "react";
import {
  handleVoiceTool,
  negotiateVoiceSession,
  prepareVoiceContext,
  recordVoiceTurn
} from "../api";
import { browserRealtimeDependencies, RealtimeTransport } from "./realtimeTransport";
import type { VoiceRealtimeEvent } from "./realtimeEvents";
import { initialVoiceSession, reduceVoiceSession } from "./voiceSession";

type VoiceControlProps = {
  projectRoot: string;
  threadId: string;
  currentSceneId?: string;
  onRecorded: () => Promise<void> | void;
  setError: (message: string) => void;
  setMessage: (message: string) => void;
};

function newTurnId(): string {
  return `turn-${crypto.randomUUID()}`;
}

export function VoiceControl({
  projectRoot,
  threadId,
  currentSceneId,
  onRecorded,
  setError,
  setMessage
}: VoiceControlProps) {
  const [state, dispatch] = useReducer(reduceVoiceSession, undefined, initialVoiceSession);
  const [busy, setBusy] = useState(false);
  const [contextPackId, setContextPackId] = useState("");
  const transportRef = useRef<RealtimeTransport | null>(null);
  const contextPackRef = useRef("");
  const modelRef = useRef("gpt-realtime");
  const sessionIdRef = useRef("");
  const userTranscriptRef = useRef("");
  const assistantTranscriptRef = useRef("");
  const recordingRef = useRef(false);

  async function persistCompletedTurn(event: VoiceRealtimeEvent): Promise<void> {
    if (event.type !== "response.completed" || recordingRef.current) return;
    const userTranscript = userTranscriptRef.current.trim();
    const assistantTranscript = assistantTranscriptRef.current.trim();
    if (!userTranscript || !assistantTranscript || !contextPackRef.current) return;
    recordingRef.current = true;
    try {
      await recordVoiceTurn(projectRoot, {
        threadId,
        turnId: newTurnId(),
        voiceSessionId: sessionIdRef.current,
        userTranscript,
        assistantTranscript,
        contextPackId: contextPackRef.current,
        providerEventId: event.providerEventId,
        model: modelRef.current
      });
      await onRecorded();
    } catch (error) {
      setError(`Voice turn could not be saved: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      recordingRef.current = false;
      userTranscriptRef.current = "";
      assistantTranscriptRef.current = "";
    }
  }

  async function handleRealtimeEvent(event: VoiceRealtimeEvent): Promise<void> {
    dispatch(event);
    if (event.type === "session.ready") sessionIdRef.current = event.sessionId;
    if (event.type === "user.transcript.delta") userTranscriptRef.current += event.text;
    if (event.type === "user.transcript.final") userTranscriptRef.current = event.text;
    if (event.type === "assistant.transcript.delta") assistantTranscriptRef.current += event.text;
    if (event.type === "assistant.transcript.final") assistantTranscriptRef.current = event.text;
    if (event.type === "tool.requested") {
      const outcome = await handleVoiceTool(projectRoot, {
        threadId,
        callId: event.callId,
        name: event.name,
        arguments: event.arguments ?? {}
      });
      transportRef.current?.sendToolOutput(event.callId, outcome);
    }
    await persistCompletedTurn(event);
  }

  async function start(): Promise<void> {
    if (busy || transportRef.current) return;
    setBusy(true);
    dispatch({ type: "start", sessionId: "" });
    try {
      const prepared = await prepareVoiceContext(projectRoot, {
        threadId,
        currentSceneId
      });
      const packId = prepared.context_pack.pack_id;
      contextPackRef.current = packId;
      setContextPackId(packId);
      const transport = new RealtimeTransport(
        browserRealtimeDependencies(async (offerSdp) => {
          const negotiated = await negotiateVoiceSession(projectRoot, {
            offerSdp,
            contextPackId: packId
          });
          modelRef.current = negotiated.model;
          return negotiated.answer_sdp;
        }),
        (event) => void handleRealtimeEvent(event)
      );
      transportRef.current = transport;
      await transport.start();
      setMessage("Voice connected. Speak naturally; changes remain approval-gated.");
    } catch (error) {
      transportRef.current?.stop();
      transportRef.current = null;
      dispatch({
        type: "session.error",
        providerEventId: "",
        code: error instanceof DOMException ? error.name : "voice_start_failed",
        message: error instanceof Error ? error.message : String(error),
        param: ""
      });
      setError(`Voice could not start: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function end(): void {
    transportRef.current?.stop();
    transportRef.current = null;
    sessionIdRef.current = "";
    dispatch({ type: "end" });
  }

  const active = !["idle", "ended", "error"].includes(state.status);
  return (
    <div
      aria-label="Voice assistant controls"
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        padding: "8px 12px",
        borderTop: "1px solid var(--border)",
        color: "var(--text-secondary)",
        fontSize: "var(--text-xs)"
      }}
    >
      {!active ? (
        <button className="btn btn--sm" disabled={busy || !threadId} onClick={() => void start()}>
          {busy ? "Connecting…" : "Start voice"}
        </button>
      ) : (
        <>
          <button
            className="btn btn--sm"
            onClick={() => {
              const muted = !state.muted;
              transportRef.current?.setMuted(muted);
              dispatch({ type: "mute.changed", muted });
            }}
          >
            {state.muted ? "Unmute" : "Mute"}
          </button>
          <button className="btn btn--sm" onClick={() => transportRef.current?.interrupt()}>
            Interrupt
          </button>
          <button className="btn btn--sm" onClick={end}>End</button>
        </>
      )}
      <span>{state.status}</span>
      {state.userTranscript && <span title={state.userTranscript}>You: {state.userTranscript.slice(-42)}</span>}
      {state.assistantTranscript && (
        <span title={state.assistantTranscript}>Assistant: {state.assistantTranscript.slice(-42)}</span>
      )}
      {contextPackId && <span title={contextPackId}>context {contextPackId.slice(-8)}</span>}
    </div>
  );
}
