// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { addPlanAct, assignPlanScene, getManuscriptPlan, listCharacterArcStates, previewPlanSceneMove, updateProjectBrief, getScene } from "../../api";
import type { ManuscriptPlan, PlanMovePreview } from "../../types";
import { PlanEditor } from "./PlanEditor";

const editor = vi.hoisted(() => ({ openTab: vi.fn(), setActiveTab: vi.fn(), beginNavigation: vi.fn(() => () => true), tabs: [] as Array<{ id: string; modified?: boolean }> }));
const workspace = vi.hoisted(() => ({ projectRoot: "/books/plan", scenes: [] as Array<{ id: string; title: string }>, codexEntities: [], setError: vi.fn(), setMessage: vi.fn() }));
vi.mock("../../api", () => ({ addPlanAct: vi.fn(), assignPlanScene: vi.fn(), getManuscriptPlan: vi.fn(), listCharacterArcStates: vi.fn(), previewPlanSceneMove: vi.fn(), updateProjectBrief: vi.fn(), getScene: vi.fn() }));
vi.mock("../../contexts/EditorContext", () => ({ useEditor: () => editor }));
vi.mock("../../contexts/WorkspaceContext", () => ({ useWorkspace: () => workspace }));
const plan: ManuscriptPlan = { schema_version: 1, brief: { synopsis: "", genre: "", themes: [], style_guide: "", outline: "" }, acts: [], beats: [], unassigned_scene_ids: [], scene_metadata: {}, notes: [] };

function orderedPlan(): ManuscriptPlan {
  workspace.scenes = ["A", "B", "C", "D", "E", "F", "G"].map((title) => ({ id: title.toLowerCase(), title }));
  return { ...plan, workspace: "main", acts: [{ id: "act", title: "Opening", position: 1, synopsis: "", chapters: [
    { id: "chapter", title: "Arrival", position: 1, synopsis: "", scene_ids: ["a", "b", "c"] },
    { id: "return", title: "Return", position: 2, synopsis: "", scene_ids: ["d", "e"] },
  ] }], unassigned_scene_ids: ["f", "g"] };
}

function preview(summary: string): PlanMovePreview {
  return { scene_id: "c", from: { act_id: "act", act_title: "Opening", chapter_id: "chapter", chapter_title: "Arrival", chapter_position: 3, narrative_index: 3 }, to: { act_id: "act", chapter_id: "chapter", chapter_title: "Arrival", before_scene_id: "a", position: 1 }, crossed_scene_ids: ["a", "b"], warnings: [], summary };
}

beforeEach(() => { vi.resetAllMocks(); editor.tabs = []; workspace.scenes = []; editor.beginNavigation.mockReturnValue(() => true); localStorage.clear(); vi.mocked(listCharacterArcStates).mockResolvedValue([]); });
afterEach(cleanup);

it("places C before A using the scene's keyboard move controls", async () => {
  const user = userEvent.setup();
  workspace.scenes = ["A", "B", "C"].map((title) => ({ id: title.toLowerCase(), title }));
  const initial = { ...plan, workspace: "main", acts: [{ id: "act", title: "Opening", position: 1, synopsis: "", chapters: [{ id: "chapter", title: "Arrival", position: 1, synopsis: "", scene_ids: ["a", "b", "c"] }] }] };
  vi.mocked(getManuscriptPlan).mockResolvedValue(initial);
  vi.mocked(previewPlanSceneMove).mockResolvedValue(preview("Move C to position 1 in Arrival."));
  vi.mocked(assignPlanScene).mockResolvedValue(initial);
  render(<PlanEditor />);
  const card = (await screen.findByRole("button", { name: "C" })).closest("article")!;
  const position = within(card).getByRole("combobox", { name: "Reading position for C" });
  await user.selectOptions(position, "a");
  await waitFor(() => expect(previewPlanSceneMove).toHaveBeenCalledWith("/books/plan", "c", "chapter", "a"));
  const saved = { ...initial, acts: [{ ...initial.acts[0], chapters: [{ ...initial.acts[0].chapters[0], scene_ids: ["c", "a", "b"] }] }] };
  vi.mocked(getManuscriptPlan).mockResolvedValue(saved);
  const move = within(card).getByRole("button", { name: "Move C" });
  move.focus();
  await user.keyboard("{Enter}");
  await waitFor(() => expect(assignPlanScene).toHaveBeenCalledWith("/books/plan", "c", "chapter", "a", "main"));
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^[ABC]$/ }).map((button) => button.textContent)).toEqual(["C", "A", "B"]));
});

