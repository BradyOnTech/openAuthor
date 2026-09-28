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

describe("durable proposal generation", () => {
  it("reuses the draft request after restart without repeating the completed plan", async () => {
    transport.send = async args => {
      if (args[1] === "draft") throw new Error("Response lost");
      return { id: "proposal-1" };
    };
    const first = new ProposalGenerationSession("/synthetic/book");
    expect(await first.start([input])).toBeNull();
    expect(first.getSnapshot().job?.tasks[0].proposalId).toBe("proposal-1");
    const interruptedDraft = requestId(transport.calls[1]);
    const restarted = new ProposalGenerationSession("/synthetic/book");
    transport.send = async args => args[1] === "list" ? [{ id: "proposal-1" }] : { id: "proposal-1" };
    expect(await restarted.retry()).toEqual([{ id: "proposal-1" }]);
    expect(transport.calls.filter(args => args[1] === "generate")).toHaveLength(1);
    expect(requestId(transport.calls[2])).toBe(interruptedDraft);
    restarted.clear();
    expect(new ProposalGenerationSession("/synthetic/book").getSnapshot().job).toBeNull();
  });

  it("reuses a planning request whose response was lost and keeps books separate", async () => {
    transport.send = async () => { throw new Error("Response lost"); };
    await new ProposalGenerationSession("/synthetic/book").start([input]);
    const previous = requestId(transport.calls[0]);
    expect(new ProposalGenerationSession("/synthetic/other").getSnapshot().job).toBeNull();
    const restarted = new ProposalGenerationSession("/synthetic/book");
    transport.send = async args => args[1] === "list" ? [{ id: "proposal-1" }] : { id: "proposal-1" };
    await restarted.retry();
    expect(requestId(transport.calls[1])).toBe(previous);
    expect(restarted.getSnapshot().job?.tasks[0].drafted).toBe(true);
  });

  it("stops after the current step, serializes clicks, and resumes the remaining batch", async () => {
    let finish!: (result: unknown) => void;
    transport.send = () => new Promise(resolve => { finish = resolve; });
    const session = new ProposalGenerationSession("/synthetic/book");
    const running = session.start([input, { ...input, sceneId: "scene-2" }]);
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
    expect(await session.retry()).toHaveLength(2);
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
    await new ProposalGenerationSession("/synthetic/book", "proposal-1").start([input], "proposal-1");
    expect(transport.calls[0][1]).toBe("draft");
    const interrupted = requestId(transport.calls[0]);
    const restarted = new ProposalGenerationSession("/synthetic/book", "proposal-1");
    transport.send = async args => args[1] === "list" ? [{ id: "proposal-1" }] : { id: "proposal-1" };
    await restarted.retry();
    expect(requestId(transport.calls[1])).toBe(interrupted);
    restarted.clear();
    await restarted.start([input], "proposal-1");
    const drafts = transport.calls.filter(args => args[1] === "draft");
    expect(requestId(drafts[2])).not.toBe(interrupted);
    expect(transport.calls.filter(args => args[1] === "generate")).toHaveLength(0);
  });
});
