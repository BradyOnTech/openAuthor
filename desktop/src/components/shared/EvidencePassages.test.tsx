// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getScene } from "../../api";
import { EvidencePassages } from "./EvidencePassages";
const editor = vi.hoisted(() => ({ tabs: [] as Array<{ id: string; modified?: boolean }>, openTab: vi.fn(), updateTab: vi.fn(), setActiveTab: vi.fn(), beginNavigation: vi.fn(() => () => true) }));
vi.mock("../../api", () => ({ getScene: vi.fn() }));
vi.mock("../../contexts/EditorContext", () => ({ useEditor: () => editor }));
vi.mock("../../contexts/WorkspaceContext", () => ({ useWorkspace: () => ({ projectRoot: "/book", scenes: [{ id: "s1", title: "The Gate" }], setError: vi.fn() }) }));
beforeEach(() => { vi.clearAllMocks(); editor.tabs = []; });
afterEach(cleanup);

it("opens evidence in an existing dirty scene without replacing its data", () => {
  editor.tabs = [{ id: "scene:s1", modified: true }];
  const evidence = { scene_id: "s1", excerpt: "The gate was blue.", start: 0, end: 18 };
  render(<EvidencePassages evidence={[evidence]} />);
  fireEvent.click(screen.getByRole("button", { name: "Open evidence 1 in The Gate" }));
  expect(editor.updateTab).toHaveBeenCalledWith("scene:s1", { focusPassage: evidence });
  expect(editor.setActiveTab).toHaveBeenCalledWith("scene:s1");
  expect(getScene).not.toHaveBeenCalled();
  expect(editor.openTab).not.toHaveBeenCalled();
});