it("keeps the latest selected reading-position preview when an earlier reply arrives late", async () => {
  const user = userEvent.setup();
  let finishFirst!: (value: PlanMovePreview) => void;
  let finishSecond!: (value: PlanMovePreview) => void;
  vi.mocked(getManuscriptPlan).mockResolvedValue(orderedPlan());
  vi.mocked(previewPlanSceneMove)
    .mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve; }))
    .mockReturnValueOnce(new Promise((resolve) => { finishSecond = resolve; }));
  render(<PlanEditor />);
  const position = await screen.findByRole("combobox", { name: "Reading position for C" });
  await user.selectOptions(position, "a");
  await user.selectOptions(position, "b");
  await act(async () => finishSecond(preview("Selected: before B.")));
  expect(screen.getByRole("region", { name: "Structural move preview" }).textContent).toContain("Selected: before B.");
  await act(async () => finishFirst(preview("Older: before A.")));
  expect((position as HTMLSelectElement).value).toBe("b");
  expect(screen.getByRole("region", { name: "Structural move preview" }).textContent).toContain("Selected: before B.");
  expect(screen.queryByText("Older: before A.")).toBeNull();
  expect(assignPlanScene).not.toHaveBeenCalled();
});

it("inserts a scene before a chosen scene in another chapter, keeping drafts and keyboard focus", async () => {
  const user = userEvent.setup();
  const initial = orderedPlan();
  let finish!: (value: ManuscriptPlan) => void;
  vi.mocked(getManuscriptPlan).mockResolvedValue(initial);
  vi.mocked(previewPlanSceneMove).mockResolvedValue(preview("C will precede E in Return."));
  vi.mocked(assignPlanScene).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  render(<PlanEditor />);
  const target = await screen.findByRole("combobox", { name: "Move C to" });
  fireEvent.change(screen.getByRole("textbox", { name: "Synopsis" }), { target: { value: "Unfinished direction" } });
  fireEvent.change(screen.getByRole("textbox", { name: "New beat for C" }), { target: { value: "An unfinished beat" } });
  await user.selectOptions(target, "return");
  const position = screen.getByRole("combobox", { name: "Reading position for C" });
  expect(within(position).getAllByRole("option").map((option) => option.textContent)).toEqual(["Before D", "Before E", "At end of chapter"]);
  await user.selectOptions(position, "e");
  await waitFor(() => expect(previewPlanSceneMove).toHaveBeenLastCalledWith("/books/plan", "c", "return", "e"));
  const move = screen.getByRole("button", { name: "Move C" });
  move.focus();
  await user.keyboard("{Enter}");
  await waitFor(() => expect(assignPlanScene).toHaveBeenCalledWith("/books/plan", "c", "return", "e", "main"));
  expect((target as HTMLSelectElement).disabled).toBe(true);
  expect((position as HTMLSelectElement).disabled).toBe(true);
  expect((move as HTMLButtonElement).disabled).toBe(true);
  const saved = { ...initial, acts: [{ ...initial.acts[0], chapters: [
    { ...initial.acts[0].chapters[0], scene_ids: ["a", "b"] },
    { ...initial.acts[0].chapters[1], scene_ids: ["d", "c", "e"] },
  ] }] };
  vi.mocked(getManuscriptPlan).mockResolvedValue(saved);
  await act(async () => finish(saved));
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^[A-G]$/ }).map((button) => button.textContent)).toEqual(["A", "B", "D", "C", "E", "F", "G"]));
  const restored = screen.getByRole("combobox", { name: "Reading position for C" });
  await waitFor(() => expect(document.activeElement).toBe(restored));
  expect((restored as HTMLSelectElement).disabled).toBe(false);
  expect((restored as HTMLSelectElement).value).toBe("e");
  expect((screen.getByRole("button", { name: "Move C" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("textbox", { name: "Synopsis" }) as HTMLTextAreaElement).value).toBe("Unfinished direction");
  expect((screen.getByRole("textbox", { name: "New beat for C" }) as HTMLInputElement).value).toBe("An unfinished beat");
  expect(updateProjectBrief).not.toHaveBeenCalled();
  await user.selectOptions(screen.getByRole("combobox", { name: "Move C to" }), "chapter");
  vi.mocked(getManuscriptPlan).mockResolvedValue(initial);
  vi.mocked(assignPlanScene).mockResolvedValue(initial);
  await user.click(screen.getByRole("button", { name: "Move C" }));
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^[A-G]$/ }).map((button) => button.textContent)).toEqual(["A", "B", "C", "D", "E", "F", "G"]));
  expect(document.activeElement).not.toBe(screen.getByRole("combobox", { name: "Reading position for C" }));
});

