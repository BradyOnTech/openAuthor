// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleHistoryUpkeep } from "./historyUpkeep";

const engine = vi.hoisted(() => ({ calls: [] as Array<{ ifDue?: boolean }>, results: [] as Array<{ ran: boolean; complete: boolean } | Error> }));
vi.mock("./api", () => ({ compactRevisions: async (_root: string, options: { ifDue?: boolean }) => {
  engine.calls.push(options);
  const next = engine.results.shift();
  if (next instanceof Error) throw next;
  return next ?? { ran: false, complete: true };
} }));

describe("history upkeep", () => {
  beforeEach(() => { vi.useFakeTimers(); engine.calls = []; engine.results = []; });
  afterEach(() => vi.useRealTimers());

  it("asks once, after the book has been open a while, and only if thinning is due", async () => {
    scheduleHistoryUpkeep("/book");
    await vi.advanceTimersByTimeAsync(19_000);
    expect(engine.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(engine.calls).toEqual([{ ifDue: true }]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(engine.calls).toHaveLength(1);
  });

  it("continues a large backlog in passes until it is complete", async () => {
    engine.results = [{ ran: true, complete: false }, { ran: true, complete: false }, { ran: true, complete: true }];
    scheduleHistoryUpkeep("/book", 0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(engine.calls).toEqual([{ ifDue: true }, { ifDue: false }, { ifDue: false }]);
  });

  it("stops when the book closes and stays quiet when the engine fails", async () => {
    engine.results = [{ ran: true, complete: false }];
    const cancel = scheduleHistoryUpkeep("/book", 0);
    await vi.advanceTimersByTimeAsync(10);
    cancel();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(engine.calls).toHaveLength(1);
    engine.results = [new Error("engine unavailable")];
    scheduleHistoryUpkeep("/other", 0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(engine.calls).toHaveLength(2);
  });
});
