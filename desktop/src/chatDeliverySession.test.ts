// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatDeliverySession } from "./chatDeliverySession";
import { invoke } from "@tauri-apps/api/core";

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
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: { invoke }, configurable: true });
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

  it("reconciles the original request before persisting a fresh review draft and new delivery", async () => {
    transport.send = async () => ({ error: { category: "core_error", message: "Context changed since preview" } });
    const session = new ChatDeliverySession("/synthetic/fresh-review", "chat-1");
    await session.send({ threadId: "chat-1", message: "Keep my question", sceneIds: ["scene-original"], scope: "chapter",
      expectedContextFingerprint: "old-preview", memoryApprovals: [{ entity_id: "mara" }], storyApprovals: ["old-fact"], approvedCodexIds: ["mara"] });
    const pending = session.getSnapshot().pending!;
    transport.send = async () => ({ result: { status: "not_delivered", can_review: true, message: "Old request closed" } });
    const draft = await session.prepareReview();
    expect(transport.calls[1].request).toMatchObject({ method: "chat.delivery.reconcile", params: { request_id: pending.deliveryId, turn_id: pending.turnId } });
    expect(draft).toEqual({ threadId: "chat-1", message: "Keep my question", sceneIds: ["scene-original"], scope: "chapter" });
    const restarted = new ChatDeliverySession("/synthetic/fresh-review", "chat-1");
    expect(restarted.getSnapshot().reviewDraft).toEqual(draft);
    expect(restarted.getSnapshot().pending).toBeNull();
    await restarted.retry();
    expect(await restarted.send(draft!)).toBe(false);
    expect(await restarted.sendReviewed(draft!)).toBe(false);
    expect(transport.calls).toHaveLength(2);
    transport.send = async () => ({ result: {} });
    expect(await restarted.sendReviewed({ ...draft!, expectedContextFingerprint: "fresh-preview", memoryApprovals: [{ entity_id: "mara" }] })).toBe(true);
    expect(transport.calls[2].request.params.delivery_id).not.toBe(pending.deliveryId);
    expect(transport.calls[2].request.params.turn_id).not.toBe(pending.turnId);
    expect(transport.calls[2].request.params.expected_context_fingerprint).toBe("fresh-preview");
    expect(restarted.getSnapshot().reviewDraft).toBeNull();
  });

  it("does not open a review or call AI after recovering a completed reply", async () => {
    transport.send = async () => { throw new Error("Response lost"); };
    const session = new ChatDeliverySession("/synthetic/completed-review", "chat-1");
    await session.send({ threadId: "chat-1", message: "Already answered" });
    transport.send = async () => ({ result: { status: "completed", can_review: false, message: "Reply recovered" } });
    expect(await session.prepareReview()).toBeNull();
    expect(session.getSnapshot().pending).toBeNull();
    expect(session.getSnapshot().reviewDraft).toBeNull();
    expect(transport.calls.map(call => call.request.method)).toEqual(["chat.send", "chat.delivery.reconcile"]);
    expect(new ChatDeliverySession("/synthetic/completed-review", "chat-1").getSnapshot().pending).toBeNull();
  });

  it("retains an indeterminate warning and an edited question across a cancelled review and restart", async () => {
    transport.send = async () => ({ error: { category: "interrupted", message: "Stopped" } });
    const session = new ChatDeliverySession("/synthetic/stopped-review", "chat-1");
    await session.send({ threadId: "chat-1", message: "Original question", scope: "storyline", replacementFromMessageId: "user-original" });
    const original = session.getSnapshot().pending!;
    transport.send = async () => ({ result: { status: "indeterminate", can_review: true, message: "May have incurred charges. Old request closed." } });
    await session.prepareReview();
    expect(transport.calls[1].request.params.request_id).toBe(original.turnId);
    const edited = session.updateReviewQuestion("Edited question")!;
    const restarted = new ChatDeliverySession("/synthetic/stopped-review", "chat-1");
    expect(restarted.getSnapshot().error).toContain("incurred charges");
    expect(await restarted.prepareReview()).toEqual(edited);
    expect(transport.calls).toHaveLength(2);
    expect(await restarted.sendReviewed({ ...edited, message: "Unreviewed alteration", expectedContextFingerprint: "fresh" })).toBe(false);
    expect(await restarted.sendReviewed({ ...edited, sceneIds: ["new-scene"], expectedContextFingerprint: "fresh" })).toBe(false);
    expect(transport.calls).toHaveLength(2);
  });

  it("keeps the old journal and refuses a new send until reconciliation and durable draft writing succeed", async () => {
    transport.send = async () => ({ error: { category: "core_error", message: "Unconfirmed" } });
    const session = new ChatDeliverySession("/synthetic/blocked-review", "chat-1");
    await session.send({ threadId: "chat-1", message: "Original question" });
    const original = session.getSnapshot().pending;
    transport.send = async () => ({ result: { status: "blocked", can_review: false, message: "Completed turn receipt unavailable" } });
    expect(await session.prepareReview()).toBeNull();
    expect(session.getSnapshot().pending).toEqual(original);
    expect(await session.send({ threadId: "chat-1", message: "Another" })).toBe(false);
    transport.send = async () => ({ result: { status: "not_delivered", can_review: true, message: "Closed" } });
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage full"); });
    try {
      expect(await session.prepareReview()).toBeNull();
      expect(session.getSnapshot().pending).toEqual(original);
      expect(new ChatDeliverySession("/synthetic/blocked-review", "chat-1").getSnapshot().pending).toEqual(original);
    } finally { storage.mockRestore(); }
    expect(await session.prepareReview()).toMatchObject({ message: "Original question" });
  });

  it("serializes reconciliation against retry, discard, and replacement sends", async () => {
    transport.send = async () => ({ error: { category: "core_error", message: "Unconfirmed" } });
    const session = new ChatDeliverySession("/synthetic/checking-review", "chat-1");
    await session.send({ threadId: "chat-1", message: "Original question" });
    let finish!: (result: unknown) => void;
    transport.send = () => new Promise(resolve => { finish = resolve; });
    const checking = session.prepareReview();
    await vi.waitFor(() => expect(transport.calls).toHaveLength(2));
    expect(session.getSnapshot().reconciling).toBe(true);
    session.discard();
    await session.retry();
    expect(await session.prepareReview()).toBeNull();
    expect(await session.send({ threadId: "chat-1", message: "New question" })).toBe(false);
    expect(session.getSnapshot().pending?.message).toBe("Original question");
    finish({ result: { status: "not_delivered", can_review: true, message: "Closed" } });
    expect(await checking).toMatchObject({ message: "Original question" });
    expect(session.getSnapshot().reconciling).toBe(false);
  });
});