it("disables current positions and can deliberately append within the same chapter", async () => {
  const user = userEvent.setup();
  const initial = orderedPlan();
  vi.mocked(getManuscriptPlan).mockResolvedValue(initial);
  vi.mocked(previewPlanSceneMove).mockResolvedValue(preview("Move A to the end."));
  vi.mocked(assignPlanScene).mockResolvedValue(initial);
  render(<PlanEditor />);
  const position = await screen.findByRole("combobox", { name: "Reading position for A" });
  const move = screen.getByRole("button", { name: "Move A" });
  expect((position as HTMLSelectElement).value).toBe("b");
  expect((move as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Move C" }) as HTMLButtonElement).disabled).toBe(true);
  await user.selectOptions(position, "");
  expect((move as HTMLButtonElement).disabled).toBe(false);
  await user.selectOptions(position, "b");
  expect((move as HTMLButtonElement).disabled).toBe(true);
  await user.click(move);
  expect(assignPlanScene).not.toHaveBeenCalled();
  await user.selectOptions(position, "");
  const saved = { ...initial, acts: [{ ...initial.acts[0], chapters: [{ ...initial.acts[0].chapters[0], scene_ids: ["b", "c", "a"] }, initial.acts[0].chapters[1]] }] };
  vi.mocked(getManuscriptPlan).mockResolvedValue(saved);
  move.focus();
  await user.keyboard("{Enter}");
  await waitFor(() => expect(assignPlanScene).toHaveBeenCalledWith("/books/plan", "a", "chapter", undefined, "main"));
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^[ABC]$/ }).map((button) => button.textContent)).toEqual(["B", "C", "A"]));
  expect((screen.getByRole("button", { name: "Move A" }) as HTMLButtonElement).disabled).toBe(true);
});

it("orders the scene inbox without creating a chapter or changing its unassigned meaning", async () => {
  const user = userEvent.setup();
  workspace.scenes = ["A", "B", "C"].map((title) => ({ id: title.toLowerCase(), title }));
  const initial = { ...plan, workspace: "main", unassigned_scene_ids: ["a", "b", "c"] };
  vi.mocked(getManuscriptPlan).mockResolvedValue(initial);
  vi.mocked(previewPlanSceneMove).mockResolvedValue(preview("Move C before A in the scene inbox."));
  vi.mocked(assignPlanScene).mockResolvedValue(initial);
  render(<PlanEditor />);
  const position = await screen.findByRole("combobox", { name: "Reading position for C" });
  expect(within(screen.getByRole("combobox", { name: "Move C to" })).getAllByRole("option").map((option) => option.textContent)).toEqual(["Unassigned scene inbox"]);
  expect(within(position).getAllByRole("option").map((option) => option.textContent)).toEqual(["Before A", "Before B", "At end of scene inbox"]);
  await user.selectOptions(position, "a");
  await waitFor(() => expect(previewPlanSceneMove).toHaveBeenCalledWith("/books/plan", "c", null, "a"));
  const saved = { ...initial, unassigned_scene_ids: ["c", "a", "b"] };
  vi.mocked(getManuscriptPlan).mockResolvedValue(saved);
  screen.getByRole("button", { name: "Move C" }).focus();
  await user.keyboard("{Enter}");
  await waitFor(() => expect(assignPlanScene).toHaveBeenCalledWith("/books/plan", "c", null, "a", "main"));
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^[ABC]$/ }).map((button) => button.textContent)).toEqual(["C", "A", "B"]));
  expect(screen.getByRole("heading", { name: "Scene Inbox" })).toBeTruthy();
  expect(addPlanAct).not.toHaveBeenCalled();
});

