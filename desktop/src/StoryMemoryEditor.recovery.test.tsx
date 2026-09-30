// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryMemoryEditor } from "./components/editor/StoryMemoryEditor";
import type { CodexEntity } from "./types";

const harness = vi.hoisted(() => ({ calls: [] as string[][], branch: "main" }));
vi.mock("./contexts/WorkspaceContext", () => ({ useWorkspace: () => ({
  projectRoot: "/synthetic/memory-recovery", scenes: [], codexEntities: [],
  branches: [{ name: harness.branch, current: true, upstream: "" }],
  refreshCodex: async () => {}, setError: () => {}, setMessage: () => {},
}) }));
vi.mock("./contexts/EditorContext", () => ({ useEditor: () => ({ updateTab: () => {} }) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (_command: string, payload: { args: string[] }) => {
  harness.calls.push(payload.args);
  return { status: 0, stdout: JSON.stringify([]), stderr: "" };
} }));
const entity: CodexEntity = { id: "mara", type: "character", name: "Mara", description: "Saved description", notes: "Private notes", aliases: [], tags: [], details: [{ key: "Past", type: "text", value: "Synthetic memory", ai_visibility: "ask" }], created_at: "2026-09-30", updated_at: "2026-09-30" };
beforeEach(() => {
  localStorage.clear();
  harness.branch = "main";
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
});
afterEach(() => {
  cleanup();
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

it("recovers unsaved Memory fields and preserves typed comma-separated aliases after reopening", async () => {
  const user = userEvent.setup();
  const first = render(<StoryMemoryEditor entity={entity} />);
  await user.clear(screen.getByLabelText("Description"));
  await user.type(screen.getByLabelText("Description"), "Recovered character description");
  await user.type(screen.getByLabelText("Aliases"), "Mara Voss, Captain Mara");
  first.unmount();
  render(<StoryMemoryEditor entity={entity} />);
  await waitFor(() => expect((screen.getByLabelText("Description") as HTMLTextAreaElement).value).toBe("Recovered character description"));
  expect((screen.getByLabelText("Aliases") as HTMLInputElement).value).toBe("Mara Voss, Captain Mara");
  expect(screen.getByText(/Recovered unsaved draft/)).toBeTruthy();
});

it("lets the author change detail privacy and recovers it without silently changing the saved entry", async () => {
  const user = userEvent.setup();
  const first = render(<StoryMemoryEditor entity={entity} />);
  await user.selectOptions(screen.getByLabelText("Assistant access for Past"), "exclude");
  first.unmount();
  render(<StoryMemoryEditor entity={entity} />);
  expect((screen.getByLabelText("Assistant access for Past") as HTMLSelectElement).value).toBe("exclude");
  expect(entity.details?.[0].ai_visibility).toBe("ask");
});

it("recovers an unfinished new detail and connection form", async () => {
  const user = userEvent.setup();
  const first = render(<StoryMemoryEditor entity={entity} />);
  await user.type(screen.getByPlaceholderText("Detail name"), "Archive promise");
  await user.type(screen.getByPlaceholderText("Value"), "Return the key before dawn");
  await user.type(screen.getByLabelText("Connection"), "protects");
  first.unmount();
  render(<StoryMemoryEditor entity={entity} />);
  expect((screen.getByPlaceholderText("Detail name") as HTMLInputElement).value).toBe("Archive promise");
  expect((screen.getByPlaceholderText("Value") as HTMLInputElement).value).toBe("Return the key before dawn");
  expect((screen.getByLabelText("Connection") as HTMLInputElement).value).toBe("protects");
});

it("keeps drafts with their Storyline even when the saved entry is identical", async () => {
  const user = userEvent.setup();
  const first = render(<StoryMemoryEditor entity={entity} />);
  await user.type(screen.getByLabelText("Description"), " primary-only revision");
  first.unmount();
  harness.branch = "storyline/alternative";
  const second = render(<StoryMemoryEditor entity={entity} />);
  expect((screen.getByLabelText("Description") as HTMLTextAreaElement).value).toBe("Saved description");
  second.unmount();
  harness.branch = "main";
  render(<StoryMemoryEditor entity={entity} />);
  expect((screen.getByLabelText("Description") as HTMLTextAreaElement).value).toBe("Saved description primary-only revision");
});
