// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getManuscriptPlan, getScene } from "../../api";
import type { ManuscriptPlan, SceneSummary } from "../../types";
import { ManuscriptExplorer } from "./ManuscriptExplorer";

const workspace = vi.hoisted(() => ({
  projectRoot: "/books/fixture", scenes: [] as SceneSummary[], branches: [{ name: "main", current: true, upstream: "" }],
  refreshScenes: vi.fn(), setMessage: vi.fn(), setError: vi.fn(),
}));
const editor = vi.hoisted(() => ({ activeTabId: "scene:scene-2", openTab: vi.fn() }));
vi.mock("../../contexts/WorkspaceContext", () => ({ useWorkspace: () => workspace }));
vi.mock("../../contexts/EditorContext", () => ({ useEditor: () => editor }));
vi.mock("../../api", () => ({ getManuscriptPlan: vi.fn(), getScene: vi.fn(), addScene: vi.fn() }));
const scenes: SceneSummary[] = ["The Map", "The Door", "The Ferry"].map((title, index) => ({
  id: `scene-${index + 1}`, title, summary: "", pov: index === 1 ? "Ivo" : "Mara", status: "draft", path: "", created_at: "", updated_at: "", word_count: 100,
}));
const plan: ManuscriptPlan = {
  schema_version: 2, brief: { synopsis: "", genre: "", style_guide: "", outline: "", themes: [] }, beats: [], notes: [], scene_metadata: {}, unassigned_scene_ids: ["scene-3"],
  acts: [{ id: "act-1", title: "The Lost Hour", synopsis: "", position: 1, chapters: [
    { id: "chapter-1", title: "The Choice", synopsis: "", position: 1, scene_ids: ["scene-2", "scene-1"] },
    { id: "chapter-2", title: "The Cost", synopsis: "", position: 2, scene_ids: [] },
  ] }],
};
const sceneButtons = () => within(screen.getByRole("navigation", { name: "Manuscript scenes" })).getAllByRole("button", { name: / DRA$/ });

describe("chapter-aware manuscript navigation", () => {
  beforeEach(() => {
    vi.resetAllMocks(); workspace.projectRoot = "/books/fixture"; workspace.scenes = scenes; workspace.branches = [{ name: "main", current: true, upstream: "" }]; editor.activeTabId = "scene:scene-2";
    vi.mocked(getManuscriptPlan).mockResolvedValue(plan);
  });
  afterEach(cleanup);

  it("follows Plan order, retains unassigned scenes, marks the open scene and opens saved prose", async () => {
    render(<ManuscriptExplorer />);
    const chapter = await screen.findByRole("region", { name: "The Choice" });
    expect(sceneButtons().map((button) => button.textContent)).toEqual(["○The DoorDRA", "○The MapDRA", "○The FerryDRA"]);
    expect(within(chapter).getByRole("button", { name: /The Choice/ }).textContent).toContain("2 scenes · 200 words");
    expect(screen.getByRole("button", { name: "The Door DRA" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("region", { name: "Unassigned scenes" })).toBeTruthy();
    expect(screen.getByText("No scenes placed yet. Arrange this chapter in Plan.")).toBeTruthy();
    const fresh = { ...scenes[0], body: "Current saved prose." };
    vi.mocked(getScene).mockResolvedValue(fresh);
    fireEvent.click(screen.getByRole("button", { name: "The Map DRA" }));
    await waitFor(() => expect(editor.openTab).toHaveBeenCalledWith({ id: "scene:scene-1", kind: "scene", label: "The Map", data: fresh }));
  });

  it("collapses chapters and finds scenes by POV or chapter, revealing hidden matches", async () => {
    render(<ManuscriptExplorer />);
    const chapter = await screen.findByRole("button", { name: /The Choice/ });
    fireEvent.click(chapter);
    expect(chapter.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "The Door DRA" })).toBeNull();
    const filter = screen.getByRole("searchbox", { name: "Filter manuscript scenes" });
    fireEvent.change(filter, { target: { value: "Ivo" } });
    expect(sceneButtons()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "The Door DRA" })).toBeTruthy();
    fireEvent.change(filter, { target: { value: "The Choice" } });
    expect(sceneButtons()).toHaveLength(2);
    fireEvent.change(filter, { target: { value: "Missing scene" } });
    expect(screen.getByText(/No matching scenes/)).toBeTruthy();
  });

  it("keeps every scene accessible during a Plan failure and can retry", async () => {
    vi.mocked(getManuscriptPlan).mockRejectedValueOnce(new Error("Unreadable structure"));
    render(<ManuscriptExplorer />);
    expect((await screen.findByRole("status")).textContent).toContain("Showing all scenes");
    expect(sceneButtons()).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Retry chapter order" }));
    await screen.findByRole("region", { name: "The Choice" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("retains scenes missing from an older Plan response without duplicating assigned scenes", async () => {
    vi.mocked(getManuscriptPlan).mockResolvedValue({ ...plan, unassigned_scene_ids: ["scene-1", "deleted-scene"] });
    render(<ManuscriptExplorer />);
    await screen.findByRole("region", { name: "The Choice" });
    expect(sceneButtons()).toHaveLength(3);
    expect(within(screen.getByRole("region", { name: "Unassigned scenes" })).getByRole("button", { name: "The Ferry DRA" })).toBeTruthy();
  });

  it("refreshes chapter membership after leaving the Plan tab", async () => {
    editor.activeTabId = "plan";
    const view = render(<ManuscriptExplorer />);
    await screen.findByRole("region", { name: "The Choice" });
    vi.mocked(getManuscriptPlan).mockResolvedValue({ ...plan, acts: [] });
    editor.activeTabId = "scene:scene-1";
    view.rerender(<ManuscriptExplorer />);
    await waitFor(() => expect(screen.queryByRole("region", { name: "The Choice" })).toBeNull());
    expect(sceneButtons()).toHaveLength(3);
  });

  it("ignores an older Storyline's pending Plan response", async () => {
    let resolveOld!: (value: ManuscriptPlan) => void;
    vi.mocked(getManuscriptPlan).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
    const view = render(<ManuscriptExplorer />);
    vi.mocked(getManuscriptPlan).mockResolvedValue({ ...plan, acts: [] });
    workspace.branches = [{ name: "alternate", current: true, upstream: "" }];
    view.rerender(<ManuscriptExplorer />);
    await screen.findByRole("region", { name: "Unassigned scenes" });
    await act(async () => resolveOld(plan));
    expect(screen.queryByRole("region", { name: "The Choice" })).toBeNull();
  });
});
