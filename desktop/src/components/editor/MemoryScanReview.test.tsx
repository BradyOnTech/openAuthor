// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { generateMemoryScan, previewMemoryScan } from "../../api";
import { MemoryScanReview } from "./MemoryScanReview";
import type { GenerationRuntimeConfig } from "../../types";

const workspace = vi.hoisted(() => ({ projectRoot: "/books/review-scan", branches: [{ name: "main", current: true }],
  scenes: Array.from({ length: 8 }, (_, index) => ({ id: `s${index + 1}`, title: `Chapter scene ${index + 1}` })),
  runtimeConfig: null as GenerationRuntimeConfig | null }));
const flush = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../../contexts/WorkspaceContext", () => ({ useWorkspace: () => workspace }));
vi.mock("../../sceneSaveSession", () => ({ flushProjectSceneSaves: flush }));
vi.mock("../../api", () => ({ previewMemoryScan: vi.fn(), generateMemoryScan: vi.fn() }));

const preview = { fingerprint: "review-v1", provider: "openai-codex" as const, model: "configured-model", scope: "scope-main",
  scenes: [{ scene_id: "s1", title: "Chapter scene 1", body: "小林把信交给阿明。\n\nExact final source line." }],
  accepted_entities: [{ id: "mara", type: "character" as const, name: "Mara", aliases: ["Captain Mara"] }],
  input_tokens_estimate: 120, response_token_reserve: 2000, warnings: ["Source text is not automatically redacted."] };
const queued = { scanned_scenes: 1, added: 2, refreshed: 0, pending: 2, suggestions: [], generation_id: "gen-one", warnings: ["One unsupported candidate withheld."] };
const onQueued = vi.fn(async () => {});
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function openAndChoose() {
  fireEvent.click(screen.getByRole("button", { name: "Review AI scan" }));
  fireEvent.click(screen.getByLabelText("Chapter scene 1"));
}
beforeEach(() => {
  vi.clearAllMocks(); workspace.projectRoot = "/books/review-scan"; workspace.branches = [{ name: "main", current: true }];
  workspace.runtimeConfig = { providers: {
    "openai-codex": { credential_present: true, default_model: "configured-model" },
    local: { credential_present: true, default_model: "local-deterministic" },
    openai: { credential_present: false, default_model: "unavailable" },
    anthropic: { credential_present: false, default_model: "unavailable" },
    openrouter: { credential_present: false, default_model: "unavailable" },
  } } as GenerationRuntimeConfig;
  flush.mockResolvedValue(true); vi.mocked(previewMemoryScan).mockResolvedValue(preview);
  vi.mocked(generateMemoryScan).mockResolvedValue(queued);
});
afterEach(cleanup);

