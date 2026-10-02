// @vitest-environment jsdom

import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getScene, updateScene } from "../../api";
import { EditorProvider, useEditor } from "../../contexts/EditorContext";
import { listSceneRecoveryDrafts, readSceneRecoveryDraft, writeSceneRecoveryDraft } from "../../recoveryJournal";
import { SceneEditConflictError, type SceneConflict } from "../../sceneConflicts";
import type { SceneDetail } from "../../types";
import { SceneEditor } from "./SceneEditor";

const workspace = vi.hoisted(() => ({
  projectRoot: "/novels/save-safety",
  refreshScenes: vi.fn(async () => {}),
  setError: vi.fn(),
}));

vi.mock("../../contexts/WorkspaceContext", () => ({ useWorkspace: () => workspace }));
vi.mock("../../api", () => ({ updateScene: vi.fn(), getScene: vi.fn() }));

const scene: SceneDetail = {
  id: "scene-0001",
  title: "The arrival",
  body: "Mara reached the station.\n",
  summary: "Mara arrives",
  pov: "Mara",
  status: "draft",
  path: "manuscript/scenes/0001-the-arrival.md",
  created_at: "2026-09-07T12:00:00Z",
  updated_at: "2026-09-07T12:00:00Z",
  edit_version: { schema_version: 1, scene_id: "scene-0001", workspace: "b".repeat(64), storyline: "main", fields: { title: "a".repeat(64), body: "a".repeat(64), summary: "a".repeat(64), pov: "a".repeat(64), status: "a".repeat(64) } },
};

const changedScene: SceneDetail = { ...scene, body: "Another writer’s passage.\n", edit_version: { ...scene.edit_version!, fields: { ...scene.edit_version!.fields, body: "c".repeat(64) } } };
function conflictError(current = changedScene, reason: SceneConflict["reason"] = "scene_changed") {
  return new SceneEditConflictError({ code: "scene_edit_conflict", reason, current, conflicting_fields: ["body"], recovery_path: ".openauthor/workspace/scene-conflicts/fixture.json" });
}

