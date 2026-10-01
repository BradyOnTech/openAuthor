// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ManuscriptPlan, SceneSummary } from "../../types";
import { PlanNotes } from "./PlanNotes";

afterEach(cleanup);
const scenes: SceneSummary[] = [{ id: "s1", title: "The Clocktower", summary: "", pov: "Mara", status: "draft", created_at: "today", updated_at: "today", path: "scene.md" }];
const notes: ManuscriptPlan["notes"] = [
  { id: "n1", title: "The missing hour", content: "Let the brass case reveal a cost.", scene_id: "s1", source: "assistant", created_at: "today" },
  { id: "n2", title: "Book ending", content: "Leave the door open.", scene_id: "", source: "author", created_at: "today" },
];

it("finds saved ideas by content or scene, combines filters, and keeps project notes reachable", () => {
  render(<PlanNotes notes={notes} scenes={scenes} onOpenScene={vi.fn()} onRevise={vi.fn()} />);
  const search = screen.getByRole("searchbox", { name: "Search saved notes" });
  fireEvent.change(search, { target: { value: "BRASS" } });
  expect(screen.getByText("The missing hour")).toBeTruthy();
  expect(screen.queryByText("Book ending")).toBeNull();
  fireEvent.change(search, { target: { value: "Clocktower" } });
  expect(screen.getByText("The missing hour")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Filter notes by scene"), { target: { value: "project" } });
  expect(screen.getByText("No notes match. Try a different search or scene.")).toBeTruthy();
  fireEvent.change(search, { target: { value: "" } });
  expect(screen.getByText("Book ending")).toBeTruthy();
  expect(screen.queryByText("The missing hour")).toBeNull();
});

it("opens the requested note and hands off its exact text only on author action", () => {
  const open = vi.fn();
  const revise = vi.fn();
  const view = render(<PlanNotes notes={notes} scenes={scenes} onOpenScene={open} onRevise={revise} />);
  view.rerender(<PlanNotes notes={notes} scenes={scenes} focusNoteId="n1" onOpenScene={open} onRevise={revise} />);
  const detail = screen.getByText("The missing hour").closest("details")!;
  expect(detail.open).toBe(true);
  expect(document.activeElement).toBe(detail.querySelector("summary"));
  expect(revise).not.toHaveBeenCalled();
  fireEvent.click(within(detail).getByRole("button", { name: "Open scene: The Clocktower" }));
  expect(open).toHaveBeenCalledWith(scenes[0]);
  fireEvent.click(within(detail).getByRole("button", { name: "Plan a revision" }));
  expect(revise).toHaveBeenCalledWith(notes[0]);
});

it("keeps a missing-scene note readable without silently retargeting a revision", () => {
  render(<PlanNotes notes={[notes[0]]} scenes={[]} focusNoteId="n1" onOpenScene={vi.fn()} onRevise={vi.fn()} />);
  expect(screen.getByText(notes[0].content)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Plan a revision" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: /Open scene/ })).toBeNull();
});
