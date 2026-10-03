// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CanonFactReview } from "./CanonFactReview";
import { reviewCanonFact } from "../../api";

const workspace = vi.hoisted(() => ({ projectRoot: "/synthetic-book", branches: [{ name: "main", current: true }],
  scenes: [{ id: "s1", title: "The loom" }], setError: vi.fn(), setMessage: vi.fn() }));
const editor = vi.hoisted(() => ({ openTab: vi.fn(), tabs: [], updateTab: vi.fn(), setActiveTab: vi.fn(), beginNavigation: vi.fn(() => () => true) }));
vi.mock("../../contexts/WorkspaceContext", () => ({ useWorkspace: () => workspace }));
vi.mock("../../contexts/EditorContext", () => ({ useEditor: () => editor }));
vi.mock("../../api", () => ({ reviewCanonFact: vi.fn(), getScene: vi.fn() }));
const fact = { id: "f1", edit_version: "original-storyline-version", subject_entity_id: "", predicate: "token color", value: "blue", status: "accepted" as const,
  confidence: 1, updated_at: "2026-10-02T10:00:00Z", evidence: [{ scene_id: "s1", excerpt: "Neri set a blue token beside the loom.", start: 0, end: 36 }],
  validity: { from_scene_id: "", to_scene_id: "" }, knowledge: [], scope: "project" as const };
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); workspace.projectRoot = "/synthetic-book"; workspace.branches = [{ name: "main", current: true }]; });
afterEach(cleanup);

it("does not label an unaccepted suggested fact as accepted by its author", () => {
  render(<CanonFactReview fact={{ ...fact, status: "suggested" }} onUpdated={vi.fn(async () => {})} />);
  expect(screen.queryByText(/Accepted by the author/)).toBeNull();
});

