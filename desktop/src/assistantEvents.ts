export type AssistantEventType =
  | "output.delta"
  | "output.final"
  | "turn.status"
  | "tool.status";

export type AssistantTurnStatus =
  | "accepted"
  | "running"
  | "completed"
  | "failed"
  | "interrupted";

export type AssistantTerminalTurnStatus = Extract<
  AssistantTurnStatus,
  "completed" | "failed" | "interrupted"
>;

export type AssistantEventEnvelope = {
  protocol_version: 1;
  event_id: string;
  turn_id: string;
  thread_id: string;
  turn_sequence: number;
  occurred_at: string;
  type: AssistantEventType;
  data: Record<string, unknown>;
};

export type AssistantEventResyncReason =
  | "sequence_gap"
  | "out_of_order"
  | "event_id_conflict"
  | "multiple_terminal_statuses";

export type AssistantTurnEventState = {
  turnId: string;
  threadId: string;
  lastSequence: number;
  events: readonly AssistantEventEnvelope[];
  seenEventIds: Readonly<Record<string, number>>;
  terminalStatus: AssistantTerminalTurnStatus | null;
  requiresResync: boolean;
  resyncReason: AssistantEventResyncReason | null;
};

export type AssistantEventState = {
  turns: Readonly<Record<string, AssistantTurnEventState>>;
};

export function createAssistantEventState(): AssistantEventState {
  return { turns: {} };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameEnvelope(
  left: AssistantEventEnvelope,
  right: AssistantEventEnvelope,
): boolean {
  return (
    left.protocol_version === right.protocol_version &&
    left.event_id === right.event_id &&
    left.turn_id === right.turn_id &&
    left.thread_id === right.thread_id &&
    left.turn_sequence === right.turn_sequence &&
    left.occurred_at === right.occurred_at &&
    left.type === right.type &&
    canonicalJson(left.data) === canonicalJson(right.data)
  );
}

function terminalStatusOf(
  envelope: AssistantEventEnvelope,
): AssistantTerminalTurnStatus | null {
  if (envelope.type !== "turn.status") {
    return null;
  }
  const status = envelope.data.status;
  return status === "completed" || status === "failed" || status === "interrupted"
    ? status
    : null;
}

export function reduceAssistantEvent(
  state: AssistantEventState,
  envelope: AssistantEventEnvelope,
): AssistantEventState {
  const existing = state.turns[envelope.turn_id];
  if (!existing && envelope.turn_sequence !== 1) {
    return {
      turns: {
        ...state.turns,
        [envelope.turn_id]: {
          turnId: envelope.turn_id,
          threadId: envelope.thread_id,
          lastSequence: 0,
          events: [],
          seenEventIds: {},
          terminalStatus: null,
          requiresResync: true,
          resyncReason:
            envelope.turn_sequence > 1 ? "sequence_gap" : "out_of_order",
        },
      },
    };
  }
  if (existing?.seenEventIds[envelope.event_id] !== undefined) {
    const previous = existing.events.find(
      ({ event_id }) => event_id === envelope.event_id,
    );
    if (previous && sameEnvelope(previous, envelope)) {
      return state;
    }
    if (existing.requiresResync) {
      return state;
    }
    return {
      turns: {
        ...state.turns,
        [envelope.turn_id]: {
          ...existing,
          requiresResync: true,
          resyncReason: "event_id_conflict",
        },
      },
    };
  }
  if (existing?.requiresResync) {
    return state;
  }
  if (existing && envelope.turn_sequence > existing.lastSequence + 1) {
    return {
      turns: {
        ...state.turns,
        [envelope.turn_id]: {
          ...existing,
          requiresResync: true,
          resyncReason: "sequence_gap",
        },
      },
    };
  }
  if (existing && envelope.turn_sequence <= existing.lastSequence) {
    return {
      turns: {
        ...state.turns,
        [envelope.turn_id]: {
          ...existing,
          requiresResync: true,
          resyncReason: "out_of_order",
        },
      },
    };
  }
  const terminalStatus = terminalStatusOf(envelope);
  if (existing?.terminalStatus && terminalStatus) {
    return {
      turns: {
        ...state.turns,
        [envelope.turn_id]: {
          ...existing,
          requiresResync: true,
          resyncReason: "multiple_terminal_statuses",
        },
      },
    };
  }

  const turn: AssistantTurnEventState = existing
    ? {
        ...existing,
        lastSequence: envelope.turn_sequence,
        events: [...existing.events, envelope],
        seenEventIds: {
          ...existing.seenEventIds,
          [envelope.event_id]: envelope.turn_sequence,
        },
        terminalStatus: terminalStatus ?? existing.terminalStatus,
      }
    : {
        turnId: envelope.turn_id,
        threadId: envelope.thread_id,
        lastSequence: envelope.turn_sequence,
        events: [envelope],
        seenEventIds: { [envelope.event_id]: envelope.turn_sequence },
        terminalStatus,
        requiresResync: false,
        resyncReason: null,
      };

  return {
    turns: {
      ...state.turns,
      [envelope.turn_id]: turn,
    },
  };
}
