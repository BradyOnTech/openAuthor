// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { correctStoryMemorySuggestion, generateMemoryScan, previewMemoryScan, listStoryMemorySuggestions, reviewStoryMemorySuggestion, scanStoryMemory, type StoryMemorySuggestion } from "../../api";
import { MemorySuggestionReview } from "./MemorySuggestionReview";

const workspace = vi.hoisted(() => ({ projectRoot: "/book/memory-review", branches: [], scenes: [{ id: "s1", title: "The Crossing" }], refreshCodex: vi.fn(async () => {}), setMessage: vi.fn(), setError: vi.fn() }));
const editor = vi.hoisted(() => ({ tabs: [], openTab: vi.fn(), updateTab: vi.fn(), setActiveTab: vi.fn(), beginNavigation: vi.fn(() => () => true) }));
vi.mock("../../contexts/WorkspaceContext", () => ({ useWorkspace: () => workspace }));
vi.mock("../../contexts/EditorContext", () => ({ useEditor: () => editor }));
vi.mock("../../api", () => ({ correctStoryMemorySuggestion: vi.fn(), generateMemoryScan: vi.fn(), previewMemoryScan: vi.fn(), listStoryMemorySuggestions: vi.fn(), reviewStoryMemorySuggestion: vi.fn(), scanStoryMemory: vi.fn(), getScene: vi.fn() }));

const suggestion: StoryMemorySuggestion = { id: "ferry", review_version: "review-v1", kind: "entity_create", entity_type: "character", name: "Last Ferry", description: "A place beside the harbor.", confidence: 0.95, reason: "Recorded capitalized name.", status: "pending", evidence: [{ scene_id: "s1", path: "s1.md", excerpt: "Mara waited at Last Ferry.", start: 0, end: 26 }] };
let records: StoryMemorySuggestion[];
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); records = [{ ...suggestion }];
  vi.mocked(listStoryMemorySuggestions).mockImplementation(async (_root, status) => records.filter(row => row.status === status));
  vi.mocked(reviewStoryMemorySuggestion).mockImplementation(async (_root, id, status) => { const row = records.find(item => item.id === id)!; const updated = { ...row, status, review_version: "review-decided" }; records = records.map(item => item.id === id ? updated : item); return updated; });
  vi.mocked(correctStoryMemorySuggestion).mockImplementation(async (_root, id, updates) => { const row = records.find(item => item.id === id)!; const updated = { ...row, ...updates, review_version: "review-corrected" }; records = records.map(item => item.id === id ? updated : item); return updated; });
});
afterEach(cleanup);

