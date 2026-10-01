// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { addPlanAct, getManuscriptPlan, listCharacterArcStates, updateProjectBrief, getScene } from "../../api";
import type { ManuscriptPlan } from "../../types";
import { PlanEditor } from "./PlanEditor";

const editor = vi.hoisted(() => ({ openTab: vi.fn(), setActiveTab: vi.fn(), beginNavigation: vi.fn(() => () => true), tabs: [] as Array<{ id: string; modified?: boolean }> }));
const workspace = vi.hoisted(() => ({ projectRoot: "/books/plan", scenes: [] as Array<{ id: string; title: string }>, codexEntities: [], setError: vi.fn(), setMessage: vi.fn() }));
vi.mock("../../api", () => ({ addPlanAct: vi.fn(), getManuscriptPlan: vi.fn(), listCharacterArcStates: vi.fn(), updateProjectBrief: vi.fn(), getScene: vi.fn() }));
vi.mock("../../contexts/EditorContext", () => ({ useEditor: () => editor }));
vi.mock("../../contexts/WorkspaceContext", () => ({ useWorkspace: () => workspace }));
const plan: ManuscriptPlan = { schema_version: 1, brief: { synopsis: "", genre: "", themes: [], style_guide: "", outline: "" }, acts: [], beats: [], unassigned_scene_ids: [], scene_metadata: {}, notes: [] };

beforeEach(() => { vi.resetAllMocks(); editor.tabs = []; workspace.scenes = []; editor.beginNavigation.mockReturnValue(() => true); localStorage.clear(); vi.mocked(listCharacterArcStates).mockResolvedValue([]); });
afterEach(cleanup);

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
  expect(updateProjectBrief).toHaveBeenCalledWith("/books/plan", expect.objectContaining({ synopsis: "A cartographer follows stolen hours." }), undefined);
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
  await act(async () => finish(saved));
  view.unmount(); render(<PlanEditor />);
  expect((await screen.findByRole("textbox", { name: "Synopsis" }) as HTMLTextAreaElement).value).toBe("Typed during save");
  fireEvent.click(screen.getByRole("button", { name: "Save Brief" }));
  expect(updateProjectBrief).toHaveBeenLastCalledWith("/books/plan", expect.objectContaining({ synopsis: "Typed during save" }), { workspace: "main", value: saved.brief });
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
