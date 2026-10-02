// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CanonFact, SceneSummary } from "../../types";
import { updateCanonFact } from "../../api";
import { CanonFactCard } from "./CanonFactCard";

vi.mock("../../api", () => ({ updateCanonFact: vi.fn() }));
beforeEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const scenes: SceneSummary[] = [{ id: "s1", title: "Gate", summary: "", pov: "Mara", status: "draft", path: "gate.md", created_at: "today", updated_at: "today" }];
const fact: CanonFact = { id: "f1", edit_version: "loaded-version", subject_entity_id: "", predicate: "gate color", value: "blue", status: "accepted", confidence: 1, evidence: [{ scene_id: "s1", excerpt: "The gate was blue.", start: 0, end: 18 }], validity: { from_scene_id: "", to_scene_id: "" }, knowledge: [], scope: "project" };
const props = { projectRoot: "/correction-recovery-book", branch: "main", subjectName: "Story", scenes, disabled: false, onOpenScene: vi.fn(), onSaved: vi.fn() };
const key = (branch = "main") => `openauthor.canonCorrection.v1:${JSON.stringify([props.projectRoot, branch, fact.id])}`;

it("recovers an unfinished assertion correction after the editor is closed and recreated", () => {
  const view = render(<CanonFactCard {...props} fact={fact} />);
  fireEvent.click(screen.getByRole("button", { name: "Correct or withdraw fact" }));
  fireEvent.change(screen.getByLabelText("Value"), { target: { value: "green" } });
  view.unmount();

  render(<CanonFactCard {...props} fact={fact} />);
  const reopen = screen.queryByRole("button", { name: "Correct or withdraw fact" });
  if (reopen) fireEvent.click(reopen);
  expect((screen.getByLabelText("Value") as HTMLTextAreaElement).value).toBe("green");
});