it("retains the original evidence correction and precondition when an older response follows a newer saved fact", async () => {
  let finish!: (value: typeof fact) => void;
  vi.mocked(reviewCanonFact).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const refreshed = vi.fn(async () => {});
  const view = render(<CanonFactReview fact={fact} onUpdated={refreshed} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Supporting passage for token color: blue" }), { target: { value: "Neri returned the blue token to the cabinet." } });
  fireEvent.click(screen.getByRole("button", { name: "Save verified evidence" }));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  const newer = { ...fact, updated_at: "2026-10-02T10:02:00Z", edit_version: "newer-version", evidence: [{ scene_id: "s1", excerpt: "The blue token stayed inside the cabinet.", start: 0, end: 40 }] };
  view.rerender(<CanonFactReview fact={newer} onUpdated={refreshed} />);
  await act(async () => finish({ ...fact, updated_at: "2026-10-02T10:01:00Z", edit_version: "older-committed-version", evidence: [{ scene_id: "s1", excerpt: "Neri returned the blue token to the cabinet.", start: 0, end: 43 }] }));
  const record = JSON.parse(localStorage.getItem("openauthor:canon-evidence:/synthetic-book:main:f1") || "null");
  expect(record?.base.updatedAt).toBe(fact.updated_at);
  expect(record?.base.editVersion).toBe(fact.edit_version);
  expect(record?.value.evidence[0].excerpt).toBe("Neri returned the blue token to the cabinet.");
  expect((screen.getByRole("button", { name: "Save verified evidence" }) as HTMLButtonElement).disabled).toBe(true);
});

const key = (branch = "main") => `openauthor:canon-evidence:/synthetic-book:${branch}:f1`;
const passage = () => screen.getByRole("textbox", { name: "Supporting passage for token color: blue" }) as HTMLTextAreaElement;

it("sends the original Storyline version with the exact submitted passage", async () => {
  const saved = { ...fact, updated_at: "saved", edit_version: "saved-version" };
  vi.mocked(reviewCanonFact).mockResolvedValueOnce(saved);
  render(<CanonFactReview fact={fact} onUpdated={vi.fn(async () => {})} />);
  fireEvent.click(screen.getByRole("button", { name: "Save verified evidence" }));
  await waitFor(() => expect(reviewCanonFact).toHaveBeenCalledWith("/synthetic-book", "f1", {
    disposition: "accepted", expectedVersion: fact.edit_version, evidence: fact.evidence,
  }));
  expect(workspace.setMessage).toHaveBeenCalledWith("Canon evidence verified and saved.");
});

it("blocks records without a current version and preserves a legacy recovered correction until explicit review", () => {
  const noVersion = render(<CanonFactReview fact={{ ...fact, edit_version: undefined }} onUpdated={vi.fn(async () => {})} />);
  expect((screen.getByRole("button", { name: "Save verified evidence" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/no current review version/)).toBeTruthy();
  noVersion.unmount();
  localStorage.setItem(key(), JSON.stringify({ version: 1,
    base: { updatedAt: fact.updated_at, evidence: fact.evidence },
    value: { updatedAt: fact.updated_at, evidence: [{ ...fact.evidence[0], excerpt: "Older recovered passage", start: 0, end: 0 }] },
  }));
  render(<CanonFactReview fact={fact} onUpdated={vi.fn(async () => {})} />);
  expect(passage().value).toBe("Older recovered passage");
  expect(screen.getByText(/no original Storyline version/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Save verified evidence" }) as HTMLButtonElement).disabled).toBe(true);
  expect(JSON.parse(localStorage.getItem(key())!).base.editVersion).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "Keep my draft" }));
  expect(passage().value).toBe("Older recovered passage");
  expect(JSON.parse(localStorage.getItem(key())!).base.editVersion).toBe(fact.edit_version);
  expect((screen.getByRole("button", { name: "Save verified evidence" }) as HTMLButtonElement).disabled).toBe(false);
  expect(reviewCanonFact).not.toHaveBeenCalled();
});

it("recovers an evidence correction with its original version and rejects changed authoritative facts", () => {
  const view = render(<CanonFactReview fact={fact} onUpdated={vi.fn(async () => {})} />);
  fireEvent.change(passage(), { target: { value: "Keep the original correction" } });
  view.unmount();
  render(<CanonFactReview fact={{ ...fact, updated_at: "newer", edit_version: "newer-version" }} onUpdated={vi.fn(async () => {})} />);
  expect(passage().value).toBe("Keep the original correction");
  expect(JSON.parse(localStorage.getItem(key())!).base.editVersion).toBe(fact.edit_version);
  expect((screen.getByRole("button", { name: "Save verified evidence" }) as HTMLButtonElement).disabled).toBe(true);
  expect(reviewCanonFact).not.toHaveBeenCalled();
});

it("prevents duplicate submission and preserves newer evidence writing during a save", async () => {
  let finish!: (value: typeof fact) => void;
  vi.mocked(reviewCanonFact).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<CanonFactReview fact={fact} onUpdated={vi.fn(async () => {})} />);
  fireEvent.change(passage(), { target: { value: "First submitted passage" } });
  const save = screen.getByRole("button", { name: "Save verified evidence" });
  fireEvent.click(save); fireEvent.click(save);
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  fireEvent.change(passage(), { target: { value: "Newer unfinished passage" } });
  const saved = { ...fact, updated_at: "saved", edit_version: "saved-version", evidence: [{ ...fact.evidence[0], excerpt: "First submitted passage" }] };
  await act(async () => finish(saved));
  expect(reviewCanonFact).toHaveBeenCalledTimes(1);
  expect(passage().value).toBe("Newer unfinished passage");
  expect(JSON.parse(localStorage.getItem(key())!).value.evidence[0].excerpt).toBe("Newer unfinished passage");
});

it("does not carry an old success or failure into another Storyline's correction", async () => {
  for (const failure of [false, true]) {
    let finish!: (value: typeof fact) => void;
    let fail!: (reason: Error) => void;
    vi.mocked(reviewCanonFact).mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
    const refreshed = vi.fn(async () => {});
    const view = render(<CanonFactReview fact={fact} onUpdated={refreshed} />);
    fireEvent.change(passage(), { target: { value: "Primary submitted passage" } });
    fireEvent.click(screen.getByRole("button", { name: "Save verified evidence" }));
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    workspace.branches = [{ name: "alternate", current: true }];
    view.rerender(<CanonFactReview fact={{ ...fact, edit_version: "alternate-version" }} onUpdated={refreshed} />);
    fireEvent.change(passage(), { target: { value: "Alternate unfinished passage" } });
    await act(async () => failure ? fail(new Error("Old delivery failed")) : finish({ ...fact, updated_at: "saved", edit_version: "saved-version" }));
    expect(passage().value).toBe("Alternate unfinished passage");
    expect(JSON.parse(localStorage.getItem(key("alternate"))!).base.editVersion).toBe("alternate-version");
    expect(refreshed).not.toHaveBeenCalled();
    expect(workspace.setError).not.toHaveBeenCalled();
    expect(workspace.setMessage).not.toHaveBeenCalled();
    view.unmount(); localStorage.clear(); workspace.branches = [{ name: "main", current: true }];
  }
});

it("acknowledges a refresh that exactly matches the committed save", async () => {
  let finish!: (value: typeof fact) => void;
  vi.mocked(reviewCanonFact).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const refreshed = vi.fn(async () => {});
  const view = render(<CanonFactReview fact={fact} onUpdated={refreshed} />);
  fireEvent.change(passage(), { target: { value: "Reviewed committed passage" } });
  fireEvent.click(screen.getByRole("button", { name: "Save verified evidence" }));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  const saved = { ...fact, updated_at: "saved", edit_version: "saved-version", evidence: [{ ...fact.evidence[0], excerpt: "Reviewed committed passage" }] };
  view.rerender(<CanonFactReview fact={saved} onUpdated={refreshed} />);
  await act(async () => finish(saved));
  expect(localStorage.getItem(key())).toBeNull();
  expect(refreshed).toHaveBeenCalledTimes(1);
  expect((screen.getByRole("button", { name: "Save verified evidence" }) as HTMLButtonElement).disabled).toBe(false);
});

it("keeps a failed correction and its original Storyline version", async () => {
  vi.mocked(reviewCanonFact).mockRejectedValueOnce(new Error("Source changed"));
  render(<CanonFactReview fact={fact} onUpdated={vi.fn(async () => {})} />);
  fireEvent.change(passage(), { target: { value: "Unfinished author correction" } });
  fireEvent.click(screen.getByRole("button", { name: "Save verified evidence" }));
  await waitFor(() => expect(workspace.setError).toHaveBeenCalledWith(expect.stringContaining("Source changed")));
  expect(passage().value).toBe("Unfinished author correction");
  expect(JSON.parse(localStorage.getItem(key())!).base.editVersion).toBe(fact.edit_version);
});

it("retires using its original version without erasing an unfinished evidence correction", async () => {
  const retired = { ...fact, status: "rejected" as const, updated_at: "retired", edit_version: "retired-version" };
  vi.mocked(reviewCanonFact).mockResolvedValueOnce(retired);
  let view: ReturnType<typeof render>;
  const refresh = vi.fn(async () => { view.rerender(<CanonFactReview fact={retired} onUpdated={refresh} />); });
  view = render(<CanonFactReview fact={fact} onUpdated={refresh} />);
  fireEvent.change(passage(), { target: { value: "Unfinished author correction" } });
  fireEvent.click(screen.getByRole("button", { name: "Retire fact" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(reviewCanonFact).toHaveBeenCalledWith("/synthetic-book", "f1", { disposition: "rejected", expectedVersion: fact.edit_version, evidence: undefined });
  expect(passage().value).toBe("Unfinished author correction");
  expect(JSON.parse(localStorage.getItem(key())!).base.editVersion).toBe(fact.edit_version);
  expect((screen.getByRole("button", { name: "Restore with verified evidence" }) as HTMLButtonElement).disabled).toBe(true);
});
