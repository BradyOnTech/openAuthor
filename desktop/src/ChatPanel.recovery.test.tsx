// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatPanel } from "./components/secondary/ChatPanel";

const harness = vi.hoisted(() => ({
  thread: "thread-a",
  fail: true,
  calls: [] as Array<Record<string, unknown>>,
  refresh: async () => {},
  messages: [] as unknown[],
}));
vi.mock("./contexts/WorkspaceContext", () => ({ useWorkspace: () => ({
  projectFound: true, projectRoot: "/synthetic/rendered-chat", activeChatThreadId: harness.thread,
  chatThreads: [{ id: harness.thread, title: "Synthetic chat", model: "heuristic-v1", provider: "local", mode: "chat", context_profile: { include_codex: "off", retrieval_mode: "off" } }],
  chatMessages: harness.messages, scenes: [], codexEntities: [], runtimeConfig: null,
  refreshChatMessages: harness.refresh, refreshChatThreads: harness.refresh, refreshProposals: harness.refresh,
  setActiveChatThreadId: (id: string) => { harness.thread = id; }, setError: () => {}, setMessage: () => {},
}) }));
vi.mock("./contexts/EditorContext", () => ({ useEditor: () => ({ tabs: [], activeTabId: "", openTab: () => {} }) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (command: string, payload: { request?: { params: Record<string, unknown> } }) => {
  if (command === "core_command") return { status: 0, stdout: JSON.stringify({ acts: [] }), stderr: "" };
  harness.calls.push(payload.request!.params);
  return harness.fail ? { error: { category: "auth_error", message: "Sign in again in Settings." } } : { result: {} };
} }));
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  Object.defineProperty(Element.prototype, "scrollIntoView", { value: () => {}, configurable: true });
});
afterEach(() => {
  cleanup();
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
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
  await waitFor(() => expect(screen.queryByRole("button", { name: "Retry message" })).toBeNull());
  expect(harness.calls).toHaveLength(2);
  expect(harness.calls[1]).toEqual(harness.calls[0]);
});
