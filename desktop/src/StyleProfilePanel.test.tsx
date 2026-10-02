// @vitest-environment jsdom
import { StrictMode } from "react";
import { invoke as nativeInvoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StyleProfilePanel } from "./components/editor/StyleProfilePanel";

const boundary = vi.hoisted(() => ({ calls: [] as string[][], frozen: false }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (_: string, payload: { args: string[] }) => {
  boundary.calls.push(payload.args);
  if (payload.args[1] === "reference") boundary.frozen = true;
  return { status: 0, stderr: "", stdout: JSON.stringify({
    schema_version: 2, exemplar_scene_ids: ["scene-1"], created_at: "2026-09-30T10:00:00Z",
    reference_mode: boundary.frozen ? "frozen" : "current", freshness: "stale", changed_scene_ids: ["scene-1"],
    usable_for_ai: boundary.frozen, fingerprint: "reviewed-profile", source_digests: { "scene-1": "saved-source" },
    metrics: { word_count: null, character_count: 25, signature_words: [] }, guidance: ["Descriptive observations only."],
    measurement: { word_metrics_available: false, limitations: ["Word segmentation is unavailable for this sample."] },
  }) };
} }));
beforeEach(() => { boundary.calls = []; boundary.frozen = false; Object.defineProperty(window, "__TAURI_INTERNALS__", { value: { invoke: nativeInvoke }, configurable: true }); });
afterEach(() => { cleanup(); delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__; });

it("shows source changes and measurement limits before the author deliberately freezes saved metrics", async () => {
  render(<StrictMode><StyleProfilePanel projectRoot="/synthetic/style" scenes={[{ id: "scene-1", title: "Gate" }]} /></StrictMode>);
  await screen.findByText(/Changed sources.*excluded from AI/i);
  expect(screen.getByText(/Word segmentation is unavailable/)).toBeTruthy();
  expect(screen.queryByText("0 words")).toBeNull();
  expect(boundary.calls.some(args => args[1] === "reference")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Use saved metrics as frozen reference" }));
  await screen.findByText(/Frozen reference.*included in AI/i);
  await waitFor(() => expect(boundary.calls.some(args => args.includes("--expected-fingerprint") && args.includes("reviewed-profile"))).toBe(true));
});
