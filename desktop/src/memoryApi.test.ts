// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { reviewCanonFact, updateCodexEntity } from "./api";
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

it("requires the loaded Canon version and sends that exact review precondition", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  boundary.args = [];
  await expect(reviewCanonFact("/synthetic/book", "fact-token", { disposition: "accepted", expectedVersion: "" })).rejects.toThrow("Reload Canon");
  expect(boundary.args).toEqual([]);
  await reviewCanonFact("/synthetic/book", "fact-token", { disposition: "rejected", expectedVersion: "loaded-storyline-version" });
  expect(boundary.args).toEqual(["memory", "fact-review", "--id", "fact-token", "--disposition", "rejected", "--expected-version", "loaded-storyline-version", "--json"]);
});
