// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatContextReview } from "./components/secondary/ChatContextReview";
import type { ChatSendPayload } from "./api";

const boundary = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (_command: string, payload: { request: { params: Record<string, unknown> } }) => {
  boundary.calls.push(payload.request.params);
  const approved = (payload.request.params.memory_approvals as unknown[]).length > 0;
  const storyApproved = (payload.request.params.story_approvals as string[] | undefined)?.includes("fact-blue") ?? false;
  return { result: {
    fingerprint: storyApproved ? "canon-preview" : approved ? "approved-preview" : "default-preview", provider: "local", model: "heuristic-v1", mode: "chat",
    estimated_input_tokens: 432, history_messages_included: 0, history_messages_omitted: 2,
    system_prompt: "An editorial assistant", user_prompt: approved ? "Approved Mara fact" : "Public context only", history: [],
    context: { current_scene: [{ id: "scene-1", title: "Archive" }], nearby_scenes: [], codex_entities: approved ? [{ id: "mara", name: "Mara", details: [] }] : [], retrieval: { citations: [], degraded: false, error: "" } },
    context_used: { privacy: { history_reset: true, one_time_approval: approved } },
    memory_choices: [{ id: "mara", name: "Mara", visibility: "ask", details: [{ key: "Past", visibility: "ask" }] }, { id: "secret", name: "Secret", visibility: "exclude", details: [] }],
    story_choices: [{ id: "fact-blue", kind: "fact", label: "Gate · color: blue", eligible: true, approved: storyApproved, included: storyApproved, reason: "" }],
  } };
} }));
beforeEach(() => {
  boundary.calls = [];
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
});
afterEach(() => {
  cleanup();
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

it("re-previews story grants and sends the matching fingerprint through the real desktop transport", async () => {
  const sent: ChatSendPayload[] = [];
  render(<ChatContextReview projectRoot="/synthetic/canon" payload={{ threadId: "chat-1", message: "Discuss the gate" }} onSend={async payload => { sent.push(payload); return true; }} onClose={() => {}} />);
  const checkbox = await screen.findByRole("checkbox", { name: "Allow Canon fact: Gate · color: blue for this request" });
  expect((checkbox as HTMLInputElement).checked).toBe(false);
  fireEvent.click(checkbox);
  expect((screen.getByRole("button", { name: "Send reviewed context" }) as HTMLButtonElement).disabled).toBe(true);
  await screen.findByText("Included in the reviewed payload.");
  expect(boundary.calls[boundary.calls.length - 1]?.story_approvals).toEqual(["fact-blue"]);
  fireEvent.click(screen.getByRole("button", { name: "Send reviewed context" }));
  await waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0].storyApprovals).toEqual(["fact-blue"]);
  expect(sent[0].expectedContextFingerprint).toBe("canon-preview");
});

it("previews context locally and sends only explicitly selected one-turn permissions with its fingerprint", async () => {
  const sent: ChatSendPayload[] = [];
  render(<ChatContextReview projectRoot="/synthetic/context" payload={{ threadId: "chat-1", message: "Discuss Mara" }} onSend={async payload => { sent.push(payload); return true; }} onClose={() => {}} />);
  expect(await screen.findByText("Archive")).toBeTruthy();
  expect(screen.getByText(/earlier replies stay on this device/i)).toBeTruthy();
  expect(screen.queryByRole("checkbox", { name: /Secret/ })).toBeNull();
  const detail = screen.getByRole("checkbox", { name: "Allow Mara: Past for this turn" }) as HTMLInputElement;
  expect(detail.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "Allow Mara for this turn" }));
  await waitFor(() => expect(boundary.calls[boundary.calls.length - 1]?.memory_approvals).toEqual([{ entity_id: "mara" }]));
  await waitFor(() => expect((screen.getByRole("button", { name: "Send reviewed context" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Send reviewed context" }));
  await waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0].memoryApprovals).toEqual([{ entity_id: "mara" }]);
  expect(sent[0].expectedContextFingerprint).toBe("approved-preview");
});
