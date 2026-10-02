// @vitest-environment jsdom
import { StrictMode } from "react";
import { invoke as nativeInvoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RevisionContextReview } from "./components/editor/RevisionContextReview";
import type { RevisionAuthorization } from "./api";

const boundary = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>>, failApproved: false }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (_: string, payload: { args: string[] }) => {
  const input = JSON.parse(payload.args[payload.args.indexOf("--input-json") + 1]);
  boundary.calls.push(input);
  const approved = input.story_approvals.includes("fact-blue");
  if (approved && boundary.failApproved) throw new Error("Selected evidence changed. Review context again.");
  return { status: 0, stderr: "", stdout: JSON.stringify({
    fingerprint: approved ? "approved-fingerprint" : "initial-fingerprint", provider: "local", model: "heuristic-v1", estimated_input_tokens: 350, max_output_tokens: 700,
    system_prompt: "Preserve the original facts.", user_prompt: "Saved terse style guidance.",
    context: { scene: { id: "scene-1", title: "Gate" }, codex_entities: [], story_plan: { limits: { clipped_fields: [], omitted_chapters: 0, omitted_relevant_beats: 0 } } },
    limits: { omitted_memory_ids: [] }, memory_choices: [],
    story_choices: [{ id: "fact-blue", kind: "fact", label: "Gate is blue", eligible: true, approved, included: approved, reason: "" }],
  }) };
} }));
beforeEach(() => { boundary.calls = []; boundary.failApproved = false; Object.defineProperty(window, "__TAURI_INTERNALS__", { value: { invoke: nativeInvoke }, configurable: true }); });
afterEach(() => { cleanup(); delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__; });

it("reviews a whole-scene draft without passage parameters or silently sending it", async () => {
  const sent: RevisionAuthorization[] = [];
  render(<RevisionContextReview projectRoot="/synthetic/scene-review" proposalId="proposal-2" provider="local" onClose={() => {}} onSend={async value => { sent.push(value); }} />);
  await screen.findByRole("region", { name: "Review scene draft context" });
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate reviewed scene" }) as HTMLButtonElement).disabled).toBe(false));
  expect(boundary.calls[boundary.calls.length - 1]?.hunk_id).toBeUndefined();
  expect(sent).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Generate reviewed scene" }));
  await waitFor(() => expect(sent).toEqual([{ fingerprint: "initial-fingerprint", memoryApprovals: [], storyApprovals: [] }]));
});

it("supports strict mounting and lets authors remove a grant after a failed refresh without sending stale context", async () => {
  const sent: RevisionAuthorization[] = [];
  render(<StrictMode><RevisionContextReview projectRoot="/synthetic/revision-review" proposalId="proposal-1" hunkId="hunk-1" provider="local" feedback="Keep voice" onClose={() => {}} onSend={async value => { sent.push(value); }} /></StrictMode>);
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate reviewed passage" }) as HTMLButtonElement).disabled).toBe(false));
  boundary.failApproved = true;
  fireEvent.click(screen.getByRole("checkbox", { name: "Allow Canon fact: Gate is blue for this request" }));
  await screen.findByRole("alert");
  expect((screen.getByRole("button", { name: "Generate reviewed passage" }) as HTMLButtonElement).disabled).toBe(true);
  expect(sent).toEqual([]);
  fireEvent.click(screen.getByRole("checkbox", { name: "Allow Canon fact: Gate is blue for this request" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate reviewed passage" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Generate reviewed passage" }));
  await waitFor(() => expect(sent).toEqual([{ fingerprint: "initial-fingerprint", memoryApprovals: [], storyApprovals: [] }]));
});
