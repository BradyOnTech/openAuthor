// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listCodexRelationships, listStoryMemorySuggestions, reviewStoryMemorySuggestion, type StoryMemorySuggestion } from "../../api";
import { ConnectionGraphEditor } from "./ConnectionGraphEditor";
const workspace = vi.hoisted(() => ({ projectRoot: "/book/connections", codexEntities: [], scenes: [{ id: "s1", title: "The Gate" }], refreshCodex: vi.fn(async () => {}), setError: vi.fn(), setMessage: vi.fn() }));
vi.mock("../../contexts/WorkspaceContext", () => ({ useWorkspace: () => workspace }));
vi.mock("../../contexts/EditorContext", () => ({ useEditor: () => ({ openTab: vi.fn() }) }));
vi.mock("../../api", () => ({ addCodexRelationship: vi.fn(), getCodexEntity: vi.fn(), listCodexRelationships: vi.fn(), listStoryMemorySuggestions: vi.fn(), reviewStoryMemorySuggestion: vi.fn(), scanStoryMemory: vi.fn() }));
const suggestion: StoryMemorySuggestion = { id: "connection", review_version: "relationship-v1", kind: "relationship_create", name: "Mara trusts Ivo", description: "", reason: "Explicit relationship.", confidence: 0.96, status: "pending", source_name: "Mara", target_name: "Ivo", relation: "trusts", evidence: [{ scene_id: "s1", excerpt: "Mara trusts Ivo.", start: 0, end: 15, path: "s1.md" }] };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(listCodexRelationships).mockResolvedValue([]); vi.mocked(listStoryMemorySuggestions).mockResolvedValue([suggestion]); vi.mocked(reviewStoryMemorySuggestion).mockResolvedValue({ ...suggestion, status: "accepted" }); });
afterEach(cleanup);

it("sends the viewed relationship version without presenting heuristic support as probability", async () => {
  render(<ConnectionGraphEditor />);
  fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
  await waitFor(() => expect(reviewStoryMemorySuggestion).toHaveBeenCalledWith("/book/connections", "connection", "accepted", "relationship-v1"));
  expect(screen.queryByText(/96%/)).toBeNull();
  expect(screen.getByText(/Heuristic suggestion; review the evidence/)).toBeTruthy();
});

it("requires refresh when a relationship has no current review version", async () => {
  vi.mocked(listStoryMemorySuggestions).mockResolvedValue([{ ...suggestion, review_version: undefined }]);
  render(<ConnectionGraphEditor />);
  fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
  await waitFor(() => expect(workspace.setError).toHaveBeenCalledWith(expect.stringContaining("review version is unavailable")));
  expect(reviewStoryMemorySuggestion).not.toHaveBeenCalled();
});
