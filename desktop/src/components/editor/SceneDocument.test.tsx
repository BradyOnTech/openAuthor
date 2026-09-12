// @vitest-environment jsdom
import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getScene, updateScene } from "../../api";
import { EditorProvider, useEditor } from "../../contexts/EditorContext";
import type { SceneDetail } from "../../types";
import { SceneDocument } from "./SceneDocument";

vi.mock("../../api", () => ({ getScene: vi.fn(), updateScene: vi.fn() }));
const workspace = vi.hoisted(() => ({ projectRoot: "/books/fixture", refreshScenes: vi.fn(async () => {}), setError: vi.fn() }));
vi.mock("../../contexts/WorkspaceContext", () => ({ useWorkspace: () => workspace }));
const original: SceneDetail = {
  id: "scene-1", title: "Ending", body: "Mara goes home.", summary: "", pov: "Mara", status: "draft", path: "manuscript/scenes/ending.md", created_at: "", updated_at: "",
  edit_version: { schema_version: 1, scene_id: "scene-1", workspace: "a".repeat(64), storyline: "main", fields: { title: "a", body: "a", summary: "a", pov: "a", status: "a" } },
};
const current: SceneDetail = { ...original, body: "Mara stays behind.", edit_version: { ...original.edit_version!, workspace: "b".repeat(64), storyline: "alternate" } };

function Harness({ modified = false }: { modified?: boolean }) {
  const { tabs, openTab, closeTab } = useEditor();
  useEffect(() => { openTab({ id: "scene:scene-1", kind: "scene", label: "Ending", data: original, modified }); }, [openTab]);
  const tab = tabs[0];
  return <><button onClick={() => closeTab("scene:scene-1")}>Close scene</button>{tab && <SceneDocument tabId={tab.id} scene={tab.data as SceneDetail} modified={tab.modified} />}</>;
}

describe("scene activation", () => {
  beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); vi.mocked(getScene).mockResolvedValue(current); });
  afterEach(cleanup);

  it("loads the current Storyline before permitting edits and saves against its version", async () => {
    render(<EditorProvider><Harness /></EditorProvider>);
    expect(screen.queryByRole("textbox", { name: "Scene prose" })).toBeNull();
    const prose = await screen.findByRole("textbox", { name: "Scene prose" });
    expect((prose as HTMLTextAreaElement).value).toBe(current.body);
    vi.mocked(updateScene).mockResolvedValue({ ...current, body: "A stronger chosen ending." });
    fireEvent.change(prose, { target: { value: "A stronger chosen ending." } });
    await act(async () => fireEvent.keyDown(window, { key: "s", ctrlKey: true }));
    expect(updateScene).toHaveBeenCalledWith(workspace.projectRoot, original.id, expect.objectContaining({ expectedVersion: current.edit_version }));
  });

  it("never silently replaces the version of an already-dirty tab", async () => {
    render(<EditorProvider><Harness modified /></EditorProvider>);
    const prose = screen.getByRole("textbox", { name: "Scene prose" });
    expect(getScene).not.toHaveBeenCalled();
    vi.mocked(updateScene).mockResolvedValue({ ...original, body: "Original branch draft." });
    fireEvent.change(prose, { target: { value: "Original branch draft." } });
    await act(async () => fireEvent.keyDown(window, { key: "s", ctrlKey: true }));
    expect(updateScene).toHaveBeenCalledWith(workspace.projectRoot, original.id, expect.objectContaining({ expectedVersion: original.edit_version }));
  });

  it("keeps failed loading non-editable and supports explicit retry", async () => {
    vi.mocked(getScene).mockRejectedValueOnce(new Error("Scene temporarily unavailable"));
    render(<EditorProvider><Harness /></EditorProvider>);
    expect((await screen.findByRole("alert")).textContent).toContain("temporarily unavailable");
    expect(screen.queryByRole("textbox", { name: "Scene prose" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry opening scene" }));
    await screen.findByRole("textbox", { name: "Scene prose" });
  });

  it("does not reopen a tab when its old loading request finishes", async () => {
    let finish!: (scene: SceneDetail) => void;
    vi.mocked(getScene).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    render(<EditorProvider><Harness /></EditorProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Close scene" }));
    await act(async () => finish(current));
    expect(screen.queryByRole("textbox", { name: "Scene prose" })).toBeNull();
  });
});