it("requires an explicit source-backed decision and revisits its accepted record", async () => {
  render(<MemorySuggestionReview />);
  await screen.findByRole("article", { name: "Review Last Ferry" });
  expect(screen.getByText("Mara waited at Last Ferry.")).toBeTruthy();
  expect(screen.queryByText(/95%/)).toBeNull();
  expect(reviewStoryMemorySuggestion).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Accept" }));
  await waitFor(() => expect(reviewStoryMemorySuggestion).toHaveBeenCalledWith("/book/memory-review", "ferry", "accepted", "review-v1"));
  await screen.findByText(/No suggestions need review/);
  fireEvent.change(screen.getByLabelText("Filter Memory suggestions"), { target: { value: "accepted" } });
  await screen.findByRole("article", { name: "Review Last Ferry" });
  expect((screen.getByRole("button", { name: "Accept" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Decision recorded: Accepted.")).toBeTruthy();
});

it("corrects an inferred entry type without accepting it and sends the reviewed baseline", async () => {
  render(<MemorySuggestionReview />);
  fireEvent.click(await screen.findByRole("button", { name: "Correct" }));
  fireEvent.change(screen.getByLabelText("Corrected Memory entry type"), { target: { value: "location" } });
  fireEvent.change(screen.getByLabelText("Corrected suggestion detail"), { target: { value: "The ferry landing." } });
  fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
  await waitFor(() => expect(correctStoryMemorySuggestion).toHaveBeenCalledWith("/book/memory-review", "ferry", { name: "Last Ferry", description: "The ferry landing.", entity_type: "location", expected_version: "review-v1" }));
  await screen.findByText("Proposed location entry");
  expect(reviewStoryMemorySuggestion).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Accept" }));
  await waitFor(() => expect(reviewStoryMemorySuggestion).toHaveBeenCalledWith("/book/memory-review", "ferry", "accepted", "review-corrected"));
});

it("recovers a correction without adopting a later source version", async () => {
  const view = render(<MemorySuggestionReview />);
  fireEvent.click(await screen.findByRole("button", { name: "Correct" }));
  fireEvent.change(screen.getByLabelText("Corrected suggestion name"), { target: { value: "The Last Ferry" } });
  view.unmount();
  records = [{ ...suggestion, description: "Changed source detail.", review_version: "review-v2" }];
  render(<MemorySuggestionReview />);
  const input = await screen.findByLabelText("Corrected suggestion name");
  expect((input as HTMLInputElement).value).toBe("The Last Ferry");
  expect(screen.getByText(/original review version/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Save correction" }) as HTMLButtonElement).disabled).toBe(true);
  expect(correctStoryMemorySuggestion).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "I reviewed updated evidence; keep my correction" }));
  fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
  await waitFor(() => expect(correctStoryMemorySuggestion).toHaveBeenCalledWith("/book/memory-review", "ferry", expect.objectContaining({ name: "The Last Ferry", expected_version: "review-v2" })));
});

it("preserves a failed correction and its original guard when refreshed", async () => {
  vi.mocked(correctStoryMemorySuggestion).mockRejectedValue(new Error("Suggestion changed in another window. Refresh and review it again."));
  render(<MemorySuggestionReview />);
  fireEvent.click(await screen.findByRole("button", { name: "Correct" }));
  fireEvent.change(screen.getByLabelText("Corrected suggestion detail"), { target: { value: "Keep this correction" } });
  fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
  await screen.findByRole("alert");
  records = [{ ...suggestion, review_version: "review-v2" }];
  fireEvent.click(screen.getByRole("button", { name: "Refresh suggestions" }));
  await screen.findByText(/original review version/);
  expect((screen.getByLabelText("Corrected suggestion detail") as HTMLTextAreaElement).value).toBe("Keep this correction");
  expect((screen.getByRole("button", { name: "Save correction" }) as HTMLButtonElement).disabled).toBe(true);
});

it("retains a recovered correction for reference when another writer has decided its suggestion", async () => {
  const view = render(<MemorySuggestionReview />);
  fireEvent.click(await screen.findByRole("button", { name: "Correct" }));
  fireEvent.change(screen.getByLabelText("Corrected suggestion detail"), { target: { value: "Unfinished author correction" } });
  view.unmount();
  records = [{ ...suggestion, status: "accepted", review_version: "review-decided" }];
  render(<MemorySuggestionReview />);
  fireEvent.change(screen.getByLabelText("Filter Memory suggestions"), { target: { value: "accepted" } });
  const detail = await screen.findByLabelText("Corrected suggestion detail");
  expect((detail as HTMLTextAreaElement).value).toBe("Unfinished author correction");
  expect(screen.getByText(/accepted while your correction was unfinished/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Save correction" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "I reviewed updated evidence; keep my correction" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
  expect(correctStoryMemorySuggestion).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel correction" }));
  expect(screen.queryByLabelText("Corrected suggestion detail")).toBeNull();
  expect(screen.getByText("Decision recorded: Accepted.")).toBeTruthy();
});

it("defers a suggestion and keeps it available in the later-review filter", async () => {
  render(<MemorySuggestionReview />);
  fireEvent.click(await screen.findByRole("button", { name: "Later" }));
  await screen.findByText(/No suggestions need review/);
  fireEvent.change(screen.getByLabelText("Filter Memory suggestions"), { target: { value: "deferred" } });
  await screen.findByRole("article", { name: "Review Last Ferry" });
  expect((screen.getByRole("button", { name: "Accept" }) as HTMLButtonElement).disabled).toBe(false);
  expect(reviewStoryMemorySuggestion).toHaveBeenCalledWith("/book/memory-review", "ferry", "deferred", "review-v1");
});

it("moves through suggestion evidence by keyboard while keeping unfinished corrections", async () => {
  records.push({ ...suggestion, id: "mara", name: "Mara", review_version: "mara-v1" });
  render(<MemorySuggestionReview />);
  fireEvent.click(await screen.findByRole("button", { name: "Correct" }));
  fireEvent.change(screen.getByLabelText("Corrected suggestion detail"), { target: { value: "Unfinished place detail" } });
  const list = within(screen.getByRole("navigation", { name: "Suggestions to review" }));
  const first = list.getByRole("button", { name: /Last Ferry/ });
  fireEvent.keyDown(first, { key: "ArrowDown" });
  expect(document.activeElement).toBe(list.getByRole("button", { name: /Mara/ }));
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  expect((screen.getByLabelText("Corrected suggestion detail") as HTMLTextAreaElement).value).toBe("Unfinished place detail");
  expect(reviewStoryMemorySuggestion).not.toHaveBeenCalled();
});

it("refuses unversioned suggestion records until they can be refreshed", async () => {
  records = [{ ...suggestion, review_version: undefined }];
  render(<MemorySuggestionReview />);
  await screen.findByText(/no current review version/);
  expect((screen.getByRole("button", { name: "Accept" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Correct" }) as HTMLButtonElement).disabled).toBe(true);
  expect(reviewStoryMemorySuggestion).not.toHaveBeenCalled();
  expect(scanStoryMemory).not.toHaveBeenCalled();
});

it("requires an explicit type correction before accepting an uncertain AI entry", async () => {
  records = [{ ...suggestion, origin: "ai_scan", classification_uncertain: true, type_candidates: ["character", "location"], type_confirmed: false }];
  render(<MemorySuggestionReview />);
  await screen.findByRole("article", { name: "Review Last Ferry" });
  expect((screen.getByRole("button", { name: "Accept" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/type is uncertain/i)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Accept" }));
  expect(reviewStoryMemorySuggestion).not.toHaveBeenCalled();
  vi.mocked(correctStoryMemorySuggestion).mockImplementationOnce(async (_root, id, updates) => {
    const updated = { ...records[0], ...updates, type_confirmed: true, review_version: "confirmed-type" };
    records = [updated]; return updated;
  });
  fireEvent.click(screen.getByRole("button", { name: "Correct" }));
  fireEvent.change(screen.getByLabelText("Corrected Memory entry type"), { target: { value: "location" } });
  fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
  await screen.findByText("Proposed location entry");
  fireEvent.click(screen.getByRole("button", { name: "Accept" }));
  await waitFor(() => expect(reviewStoryMemorySuggestion).toHaveBeenCalledWith("/book/memory-review", "ferry", "accepted", "confirmed-type"));
});

it("keeps local scanning separate and returns reviewed scan results to the pending inbox", async () => {
  records = [];
  vi.mocked(previewMemoryScan).mockResolvedValue({ fingerprint: "reviewed-local", provider: "local", model: "local-deterministic", scope: "book-scope",
    scenes: [{ scene_id: "s1", title: "The Crossing", body: "Mara crossed the river." }], accepted_entities: [], input_tokens_estimate: 100, response_token_reserve: 1000,
    warnings: ["Local identity heuristics can refresh all saved scenes."] });
  vi.mocked(generateMemoryScan).mockImplementationOnce(async () => {
    records = [{ ...suggestion }];
    return { scanned_scenes: 1, added: 1, refreshed: 0, pending: 1, suggestions: records, generation_id: "", warnings: [] };
  });
  render(<MemorySuggestionReview />);
  await screen.findByText(/No suggestions need review/);
  expect(screen.getByRole("button", { name: "Scan manuscript" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Review AI scan" }));
  fireEvent.click(screen.getByLabelText("The Crossing"));
  fireEvent.click(screen.getByRole("button", { name: "Preview scan sources" }));
  await screen.findByText("Mara crossed the river.");
  fireEvent.click(screen.getByRole("button", { name: "Run reviewed local scan" }));
  await screen.findByText(/1 await review\. Suggestions remain unconfirmed/);
  expect(screen.queryByRole("article", { name: "Review Last Ferry" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Close scan review" }));
  await screen.findByRole("article", { name: "Review Last Ferry" });
  expect(generateMemoryScan).toHaveBeenCalledWith("/book/memory-review", { scene_ids: ["s1"], provider: "local", model: "local-deterministic" }, "reviewed-local");
  expect(reviewStoryMemorySuggestion).not.toHaveBeenCalled(); expect(scanStoryMemory).not.toHaveBeenCalled();
  expect(workspace.setMessage).toHaveBeenCalledWith(expect.stringContaining("remain unconfirmed"));
});