it.each(["pointer move", "new author focus"])("does not restore keyboard focus over a %s", async (interaction) => {
  const user = userEvent.setup();
  const initial = orderedPlan();
  let finish!: (value: ManuscriptPlan) => void;
  vi.mocked(getManuscriptPlan).mockResolvedValue(initial);
  vi.mocked(previewPlanSceneMove).mockResolvedValue(preview("Move C into Return."));
  vi.mocked(assignPlanScene).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  render(<PlanEditor />);
  await user.selectOptions(await screen.findByRole("combobox", { name: "Move C to" }), "return");
  const move = screen.getByRole("button", { name: "Move C" });
  if (interaction === "pointer move") await user.click(move);
  else {
    move.focus();
    await user.keyboard("{Enter}");
  }
  await waitFor(() => expect(assignPlanScene).toHaveBeenCalledTimes(1));
  const synopsis = screen.getByRole("textbox", { name: "Synopsis" });
  if (interaction === "new author focus") await user.click(synopsis);
  const saved = { ...initial, acts: [{ ...initial.acts[0], chapters: [{ ...initial.acts[0].chapters[0], scene_ids: ["a", "b"] }, { ...initial.acts[0].chapters[1], scene_ids: ["d", "e", "c"] }] }] };
  vi.mocked(getManuscriptPlan).mockResolvedValue(saved);
  await act(async () => finish(saved));
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^[A-G]$/ }).map((button) => button.textContent)).toEqual(["A", "B", "D", "E", "C", "F", "G"]));
  expect(document.activeElement).not.toBe(screen.getByRole("combobox", { name: "Reading position for C" }));
  if (interaction === "new author focus") expect(document.activeElement).toBe(synopsis);
});

it("does not bring back a delayed preview after the author applies the move", async () => {
  const user = userEvent.setup();
  let finish!: (value: PlanMovePreview) => void;
  const initial = orderedPlan();
  vi.mocked(getManuscriptPlan).mockResolvedValue(initial);
  vi.mocked(previewPlanSceneMove).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  vi.mocked(assignPlanScene).mockResolvedValue(initial);
  render(<PlanEditor />);
  await user.selectOptions(await screen.findByRole("combobox", { name: "Reading position for C" }), "a");
  const saved = { ...initial, acts: [{ ...initial.acts[0], chapters: [{ ...initial.acts[0].chapters[0], scene_ids: ["c", "a", "b"] }, initial.acts[0].chapters[1]] }] };
  vi.mocked(getManuscriptPlan).mockResolvedValue(saved);
  screen.getByRole("button", { name: "Move C" }).focus();
  await user.keyboard("{Enter}");
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^[ABC]$/ }).map((button) => button.textContent)).toEqual(["C", "A", "B"]));
  await act(async () => finish(preview("Already applied: before A.")));
  expect(screen.queryByRole("region", { name: "Structural move preview" })).toBeNull();
});

