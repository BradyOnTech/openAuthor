// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatDeliverySession } from "./chatDeliverySession";

const transport = vi.hoisted(() => ({
  calls: [] as Array<{ projectRoot: string; request: { id: string; method: string; params: Record<string, unknown> } }>,
  send: async (): Promise<unknown> => ({ result: {} }),
  listener: null as null | ((event: { payload: unknown }) => void),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (_command: string, payload: typeof transport.calls[number]) => {
  transport.calls.push(payload);
  return transport.send();
} }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async (_name: string, listener: typeof transport.listener) => {
  transport.listener = listener;
  return () => { transport.listener = null; };
} }));

beforeEach(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  localStorage.clear();
  transport.calls = [];
  transport.listener = null;
  transport.send = async () => ({ result: {} });
});
afterEach(() => { delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__; });

describe("durable chat delivery", () => {
  it("retains the prompt and context across restart and retries with the same delivery id", async () => {
    transport.send = async () => { throw new Error("Connection lost after delivery"); };
    const first = new ChatDeliverySession("/synthetic/book", "chat-1");
    await first.send({ threadId: "chat-1", message: "Synthetic prompt", sceneIds: ["scene-1"], scope: "scene" });
    expect(first.getSnapshot().error).toContain("Connection lost");
    const restarted = new ChatDeliverySession("/synthetic/book", "chat-1");
    expect(restarted.getSnapshot().pending).toEqual(first.getSnapshot().pending);
    transport.send = async () => ({ result: {} });
    await restarted.retry();
    expect(transport.calls[0].request.params).toEqual(transport.calls[1].request.params);
    expect(transport.calls[0].request.id).not.toBe(transport.calls[1].request.id);
    expect(restarted.getSnapshot().pending).toBeNull();
    expect(new ChatDeliverySession("/synthetic/book", "chat-1").getSnapshot().pending).toBeNull();
  });

  it("serializes repeated sends and ignores deltas for another book or request", async () => {
    let finish!: (value: unknown) => void;
    transport.send = () => new Promise(resolve => { finish = resolve; });
    const session = new ChatDeliverySession("/synthetic/book", "chat-1");
    const sending = session.send({ threadId: "chat-1", message: "One turn" });
    await vi.waitFor(() => expect(transport.calls).toHaveLength(1));
    expect(await session.send({ threadId: "chat-1", message: "Duplicate" })).toBe(false);
    await session.retry();
    const requestId = transport.calls[0].request.id;
    const emit = (projectRoot: string, id: string, text: string) => transport.listener?.({ payload: {
      projectRoot, frame: { event: "chat.delta", payload: { request_id: id, text } },
    } });
    emit("/another/book", requestId, "Wrong book");
    emit("/synthetic/book", "other-request", "Wrong request");
    expect(session.getSnapshot().text).toBe("");
    emit("/synthetic/book", requestId, "Synthetic answer");
    expect(session.getSnapshot().text).toBe("Synthetic answer");
    expect(new ChatDeliverySession("/another/book", "chat-1").getSnapshot().pending).toBeNull();
    session.discard();
    expect(session.getSnapshot().pending).not.toBeNull();
    finish({ result: {} });
    await sending;
    expect(transport.calls).toHaveLength(1);
  });

  it("retains cancelled turns until explicit retry or discard", async () => {
    transport.send = async () => ({ error: { category: "interrupted", message: "Stopped by author" } });
    const session = new ChatDeliverySession("/synthetic/book", "chat-1");
    await session.send({ threadId: "chat-1", message: "Keep my prompt" });
    expect(session.getSnapshot().pending?.message).toBe("Keep my prompt");
    expect(session.getSnapshot().error).toBe("Stopped by author");
    session.discard();
    expect(new ChatDeliverySession("/synthetic/book", "chat-1").getSnapshot().pending).toBeNull();
  });

  it("fails before sending when the recovery journal cannot be written", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage full"); });
    try {
      const session = new ChatDeliverySession("/synthetic/book", "chat-1");
      expect(await session.send({ threadId: "chat-1", message: "Unsaved prompt" })).toBe(false);
      expect(transport.calls).toHaveLength(0);
      expect(session.getSnapshot().error).toContain("not been sent");
    } finally { setItem.mockRestore(); }
  });
});
