// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SelectionAssist } from "./components/editor/SelectionAssist";

const boundary = vi.hoisted(() => ({ calls: [] as string[][], loseResponse: false }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (_: string, payload: { args: string[] }) => {
  boundary.calls.push(payload.args);
  if (payload.args[1] === "selection-generate" && boundary.loseResponse) { boundary.loseResponse = false; throw new Error("Connection lost after saving result"); }
  return { status: 0, stderr: "", stdout: JSON.stringify(payload.args[1] === "selection-preview" ? {
    fingerprint: "reviewed", provider: "local", model: "heuristic-v1", system_prompt: "Edit selected prose only", user_prompt: "Mara began to count.", estimated_input_tokens: 120, max_output_tokens: 4096,
    anchor: { branch: "main" }, limits: { omitted_before_characters: 0, omitted_after_characters: 0, omitted_memory_ids: [] }, memory_choices: [{ id: "mara", name: "Mara", visibility: "ask", details: [] }],
  } : { id: "proposal-selection", title: "Shorten", selection: { before: "Mara began to count.", after: "Mara counted." } }) };
} }));
beforeEach(() => { boundary.calls = []; boundary.loseResponse = false; window.localStorage.clear(); Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true }); });
afterEach(() => { cleanup(); });

it("requires reviewed context before generation and journals the exact Unicode selection", async () => {
  const completed: string[] = [];
  render(<SelectionAssist projectRoot="/synthetic/selection" sceneId="scene-1" branch="main" selection={{ body: "🌙 Mara began to count.", start: 3, end: 23 }} disabled={false} providers={["local"]} flush={async () => true} onResult={async proposal => { completed.push(proposal.id); }} />);
  fireEvent.click(screen.getByRole("button", { name: "Shorten" }));
  expect(boundary.calls).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("Direction for this passage"), { target: { value: "Keep the voice" } });
  fireEvent.click(screen.getByRole("button", { name: "Review context" }));
  expect(await screen.findByText("Edit selected prose only")).toBeTruthy();
  expect(boundary.calls).toHaveLength(1);
  const input = JSON.parse(boundary.calls[0][boundary.calls[0].indexOf("--input-json") + 1]);
  expect(input.start).toBe(2);
  expect(input.selected_text).toBe("Mara began to count.");
  fireEvent.click(screen.getByRole("button", { name: "Generate reviewed edit" }));
  await waitFor(() => expect(completed).toEqual(["proposal-selection"]));
  expect(boundary.calls[1]).toContain("reviewed");
});

it("recovers the same request after a lost response and editor restart", async () => {
  boundary.loseResponse = true;
  const props = { projectRoot: "/synthetic/recovery", sceneId: "scene-1", branch: "main", selection: { body: "Mara began to count.", start: 0, end: 20 }, disabled: false, providers: ["local"] as ["local"], flush: async () => true, onResult: async () => {} };
  const view = render(<SelectionAssist {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Rewrite" }));
  fireEvent.change(screen.getByLabelText("Direction for this passage"), { target: { value: "Preserve her voice" } });
  view.unmount();
  const recovered = render(<SelectionAssist {...props} />);
  expect((screen.getByLabelText("Direction for this passage") as HTMLTextAreaElement).value).toBe("Preserve her voice");
  fireEvent.click(screen.getByRole("button", { name: "Review context" }));
  fireEvent.click(await screen.findByRole("button", { name: "Generate reviewed edit" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Connection lost after saving result");
  recovered.unmount();
  render(<SelectionAssist {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Recover request" }));
  await waitFor(() => expect(boundary.calls.filter(args => args[1] === "selection-generate")).toHaveLength(2));
  const requests = boundary.calls.filter(args => args[1] === "selection-generate");
  expect(requests[0]).toEqual(requests[1]);
});

it("invalidates a reviewed payload when author direction changes", async () => {
  render(<SelectionAssist projectRoot="/synthetic/review" sceneId="scene-1" branch="main" selection={{ body: "Mara began to count.", start: 0, end: 20 }} disabled={false} providers={["local"]} flush={async () => true} onResult={async () => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Shorten" }));
  fireEvent.click(screen.getByRole("button", { name: "Review context" }));
  await screen.findByRole("button", { name: "Generate reviewed edit" });
  fireEvent.change(screen.getByLabelText("Direction for this passage"), { target: { value: "Keep all details" } });
  expect(screen.queryByRole("button", { name: "Generate reviewed edit" })).toBeNull();
  expect(boundary.calls).toHaveLength(1);
});

it("does not carry one-request Memory permission into a new request", async () => {
  boundary.loseResponse = true;
  render(<SelectionAssist projectRoot="/synthetic/permissions" sceneId="scene-1" branch="main" selection={{ body: "Mara began to count.", start: 0, end: 20 }} disabled={false} providers={["local"]} flush={async () => true} onResult={async () => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Shorten" }));
  fireEvent.click(screen.getByRole("button", { name: "Review context" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Allow Mara for this request" }));
  expect(screen.queryByRole("button", { name: "Generate reviewed edit" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review context" }));
  fireEvent.click(await screen.findByRole("button", { name: "Generate reviewed edit" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Review as a new request" }));
  fireEvent.click(screen.getByRole("button", { name: "Review context" }));
  const permission = await screen.findByRole("checkbox", { name: "Allow Mara for this request" }) as HTMLInputElement;
  expect(permission.checked).toBe(false);
});
