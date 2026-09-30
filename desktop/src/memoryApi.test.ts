// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { updateCodexEntity } from "./api";
const boundary = vi.hoisted(() => ({ args: [] as string[] }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (_command: string, payload: { args: string[] }) => {
  boundary.args = payload.args;
  return { status: 0, stdout: "{}", stderr: "" };
} }));
afterEach(() => { delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__; });
it("explicitly clears aliases and tags instead of treating an empty field as unchanged", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  await updateCodexEntity("/synthetic/book", "mara", { type: "character", name: "Mara", description: "", aliases: [], tags: [] });
  for (const flag of ["--alias", "--tag"]) {
    expect(boundary.args.includes(flag)).toBe(true);
    expect(boundary.args[boundary.args.indexOf(flag) + 1]).toBe("");
  }
});
