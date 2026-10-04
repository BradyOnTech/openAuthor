// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DraftJournal, retentionKey } from "./workspaceRetention";
import { useRetainedDraft } from "./hooks/useRetainedDraft";
const valid = (value: unknown): value is string => typeof value === "string";
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("isolates books and Storylines and retains independent window drafts", () => {
  const journal = new DraftJournal(retentionKey("book", "main", "plan"), valid);
  journal.write("first window"); journal.write("second window");
  expect(journal.read().map((row) => row.value).sort()).toEqual(["first window", "second window"]);
  expect(new DraftJournal(retentionKey("other book", "main", "plan"), valid).read()).toEqual([]);
  expect(new DraftJournal(retentionKey("book", "other Storyline", "plan"), valid).read()).toEqual([]);
});

it("an older save receipt cannot acknowledge newer typing or another window", () => {
  const journal = new DraftJournal("work", valid);
  const original = journal.write("submitted");
  const latest = journal.write("typed after save began", original);
  journal.write("other writer"); journal.retire(original);
  expect(journal.read()).toHaveLength(2);
  journal.retire(latest); journal.retire(original);
  expect(journal.read().map((row) => row.value)).toEqual(["other writer"]);
});

it("preserves malformed records and reports damage rather than resetting storage", () => {
  localStorage.setItem("work:draft:broken", "{broken");
  expect(() => new DraftJournal("work", valid).read()).toThrow(/damaged/);
  expect(localStorage.getItem("work:draft:broken")).toBe("{broken");
});

it("retains at the input event and recovers after remount", () => {
  const first = renderHook(() => useRetainedDraft("work", "", valid));
  act(() => first.result.current.change("unfinished"));
  first.unmount();
  const second = renderHook(() => useRetainedDraft("work", "", valid));
  expect(second.result.current.value).toBe("unfinished");
  expect(second.result.current.restored).toBe(true);
});

it("late completion in a closed window does not mask a newer recovered draft", () => {
  const first = renderHook(() => useRetainedDraft("work", "", valid));
  act(() => first.result.current.change("submitted"));
  const acknowledge = first.result.current.change;
  first.unmount();
  const second = renderHook(() => useRetainedDraft("work", "", valid));
  act(() => second.result.current.change("newer draft in reopened window"));
  act(() => acknowledge(""));
  second.unmount();
  const third = renderHook(() => useRetainedDraft("work", "", valid));
  expect(third.result.current.value).toBe("newer draft in reopened window");
});

it("keeps current text and warns if local storage fills up", () => {
  const hook = renderHook(() => useRetainedDraft("work", "", valid));
  act(() => hook.result.current.change("recoverable"));
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
  act(() => hook.result.current.change("new text still in memory"));
  expect(hook.result.current.value).toBe("new text still in memory");
  expect(hook.result.current.warning).toMatch(/Keep this screen open/);
  expect(new DraftJournal("work", valid).read()[0].value).toBe("recoverable");
});

it("lets authors switch recovered copies without losing the current writer's draft", () => {
  const journal = new DraftJournal("work", valid);
  journal.write("one"); journal.write("two");
  const hook = renderHook(() => useRetainedDraft("work", "", valid));
  act(() => hook.result.current.change("three"));
  const alternative = hook.result.current.alternatives[0];
  act(() => hook.result.current.restore(alternative));
  expect(hook.result.current.value).toBe(alternative.value);
  expect(hook.result.current.alternatives.map((row) => row.value)).toContain("three");
});
