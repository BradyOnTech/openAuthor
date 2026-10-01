// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { updateCanonFact } from "../../api";
import type { CanonFact, SceneSummary } from "../../types";
import { CanonFactCard } from "./CanonFactCard";

vi.mock("../../api", () => ({ updateCanonFact: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);
const scenes: SceneSummary[] = [{ id: "s1", title: "Gate", summary: "", pov: "Mara", status: "draft", path: "gate.md", created_at: "today", updated_at: "today" }];
const fact: CanonFact = { id: "f1", edit_version: "loaded-version", subject_entity_id: "", predicate: "gate color", value: "blue", status: "accepted", confidence: 1, evidence: [{ scene_id: "s1", excerpt: "The gate was blue.", start: 0, end: 18 }], validity: { from_scene_id: "", to_scene_id: "" }, knowledge: [], scope: "project" };
const props = { projectRoot: "/book", subjectName: "Story", scenes, disabled: false, onOpenScene: vi.fn(), onSaved: vi.fn() };

it("submits a correction against the originally loaded fact and retains input after failure", async () => {
  vi.mocked(updateCanonFact).mockRejectedValueOnce(new Error("Fact changed since you opened it."));
  render(<CanonFactCard {...props} fact={fact} />);
  fireEvent.click(screen.getByRole("button", { name: "Correct or withdraw fact" }));
  fireEvent.change(screen.getByLabelText("Value"), { target: { value: "green" } });
  fireEvent.change(screen.getByLabelText("Supporting passage 1"), { target: { value: "The gate was green." } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save fact correction" })));
  expect(updateCanonFact).toHaveBeenCalledWith("/book", fact, expect.objectContaining({ value: "green", evidence: [expect.objectContaining({ excerpt: "The gate was green." })] }));
  expect((screen.getByLabelText("Value") as HTMLTextAreaElement).value).toBe("green");
  expect(screen.getByRole("alert").textContent).toContain("still here");
  expect(props.onSaved).not.toHaveBeenCalled();
});

it("withdraws without losing sources and makes restoration available", async () => {
  const withdrawn = { ...fact, status: "rejected" as const, edit_version: "withdrawn-version" };
  vi.mocked(updateCanonFact).mockResolvedValueOnce(withdrawn).mockResolvedValueOnce({ ...fact, edit_version: "restored-version" });
  const view = render(<CanonFactCard {...props} fact={fact} />);
  fireEvent.click(screen.getByRole("button", { name: "Correct or withdraw fact" }));
  fireEvent.change(screen.getByLabelText("Canon status"), { target: { value: "rejected" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save fact correction" })));
  expect(updateCanonFact).toHaveBeenCalledWith("/book", fact, expect.objectContaining({ status: "rejected", evidence: fact.evidence }));
  view.rerender(<CanonFactCard {...props} fact={withdrawn} />);
  expect(screen.getByText(/Excluded from new Copilot canon context/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Correct or withdraw fact" }));
  fireEvent.change(screen.getByLabelText("Canon status"), { target: { value: "accepted" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save fact correction" })));
  expect(updateCanonFact).toHaveBeenLastCalledWith("/book", withdrawn, expect.objectContaining({ status: "accepted", evidence: fact.evidence }));
});

it("does not replace unsaved edits or advance their baseline when a refreshed fact arrives", () => {
  const view = render(<CanonFactCard {...props} fact={fact} />);
  fireEvent.click(screen.getByRole("button", { name: "Correct or withdraw fact" }));
  fireEvent.change(screen.getByLabelText("Value"), { target: { value: "green" } });
  const newer = { ...fact, value: "red", edit_version: "new-version" };
  view.rerender(<CanonFactCard {...props} fact={newer} />);
  expect((screen.getByLabelText("Value") as HTMLTextAreaElement).value).toBe("green");
  expect((screen.getByRole("button", { name: "Save fact correction" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("red")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Discard these edits and use the saved fact" }));
  expect((screen.getByLabelText("Value") as HTMLTextAreaElement).value).toBe("red");
  expect(updateCanonFact).not.toHaveBeenCalled();
});
