// @vitest-environment jsdom
import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateSceneMetadata } from "../../api";
import { EditorProvider, useEditor } from "../../contexts/EditorContext";
import { SceneEditConflictError } from "../../sceneConflicts";
import type { SceneDetail } from "../../types";
import { InspectorPanel } from "./InspectorPanel";

const workspace = vi.hoisted(() => ({ projectRoot: "/book", proposals: [], refreshScenes: vi.fn(), setError: vi.fn(), setMessage: vi.fn() }));
vi.mock("../../contexts/WorkspaceContext", () => ({ useWorkspace: () => workspace }));
vi.mock("../../api", () => ({ updateSceneMetadata: vi.fn() }));
const scene: SceneDetail = { id: "scene-0001", title: "Letter", body: "Prose", summary: "Original", pov: "Mara", status: "draft", created_at: "today", updated_at: "today", path: "scene.md", edit_version: { schema_version: 1, scene_id: "scene-0001", workspace: "a".repeat(64), storyline: "main", fields: { title: "b".repeat(64), body: "b".repeat(64), summary: "b".repeat(64), pov: "b".repeat(64), status: "b".repeat(64) } } };
const updated = { ...scene, summary: "Other summary", body: "New prose", edit_version: { ...scene.edit_version!, fields: { ...scene.edit_version!.fields, summary: "c".repeat(64), body: "d".repeat(64) } } };
function Harness() {
  const { openTab, updateTab } = useEditor();
  useEffect(() => openTab({ id: scene.id, kind: "scene", label: scene.title, data: scene }), [openTab]);
  return <><button onClick={() => updateTab(scene.id, { data: updated })}>Receive scene refresh</button><InspectorPanel /></>;
}

describe("Inspector save conflicts", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("keeps entered details and their original version when a scene refresh arrives", async () => {
    vi.mocked(updateSceneMetadata).mockResolvedValueOnce({ ...updated, summary: "My summary" });
    render(<EditorProvider><Harness /></EditorProvider>);
    fireEvent.change(screen.getByLabelText("Scene summary"), { target: { value: "My summary" } });
    fireEvent.click(screen.getByText("Receive scene refresh"));
    expect((screen.getByLabelText("Scene summary") as HTMLTextAreaElement).value).toBe("My summary");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save scene details" })));
    expect(updateSceneMetadata).toHaveBeenCalledWith("/book", scene.id, { summary: "My summary", pov: "Mara", status: "draft", expectedVersion: scene.edit_version });
  });

  it("requires reviewed details after a conflict and checks the reviewed version again", async () => {
    vi.mocked(updateSceneMetadata).mockRejectedValueOnce(new SceneEditConflictError({ code: "scene_edit_conflict", reason: "scene_changed", current: updated, conflicting_fields: ["summary"], recovery_path: "conflict.json" }));
    render(<EditorProvider><Harness /></EditorProvider>);
    fireEvent.change(screen.getByLabelText("Scene summary"), { target: { value: "My summary" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save scene details" })));
    expect(screen.getByRole("heading", { name: "Scene details changed elsewhere" })).toBeTruthy();
    expect((screen.getByLabelText("Scene summary") as HTMLTextAreaElement).value).toBe("My summary");
    vi.mocked(updateSceneMetadata).mockResolvedValueOnce({ ...updated, summary: "My summary" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save reviewed details" })));
    expect(updateSceneMetadata).toHaveBeenLastCalledWith("/book", scene.id, expect.objectContaining({ expectedVersion: updated.edit_version }));
  });
});
