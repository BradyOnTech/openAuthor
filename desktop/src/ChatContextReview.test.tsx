// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatContextReview } from "./components/secondary/ChatContextReview";
import type { ChatSendPayload } from "./api";

const boundary = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>>, permissionsError: false, previewError: false }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (command: string, payload: { request: { params: Record<string, unknown> } }) => {
  if (command === "core_command") return { status: boundary.permissionsError ? 1 : 0, stdout: JSON.stringify([
    { id: "mara", name: "Mara", ai_visibility: "ask", details: [{ key: "Past", ai_visibility: "ask" }] },
    { id: "secret", name: "Secret", ai_visibility: "exclude", details: [] },
  ]), stderr: boundary.permissionsError ? "Permission metadata unavailable" : "" };
  boundary.calls.push(payload.request.params);
  if (boundary.previewError) throw new Error("Context preview unavailable");
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
  boundary.permissionsError = false; boundary.previewError = false;
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

it("offers selected ask-entry permission before the first preview and requires review before sending", async () => {
  const sent: ChatSendPayload[] = [];
  render(<ChatContextReview projectRoot="/synthetic/context" payload={{ threadId: "chat-1", message: "Discuss Mara", codexIds: ["mara"], scope: "character" }} onSend={async payload => { sent.push(payload); return true; }} onClose={() => {}} />);
  const grant = await screen.findByRole("checkbox", { name: "Allow Mara for this turn" });
  await screen.findByText(/Allow Mara below before previewing/);
  expect(boundary.calls).toHaveLength(0);
  expect((screen.getByRole("button", { name: "Send reviewed context" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("checkbox", { name: /Secret/ })).toBeNull();
  fireEvent.click(grant);
  expect((screen.getByRole("button", { name: "Send reviewed context" }) as HTMLButtonElement).disabled).toBe(true);
  await screen.findByText("Archive");
  expect(sent).toHaveLength(0);
  expect(boundary.calls[0].memory_approvals).toEqual([{ entity_id: "mara" }]);
  fireEvent.click(screen.getByRole("button", { name: "Send reviewed context" }));
  await waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0].expectedContextFingerprint).toBe("approved-preview");
});

it("keeps sending closed when permission metadata or an approved preview fails", async () => {
  const sent = vi.fn(async () => true);
  boundary.permissionsError = true;
  render(<ChatContextReview projectRoot="/synthetic/context" payload={{ threadId: "chat-1", message: "Discuss Mara", codexIds: ["mara"] }} onSend={sent} onClose={() => {}} />);
  await screen.findByText(/Could not load Memory permissions/);
  expect(boundary.calls).toHaveLength(0);
  expect((screen.getByRole("button", { name: "Send reviewed context" }) as HTMLButtonElement).disabled).toBe(true);
  boundary.permissionsError = false; boundary.previewError = true;
  fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Allow Mara for this turn" }));
  await screen.findByText(/Context preview unavailable/);
  expect((screen.getByRole("button", { name: "Send reviewed context" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Send reviewed context" }));
  expect(sent).not.toHaveBeenCalled();
});

it("refuses a selected excluded entry without offering a grant or creating a preview", async () => {
  const sent = vi.fn(async () => true);
  render(<ChatContextReview projectRoot="/synthetic/context" payload={{ threadId: "chat-1", message: "Discuss Secret", codexIds: ["secret"] }} onSend={sent} onClose={() => {}} />);
  await screen.findByText(/Secret is excluded from AI context/);
  expect(screen.queryByRole("checkbox", { name: /Allow Secret/ })).toBeNull();
  expect((screen.getByRole("button", { name: "Send reviewed context" }) as HTMLButtonElement).disabled).toBe(true);
  expect(boundary.calls).toHaveLength(0);
  expect(sent).not.toHaveBeenCalled();
});
