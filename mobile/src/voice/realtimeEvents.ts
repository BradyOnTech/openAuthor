export type MobileVoiceEvent =
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
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function translateMobileRealtimeEvent(raw: unknown): MobileVoiceEvent | null {
  const event = record(raw);
  const eventType = text(event.type);
  const providerEventId = text(event.event_id);
  if (eventType === "session.created" || eventType === "session.updated") {
    return {
      providerEventId,
      type: eventType === "session.created" ? "session.ready" : "session.updated",
      sessionId: text(record(event.session).id),
    };
  }
  if (eventType === "input_audio_buffer.speech_started") {
    return { providerEventId, type: "speech.started", itemId: text(event.item_id) };
  }
  if (eventType === "input_audio_buffer.speech_stopped") {
    return { providerEventId, type: "speech.stopped", itemId: text(event.item_id) };
  }
  if (eventType === "conversation.item.input_audio_transcription.delta") {
    return {
      providerEventId,
      type: "user.transcript.delta",
      itemId: text(event.item_id),
      text: text(event.delta),
    };
  }
  if (eventType === "conversation.item.input_audio_transcription.completed") {
    return {
      providerEventId,
      type: "user.transcript.final",
      itemId: text(event.item_id),
      text: text(event.transcript),
    };
  }
  if (eventType === "response.output_audio_transcript.delta" || eventType === "response.output_text.delta") {
    return {
      providerEventId,
      type: "assistant.transcript.delta",
      itemId: text(event.item_id),
      text: text(event.delta),
    };
  }
  if (eventType === "response.output_audio_transcript.done" || eventType === "response.output_text.done") {
    return {
      providerEventId,
      type: "assistant.transcript.final",
      itemId: text(event.item_id),
      text: text(event.transcript) || text(event.text),
    };
  }
  if (eventType === "response.created") {
    return {
      providerEventId,
      type: "response.started",
      responseId: text(record(event.response).id),
    };
  }
  if (eventType === "response.done") {
    const response = record(event.response);
    const status = text(response.status);
    return {
      providerEventId,
      type: status === "cancelled"
        ? "response.cancelled"
        : status === "failed"
          ? "response.failed"
          : "response.completed",
      responseId: text(response.id),
    };
  }
  if (eventType === "response.function_call_arguments.done") {
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
      argumentsJson,
    };
  }
  if (eventType === "error") {
    const error = record(event.error);
    return {
      providerEventId,
      type: "session.error",
      code: text(error.code),
      message: text(error.message),
      param: text(error.param),
    };
  }
  return null;
}
