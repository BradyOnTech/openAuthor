// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorProvider } from "../../contexts/EditorContext";
import { rememberTextLocation, restoreTextLocation } from "../../editorLocation";
import { writeSceneRecoveryDraft } from "../../recoveryJournal";
import type { SceneDetail } from "../../types";
import { SceneEditor } from "./SceneEditor";

const workspace = vi.hoisted(() => ({ projectRoot: "/books/focus", refreshScenes: vi.fn(async () => {}), setError: vi.fn() }));
vi.mock("../../contexts/WorkspaceContext", () => ({ useWorkspace: () => workspace }));
vi.mock("../../api", () => ({ getScene: vi.fn(), updateScene: vi.fn() }));
const scene: SceneDetail = {
  id: "scene-1", title: "Office", body: "Leah waited at the office.", summary: "", pov: "", status: "draft", path: "", created_at: "", updated_at: "",
  edit_version: { schema_version: 1, scene_id: "scene-1", workspace: "a".repeat(64), storyline: "main", fields: { title: "a", body: "a", summary: "a", pov: "a", status: "a" } },
};
function saveLocation(scope = scene.edit_version!.workspace, start = 6) {
  const node = document.createElement("textarea"); node.value = scene.body; node.setSelectionRange(start, start);
  rememberTextLocation(workspace.projectRoot, scope, scene.id, node);
}
function open(loaded = scene) {
  return render(<EditorProvider><SceneEditor scene={loaded} /></EditorProvider>);
}
function resetOnFocus() {
  const node = screen.getByRole("textbox", { name: "Scene prose" }) as HTMLTextAreaElement;
  act(() => node.focus());
  node.setSelectionRange(0, 0);
  fireEvent.select(node);
  return node;
}
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); workspace.projectRoot = `/books/focus-${crypto.randomUUID()}`; saveLocation();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("retains the saved location through WebKit's focus reset until the deferred restoration", async () => {
  open(); const node = resetOnFocus();
  expect(restoreTextLocation(workspace.projectRoot, scene.edit_version!.workspace, scene.id, scene.body)?.start).toBe(6);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(node.selectionStart).toBe(6);
});

it("restores a saved noncollapsed selection after WebKit's automatic zero range", async () => {
  const saved = document.createElement("textarea"); saved.value = scene.body; saved.setSelectionRange(6, 12, "backward");
  rememberTextLocation(workspace.projectRoot, scene.edit_version!.workspace, scene.id, saved);
  open(); const node = resetOnFocus();
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect([node.selectionStart, node.selectionEnd, node.selectionDirection]).toEqual([6, 12, "backward"]);
});

it.each(["keyboard", "paste", "composition"])("restores before immediate %s input without waiting for the focus task", async kind => {
  open(); const node = resetOnFocus();
  if (kind === "keyboard") fireEvent.keyDown(node, { key: "x" });
  else if (kind === "paste") fireEvent.paste(node);
  else fireEvent.compositionStart(node);
  expect(node.selectionStart).toBe(6);
  node.setSelectionRange(3, 3); fireEvent.select(node);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(node.selectionStart).toBe(3);
});

it.each(["keyboard", "paste", "composition"])("preserves select-all before immediate %s replacement while restoration is pending", async kind => {
  open(); const node = resetOnFocus();
  node.setSelectionRange(0, node.value.length);
  if (kind === "keyboard") fireEvent.keyDown(node, { key: "x" });
  else if (kind === "paste") fireEvent.paste(node);
  else fireEvent.compositionStart(node);
  expect([node.selectionStart, node.selectionEnd]).toEqual([0, scene.body.length]);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect([node.selectionStart, node.selectionEnd]).toEqual([0, scene.body.length]);
});

it.each([[12, 12], [2, 5]])("preserves an explicit programmatic range %s..%s before the deferred focus task", async (start, end) => {
  open(); const node = resetOnFocus();
  node.setSelectionRange(start, end); fireEvent.select(node);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect([node.selectionStart, node.selectionEnd]).toEqual([start, end]);
  expect(restoreTextLocation(workspace.projectRoot, scene.edit_version!.workspace, scene.id, scene.body)).toMatchObject({ start, end });
});

it("honors pointer placement before the timer and resumes the newer caret on a later keyboard focus", async () => {
  open(); const node = resetOnFocus();
  fireEvent.pointerDown(node); node.setSelectionRange(2, 2); fireEvent.select(node);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(node.selectionStart).toBe(2);
  act(() => screen.getByRole("textbox", { name: "Scene title" }).focus());
  resetOnFocus(); fireEvent.keyDown(node, { key: "x" });
  expect(node.selectionStart).toBe(2);
});

it("cancels pending focus work when the editor unmounts or its Storyline scope changes", async () => {
  const view = open(); resetOnFocus();
  const alternate = { ...scene, edit_version: { ...scene.edit_version!, workspace: "b".repeat(64), storyline: "alternate" } };
  saveLocation(alternate.edit_version.workspace, 9);
  view.rerender(<EditorProvider><SceneEditor scene={alternate} /></EditorProvider>);
  expect((screen.getByRole("textbox", { name: "Scene prose" }) as HTMLTextAreaElement).selectionStart).toBe(9);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect((screen.getByRole("textbox", { name: "Scene prose" }) as HTMLTextAreaElement).selectionStart).toBe(9);
  view.unmount(); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(restoreTextLocation(workspace.projectRoot, scene.edit_version!.workspace, scene.id, scene.body)?.start).toBe(6);
});

it("revalidates pending location against a recovered draft before applying it", async () => {
  writeSceneRecoveryDraft({ projectRoot: workspace.projectRoot, sceneId: scene.id, baseUpdatedAt: "older", baseVersion: scene.edit_version, title: scene.title, body: "A different recovered opening." });
  open(); fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  const node = resetOnFocus();
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(node.value).toBe("A different recovered opening.");
  expect(node.selectionStart).toBe(0);
});
