// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { CanonDiagnostic, SceneSummary } from "../../types";
import { CanonMemoryEditor } from "./CanonMemoryEditor";

const editor = vi.hoisted(() => ({ tabs: [{ id: "scene:s1", modified: true }], setActiveTab: vi.fn(), openTab: vi.fn(), updateTab: vi.fn(), beginNavigation: vi.fn(() => () => true) }));
const workspace = vi.hoisted(() => ({ projectRoot: "/book", scenes: [] as SceneSummary[], codexEntities: [], setError: vi.fn(), setMessage: vi.fn() }));
vi.mock("../../contexts/EditorContext", () => ({ useEditor: () => editor }));
vi.mock("../../contexts/WorkspaceContext", () => ({ useWorkspace: () => workspace }));
vi.mock("../../api", () => ({ listCanonFacts: vi.fn(), listNarrativeSetups: vi.fn(), listOpenQuestions: vi.fn(), listCharacterArcStates: vi.fn(), runCanonDiagnostics: vi.fn(), disposeCanonDiagnostic: vi.fn(), getScene: vi.fn() }));
const finding: CanonDiagnostic = { id: "d1", code: "pov_knowledge_leak", severity: "warning", title: "Possible POV knowledge leak", message: "Mara knows too early.", fact_ids: [], scene_ids: ["s1"], evidence: [{ scene_id: "s1", excerpt: "Mara knew.", start: 0, end: 10 }] };
beforeEach(() => {
  vi.resetAllMocks();
  workspace.scenes = [{ id: "s1", title: "The Gate", pov: "Mara", summary: "", status: "draft", path: "scene.md", created_at: "today", updated_at: "today" }];
  for (const fn of [api.listCanonFacts, api.listNarrativeSetups, api.listOpenQuestions, api.listCharacterArcStates]) vi.mocked(fn).mockResolvedValue([]);
  vi.mocked(api.runCanonDiagnostics).mockResolvedValue({ diagnostics: [finding], summary: { errors: 0, warnings: 1, info: 0 } });
});
afterEach(cleanup);

it("opens an existing evidence scene without replacing its draft and preserves review notes after a failed save", async () => {
  render(<CanonMemoryEditor />);
  const card = within(await screen.findByRole("article", { name: finding.title }));
  fireEvent.click(card.getByText("Review evidence (1)"));
  fireEvent.click(card.getByRole("button", { name: "Open evidence 1 in The Gate" }));
  expect(editor.setActiveTab).toHaveBeenCalledWith("scene:s1");
  expect(api.getScene).not.toHaveBeenCalled();
  fireEvent.click(card.getByText("Record review decision"));
  fireEvent.change(card.getByLabelText("Review notes"), { target: { value: "Review after the reveal is moved." } });
  vi.mocked(api.disposeCanonDiagnostic).mockRejectedValueOnce(new Error("Disk full"));
  await act(async () => fireEvent.click(card.getByRole("button", { name: "Save review decision" })));
  expect(workspace.setError).toHaveBeenCalledWith(expect.stringContaining("Disk full"));
  expect((card.getByLabelText("Review notes") as HTMLTextAreaElement).value).toBe("Review after the reveal is moved.");
  expect(api.disposeCanonDiagnostic).toHaveBeenCalledWith("/book", "d1", "deferred", "Review after the reveal is moved.");
  expect(workspace.setMessage).not.toHaveBeenCalled();
  fireEvent.click(card.getByRole("button", { name: "Plan a revision" }));
  expect(editor.openTab).toHaveBeenCalledWith(expect.objectContaining({ kind: "generate", data: expect.objectContaining({ sceneId: "s1", instruction: expect.stringContaining("Mara knows too early.") }) }));
  expect(editor.openTab.mock.calls[0][0].data.instruction).toContain("Author review notes: Review after the reveal is moved.");
});

it("offers a retry after a failed report instead of claiming there are no findings", async () => {
  vi.mocked(api.runCanonDiagnostics).mockRejectedValueOnce(new Error("Cannot read Memory"));
  render(<CanonMemoryEditor />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText(/No findings from/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Run Diagnostics" }));
  expect(await screen.findByRole("article", { name: finding.title })).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});
