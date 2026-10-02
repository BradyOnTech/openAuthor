// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { generateMemoryScan, previewMemoryScan } from "./api";

const boundary = vi.hoisted(() => ({ calls: [] as Array<{ command: string; projectRoot: string; args: string[] }> }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (command: string, payload: { projectRoot: string; args: string[] }) => {
  boundary.calls.push({ command, ...payload });
  return { status: 0, stdout: '{"fingerprint":"reviewed","suggestions":[]}', stderr: "" };
} }));
afterEach(() => { boundary.calls = []; delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__; });

it("sends the exact reviewed scope and fingerprint through existing native CLI transport", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  const request = { scene_ids: ["scene-one", "scene-two"], provider: "openai-codex" as const, model: "configured-model" };
  await previewMemoryScan("/synthetic/book", request);
  await generateMemoryScan("/synthetic/book", request, "reviewed-source");
  expect(boundary.calls.map(call => call.args.slice(0, 2))).toEqual([["memory", "scan-preview"], ["memory", "scan-ai"]]);
  expect(boundary.calls.every(call => call.command === "core_command" && call.projectRoot === "/synthetic/book")).toBe(true);
  expect(JSON.parse(boundary.calls[0].args[3])).toEqual(request);
  expect(JSON.parse(boundary.calls[1].args[3])).toEqual({ ...request, expected_fingerprint: "reviewed-source" });
});
