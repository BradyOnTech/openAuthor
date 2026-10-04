// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ChatPanel } from "./components/secondary/ChatPanel";
import { chatDeliverySession } from "./chatDeliverySession";

const harness = vi.hoisted(() => ({
  thread: "thread-a",
  fail: true,
  calls: [] as Array<Record<string, unknown>>,
  refresh: async () => {},
  messages: [] as unknown[],
  entities: [] as Array<{ id: string; name: string; type: string; ai_visibility: string; details: unknown[] }>,
  previews: [] as Array<Record<string, unknown>>,
  reconciliations: [] as Array<Record<string, unknown>>,
  status: "not_delivered",
  reconcileError: false,
  heldSend: null as null | (() => Promise<unknown>),
  sendRequestIds: [] as string[],
  interrupts: [] as string[],
  heldReconcile: null as null | (() => Promise<void>),
}));
vi.mock("./contexts/WorkspaceContext", () => ({ useWorkspace: () => ({
  projectFound: true, projectRoot: "/synthetic/rendered-chat", activeChatThreadId: harness.thread,
  chatThreads: [{ id: harness.thread, title: "Synthetic chat", model: "heuristic-v1", provider: "local", mode: "chat", context_profile: { include_codex: "off", retrieval_mode: "off" } }],
  chatMessages: harness.messages, scenes: [], codexEntities: harness.entities, runtimeConfig: null,
  refreshChatMessages: harness.refresh, refreshChatThreads: harness.refresh, refreshProposals: harness.refresh,
  setActiveChatThreadId: (id: string) => { harness.thread = id; }, setError: () => {}, setMessage: () => {},
}) }));
vi.mock("./contexts/EditorContext", () => ({ useEditor: () => ({ tabs: [], activeTabId: "", openTab: () => {} }) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (command: string, payload: { args?: string[]; request?: { id: string; method: string; params: Record<string, unknown> } }) => {
  if (command === "core_command") return { status: 0, stdout: JSON.stringify(payload.args?.[0] === "codex" ? harness.entities : { acts: [] }), stderr: "" };
  if (payload.request?.method === "chat.context") {
    harness.previews.push(payload.request.params);
    return { result: { fingerprint: "reviewed-recovery", provider: "local", model: "heuristic-v1", mode: "chat", estimated_input_tokens: 100,
      history_messages_included: 1, history: [], context: { current_scene: [], nearby_scenes: [], codex_entities: [], retrieval: { citations: [] } },
      context_used: { privacy: { history_reset: true } }, story_choices: [],
    } };
  }
  if (payload.request?.method === "chat.delivery.reconcile") {
    harness.reconciliations.push(payload.request.params);
    await harness.heldReconcile?.();
    return harness.reconcileError ? { error: { message: "Receipt storage unavailable", category: "core_error" } } : { result: { status: harness.status, can_review: harness.status === "not_delivered", message: "Delivery reconciled locally" } };
  }
  if (payload.request?.method === "chat.interrupt") {
    harness.interrupts.push(String(payload.request.params.request_id));
    return { result: { interrupt_requested: true } };
  }
  harness.calls.push(payload.request!.params);
  harness.sendRequestIds.push(payload.request!.id);
  if (harness.heldSend) return harness.heldSend();
  return harness.fail ? { error: { category: "auth_error", message: "Sign in again in Settings." } } : { result: {} };
} }));
beforeEach(() => {
  localStorage.clear();
  harness.thread = "thread-a"; harness.fail = true; harness.status = "not_delivered"; harness.reconcileError = false;
  harness.calls = []; harness.previews = []; harness.reconciliations = []; harness.entities = [];
  harness.heldSend = null; harness.sendRequestIds = []; harness.interrupts = [];
  harness.heldReconcile = null;
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: { invoke }, configurable: true });
  Object.defineProperty(Element.prototype, "scrollIntoView", { value: () => {}, configurable: true });
});
afterEach(async () => {
  try {
    // The recovery controls disappear while work is in flight. Drain the
    // book/thread session before resetting a transport harness another test uses.
    await waitFor(() => {
      const delivery = chatDeliverySession("/synthetic/rendered-chat", harness.thread).getSnapshot();
      expect(delivery.sending).toBe(false);
      expect(delivery.reconciling).toBe(false);
    });
  } finally {
    cleanup();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  }
});

