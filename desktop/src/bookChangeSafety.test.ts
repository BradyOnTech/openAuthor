// @vitest-environment jsdom

import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { runCoreCommand, updateProjectBrief } from "./api";
import { sceneSaveSession, withProjectBookChange } from "./sceneSaveSession";

const bridge = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.run }));

beforeEach(() => {
  (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  bridge.run.mockReset();
});
afterEach(() => { delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__; });

it("finishes a pending Plan save in its original book before changing Storylines", async () => {
  const project = "/tmp/pending-plan-storyline";
  let finish!: () => void;
  let branch = "primary";
  let writtenBranch = "";
  bridge.run.mockImplementation(async () => {
    await new Promise<void>(resolve => { finish = resolve; });
    writtenBranch = branch;
    return { status: 0, stdout: "{}", stderr: "" };
  });
  const save = updateProjectBrief(project, { synopsis: "Preserve this brief.", genre: "", style_guide: "", outline: "", themes: [] });
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  const change = withProjectBookChange(project, async () => { branch = "alternate"; });
  await new Promise(resolve => setTimeout(resolve, 0));
  const branchWhileSaving = branch;
  finish();
  await Promise.all([save, change]);
  expect(branchWhileSaving).toBe("primary");
  expect(writtenBranch).toBe("primary");
  expect(branch).toBe("alternate");
});

it("leaves scene editors writable if an earlier metadata save prevents the version change", async () => {
  const project = "/tmp/failed-plan-storyline";
  let fail!: (error: Error) => void;
  let changed = false;
  bridge.run.mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
  const save = runCoreCommand(project, ["plan", "brief", "--json"]).catch(error => error);
  await vi.waitFor(() => expect(fail).toBeTypeOf("function"));
  const change = withProjectBookChange(project, async () => { changed = true; }).catch(error => error);
  const scene = sceneSaveSession(project, { id: "scene-1", title: "Opening", body: "Keep writing.", summary: "", pov: "", status: "draft", path: "manuscript/scenes/1.md", created_at: "", updated_at: "" });
  fail(new Error("Disk unavailable"));
  await Promise.all([save, change]);
  expect(changed).toBe(false);
  expect(scene.getSnapshot().readOnly).toBe(false);
});

it.each([
  ["plan", "brief"], ["plan", "scene-assign"], ["codex", "update"],
  ["codex", "relationship-delete"], ["memory", "fact-review"],
  ["memory", "review"], ["memory", "scan"], ["scene", "add"],
])("rejects a new %s %s write during a version change without invoking the native command", async (root, action) => {
  const project = `/tmp/changing-${root}-${action}`;
  let finish!: () => void;
  const change = withProjectBookChange(project, () => new Promise<void>(resolve => { finish = resolve; }));
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  try {
    await expect(runCoreCommand(project, [root, action, "--json"])).rejects.toThrow("book version is changing");
    expect(bridge.run).not.toHaveBeenCalled();
  } finally { finish(); await change; }
  bridge.run.mockResolvedValue({ status: 0, stdout: "{}", stderr: "" });
  await runCoreCommand(project, [root, action, "--json"]);
  expect(bridge.run).toHaveBeenCalledTimes(1);
});

it("does not block another project or read-only commands while a book is changing", async () => {
  let finish!: () => void;
  const project = "/tmp/changing-project-isolation";
  bridge.run.mockResolvedValue({ status: 0, stdout: "{}", stderr: "" });
  const change = withProjectBookChange(project, () => new Promise<void>(resolve => { finish = resolve; }));
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  try {
    await runCoreCommand("/tmp/independent-book", ["memory", "review", "--json"]);
    for (const args of [["plan", "get"], ["memory", "fact-list"], ["memory", "diagnose"], ["codex", "get"]]) await runCoreCommand(project, [...args, "--json"]);
    expect(bridge.run).toHaveBeenCalledTimes(5);
  } finally { finish(); await change; }
});