it("keeps an author's new brief when an older initial load completes late", async () => {
  let finishOld!: (value: ManuscriptPlan) => void;
  vi.mocked(getManuscriptPlan).mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; })).mockResolvedValue(plan);
  render(<StrictMode><PlanEditor /></StrictMode>);
  const synopsis = await screen.findByRole("textbox", { name: "Synopsis" });
  fireEvent.change(synopsis, { target: { value: "A cartographer follows stolen hours." } });
  await act(async () => finishOld(plan));
  expect(screen.getByRole("textbox", { name: "Synopsis" })).toBe(synopsis);
  expect((synopsis as HTMLTextAreaElement).value).toBe("A cartographer follows stolen hours.");
  fireEvent.click(screen.getByRole("button", { name: "Save Brief" }));
  await waitFor(() => expect(updateProjectBrief).toHaveBeenCalledWith("/books/plan", expect.objectContaining({ synopsis: "A cartographer follows stolen hours." }), undefined));
});

it("starts saved guidance compact and opens editing only on request", async () => {
  vi.mocked(getManuscriptPlan).mockResolvedValue({ ...plan, brief: { ...plan.brief, synopsis: "A cartographer follows stolen hours.", genre: "Fantasy", themes: ["Trust"], style_guide: "Keep close third person.", outline: "Return to the harbor." } });
  render(<PlanEditor />);
  const edit = await screen.findByRole("button", { name: "Edit saved brief" });
  expect(edit.getAttribute("aria-expanded")).toBe("false");
  expect(screen.getByText("A cartographer follows stolen hours.", { selector: "p" })).toBeTruthy();
  expect(screen.getByText("Fantasy · Trust")).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "Synopsis" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Discard local Plan drafts…" })).toBeNull();
  fireEvent.click(edit);
  expect((screen.getByRole("textbox", { name: "Style guide" }) as HTMLTextAreaElement).value).toBe("Keep close third person.");
  fireEvent.click(screen.getByRole("button", { name: "Collapse saved brief" }));
  expect(screen.queryByRole("textbox", { name: "Outline" })).toBeNull();
  expect(updateProjectBrief).not.toHaveBeenCalled();
});

it("keeps unsaved edits and their save action visible through recovery of a saved brief", async () => {
  const saved = { ...plan, workspace: "main", brief: { ...plan.brief, synopsis: "Saved direction" } };
  vi.mocked(getManuscriptPlan).mockResolvedValue(saved);
  const view = render(<PlanEditor />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit saved brief" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Synopsis" }), { target: { value: "Keep this unsaved direction" } });
  expect(screen.getByText("Unsaved brief · kept on this device")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Collapse saved brief" })).toBeNull();
  view.unmount(); render(<PlanEditor />);
  expect((await screen.findByRole("textbox", { name: "Synopsis" }) as HTMLTextAreaElement).value).toBe("Keep this unsaved direction");
  expect((screen.getByRole("button", { name: "Save Brief" }) as HTMLButtonElement).disabled).toBe(false);
  expect(updateProjectBrief).not.toHaveBeenCalled();
});

it("recovers brief and new act drafts after remount without writing the book", async () => {
  vi.mocked(getManuscriptPlan).mockResolvedValue({ ...plan, workspace: "main" });
  const view = render(<PlanEditor />);
  fireEvent.change(await screen.findByRole("textbox", { name: "Synopsis" }), { target: { value: "Unsaved brief" } });
  fireEvent.change(screen.getByPlaceholderText("New act title"), { target: { value: "Unfinished act" } });
  view.unmount(); render(<PlanEditor />);
  expect((await screen.findByRole("textbox", { name: "Synopsis" }) as HTMLTextAreaElement).value).toBe("Unsaved brief");
  expect((screen.getByPlaceholderText("New act title") as HTMLInputElement).value).toBe("Unfinished act");
  expect(updateProjectBrief).not.toHaveBeenCalled();
  expect(addPlanAct).not.toHaveBeenCalled();
});

