// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { readWorkspace, restoreBookmarks, saveWorkspace, workspaceKey } from "./tabRecovery";
import { getScene, getProposal } from "./api";
vi.mock("./api", () => ({ getScene: vi.fn(), getCodexEntity: vi.fn(), getProposal: vi.fn(), listRevisions: vi.fn() }));
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
it("stores references and reloads current prose, dropping a deleted proposal", async () => {
  const key = workspaceKey("/book", "main");
  saveWorkspace(key, [{ id: "scene:s1", kind: "scene", label: "Old title", modified: true, data: { id: "s1", body: "OLD PRIVATE PROSE" } as never }, { id: "proposal:p1", kind: "proposal", label: "Old change", data: { id: "p1" } as never }], "scene:s1", "none", "");
  expect(localStorage.getItem(key)).not.toContain("OLD PRIVATE PROSE");
  vi.mocked(getScene).mockResolvedValue({ id: "s1", title: "Current title", body: "Current prose" } as never);
  vi.mocked(getProposal).mockRejectedValue(new Error("Deleted"));
  const rows = await restoreBookmarks("/book", readWorkspace(key)!);
  expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ label: "Current title", data: { body: "Current prose" } });
  expect(rows[0].modified).toBeUndefined();
});
it("ignores malformed and duplicate bookmarks", () => {
  const key = workspaceKey("/book", "main"); localStorage.setItem(key, '{broken'); expect(readWorkspace(key)).toBeNull();
  localStorage.setItem(key, JSON.stringify({ tabs: [{ id: "x", kind: "plan", label: "Plan" }, { id: "x", kind: "plan", label: "Plan" }], activeTabId: "x", splitDirection: "none", secondaryActiveTabId: "" })); expect(readWorkspace(key)).toBeNull();
});

it("restores an untouched evidence revision request without storing manuscript snapshots", async () => {
  const key = workspaceKey("/book", "main");
  const request = { sceneId: "s2", instruction: "Review the recorded contradiction before suggesting a correction." };
  saveWorkspace(key, [
    { id: "generate:continuity:d1", kind: "generate", label: "Revise continuity", data: request },
    { id: "scene:s2", kind: "scene", label: "Old scene", data: { id: "s2", body: "OLD PRIVATE PROSE" } as never },
  ], "generate:continuity:d1", "none", "");
  expect(localStorage.getItem(key)).not.toContain("OLD PRIVATE PROSE");
  vi.mocked(getScene).mockResolvedValue({ id: "s2", title: "Current scene", body: "Current prose" } as never);
  const restored = await restoreBookmarks("/book", readWorkspace(key)!);
  expect(restored[0]).toMatchObject({ id: "generate:continuity:d1", data: request });
  expect(restored[1]).toMatchObject({ label: "Current scene", data: { body: "Current prose" } });
});

it.each([
  { sceneId: 2, instruction: "Review this." },
  { sceneId: "s2", instruction: null },
  { sceneId: "s2", instruction: "Review this.", body: "Unexpected manuscript snapshot" },
])("ignores malformed or excessive saved revision request fields", (request) => {
  const key = workspaceKey("/book", "main");
  localStorage.setItem(key, JSON.stringify({ tabs: [{ id: "generate", kind: "generate", label: "Generate", request }], activeTabId: "generate", splitDirection: "none", secondaryActiveTabId: "" }));
  expect(readWorkspace(key)).toBeNull();
});