it("shows a recoverable prompt after expired sign-in, isolates threads, and retries the original delivery", async () => {
  const view = render(<ChatPanel />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Synthetic editorial question" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByRole("button", { name: "Retry message" })).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("Sign in again in Settings.");
  expect(screen.getByRole("status").textContent).toContain("Synthetic editorial question");
  expect(screen.getByRole("status").textContent).toContain("may incur charges");
  harness.thread = "thread-b";
  view.rerender(<ChatPanel />);
  expect(screen.queryByRole("button", { name: "Retry message" })).toBeNull();
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  harness.thread = "thread-a";
  view.rerender(<ChatPanel />);
  harness.fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry message" }));
  await waitFor(() => expect(chatDeliverySession("/synthetic/rendered-chat", harness.thread).getSnapshot().pending).toBeNull());
  expect(harness.calls).toHaveLength(2);
  expect(harness.calls[1]).toEqual(harness.calls[0]);
});

it("offers a fresh context review for a stale saved question without sending it", async () => {
  harness.thread = "stale-review-thread";
  localStorage.setItem(`openauthor:chat-delivery:${JSON.stringify(["/synthetic/rendered-chat", harness.thread])}`, JSON.stringify({
    threadId: harness.thread, deliveryId: "stale-delivery", turnId: "stale-turn", message: "Keep this question",
    scope: "storyline", sceneIds: ["scene-original"], expectedContextFingerprint: "old-context",
  }));
  render(<ChatPanel />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "A separate unfinished question" } });
  fireEvent.click(screen.getByRole("button", { name: "Review current context" }));
  await waitFor(() => expect(harness.reconciliations).toHaveLength(1));
  expect(await screen.findByRole("region", { name: "Review AI context" })).toBeTruthy();
  expect((screen.getByRole("textbox", { name: "Saved question" }) as HTMLTextAreaElement).value).toBe("Keep this question");
  expect(harness.reconciliations).toEqual([{ thread_id: harness.thread, request_id: "stale-delivery", turn_id: "stale-turn" }]);
  expect(harness.calls.filter(call => call.message === "Keep this question")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Back to message" }));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("A separate unfinished question");
  expect((screen.getByRole("button", { name: /^Send$/ }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Review current context" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "Send reviewed context" }) as HTMLButtonElement).disabled).toBe(false));
  harness.fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Send reviewed context" }));
  await waitFor(() => expect(harness.calls).toHaveLength(1));
  expect(harness.calls[0].delivery_id).not.toBe("stale-delivery");
  expect(harness.calls[0].turn_id).not.toBe("stale-turn");
  expect(harness.calls[0].context_overrides).toEqual({ scope: "storyline" });
  expect(harness.calls[0].scene_ids).toEqual(["scene-original"]);
  expect(harness.calls[0].expected_context_fingerprint).toBe("reviewed-recovery");
  await waitFor(() => expect(screen.queryByRole("region", { name: "Review AI context" })).toBeNull());
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("A separate unfinished question");
  expect(harness.reconciliations).toHaveLength(1);
});

it("recovers a completed reply without opening a new-send review or changing the current composer", async () => {
  harness.thread = "completed-recovery"; harness.status = "completed";
  let finish!: () => void;
  harness.heldReconcile = () => new Promise(resolve => { finish = resolve; });
  localStorage.setItem(`openauthor:chat-delivery:${JSON.stringify(["/synthetic/rendered-chat", harness.thread])}`, JSON.stringify({ threadId: harness.thread, deliveryId: "completed-id", turnId: "completed-turn", message: "Already answered" }));
  render(<ChatPanel />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Next question" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Assistant conversation scope" }), { target: { value: "storyline" } });
  fireEvent.click(screen.getByRole("button", { name: "Review current context" }));
  await waitFor(() => expect(harness.reconciliations).toHaveLength(1));
  const session = chatDeliverySession("/synthetic/rendered-chat", harness.thread);
  // The old completion assertion already passes while the receipt is held.
  // Prove that absence of Retry is not a completed reconciliation signal.
  try {
    expect(screen.queryByRole("button", { name: "Retry message" })).toBeNull();
    expect(session.getSnapshot().reconciling).toBe(true);
    expect(session.getSnapshot().pending?.deliveryId).toBe("completed-id");
  } finally { finish(); }
  await screen.findByText("Delivery reconciled locally");
  await waitFor(() => expect(session.getSnapshot().pending).toBeNull());
  expect(session.getSnapshot().reconciling).toBe(false);
  expect(localStorage.getItem(`openauthor:chat-delivery:${JSON.stringify(["/synthetic/rendered-chat", harness.thread])}`)).toBeNull();
  expect(harness.reconciliations).toEqual([{ thread_id: "completed-recovery", request_id: "completed-id", turn_id: "completed-turn" }]);
  expect(screen.queryByRole("region", { name: "Review AI context" })).toBeNull();
  expect(harness.calls).toHaveLength(0);
  expect(harness.previews).toHaveLength(0);
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Next question");
  expect((screen.getByRole("combobox", { name: "Assistant conversation scope" }) as HTMLSelectElement).value).toBe("storyline");
});

it("preserves a replacement boundary and requires fresh Ask first permission, including after a question edit", async () => {
  harness.thread = "replacement-recovery";
  harness.entities = [{ id: "mara", name: "Mara", type: "character", ai_visibility: "ask", details: [] }];
  localStorage.setItem(`openauthor:chat-delivery:${JSON.stringify(["/synthetic/rendered-chat", harness.thread])}`, JSON.stringify({
    threadId: harness.thread, deliveryId: "replacement-delivery", turnId: "replacement-turn", message: "Original question",
    scope: "character", codexIds: ["mara"], replacementFromMessageId: "old-user-message", memoryApprovals: [{ entity_id: "mara" }], storyApprovals: ["old-fact"], expectedContextFingerprint: "old",
  }));
  render(<ChatPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Review current context" }));
  const grant = await screen.findByRole("checkbox", { name: "Allow Mara for this turn" });
  expect((grant as HTMLInputElement).checked).toBe(false);
  expect(harness.previews).toHaveLength(0);
  fireEvent.click(grant);
  await waitFor(() => expect((screen.getByRole("button", { name: "Send reviewed context" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(screen.getByRole("textbox", { name: "Saved question" }), { target: { value: "Edited question" } });
  expect((screen.getByRole("checkbox", { name: "Allow Mara for this turn" }) as HTMLInputElement).checked).toBe(false);
  await screen.findByText(/Allow Mara below before previewing/);
  expect((screen.getByRole("button", { name: "Send reviewed context" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "Allow Mara for this turn" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "Send reviewed context" }) as HTMLButtonElement).disabled).toBe(false));
  harness.fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Send reviewed context" }));
  await waitFor(() => expect(harness.calls).toHaveLength(1));
  expect(harness.reconciliations[0].request_id).toBe("replacement-turn");
  expect(harness.previews[harness.previews.length - 1].history_before_message_id).toBe("old-user-message");
  expect(harness.calls[0]).toMatchObject({ message: "Edited question", replace_from_message_id: "old-user-message", memory_approvals: [{ entity_id: "mara" }], story_approvals: [] });
  await waitFor(() => expect(screen.queryByRole("region", { name: "Review AI context" })).toBeNull());
});

it("keeps recovery closed when delivery reconciliation fails", async () => {
  harness.thread = "unconfirmed-recovery"; harness.reconcileError = true;
  localStorage.setItem(`openauthor:chat-delivery:${JSON.stringify(["/synthetic/rendered-chat", harness.thread])}`, JSON.stringify({ threadId: harness.thread, deliveryId: "unknown-id", turnId: "unknown-turn", message: "Unconfirmed question" }));
  render(<ChatPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Review current context" }));
  await screen.findByText(/Could not prepare a fresh review/);
  expect(screen.queryByRole("region", { name: "Review AI context" })).toBeNull();
  expect(screen.getByRole("button", { name: "Retry message" })).toBeTruthy();
  expect(harness.calls).toHaveLength(0);
});

it("lets the author stop a freshly reviewed recovery turn through the existing delivery session", async () => {
  harness.thread = "stop-reviewed-recovery";
  localStorage.setItem(`openauthor:chat-delivery:${JSON.stringify(["/synthetic/rendered-chat", harness.thread])}`, JSON.stringify({
    schema_version: 2, phase: "review", payload: { threadId: harness.thread, message: "Keep this recovered question", scope: "storyline" },
  }));
  let finish!: (result: unknown) => void;
  harness.heldSend = () => new Promise(resolve => { finish = resolve; });
  render(<ChatPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Review current context" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "Send reviewed context" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Send reviewed context" }));
  fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
  await waitFor(() => expect(harness.interrupts).toEqual(harness.sendRequestIds));
  expect(harness.calls).toHaveLength(1);
  finish({ error: { category: "interrupted", message: "Stopped by author" } });
  await screen.findByRole("button", { name: "Retry message" });
  expect(screen.getByRole("status").textContent).toContain("Keep this recovered question");
  expect(screen.getByRole("status").textContent).toContain("Stopped by author");
  expect(harness.calls).toHaveLength(1);
});