it("requires chosen scope and exact source review before an explicit send, using configured provider/model", async () => {
  render(<MemoryScanReview onQueued={onQueued} />);
  expect(previewMemoryScan).not.toHaveBeenCalled(); expect(generateMemoryScan).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Review AI scan" }));
  expect((screen.getByRole("button", { name: "Preview scan sources" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("Chapter scene 1"));
  fireEvent.click(screen.getByRole("button", { name: "Preview scan sources" }));
  await screen.findByText(/Exact final source line/);
  expect(previewMemoryScan).toHaveBeenCalledWith(workspace.projectRoot, { scene_ids: ["s1"], provider: "openai-codex", model: "configured-model" });
  expect(screen.getByText(/Captain Mara/)).toBeTruthy(); expect(screen.getByText(/approximately 120/)).toBeTruthy();
  expect(generateMemoryScan).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Send reviewed AI scan" }));
  await waitFor(() => expect(generateMemoryScan).toHaveBeenCalledWith(workspace.projectRoot,
    { scene_ids: ["s1"], provider: "openai-codex", model: "configured-model" }, "review-v1"));
  await screen.findByText("One unsupported candidate withheld.");
  expect(onQueued).toHaveBeenCalledWith(queued);
  expect(flush).toHaveBeenCalledTimes(2);
});

it("retains selected scenes after preview and send failures, requiring a fresh review", async () => {
  vi.mocked(previewMemoryScan).mockRejectedValueOnce(new Error("Too much selected prose. Choose fewer scenes."));
  render(<MemoryScanReview onQueued={onQueued} />); openAndChoose();
  fireEvent.click(screen.getByRole("button", { name: "Preview scan sources" }));
  await screen.findByText(/Too much selected prose/);
  expect((screen.getByLabelText("Chapter scene 1") as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Preview scan sources" }));
  await screen.findByText(/Exact final source line/);
  vi.mocked(generateMemoryScan).mockRejectedValueOnce(new Error("Source changed. Review again."));
  fireEvent.click(screen.getByRole("button", { name: "Send reviewed AI scan" }));
  await screen.findByText(/Source changed/);
  expect((screen.getByLabelText("Chapter scene 1") as HTMLInputElement).checked).toBe(true);
  expect(screen.queryByRole("button", { name: "Send reviewed AI scan" })).toBeNull();
  expect(onQueued).not.toHaveBeenCalled();
});

it("invalidates reviewed context when selection/provider/model/Storyline changes and ignores late previews", async () => {
  const late = deferred<typeof preview>(); vi.mocked(previewMemoryScan).mockReturnValueOnce(late.promise);
  const view = render(<MemoryScanReview onQueued={onQueued} />); openAndChoose();
  fireEvent.click(screen.getByRole("button", { name: "Preview scan sources" }));
  await waitFor(() => expect(previewMemoryScan).toHaveBeenCalledTimes(1));
  workspace.branches = [{ name: "experiment", current: true }]; view.rerender(<MemoryScanReview onQueued={onQueued} />);
  late.resolve(preview);
  await waitFor(() => expect(screen.queryByText(/Exact final source line/)).toBeNull());
  openAndChoose(); fireEvent.click(screen.getByRole("button", { name: "Preview scan sources" }));
  await screen.findByText(/Exact final source line/);
  fireEvent.change(screen.getByLabelText("Scan model override"), { target: { value: "another-model" } });
  expect(screen.queryByRole("button", { name: "Send reviewed AI scan" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Preview scan sources" })); await screen.findByText(/Exact final source line/);
  fireEvent.click(screen.getByLabelText("Chapter scene 2"));
  expect(screen.queryByRole("button", { name: "Send reviewed AI scan" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Scan provider"), { target: { value: "local" } });
  expect(screen.getByText(/^Local mode performs no semantic interpretation/i)).toBeTruthy(); expect(generateMemoryScan).not.toHaveBeenCalled();
});

it("limits selection to six scenes and prevents duplicate sends while exposing honest busy state", async () => {
  const pending = deferred<typeof queued>(); vi.mocked(generateMemoryScan).mockReturnValueOnce(pending.promise);
  render(<MemoryScanReview onQueued={onQueued} />); openAndChoose();
  for (let index = 2; index <= 6; index++) fireEvent.click(screen.getByLabelText(`Chapter scene ${index}`));
  expect((screen.getByLabelText("Chapter scene 7") as HTMLInputElement).disabled).toBe(true);
  for (let index = 2; index <= 6; index++) fireEvent.click(screen.getByLabelText(`Chapter scene ${index}`));
  fireEvent.click(screen.getByRole("button", { name: "Preview scan sources" })); await screen.findByText(/Exact final source line/);
  const send = screen.getByRole("button", { name: "Send reviewed AI scan" }); fireEvent.click(send); fireEvent.click(send);
  await screen.findByText(/cannot be interrupted/i);
  expect(generateMemoryScan).toHaveBeenCalledTimes(1);
  expect((screen.getByLabelText("Scan provider") as HTMLSelectElement).disabled).toBe(true);
  pending.resolve(queued); await waitFor(() => expect(onQueued).toHaveBeenCalledTimes(1));
});

it("does not call preview or send when pending scene saves cannot finish", async () => {
  flush.mockResolvedValueOnce(false);
  render(<MemoryScanReview onQueued={onQueued} />); openAndChoose();
  fireEvent.click(screen.getByRole("button", { name: "Preview scan sources" }));
  await screen.findByText(/Save pending manuscript writing/);
  expect(previewMemoryScan).not.toHaveBeenCalled(); expect(generateMemoryScan).not.toHaveBeenCalled();
  expect((screen.getByLabelText("Chapter scene 1") as HTMLInputElement).checked).toBe(true);
});

it("flushes again before send and keeps scope after a failed save without contacting a provider", async () => {
  render(<MemoryScanReview onQueued={onQueued} />); openAndChoose();
  fireEvent.click(screen.getByRole("button", { name: "Preview scan sources" })); await screen.findByText(/Exact final source line/);
  flush.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByRole("button", { name: "Send reviewed AI scan" }));
  await screen.findByText(/Save pending manuscript writing before sending/);
  expect(generateMemoryScan).not.toHaveBeenCalled();
  expect((screen.getByLabelText("Chapter scene 1") as HTMLInputElement).checked).toBe(true);
  expect(screen.queryByRole("button", { name: "Send reviewed AI scan" })).toBeNull();
});

it("does not deliver a late scan result into another open project", async () => {
  const pending = deferred<typeof queued>(); vi.mocked(generateMemoryScan).mockReturnValueOnce(pending.promise);
  const view = render(<MemoryScanReview onQueued={onQueued} />); openAndChoose();
  fireEvent.click(screen.getByRole("button", { name: "Preview scan sources" })); await screen.findByText(/Exact final source line/);
  fireEvent.click(screen.getByRole("button", { name: "Send reviewed AI scan" }));
  await waitFor(() => expect(generateMemoryScan).toHaveBeenCalledTimes(1));
  workspace.projectRoot = "/books/another-book"; view.rerender(<MemoryScanReview onQueued={onQueued} />);
  pending.resolve(queued);
  await waitFor(() => expect(screen.getByRole("button", { name: "Review AI scan" })).toBeTruthy());
  expect(onQueued).not.toHaveBeenCalled();
  expect(screen.queryByText("One unsupported candidate withheld.")).toBeNull();
});

it("clears the preview when configured model or provider availability changes", async () => {
  const view = render(<MemoryScanReview onQueued={onQueued} />); openAndChoose();
  fireEvent.click(screen.getByRole("button", { name: "Preview scan sources" })); await screen.findByText(/Exact final source line/);
  workspace.runtimeConfig = { ...workspace.runtimeConfig!, providers: { ...workspace.runtimeConfig!.providers,
    "openai-codex": { ...workspace.runtimeConfig!.providers["openai-codex"], default_model: "changed-default" } } };
  view.rerender(<MemoryScanReview onQueued={onQueued} />);
  expect(screen.queryByRole("button", { name: "Send reviewed AI scan" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Preview scan sources" })); await screen.findByText(/Exact final source line/);
  workspace.runtimeConfig = { ...workspace.runtimeConfig, providers: { ...workspace.runtimeConfig.providers,
    "openai-codex": { ...workspace.runtimeConfig.providers["openai-codex"], credential_present: false } } };
  view.rerender(<MemoryScanReview onQueued={onQueued} />);
  expect(screen.queryByRole("button", { name: "Send reviewed AI scan" })).toBeNull();
  expect(generateMemoryScan).not.toHaveBeenCalled();
});