it("journals the original edit version and refuses a stale recovered correction until explicit review", async () => {
  const view = render(<CanonFactCard {...props} fact={fact} />);
  fireEvent.click(screen.getByRole("button", { name: "Correct or withdraw fact" }));
  fireEvent.change(screen.getByLabelText("Value"), { target: { value: "green" } });
  expect(JSON.parse(window.localStorage.getItem(key()) || "null")?.base.editVersion).toBe("loaded-version");
  view.unmount();
  const current = { ...fact, value: "red", edit_version: "external-version" };
  render(<CanonFactCard {...props} fact={current} />);
  expect((screen.getByLabelText("Value") as HTMLTextAreaElement).value).toBe("green");
  expect((screen.getByRole("button", { name: "Save fact correction" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("red")).toBeTruthy();
  expect(JSON.parse(window.localStorage.getItem(key()) || "null")?.base.editVersion).toBe("loaded-version");
  expect(updateCanonFact).not.toHaveBeenCalled();

  vi.mocked(updateCanonFact).mockResolvedValueOnce({ ...current, value: "green", edit_version: "saved-version" });
  fireEvent.click(screen.getByRole("button", { name: "Keep correction after reviewing saved fact" }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save fact correction" })));
  expect(updateCanonFact).toHaveBeenCalledWith(props.projectRoot, expect.objectContaining({ edit_version: "external-version" }), expect.objectContaining({ value: "green" }));
  expect(window.localStorage.getItem(key())).toBeNull();
});

it("recovers every assertion field and discards only after an explicit cancel", () => {
  const view = render(<CanonFactCard {...props} fact={fact} />);
  fireEvent.click(screen.getByRole("button", { name: "Correct or withdraw fact" }));
  fireEvent.change(screen.getByLabelText("Predicate"), { target: { value: "gate paint" } });
  fireEvent.change(screen.getByLabelText("Value"), { target: { value: "green" } });
  fireEvent.change(screen.getByLabelText("Canon status"), { target: { value: "rejected" } });
  fireEvent.change(screen.getByLabelText("True from"), { target: { value: "s1" } });
  fireEvent.change(screen.getByLabelText("True until"), { target: { value: "s1" } });
  fireEvent.change(screen.getByLabelText("Supporting passage 1"), { target: { value: "The gate was green." } });
  view.unmount();
  const reopened = render(<CanonFactCard {...props} fact={fact} />);
  for (const [label, expected] of [["Predicate", "gate paint"], ["Value", "green"], ["Canon status", "rejected"], ["True from", "s1"], ["True until", "s1"], ["Supporting passage 1", "The gate was green."]]) {
    expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe(expected);
  }
  fireEvent.click(screen.getByRole("button", { name: "Cancel correction" }));
  expect(window.localStorage.getItem(key())).toBeNull();
  reopened.unmount();
  render(<CanonFactCard {...props} fact={fact} />);
  expect(screen.queryByLabelText("Value")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Correct or withdraw fact" }));
  expect((screen.getByLabelText("Value") as HTMLTextAreaElement).value).toBe("blue");
});

it("isolates drafts by book, Storyline and fact without advancing their stored baselines", () => {
  const view = render(<CanonFactCard {...props} fact={fact} />);
  fireEvent.click(screen.getByRole("button", { name: "Correct or withdraw fact" }));
  fireEvent.change(screen.getByLabelText("Value"), { target: { value: "green" } });
  view.rerender(<CanonFactCard {...props} branch="alternate" fact={fact} />);
  expect(screen.queryByLabelText("Value")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Correct or withdraw fact" }));
  expect((screen.getByLabelText("Value") as HTMLTextAreaElement).value).toBe("blue");
  fireEvent.change(screen.getByLabelText("Value"), { target: { value: "amber" } });
  view.rerender(<CanonFactCard {...props} projectRoot="/another-book" fact={fact} />);
  expect(screen.queryByLabelText("Value")).toBeNull();
  view.rerender(<CanonFactCard {...props} fact={{ ...fact, id: "f2" }} />);
  expect(screen.queryByLabelText("Value")).toBeNull();
  view.rerender(<CanonFactCard {...props} fact={fact} />);
  expect((screen.getByLabelText("Value") as HTMLTextAreaElement).value).toBe("green");
  expect(JSON.parse(window.localStorage.getItem(key()) || "null").base.editVersion).toBe("loaded-version");
  view.rerender(<CanonFactCard {...props} branch="alternate" fact={fact} />);
  expect((screen.getByLabelText("Value") as HTMLTextAreaElement).value).toBe("amber");
});

it("retains a recovered correction after a failed save and explicit stale discard uses the current fact", async () => {
  vi.mocked(updateCanonFact).mockRejectedValueOnce(new Error("The Storyline changed."));
  const view = render(<CanonFactCard {...props} fact={fact} />);
  fireEvent.click(screen.getByRole("button", { name: "Correct or withdraw fact" }));
  fireEvent.change(screen.getByLabelText("Value"), { target: { value: "green" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save fact correction" })));
  view.unmount();
  const current = { ...fact, value: "red", edit_version: "new-version" };
  render(<CanonFactCard {...props} fact={current} />);
  expect((screen.getByLabelText("Value") as HTMLTextAreaElement).value).toBe("green");
  fireEvent.click(screen.getByRole("button", { name: "Discard these edits and use the saved fact" }));
  expect(screen.getByText("red")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Correct or withdraw fact" }));
  expect((screen.getByLabelText("Value") as HTMLTextAreaElement).value).toBe("red");
  expect(window.localStorage.getItem(key())).toBeNull();
  expect(updateCanonFact).toHaveBeenCalledTimes(1);
});

it("does not clear a reopened editor's newer changes when an earlier save completes", async () => {
  let finish!: (value: CanonFact) => void;
  vi.mocked(updateCanonFact).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = render(<CanonFactCard {...props} fact={fact} />);
  fireEvent.click(screen.getByRole("button", { name: "Correct or withdraw fact" }));
  fireEvent.change(screen.getByLabelText("Value"), { target: { value: "green" } });
  fireEvent.click(screen.getByRole("button", { name: "Save fact correction" }));
  first.unmount();
  const second = render(<CanonFactCard {...props} fact={fact} />);
  fireEvent.change(screen.getByLabelText("Value"), { target: { value: "amber" } });
  const saved = { ...fact, value: "green", edit_version: "saved-version" };
  await act(async () => finish(saved));
  expect((screen.getByLabelText("Value") as HTMLTextAreaElement).value).toBe("amber");
  expect(props.onSaved).not.toHaveBeenCalled();
  second.unmount();
  render(<CanonFactCard {...props} fact={saved} />);
  expect((screen.getByLabelText("Value") as HTMLTextAreaElement).value).toBe("amber");
  expect(JSON.parse(window.localStorage.getItem(key()) || "null").base.editVersion).toBe("saved-version");
  expect((screen.getByRole("button", { name: "Save fact correction" }) as HTMLButtonElement).disabled).toBe(false);
});

it("does not carry a delayed save result into another Storyline or erase that Storyline's draft", async () => {
  let finish!: (value: CanonFact) => void;
  vi.mocked(updateCanonFact).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<CanonFactCard {...props} fact={fact} />);
  fireEvent.click(screen.getByRole("button", { name: "Correct or withdraw fact" }));
  fireEvent.change(screen.getByLabelText("Value"), { target: { value: "green" } });
  fireEvent.click(screen.getByRole("button", { name: "Save fact correction" }));
  view.rerender(<CanonFactCard {...props} branch="alternate" fact={fact} />);
  fireEvent.click(screen.getByRole("button", { name: "Correct or withdraw fact" }));
  fireEvent.change(screen.getByLabelText("Value"), { target: { value: "amber" } });
  await act(async () => finish({ ...fact, value: "green", edit_version: "saved-version" }));
  expect((screen.getByLabelText("Value") as HTMLTextAreaElement).value).toBe("amber");
  expect(props.onSaved).not.toHaveBeenCalled();
  expect(JSON.parse(window.localStorage.getItem(key("alternate")) || "null").base.editVersion).toBe("loaded-version");
});

it("does not downgrade a newer authoritative fact or clear its pending correction when an older save response arrives", async () => {
  let finish!: (value: CanonFact) => void;
  vi.mocked(updateCanonFact).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<CanonFactCard {...props} fact={fact} />);
  fireEvent.click(screen.getByRole("button", { name: "Correct or withdraw fact" }));
  fireEvent.change(screen.getByLabelText("Value"), { target: { value: "green" } });
  fireEvent.click(screen.getByRole("button", { name: "Save fact correction" }));
  const newer = { ...fact, value: "amber", edit_version: "later-authoritative-version" };
  view.rerender(<CanonFactCard {...props} fact={newer} />);
  await act(async () => finish({ ...fact, value: "green", edit_version: "earlier-saved-version" }));
  expect(props.onSaved).not.toHaveBeenCalled();
  expect(screen.getByText("amber")).toBeTruthy();
  expect((screen.getByLabelText("Value") as HTMLTextAreaElement).value).toBe("green");
  expect((screen.getByRole("button", { name: "Save fact correction" }) as HTMLButtonElement).disabled).toBe(true);
  const record = JSON.parse(window.localStorage.getItem(key()) || "null");
  expect(record.base.editVersion).toBe("loaded-version");
  expect(record.value.changes.value).toBe("green");
  expect(screen.getByText(/The correction was saved, and a newer saved fact is now available/)).toBeTruthy();
});

it("acknowledges a delayed save when the refreshed fact is exactly its committed result", async () => {
  let finish!: (value: CanonFact) => void;
  vi.mocked(updateCanonFact).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<CanonFactCard {...props} fact={fact} />);
  fireEvent.click(screen.getByRole("button", { name: "Correct or withdraw fact" }));
  fireEvent.change(screen.getByLabelText("Value"), { target: { value: "green" } });
  fireEvent.click(screen.getByRole("button", { name: "Save fact correction" }));
  const saved = { ...fact, value: "green", edit_version: "committed-version" };
  view.rerender(<CanonFactCard {...props} fact={saved} />);
  await act(async () => finish(saved));
  expect(props.onSaved).toHaveBeenCalledWith(saved);
  expect(screen.queryByLabelText("Value")).toBeNull();
  expect(window.localStorage.getItem(key())).toBeNull();
});

it("does not reuse unmounted stale props when a storage-failed session is reopened with a newer fact", async () => {
  const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
  let finish!: (value: CanonFact) => void;
  vi.mocked(updateCanonFact).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = render(<CanonFactCard {...props} fact={fact} />);
  fireEvent.click(screen.getByRole("button", { name: "Correct or withdraw fact" }));
  fireEvent.change(screen.getByLabelText("Value"), { target: { value: "green" } });
  fireEvent.click(screen.getByRole("button", { name: "Save fact correction" }));
  first.unmount();
  render(<CanonFactCard {...props} fact={{ ...fact, value: "amber", edit_version: "later-version" }} />);
  await act(async () => finish({ ...fact, value: "green", edit_version: "earlier-saved-version" }));
  expect((screen.getByLabelText("Value") as HTMLTextAreaElement).value).toBe("green");
  expect((screen.getByRole("button", { name: "Save fact correction" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("amber")).toBeTruthy();
  expect(props.onSaved).not.toHaveBeenCalled();
  storage.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "Cancel correction" }));
});

it("does not adopt or erase unreadable recovery data when opening a correction", () => {
  const raw = JSON.stringify({ version: 1, base: { editVersion: 42 }, value: { changes: { value: "untrusted" } } });
  window.localStorage.setItem(key(), raw);
  render(<CanonFactCard {...props} fact={fact} />);
  expect(screen.getByRole("alert").textContent).toContain("unreadable");
  fireEvent.click(screen.getByRole("button", { name: "Correct or withdraw fact" }));
  expect((screen.getByLabelText("Value") as HTMLTextAreaElement).value).toBe("blue");
  expect(window.localStorage.getItem(key())).toBe(raw);
  expect(updateCanonFact).not.toHaveBeenCalled();
});

it("keeps a storage-failed correction available after navigation and reports the failure", () => {
  const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
  const view = render(<CanonFactCard {...props} fact={fact} />);
  fireEvent.click(screen.getByRole("button", { name: "Correct or withdraw fact" }));
  fireEvent.change(screen.getByLabelText("Value"), { target: { value: "green" } });
  view.unmount();
  render(<CanonFactCard {...props} fact={fact} />);
  expect((screen.getByLabelText("Value") as HTMLTextAreaElement).value).toBe("green");
  expect(screen.getByRole("alert").textContent).toContain("storage is full or unavailable");
  storage.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "Cancel correction" }));
});
