// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { getScene } from "../api";
import { EditorProvider, useEditor } from "../contexts/EditorContext";
import { useWorkspaceNavigation } from "./useWorkspaceNavigation";
import type { SceneDetail } from "../types";
vi.mock("../api", () => ({ getScene: vi.fn(), listScenes: vi.fn() }));
vi.mock("../contexts/UIContext", () => ({ useUI: () => ({ setActiveView: vi.fn(), setSidebarOpen: vi.fn() }) }));
vi.mock("../contexts/WorkspaceContext", () => ({ useWorkspace: () => ({ projectRoot: "book", scenes: [{ id: "scene-1" }], setError: vi.fn() }) }));
afterEach(cleanup);

it("does not let a slower first-scene request steal focus from a subsequently opened reader", async () => {
  let finish!: (scene: SceneDetail) => void;
  vi.mocked(getScene).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const view = renderHook(() => ({ navigate: useWorkspaceNavigation(), editor: useEditor() }), { wrapper: EditorProvider });
  let navigation!: Promise<void>;
  act(() => { navigation = view.result.current.navigate("manuscript"); });
  act(() => view.result.current.editor.openTab({ id: "reader", kind: "reader", label: "Read manuscript" }));
  await act(async () => { finish({ id: "scene-1", title: "Dawn" } as SceneDetail); await navigation; });
  expect(view.result.current.editor.activeTabId).toBe("reader");
  expect(view.result.current.editor.tabs.map((row) => row.id)).toEqual(["reader"]);
});