function EditorHarness() {
  const { tabs, activeTabId, openTab, closeTab } = useEditor();
  useEffect(() => openTab({ id: scene.id, kind: "scene", label: scene.title, data: scene }), [openTab]);
  const tab = tabs.find((item) => item.id === activeTabId);
  return <>
    <button onClick={() => closeTab(activeTabId)}>Close scene</button>
    {tab && <SceneEditor key={tab.id} scene={tab.data as SceneDetail} />}
  </>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function SplitEditorHarness() {
  const { tabs, openTab } = useEditor();
  useEffect(() => {
    openTab({ id: scene.id, kind: "scene", label: scene.title, data: scene });
    openTab({ id: "scene-0002", kind: "scene", label: "Other scene", data: { ...scene, id: "scene-0002", title: "Other scene", body: "Other prose." } });
  }, [openTab]);
  return <>{tabs.map(tab => <section key={tab.id}>
    <output aria-label={`Draft in ${tab.id}`}>{(tab.data as SceneDetail).body}</output>
    <SceneEditor tabId={tab.id} scene={tab.data as SceneDetail} />
  </section>)}</>;
}

function saveShortcut() {
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
}

describe("scene save safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    workspace.projectRoot = `/novels/save-safety-${crypto.randomUUID()}`;
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it("keeps each restored split editor's draft attached to its own tab", async () => {
    vi.mocked(updateScene).mockImplementation(async (_root, _id, changes) => ({ ...scene, body: changes.body ?? scene.body }));
    render(<EditorProvider><SplitEditorHarness /></EditorProvider>);
    fireEvent.change(screen.getAllByRole("textbox", { name: "Scene prose" })[0], { target: { value: "First pane changed." } });
    expect(screen.getByLabelText("Draft in scene-0001").textContent).toBe("First pane changed.");
    expect(screen.getByLabelText("Draft in scene-0002").textContent).toBe("Other prose.");
    await act(async () => saveShortcut());
  });

  it("retains conflict comparison and reconciliation after closing and reopening the editor", async () => {
    vi.mocked(updateScene).mockRejectedValueOnce(conflictError());
    const first = render(<EditorProvider><SceneEditor scene={scene} /></EditorProvider>);
    fireEvent.change(screen.getByRole("textbox", { name: "Scene prose" }), { target: { value: "My pending draft." } });
    await act(async () => saveShortcut());
    first.unmount();
    render(<EditorProvider><SceneEditor scene={scene} /></EditorProvider>);
    expect(screen.getByRole("heading", { name: "Scene changed elsewhere" })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Scene prose" }) as HTMLTextAreaElement).value).toBe("My pending draft.");
    vi.mocked(updateScene).mockResolvedValueOnce({ ...changedScene, body: "My pending draft.\n" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save reconciled version" })));
    expect(updateScene).toHaveBeenLastCalledWith(workspace.projectRoot, scene.id, expect.objectContaining({ expectedVersion: changedScene.edit_version }));
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  it("pauses conflicting autosaves and explicitly saves the newest reconciled draft against the reviewed version", async () => {
    vi.useFakeTimers();
    vi.mocked(updateScene).mockRejectedValueOnce(conflictError());
    render(<EditorProvider><EditorHarness /></EditorProvider>);
    fireEvent.change(screen.getByRole("textbox", { name: "Scene prose" }), { target: { value: "My conflicting draft." } });
    await act(async () => saveShortcut());
    expect(screen.getByRole("heading", { name: "Scene changed elsewhere" })).toBeTruthy();
    expect(readSceneRecoveryDraft(workspace.projectRoot, scene.id)?.body).toBe("My conflicting draft.");
    fireEvent.change(screen.getByRole("textbox", { name: "Scene prose" }), { target: { value: "Both versions reconciled." } });
    await act(async () => { saveShortcut(); await vi.advanceTimersByTimeAsync(3000); });
    expect(updateScene).toHaveBeenCalledTimes(1);
    vi.mocked(updateScene).mockResolvedValueOnce({ ...changedScene, body: "Both versions reconciled.\n" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save reconciled version" })));
    expect(updateScene).toHaveBeenLastCalledWith(workspace.projectRoot, scene.id, {
      title: scene.title, body: "Both versions reconciled.", expectedVersion: changedScene.edit_version,
    });
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(readSceneRecoveryDraft(workspace.projectRoot, scene.id)).toBeNull();
  });

  it("keeps a recovered draft's original version instead of authorizing replacement of the newly loaded scene", async () => {
    writeSceneRecoveryDraft({ projectRoot: workspace.projectRoot, sceneId: scene.id, baseUpdatedAt: "old", baseVersion: changedScene.edit_version, title: scene.title, body: "Recovered older writing." });
    vi.mocked(updateScene).mockRejectedValueOnce(conflictError());
    render(<EditorProvider><EditorHarness /></EditorProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await act(async () => saveShortcut());
    expect(updateScene).toHaveBeenLastCalledWith(workspace.projectRoot, scene.id, expect.objectContaining({ expectedVersion: changedScene.edit_version }));
    expect(screen.getByRole("heading", { name: "Scene changed elsewhere" })).toBeTruthy();
    expect(readSceneRecoveryDraft(workspace.projectRoot, scene.id)?.baseVersion).toEqual(changedScene.edit_version);
  });

  it("requires comparison before saving a legacy recovery draft with no version", async () => {
    writeSceneRecoveryDraft({ projectRoot: workspace.projectRoot, sceneId: scene.id, baseUpdatedAt: "old", title: scene.title, body: "Legacy recovered writing." });
    render(<EditorProvider><EditorHarness /></EditorProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await act(async () => saveShortcut());
    expect(updateScene).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Scene changed elsewhere" })).toBeTruthy();
  });

  it("lets the author choose a recovery draft without retiring another window's newer writing", async () => {
    const first = writeSceneRecoveryDraft({ projectRoot: workspace.projectRoot, sceneId: scene.id, baseUpdatedAt: "old", baseVersion: scene.edit_version, title: scene.title, body: "First window.", draftId: "first-window", sequence: 1 })!;
    writeSceneRecoveryDraft({ ...first, draftId: "other-window", body: "Other window." });
    render(<EditorProvider><EditorHarness /></EditorProvider>);
    expect(screen.getByRole("combobox", { name: "Recovery draft" }).children).toHaveLength(2);
    const drafts = listSceneRecoveryDrafts(workspace.projectRoot, scene.id);
    fireEvent.change(screen.getByRole("combobox", { name: "Recovery draft" }), { target: { value: String(drafts.findIndex((draft) => draft.draftId === first.draftId)) } });
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect((screen.getByRole("textbox", { name: "Scene prose" }) as HTMLTextAreaElement).value).toBe(first.body);
    fireEvent.change(screen.getByRole("textbox", { name: "Scene prose" }), { target: { value: "Reviewed recovered writing." } });
    writeSceneRecoveryDraft({ ...first, sequence: 2, body: "First window kept writing." });
    vi.mocked(updateScene).mockResolvedValueOnce({ ...scene, body: "Reviewed recovered writing.\n" });
    await act(async () => saveShortcut());
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(listSceneRecoveryDrafts(workspace.projectRoot, scene.id).map((draft) => draft.body).sort()).toEqual(["First window kept writing.", "Other window."]);
    expect(screen.getByRole("combobox", { name: "Recovery draft" }).children).toHaveLength(2);
  });

  it("refuses reconciliation onto another Storyline until the author switches back and refreshes the comparison", async () => {
    const alternate = { ...changedScene, edit_version: { ...changedScene.edit_version!, workspace: "d".repeat(64), storyline: "alternate" } };
    vi.mocked(updateScene).mockRejectedValueOnce(conflictError(alternate, "storyline_changed"));
    render(<EditorProvider><EditorHarness /></EditorProvider>);
    fireEvent.change(screen.getByRole("textbox", { name: "Scene prose" }), { target: { value: "Draft for main." } });
    await act(async () => saveShortcut());
    expect((screen.getByRole("button", { name: "Save reconciled version" }) as HTMLButtonElement).disabled).toBe(true);
    vi.mocked(getScene).mockResolvedValueOnce(changedScene);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reload latest comparison" })));
    expect((screen.getByRole("button", { name: "Save reconciled version" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("textbox", { name: "Scene prose" }) as HTMLTextAreaElement).value).toBe("Draft for main.");
  });

  it("only transfers a draft into the current Storyline after an explicit destination choice", async () => {
    const alternate = { ...changedScene, edit_version: { ...changedScene.edit_version!, workspace: "d".repeat(64), storyline: "alternate" } };
    vi.mocked(updateScene).mockRejectedValueOnce(conflictError(alternate, "storyline_changed"));
    render(<EditorProvider><EditorHarness /></EditorProvider>);
    fireEvent.change(screen.getByRole("textbox", { name: "Scene prose" }), { target: { value: "A deliberate transfer." } });
    await act(async () => saveShortcut());
    expect((screen.getByRole("button", { name: "Save reconciled version" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Save this reviewed draft into alternate" }));
    vi.mocked(updateScene).mockResolvedValueOnce({ ...alternate, body: "A deliberate transfer.\n" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save reconciled version" })));
    expect(updateScene).toHaveBeenLastCalledWith(workspace.projectRoot, scene.id, expect.objectContaining({ expectedVersion: alternate.edit_version, body: "A deliberate transfer." }));
  });

  it("preserves writing entered while an earlier save is completing", async () => {
    const first = deferred<SceneDetail>();
    const second = deferred<SceneDetail>();
    vi.mocked(updateScene).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<EditorProvider><EditorHarness /></EditorProvider>);

    fireEvent.change(screen.getByPlaceholderText("Begin writing..."), { target: { value: "Mara opened the letter." } });
    saveShortcut();
    expect(updateScene).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByPlaceholderText("Begin writing..."), { target: { value: "Mara opened the letter. Her name was missing." } });
    await act(async () => first.resolve({ ...scene, body: "Mara opened the letter.\n" }));

    expect((screen.getByPlaceholderText("Begin writing...") as HTMLTextAreaElement).value)
      .toBe("Mara opened the letter. Her name was missing.");
    expect(readSceneRecoveryDraft(workspace.projectRoot, scene.id)?.body)
      .toBe("Mara opened the letter. Her name was missing.");

    saveShortcut();
    expect(updateScene).toHaveBeenLastCalledWith(workspace.projectRoot, scene.id, expect.objectContaining({
      body: "Mara opened the letter. Her name was missing.",
    }));
    await act(async () => second.resolve({ ...scene, body: "Mara opened the letter. Her name was missing.\n" }));
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(readSceneRecoveryDraft(workspace.projectRoot, scene.id)).toBeNull();
  });

  it("finishes saving the newest draft when the author closes the scene during a save", async () => {
    const first = deferred<SceneDetail>();
    const second = deferred<SceneDetail>();
    vi.mocked(updateScene).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<EditorProvider><EditorHarness /></EditorProvider>);
    fireEvent.change(screen.getByPlaceholderText("Begin writing..."), { target: { value: "First sentence." } });
    saveShortcut();
    fireEvent.change(screen.getByPlaceholderText("Begin writing..."), { target: { value: "First sentence. Last sentence." } });
    fireEvent.click(screen.getByText("Close scene"));

    await act(async () => first.resolve({ ...scene, body: "First sentence.\n" }));
    expect(updateScene).toHaveBeenCalledTimes(2);
    expect(updateScene).toHaveBeenLastCalledWith(workspace.projectRoot, scene.id, expect.objectContaining({
      body: "First sentence. Last sentence.",
    }));
    expect(readSceneRecoveryDraft(workspace.projectRoot, scene.id)?.body).toBe("First sentence. Last sentence.");
    await act(async () => second.resolve({ ...scene, body: "First sentence. Last sentence.\n" }));
    expect(readSceneRecoveryDraft(workspace.projectRoot, scene.id)).toBeNull();
  });

  it("keeps failed writing recoverable and offers an explicit save retry", async () => {
    const first = deferred<SceneDetail>();
    const retry = deferred<SceneDetail>();
    vi.mocked(updateScene).mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
    render(<EditorProvider><EditorHarness /></EditorProvider>);
    fireEvent.change(screen.getByPlaceholderText("Begin writing..."), { target: { value: "Do not lose this passage." } });
    saveShortcut();
    await act(async () => first.reject(new Error("Disk is full")));

    expect((screen.getByPlaceholderText("Begin writing...") as HTMLTextAreaElement).value).toBe("Do not lose this passage.");
    expect(readSceneRecoveryDraft(workspace.projectRoot, scene.id)?.body).toBe("Do not lose this passage.");
    expect(screen.queryByText("Saved")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    await act(async () => retry.resolve({ ...scene, body: "Do not lose this passage.\n" }));
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry save" })).toBeNull();
  });

  it("saves only prose and title so a pending save cannot undo Inspector edits", async () => {
    vi.mocked(updateScene).mockResolvedValueOnce({ ...scene, body: "Updated prose.\n", status: "final" });
    render(<EditorProvider><EditorHarness /></EditorProvider>);
    fireEvent.change(screen.getByRole("textbox", { name: "Scene prose" }), { target: { value: "Updated prose." } });
    await act(async () => saveShortcut());
    expect(updateScene).toHaveBeenCalledWith(workspace.projectRoot, scene.id, {
      title: scene.title,
      body: "Updated prose.",
      expectedVersion: scene.edit_version,
    });
  });

  it("does not offer discarded writing as recovery after the author returns to the saved text", () => {
    render(<EditorProvider><EditorHarness /></EditorProvider>);
    fireEvent.change(screen.getByRole("textbox", { name: "Scene prose" }), { target: { value: "A discarded direction." } });
    expect(readSceneRecoveryDraft(workspace.projectRoot, scene.id)?.body).toBe("A discarded direction.");
    fireEvent.change(screen.getByRole("textbox", { name: "Scene prose" }), { target: { value: scene.body } });
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(readSceneRecoveryDraft(workspace.projectRoot, scene.id)).toBeNull();
  });

  it("keeps the editor usable and warns if the recovery store fills up", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    vi.mocked(updateScene).mockResolvedValueOnce({ ...scene, body: "Writing with full recovery storage.\n" });
    render(<EditorProvider><EditorHarness /></EditorProvider>);
    fireEvent.change(screen.getByRole("textbox", { name: "Scene prose" }), { target: { value: "Writing with full recovery storage." } });
    expect(screen.getByRole("alert").textContent).toContain("Recovery storage is unavailable");
    await act(async () => saveShortcut());
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("can save new writing while a previous scene-list refresh is still pending", async () => {
    const refresh = deferred<void>();
    workspace.refreshScenes.mockReturnValueOnce(refresh.promise);
    vi.mocked(updateScene)
      .mockResolvedValueOnce({ ...scene, body: "First saved passage.\n" })
      .mockResolvedValueOnce({ ...scene, body: "Second saved passage.\n" });
    render(<EditorProvider><EditorHarness /></EditorProvider>);
    fireEvent.change(screen.getByRole("textbox", { name: "Scene prose" }), { target: { value: "First saved passage." } });
    await act(async () => saveShortcut());
    fireEvent.change(screen.getByRole("textbox", { name: "Scene prose" }), { target: { value: "Second saved passage." } });
    await act(async () => saveShortcut());
    expect(updateScene).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Saved")).toBeTruthy();
    await act(async () => refresh.resolve());
  });
});
