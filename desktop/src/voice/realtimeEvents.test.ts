import { describe, expect, it } from "vitest";
import { translateRealtimeEvent } from "./realtimeEvents";

describe("translateRealtimeEvent", () => {
  it("translates the current Realtime audio transcript lifecycle", () => {
    expect(
      translateRealtimeEvent({
        event_id: "evt-1",
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "user-item",
        transcript: "Where should Mara go?"
      })
    ).toEqual({
      providerEventId: "evt-1",
      type: "user.transcript.final",
      itemId: "user-item",
      text: "Where should Mara go?"
    });
    expect(
      translateRealtimeEvent({
        event_id: "evt-2",
        type: "response.output_audio_transcript.delta",
        item_id: "assistant-item",
        delta: "Toward the station."
      })
    ).toEqual({
      providerEventId: "evt-2",
      type: "assistant.transcript.delta",
      itemId: "assistant-item",
      text: "Toward the station."
    });
  });

  it("translates response, speech, tool, and error events without leaking unknown payloads", () => {
    expect(
      translateRealtimeEvent({ type: "input_audio_buffer.speech_started", item_id: "user-1" })
    ).toMatchObject({ type: "speech.started", itemId: "user-1" });
    expect(
      translateRealtimeEvent({
        type: "response.function_call_arguments.done",
        call_id: "call-1",
        name: "scene_get",
        arguments: '{"id":"scene-0001"}'
      })
    ).toMatchObject({ type: "tool.requested", callId: "call-1", name: "scene_get" });
    expect(
      translateRealtimeEvent({
        type: "error",
        error: { code: "invalid_value", message: "bad request", param: "type" },
        secret: "must not escape"
      })
    ).toEqual({
      providerEventId: "",
      type: "session.error",
      code: "invalid_value",
      message: "bad request",
      param: "type"
    });
  });

  it("returns null for media frames and unknown events", () => {
    expect(translateRealtimeEvent({ type: "response.output_audio.delta", delta: "base64" })).toBeNull();
    expect(translateRealtimeEvent({ type: "future.event", manuscript: "private" })).toBeNull();
  });
});
