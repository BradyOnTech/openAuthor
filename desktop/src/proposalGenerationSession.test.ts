// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProposalGenerationSession } from "./proposalGenerationSession";

const transport = vi.hoisted(() => ({
  calls: [] as string[][],
  send: async (_args: string[]): Promise<unknown> => ({}),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (_command: string, payload: { args: string[] }) => {
  transport.calls.push(payload.args);
  return { status: 0, stderr: "", stdout: JSON.stringify(await transport.send(payload.args)) };
} }));

beforeEach(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  localStorage.clear();
  transport.calls = [];
});
afterEach(() => { delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__; });
const input = { sceneId: "scene-1", instruction: "Tighten this synthetic passage.", provider: "local" as const };
const requestId = (args: string[]) => args[args.indexOf("--request-id") + 1];
const approval = { fingerprint: "reviewed-draft", memoryApprovals: [], storyApprovals: [] };

describe("durable proposal generation", () => {
  it("retains scene intent and the review mode through planning, restart and drafting", async () => {
    const request = { ...input, provider: "openai-codex" as const, sceneContract: { purpose: "Test trust", turn: "Choose to wait", ending: "Keep the permit closed" }, reviewMode: "refine" as const, reviewReasoningEffort: "high" as const };
    transport.send = async args => args[1] === "list" ? [{ id: "proposal-1" }] : { id: "proposal-1" };
    const session = new ProposalGenerationSession("/synthetic/craft");
    await session.start([request]);
    await session.approvePlan(0, approval);
    expect(transport.calls[0]).toContain(JSON.stringify(request.sceneContract));
    const restarted = new ProposalGenerationSession("/synthetic/craft");
    expect(restarted.getSnapshot().reviewTask?.input).toEqual(request);
    await restarted.approveDraft(0, approval);
    const draft = transport.calls.find(args => args[1] === "draft")!;
    expect(draft[draft.indexOf("--review-reasoning-effort") + 1]).toBe("high");
    expect(draft[draft.indexOf("--review-mode") + 1]).toBe("refine");
  });
  it("sends no initial plan before its context is durably approved", async () => {
    const session = new ProposalGenerationSession("/synthetic/first-review");
    await session.start([input]);
    expect(transport.calls).toHaveLength(0);
    expect(session.getSnapshot().planReviewTask?.input).toEqual(input);
  });
  it("retains an unapproved plan when approval storage fails", async () => {
    const session = new ProposalGenerationSession("/synthetic/plan-approval-storage");
    await session.start([input]);
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage full"); });
    try {
      await session.approvePlan(0, approval);
      expect(transport.calls).toHaveLength(0);
      expect(session.getSnapshot().planReviewTask?.input).toEqual(input);
      expect(session.getSnapshot().error).toContain("Nothing was sent");
    } finally { storage.mockRestore(); }
  });
  it("retains plan instructions but resets approval and request identity for a new review", async () => {
    const session = new ProposalGenerationSession("/synthetic/plan-changed");
    transport.send = async () => { throw new Error("Context changed"); };
    await session.start([input]);
    await session.approvePlan(0, approval);
    const original = transport.calls[0];
    session.reviewDraftAgain();
    expect(session.getSnapshot().planReviewTask?.input).toEqual(input);
    const restarted = new ProposalGenerationSession("/synthetic/plan-changed");
    await restarted.retry();
    expect(transport.calls).toHaveLength(1);
    await restarted.approvePlan(0, { ...approval, fingerprint: "updated-plan" });
    expect(requestId(transport.calls[1])).not.toEqual(requestId(original));
    expect(transport.calls[1]).toContain("updated-plan");
  });
  it("pauses after planning and requires separate durable context approval for every draft", async () => {
    transport.send = async args => args[1] === "list" ? [{ id: "proposal-1" }, { id: "proposal-2" }]
      : { id: args.includes("scene-2") ? "proposal-2" : "proposal-1" };
    const session = new ProposalGenerationSession("/synthetic/reviewed");
    expect(await session.start([input, { ...input, sceneId: "scene-2" }])).toBeNull();
    expect(transport.calls).toHaveLength(0);
    await session.approvePlan(0, approval);
    expect(transport.calls.map(args => args[1])).toEqual(["generate"]);
    expect(session.getSnapshot().reviewTask?.proposalId).toBe("proposal-1");
    const first = { fingerprint: "first-context", memoryApprovals: [{ entity_id: "mara" }], storyApprovals: ["fact-four"] };
    expect(await session.approveDraft(0, first)).toBeNull();
    expect(transport.calls.map(args => args[1])).toEqual(["generate", "draft"]);
    expect(session.getSnapshot().planReviewTask?.index).toBe(1);
    await session.approvePlan(1, { ...approval, fingerprint: "second-plan" });
    expect(transport.calls.map(args => args[1])).toEqual(["generate", "draft", "generate"]);
    expect(transport.calls[1]).toContain("first-context");
    expect(session.getSnapshot().reviewTask?.proposalId).toBe("proposal-2");
    const restarted = new ProposalGenerationSession("/synthetic/reviewed");
    expect(await restarted.retry()).toBeNull();
    expect(transport.calls).toHaveLength(3);
    expect(await restarted.approveDraft(1, { fingerprint: "second-context", memoryApprovals: [], storyApprovals: [] })).toHaveLength(2);
    expect(transport.calls[3]).toContain("second-context");
    expect(transport.calls[3]).not.toContain(JSON.stringify(["fact-four"]));
  });
  it("retains hunk feedback and request identity across a restart", async () => {
    transport.send = async () => { throw new Error("Hunk response lost"); };
    await new ProposalGenerationSession("/synthetic/book", "proposal-1:hunks").start([input], "proposal-1", { id: "hunk-1", feedback: "Keep the quiet voice.", authorization: { fingerprint: "reviewed", memoryApprovals: [{ entity_id: "mara" }], storyApprovals: ["fact-four"] } });
    expect(transport.calls[0][1]).toBe("hunk-regenerate");
    const firstRequest = transport.calls[0];
    expect(firstRequest).toContain("reviewed");
    expect(firstRequest).toContain(JSON.stringify(["fact-four"]));
    const restarted = new ProposalGenerationSession("/synthetic/book", "proposal-1:hunks");
    transport.send = async args => args[1] === "list" ? [{ id: "proposal-1" }] : { id: "proposal-1" };
    await restarted.retry();
    expect(transport.calls[1]).toEqual(firstRequest);
    restarted.clear();
    expect(new ProposalGenerationSession("/synthetic/book", "proposal-1:hunks").getSnapshot().job).toBeNull();
  });
  it("reuses the draft request after restart without repeating the completed plan", async () => {
    transport.send = async args => {
      if (args[1] === "draft") throw new Error("Response lost");
      return { id: "proposal-1" };
    };
    const first = new ProposalGenerationSession("/synthetic/book");
    expect(await first.start([input])).toBeNull();
    await first.approvePlan(0, approval);
    expect(first.getSnapshot().job?.tasks[0].proposalId).toBe("proposal-1");
    expect(await first.approveDraft(0, approval)).toBeNull();
    const interruptedDraft = requestId(transport.calls[1]);
    const restarted = new ProposalGenerationSession("/synthetic/book");
    transport.send = async args => args[1] === "list" ? [{ id: "proposal-1" }] : { id: "proposal-1" };
    expect(await restarted.retry()).toEqual([{ id: "proposal-1" }]);
    expect(transport.calls.filter(args => args[1] === "generate")).toHaveLength(1);
    expect(requestId(transport.calls[2])).toBe(interruptedDraft);
    expect(transport.calls[2]).toEqual(transport.calls[1]);
    restarted.clear();
    expect(new ProposalGenerationSession("/synthetic/book").getSnapshot().job).toBeNull();
  });

  it("reuses a planning request whose response was lost and keeps books separate", async () => {
    transport.send = async () => { throw new Error("Response lost"); };
    const session = new ProposalGenerationSession("/synthetic/book");
    await session.start([input]);
    await session.approvePlan(0, approval);
    const previous = requestId(transport.calls[0]);
    expect(new ProposalGenerationSession("/synthetic/other").getSnapshot().job).toBeNull();
    const restarted = new ProposalGenerationSession("/synthetic/book");
    transport.send = async args => args[1] === "list" ? [{ id: "proposal-1" }] : { id: "proposal-1" };
    await restarted.retry();
    expect(requestId(transport.calls[1])).toBe(previous);
    await restarted.approveDraft(0, approval);
    expect(restarted.getSnapshot().job?.tasks[0].drafted).toBe(true);
  });

  it("stops after the current step, serializes clicks, and resumes the remaining batch", async () => {
    let finish!: (result: unknown) => void;
    transport.send = () => new Promise(resolve => { finish = resolve; });
    const session = new ProposalGenerationSession("/synthetic/book");
    await session.start([input, { ...input, sceneId: "scene-2" }]);
    const running = session.approvePlan(0, approval);
    await vi.waitFor(() => expect(transport.calls).toHaveLength(1));
    expect(await session.start([input])).toBeNull();
    expect(await session.retry()).toBeNull();
    session.stop();
    session.clear();
    finish({ id: "proposal-1" });
    expect(await running).toBeNull();
    expect(transport.calls).toHaveLength(1);
    expect(session.getSnapshot().error).toContain("Stopped");
    transport.send = async args => args[1] === "list" ? [{ id: "proposal-1" }, { id: "proposal-2" }] : { id: "proposal-2" };
    expect(await session.retry()).toBeNull();
    expect(await session.approveDraft(0, approval)).toBeNull();
    await session.approvePlan(1, { ...approval, fingerprint: "second-plan" });
    expect(await session.approveDraft(1, { ...approval, fingerprint: "second-scene" })).toHaveLength(2);
    expect(transport.calls.filter(args => args[1] === "generate")).toHaveLength(2);
    expect(transport.calls.filter(args => args[1] === "draft")).toHaveLength(2);
  });

  it("sends nothing when the recovery journal cannot be written", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage full"); });
    try {
      const session = new ProposalGenerationSession("/synthetic/book");
      expect(await session.start([input])).toBeNull();
      expect(transport.calls).toHaveLength(0);
      expect(session.getSnapshot().error).toContain("Nothing was sent");
    } finally { storage.mockRestore(); }
  });

  it("recovers an existing proposal draft and permits an intentional new regeneration", async () => {
    transport.send = async () => { throw new Error("Draft response lost"); };
    const original = new ProposalGenerationSession("/synthetic/book", "proposal-1");
    await original.start([input], "proposal-1");
    await original.approveDraft(0, approval);
    expect(transport.calls[0][1]).toBe("draft");
    const interrupted = requestId(transport.calls[0]);
    const restarted = new ProposalGenerationSession("/synthetic/book", "proposal-1");
    transport.send = async args => args[1] === "list" ? [{ id: "proposal-1" }] : { id: "proposal-1" };
    await restarted.retry();
    expect(requestId(transport.calls[1])).toBe(interrupted);
    restarted.clear();
    await restarted.start([input], "proposal-1");
    await restarted.approveDraft(0, { ...approval, fingerprint: "new-review" });
    const drafts = transport.calls.filter(args => args[1] === "draft");
    expect(requestId(drafts[2])).not.toBe(interrupted);
    expect(transport.calls.filter(args => args[1] === "generate")).toHaveLength(0);
  });

  it("does not send a draft if its reviewed permissions cannot be saved", async () => {
    const session = new ProposalGenerationSession("/synthetic/approval-storage");
    await session.start([input], "proposal-1");
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage full"); });
    try {
      expect(await session.approveDraft(0, approval)).toBeNull();
      expect(transport.calls).toHaveLength(0);
      expect(session.getSnapshot().reviewTask?.proposalId).toBe("proposal-1");
      expect(session.getSnapshot().error).toContain("Nothing was sent");
    } finally { storage.mockRestore(); }
  });

  it("keeps the completed plan when explicitly reviewing changed context as a new draft request", async () => {
    const session = new ProposalGenerationSession("/synthetic/changed-context");
    transport.send = async args => {
      if (args[1] === "draft") throw new Error("Revision context changed. Nothing was sent.");
      return { id: "proposal-1" };
    };
    await session.start([input]);
    await session.approvePlan(0, approval);
    await session.approveDraft(0, approval);
    const original = transport.calls[1];
    await session.retry();
    expect(transport.calls[2]).toEqual(original);
    session.reviewDraftAgain();
    expect(session.getSnapshot().reviewTask?.proposalId).toBe("proposal-1");
    transport.send = async args => args[1] === "list" ? [{ id: "proposal-1" }] : { id: "proposal-1" };
    const restarted = new ProposalGenerationSession("/synthetic/changed-context");
    expect(await restarted.approveDraft(0, { ...approval, fingerprint: "changed-context" })).toHaveLength(1);
    expect(requestId(transport.calls[3])).not.toBe(requestId(original));
    expect(transport.calls[3]).toContain("changed-context");
    expect(transport.calls.filter(args => args[1] === "generate")).toHaveLength(1);
  });
});