it("keeps a failed act draft and preserves the brief through a successful structural refresh", async () => {
  vi.mocked(getManuscriptPlan).mockResolvedValue(plan);
  vi.mocked(addPlanAct).mockRejectedValueOnce(new Error("Cannot save")).mockResolvedValueOnce({ id: "act", title: "New", chapters: [], position: 1, synopsis: "" });
  render(<PlanEditor />);
  fireEvent.change(await screen.findByRole("textbox", { name: "Synopsis" }), { target: { value: "Keep this brief" } });
  fireEvent.change(screen.getByPlaceholderText("New act title"), { target: { value: "New" } });
  fireEvent.click(screen.getByRole("button", { name: "Add Act" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "Add Act" }) as HTMLButtonElement).disabled).toBe(false));
  expect((screen.getByPlaceholderText("New act title") as HTMLInputElement).value).toBe("New");
  fireEvent.click(screen.getByRole("button", { name: "Add Act" }));
  await waitFor(() => expect((screen.getByPlaceholderText("New act title") as HTMLInputElement).value).toBe(""));
  expect((screen.getByRole("textbox", { name: "Synopsis" }) as HTMLTextAreaElement).value).toBe("Keep this brief");
});

it("preserves typing after a brief save starts and advances only its acknowledged baseline", async () => {
  let finish!: (value: ManuscriptPlan) => void;
  vi.mocked(getManuscriptPlan).mockResolvedValue({ ...plan, workspace: "main" });
  vi.mocked(updateProjectBrief).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const view = render(<PlanEditor />);
  const input = await screen.findByRole("textbox", { name: "Synopsis" });
  fireEvent.change(input, { target: { value: "Submitted" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Brief" }));
  fireEvent.change(input, { target: { value: "Typed during save" } });
  const saved = { ...plan, workspace: "main", brief: { ...plan.brief, synopsis: "Submitted" } };
  vi.mocked(getManuscriptPlan).mockResolvedValue(saved);
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  await act(async () => finish(saved));
  view.unmount(); render(<PlanEditor />);
  expect((await screen.findByRole("textbox", { name: "Synopsis" }) as HTMLTextAreaElement).value).toBe("Typed during save");
  fireEvent.click(screen.getByRole("button", { name: "Save Brief" }));
  await waitFor(() => expect(updateProjectBrief).toHaveBeenLastCalledWith("/books/plan", expect.objectContaining({ synopsis: "Typed during save" }), { workspace: "main", value: saved.brief }));
});

it("does not restore drafts into a different Storyline", async () => {
  vi.mocked(getManuscriptPlan).mockResolvedValue({ ...plan, workspace: "main" });
  const view = render(<PlanEditor />);
  fireEvent.change(await screen.findByRole("textbox", { name: "Synopsis" }), { target: { value: "Main only" } });
  view.unmount();
  vi.mocked(getManuscriptPlan).mockResolvedValue({ ...plan, workspace: "alternate" });
  render(<PlanEditor />);
  expect((await screen.findByRole("textbox", { name: "Synopsis" }) as HTMLTextAreaElement).value).toBe("");
});

it("refreshes a newly saved note while keeping an unfinished Plan brief and an existing dirty scene", async () => {
  workspace.scenes = [{ id: "s1", title: "Clocktower" }];
  editor.tabs = [{ id: "scene:s1", modified: true }];
  vi.mocked(getManuscriptPlan).mockResolvedValue(plan);
  const view = render(<PlanEditor />);
  fireEvent.change(await screen.findByRole("textbox", { name: "Synopsis" }), { target: { value: "Unfinished idea" } });
  const note = { id: "n1", title: "New idea", content: "Make the choice costly.", scene_id: "s1", source: "assistant", created_at: "today" };
  vi.mocked(getManuscriptPlan).mockResolvedValue({ ...plan, notes: [note] });
  view.rerender(<PlanEditor focusNoteId="n1" />);
  await screen.findByText("New idea");
  expect((screen.getByRole("textbox", { name: "Synopsis" }) as HTMLTextAreaElement).value).toBe("Unfinished idea");
  fireEvent.click(screen.getByRole("button", { name: "Open scene: Clocktower" }));
  expect(editor.setActiveTab).toHaveBeenCalledWith("scene:s1");
  expect(getScene).not.toHaveBeenCalled();
  expect(editor.openTab).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Plan a revision" }));
  expect(editor.openTab).toHaveBeenCalledWith(expect.objectContaining({ kind: "generate", data: { sceneId: "s1", instruction: note.content } }));
  expect(updateProjectBrief).not.toHaveBeenCalled();
});
