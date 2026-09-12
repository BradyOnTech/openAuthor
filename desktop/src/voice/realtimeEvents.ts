export type VoiceRealtimeEvent =
  | { providerEventId: string; type: "session.ready"; sessionId: string }
  | { providerEventId: string; type: "session.updated"; sessionId: string }
  | { providerEventId: string; type: "speech.started"; itemId: string }
  | { providerEventId: string; type: "speech.stopped"; itemId: string }
  | {
      providerEventId: string;
      type: "user.transcript.delta" | "user.transcript.final";
      itemId: string;
      text: string;
    }
  | {
      providerEventId: string;
      type: "assistant.transcript.delta" | "assistant.transcript.final";
      itemId: string;
      text: string;
    }
  | { providerEventId: string; type: "response.started"; responseId: string }
  | {
      providerEventId: string;
      type: "response.completed" | "response.cancelled" | "response.failed";
      responseId: string;
    }
  | {
      providerEventId: string;
      type: "tool.requested";
      callId: string;
      name: string;
      arguments: Record<string, unknown> | null;
      argumentsJson: string;
    }
  | {
      providerEventId: string;
      type: "session.error";
      code: string;
      message: string;
      param: string;
    };

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" ? (value as UnknownRecord) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function eventId(event: UnknownRecord): string {
  return text(event.event_id);
}

function transcriptEvent(
  event: UnknownRecord,
  type:
    | "user.transcript.delta"
    | "user.transcript.final"
    | "assistant.transcript.delta"
    | "assistant.transcript.final",
  value: unknown
): VoiceRealtimeEvent {
  return {
    providerEventId: eventId(event),
    type,
    itemId: text(event.item_id),
    text: text(value)
  };
}

export function translateRealtimeEvent(raw: unknown): VoiceRealtimeEvent | null {
  const event = record(raw);
  const type = text(event.type);
  const providerEventId = eventId(event);
  if (type === "session.created" || type === "session.updated") {
    const session = record(event.session);
    return {
      providerEventId,
      type: type === "session.created" ? "session.ready" : "session.updated",
      sessionId: text(session.id)
    };
  }
  if (type === "input_audio_buffer.speech_started") {
    return { providerEventId, type: "speech.started", itemId: text(event.item_id) };
  }
  if (type === "input_audio_buffer.speech_stopped") {
    return { providerEventId, type: "speech.stopped", itemId: text(event.item_id) };
  }
  if (type === "conversation.item.input_audio_transcription.delta") {
    return transcriptEvent(event, "user.transcript.delta", event.delta);
  }
  if (type === "conversation.item.input_audio_transcription.completed") {
    return transcriptEvent(event, "user.transcript.final", event.transcript);
  }
  if (type === "response.output_audio_transcript.delta" || type === "response.output_text.delta") {
    return transcriptEvent(event, "assistant.transcript.delta", event.delta);
  }
  if (type === "response.output_audio_transcript.done") {
    return transcriptEvent(event, "assistant.transcript.final", event.transcript);
  }
  if (type === "response.output_text.done") {
    return transcriptEvent(event, "assistant.transcript.final", event.text);
  }
  if (type === "response.created") {
    return {
      providerEventId,
      type: "response.started",
      responseId: text(record(event.response).id)
    };
  }
  if (type === "response.done") {
    const response = record(event.response);
    const status = text(response.status);
    const finalType =
      status === "cancelled"
        ? "response.cancelled"
        : status === "failed"
          ? "response.failed"
          : "response.completed";
    return { providerEventId, type: finalType, responseId: text(response.id) };
  }
  if (type === "response.function_call_arguments.done") {
    const argumentsJson = text(event.arguments);
    let args: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(argumentsJson);
      args = record(parsed);
    } catch {
      args = null;
    }
    return {
      providerEventId,
      type: "tool.requested",
      callId: text(event.call_id),
      name: text(event.name),
      arguments: args,
      argumentsJson
    };
  }
  if (type === "error") {
    const error = record(event.error);
    return {
      providerEventId,
      type: "session.error",
      code: text(error.code),
      message: text(error.message),
      param: text(error.param)
    };
  }
  return null;
}
