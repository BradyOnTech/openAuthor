import { describe, expect, it } from "vitest";
import {
  createAssistantEventState,
  reduceAssistantEvent,
  type AssistantEventEnvelope,
} from "./assistantEvents";

function event(
  overrides: Partial<AssistantEventEnvelope> = {},
): AssistantEventEnvelope {
  return {
    protocol_version: 1,
    event_id: "turn-1:1",
    turn_id: "turn-1",
    thread_id: "thread-1",
    turn_sequence: 1,
    occurred_at: "2026-08-30T12:00:00Z",
    type: "output.delta",
    data: {
      output_id: "turn-1:assistant",
      role: "assistant",
      modality: "text",
      delta: "Hello",
    },
    ...overrides,
  };
}

describe("reduceAssistantEvent", () => {
  it("accepts the first event for a turn", () => {
    const state = reduceAssistantEvent(
      createAssistantEventState(),
      event(),
    );

    expect(state.turns["turn-1"]).toMatchObject({
      turnId: "turn-1",
      threadId: "thread-1",
      lastSequence: 1,
      requiresResync: false,
      resyncReason: null,
      terminalStatus: null,
    });
    expect(state.turns["turn-1"]?.events).toEqual([event()]);
  });

  it("deduplicates a replayed event_id without changing turn state", () => {
    const first = reduceAssistantEvent(createAssistantEventState(), event());
    const replayed = reduceAssistantEvent(first, event());

    expect(replayed).toBe(first);
    expect(replayed.turns["turn-1"]?.events).toHaveLength(1);
  });

  it("accepts contiguous events in turn_sequence order", () => {
    const first = reduceAssistantEvent(createAssistantEventState(), event());
    const secondEvent = event({
      event_id: "turn-1:2",
      turn_sequence: 2,
      data: {
        output_id: "turn-1:assistant",
        role: "assistant",
        modality: "text",
        delta: " world",
      },
    });

    const second = reduceAssistantEvent(first, secondEvent);

    expect(second.turns["turn-1"]?.lastSequence).toBe(2);
    expect(second.turns["turn-1"]?.events).toEqual([event(), secondEvent]);
  });

  it("detects a sequence gap and requires assistant.turn.get resync", () => {
    const first = reduceAssistantEvent(createAssistantEventState(), event());
    const withGap = reduceAssistantEvent(
      first,
      event({ event_id: "turn-1:3", turn_sequence: 3 }),
    );

    expect(withGap.turns["turn-1"]).toMatchObject({
      lastSequence: 1,
      requiresResync: true,
      resyncReason: "sequence_gap",
    });
    expect(withGap.turns["turn-1"]?.events).toHaveLength(1);
  });

  it("detects a gap when the first observed sequence is not one", () => {
    const withInitialGap = reduceAssistantEvent(
      createAssistantEventState(),
      event({ event_id: "turn-1:2", turn_sequence: 2 }),
    );

    expect(withInitialGap.turns["turn-1"]).toMatchObject({
      lastSequence: 0,
      requiresResync: true,
      resyncReason: "sequence_gap",
      events: [],
    });
  });

  it("stops deriving turn state until a required resync replaces it", () => {
    const first = reduceAssistantEvent(createAssistantEventState(), event());
    const withGap = reduceAssistantEvent(
      first,
      event({ event_id: "turn-1:3", turn_sequence: 3 }),
    );
    const lateMissingEvent = reduceAssistantEvent(
      withGap,
      event({ event_id: "turn-1:2", turn_sequence: 2 }),
    );

    expect(lateMissingEvent).toBe(withGap);
    expect(lateMissingEvent.turns["turn-1"]?.events).toEqual([event()]);
  });

  it("detects out-of-order delivery under a new event_id", () => {
    const first = reduceAssistantEvent(createAssistantEventState(), event());
    const outOfOrder = reduceAssistantEvent(
      first,
      event({ event_id: "turn-1:late-copy", turn_sequence: 1 }),
    );

    expect(outOfOrder.turns["turn-1"]).toMatchObject({
      lastSequence: 1,
      requiresResync: true,
      resyncReason: "out_of_order",
    });
    expect(outOfOrder.turns["turn-1"]?.events).toHaveLength(1);
  });

  it("requires resync when an event_id is reused for different content", () => {
    const first = reduceAssistantEvent(createAssistantEventState(), event());
    const conflicted = reduceAssistantEvent(
      first,
      event({ data: { delta: "different" } }),
    );

    expect(conflicted.turns["turn-1"]).toMatchObject({
      lastSequence: 1,
      requiresResync: true,
      resyncReason: "event_id_conflict",
    });
    expect(conflicted.turns["turn-1"]?.events).toHaveLength(1);
  });

  it("accepts one terminal turn status", () => {
    const first = reduceAssistantEvent(createAssistantEventState(), event());
    const completed = reduceAssistantEvent(
      first,
      event({
        event_id: "turn-1:2",
        turn_sequence: 2,
        type: "turn.status",
        data: { status: "completed" },
      }),
    );

    expect(completed.turns["turn-1"]).toMatchObject({
      lastSequence: 2,
      terminalStatus: "completed",
      requiresResync: false,
    });
  });

  it("rejects a second terminal status and preserves the first", () => {
    const first = reduceAssistantEvent(createAssistantEventState(), event());
    const completed = reduceAssistantEvent(
      first,
      event({
        event_id: "turn-1:2",
        turn_sequence: 2,
        type: "turn.status",
        data: { status: "completed" },
      }),
    );
    const secondTerminal = reduceAssistantEvent(
      completed,
      event({
        event_id: "turn-1:3",
        turn_sequence: 3,
        type: "turn.status",
        data: { status: "completed" },
      }),
    );

    expect(secondTerminal.turns["turn-1"]).toMatchObject({
      lastSequence: 2,
      terminalStatus: "completed",
      requiresResync: true,
      resyncReason: "multiple_terminal_statuses",
    });
    expect(secondTerminal.turns["turn-1"]?.events).toHaveLength(2);
  });

  it("tracks event_id and turn_sequence independently per turn", () => {
    const firstTurn = reduceAssistantEvent(
      createAssistantEventState(),
      event({ event_id: "provider-event-1" }),
    );
    const secondTurn = reduceAssistantEvent(
      firstTurn,
      event({
        event_id: "provider-event-1",
        turn_id: "turn-2",
        thread_id: "thread-2",
        data: { delta: "Independent turn" },
      }),
    );

    expect(Object.keys(secondTurn.turns)).toEqual(["turn-1", "turn-2"]);
    expect(secondTurn.turns["turn-1"]?.lastSequence).toBe(1);
    expect(secondTurn.turns["turn-2"]).toMatchObject({
      threadId: "thread-2",
      lastSequence: 1,
      requiresResync: false,
    });
  });
});
