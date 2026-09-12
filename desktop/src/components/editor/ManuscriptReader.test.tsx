// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getManuscriptReading, getScene } from "../../api";
import { ManuscriptReader } from "./ManuscriptReader";
import type { ManuscriptReading, SceneDetail } from "../../types";

const editor = vi.hoisted(() => ({ tabs: [] as Array<{ id: string; kind: string; modified?: boolean }>, openTab: vi.fn(), setActiveTab: vi.fn() }));
vi.mock("../../contexts/EditorContext", () => ({ useEditor: () => editor }));
vi.mock("../../contexts/WorkspaceContext", () => ({ useWorkspace: () => ({ projectRoot: "/books/fixture" }) }));
vi.mock("../../api", () => ({ getManuscriptReading: vi.fn(), getScene: vi.fn() }));

const scenes = ["Second written", "First written", "Unassigned"].map((title, index) => ({ id: `scene-${index}`, title, body: `Prose for ${title}.` } as SceneDetail));
const reading: ManuscriptReading = { schema_version: 1, scenes, word_count: 10, sections: [
  { id: "chapter-1", title: "Opening", act_title: "Act One", scene_ids: ["scene-0", "scene-1"] },
  { id: "unassigned", title: "Unassigned scenes", act_title: "", scene_ids: ["scene-2"] },
] };

describe("manuscript reading", () => {
  beforeEach(() => { vi.resetAllMocks(); editor.tabs = []; vi.mocked(getManuscriptReading).mockResolvedValue(reading); });
  afterEach(cleanup);

  it("reads chapters in saved order and fetches the current scene before opening its editor", async () => {
    render(<ManuscriptReader />);
    await screen.findByRole("main", { name: "Manuscript reading copy" });
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["Second written", "First written"]);
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next chapter" }));
    expect(screen.getByText("Prose for Unassigned.")).toBeTruthy();
    const fresh = { ...scenes[2], body: "Fresh saved prose." };
    vi.mocked(getScene).mockResolvedValueOnce(fresh);
    fireEvent.click(screen.getByRole("button", { name: "Edit Unassigned" }));
    await waitFor(() => expect(editor.openTab).toHaveBeenCalledWith({ id: "scene:scene-2", kind: "scene", label: "Unassigned", data: fresh }));
  });

  it("waits for pending editor saves and offers a route back to an unsaved scene", async () => {
    editor.tabs = [{ id: "scene:scene-0", kind: "scene", modified: true }];
    const view = render(<ManuscriptReader />);
    expect(getManuscriptReading).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Return to unsaved scene" }));
    expect(editor.setActiveTab).toHaveBeenCalledWith("scene:scene-0");
    editor.tabs = [];
    view.rerender(<ManuscriptReader />);
    await screen.findByRole("main", { name: "Manuscript reading copy" });
    expect(getManuscriptReading).toHaveBeenCalledTimes(1);
  });

  it("offers a retry when reading fails", async () => {
    vi.mocked(getManuscriptReading).mockRejectedValueOnce(new Error("Unavailable"));
    render(<ManuscriptReader />);
    expect((await screen.findByRole("alert")).textContent).toContain("Unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Refresh reading copy" }));
    await screen.findByRole("main", { name: "Manuscript reading copy" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("bounds rendered prose to 25 scenes while retaining access to the rest of a long chapter", async () => {
    const many = Array.from({ length: 26 }, (_, index) => ({ ...scenes[0], id: `scene-${index}`, title: `Scene ${index + 1}` }));
    vi.mocked(getManuscriptReading).mockResolvedValue({ ...reading, scenes: many, sections: [{ ...reading.sections[0], scene_ids: many.map((scene) => scene.id) }] });
    render(<ManuscriptReader />);
    await screen.findByRole("main", { name: "Manuscript reading copy" });
    expect(screen.getAllByRole("article")).toHaveLength(25);
    fireEvent.click(screen.getByRole("button", { name: "Next scenes" }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Scene 26" })).toBeTruthy();
  });
});
