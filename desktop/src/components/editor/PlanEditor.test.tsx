// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getManuscriptPlan, listCharacterArcStates, updateProjectBrief } from "../../api";
import type { ManuscriptPlan } from "../../types";
import { PlanEditor } from "./PlanEditor";

vi.mock("../../api", () => ({ getManuscriptPlan: vi.fn(), listCharacterArcStates: vi.fn(), updateProjectBrief: vi.fn() }));
vi.mock("../../contexts/EditorContext", () => ({ useEditor: () => ({ openTab: vi.fn() }) }));
vi.mock("../../contexts/WorkspaceContext", () => ({ useWorkspace: () => ({ projectRoot: "/books/plan", scenes: [], codexEntities: [], setError: vi.fn(), setMessage: vi.fn() }) }));
const plan: ManuscriptPlan = { schema_version: 1, brief: { synopsis: "", genre: "", themes: [], style_guide: "", outline: "" }, acts: [], beats: [], unassigned_scene_ids: [], scene_metadata: {}, notes: [] };

beforeEach(() => { vi.resetAllMocks(); vi.mocked(listCharacterArcStates).mockResolvedValue([]); });
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
  expect(updateProjectBrief).toHaveBeenCalledWith("/books/plan", expect.objectContaining({ synopsis: "A cartographer follows stolen hours." }));
});
