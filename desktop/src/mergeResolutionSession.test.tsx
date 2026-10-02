// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MergeResolutionSession } from "./mergeResolutionSession";
import { MergePanel } from "./components/panel/MergePanel";

const transport = vi.hoisted(() => ({
  calls: [] as string[][],
  send: async (_args: string[]): Promise<unknown> => ({}),
  messages: [] as string[],
}));
const invoke = async (_command: string, payload: { args: string[] }) => {
  transport.calls.push(payload.args);
  return { status: 0, stderr: "", stdout: JSON.stringify(await transport.send(payload.args)) };
};
vi.mock("./contexts/WorkspaceContext", () => ({ useWorkspace: () => ({
  projectRoot: "/synthetic/ui-merge", branches: [{ name: "primary", current: true }, { name: "alternate", current: false }, { name: "another", current: false }],
  proposals: [], refreshBranches: async () => {}, refreshScenes: async () => {}, refreshProposals: async () => {}, refreshCodex: async () => {},
  setError: (text: string) => transport.messages.push(text), setMessage: (text: string) => transport.messages.push(text),
}) }));
vi.mock("./hooks/useRefreshBookTabs", () => ({ useRefreshBookTabs: () => async () => {} }));

const input = { base: "primary", head: "alternate", path: "manuscript/scenes/0001-choice.md", provider: "local" as const };
const result = { id: "proposal-1", stale: false, merge: input };
const approval = { fingerprint: "merge-reviewed", memoryApprovals: [], storyApprovals: [] };
beforeEach(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: { invoke }, configurable: true });
  localStorage.clear();
  transport.calls = [];
  transport.messages = [];
});
afterEach(() => { cleanup(); delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__; });

describe("reconciliation recovery", () => {
  it("waits for durable context approval before reconciliation", async () => {
    const session = new MergeResolutionSession("/synthetic/first-merge-review");
    await session.start(input);
    expect(transport.calls).toHaveLength(0);
  });
  it("retains the exact branch/path request across restart and serializes retries", async () => {
    transport.send = async () => { throw new Error("Response lost"); };
    const initial = new MergeResolutionSession("/synthetic/book");
    expect(await initial.start(input)).toBeNull();
    await initial.approve(approval);
    const original = transport.calls[0];
    const restarted = new MergeResolutionSession("/synthetic/book");
    expect(restarted.getSnapshot().pending?.path).toBe(input.path);
    expect(new MergeResolutionSession("/synthetic/another-book").getSnapshot().pending).toBeNull();
    let finish!: (value: unknown) => void;
    transport.send = () => new Promise(resolve => { finish = resolve; });
    const retry = restarted.retry();
    await waitFor(() => expect(transport.calls).toHaveLength(2));
    expect(await restarted.retry()).toBeNull();
    restarted.clear();
    expect(restarted.getSnapshot().pending).not.toBeNull();
    finish(result);
    expect(await retry).toEqual(result);
    expect(transport.calls[1]).toEqual(original);
    expect(transport.calls).toHaveLength(2);
    restarted.clear();
    expect(new MergeResolutionSession("/synthetic/book").getSnapshot().pending).toBeNull();
  });

  it("sends nothing when its recovery request cannot be saved", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Full"); });
    try {
      const session = new MergeResolutionSession("/synthetic/book");
      expect(await session.start(input)).toBeNull();
      expect(transport.calls).toHaveLength(0);
      expect(session.getSnapshot().error).toContain("Nothing was sent");
    } finally { storage.mockRestore(); }
  });

  it("renders recovery, invalidates changed selections, and retries the original request", async () => {
    let fail = true;
    transport.send = async args => {
      if (args[1] === "preflight") return { risk_level: "high" };
      if (args[1] === "conflicts") return { conflicts: [{ path: input.path, category: "scene", kind: "content" }], auto_mergeable: [], conflict_count: 1 };
      if (args[1] === "resolve-preview") return { fingerprint: "merge-reviewed", provider: "local", model: "heuristic-v1", estimated_input_tokens: 320, max_output_tokens: 3000,
        system_prompt: "Reconcile reviewed versions.", user_prompt: "Saved guidance.", memory_choices: [], story_choices: [], limits: { omitted_memory_ids: [] },
        context: { scene: { id: "scene-0001", title: "Choice" }, guidance_branch: "primary", codex_entities: [], story_plan: { limits: { clipped_fields: [], omitted_chapters: 0, omitted_relevant_beats: 0 } } } };
      if (args[1] === "resolve") {
        if (fail) { fail = false; throw new Error("Synthetic reconciliation response lost"); }
        return result;
      }
      throw new Error(`Unexpected command: ${args.join(" ")}`);
    };
    const user = userEvent.setup();
    render(<MergePanel />);
    await user.selectOptions(screen.getAllByRole("combobox")[0], "alternate");
    await user.click(screen.getByRole("button", { name: "Check compatibility" }));
    expect(transport.messages).toEqual([]);
    await user.click(await screen.findByRole("button", { name: "Reconcile with AI" }));
    expect(transport.calls.filter(args => args[1] === "resolve")).toHaveLength(0);
    await user.click(await screen.findByRole("button", { name: "Generate reviewed reconciliation" }));
    await screen.findByText(/Synthetic reconciliation response lost/);
    expect(screen.getByText(/alternate into primary: manuscript/)).toBeTruthy();
    await user.selectOptions(screen.getAllByRole("combobox")[0], "another");
    expect(screen.queryByRole("button", { name: "Reconcile with AI" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Merge storyline" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry reconciliation" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry reconciliation" })).toBeNull());
    const requests = transport.calls.filter(args => args[1] === "resolve");
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[0]).toContain("--request-id");
    expect(transport.messages.join(" ")).toContain("Review it in Changes");
  });
});
