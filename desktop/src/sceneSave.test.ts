// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateScene, updateSceneMetadata } from "./api";
import { SceneEditConflictError } from "./sceneConflicts";
import type { SceneEditVersion } from "./types";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const version: SceneEditVersion = { schema_version: 1, scene_id: "scene-0001", workspace: "a".repeat(64), storyline: "main", fields: { title: "b".repeat(64), body: "b".repeat(64), summary: "b".repeat(64), pov: "b".repeat(64), status: "b".repeat(64) } };

describe("guarded desktop scene commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  });
  afterEach(() => { delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__; });

  it("refuses to send an unguarded scene write when the loaded version is missing", async () => {
    await expect(updateScene("/book", "scene-0001", { body: "Draft" })).rejects.toThrow("no save version");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("uses the same guarded command for prose and Inspector fields", async () => {
    invoke.mockResolvedValue({ status: 0, stdout: JSON.stringify({ id: "scene-0001", edit_version: version }), stderr: "" });
    await updateScene("/book", "scene-0001", { body: "Draft", expectedVersion: version });
    await updateSceneMetadata("/book", "scene-0001", { summary: "Summary", expectedVersion: version });
    expect(invoke.mock.calls[0][1].args).toEqual(["scene", "update", "--id", "scene-0001", "--expected-version", JSON.stringify(version), "--body", "Draft", "--json"]);
    expect(invoke.mock.calls[1][1].args).toEqual(["scene", "update", "--id", "scene-0001", "--expected-version", JSON.stringify(version), "--summary", "Summary", "--json"]);
  });

  it("preserves structured conflict details without treating them as a successful save", async () => {
    const conflict = { code: "scene_edit_conflict", current: { edit_version: version, body: "Current" }, reason: "scene_changed", conflicting_fields: ["body"], recovery_path: ".openauthor/workspace/scene-conflicts/fixture.json" };
    invoke.mockResolvedValue({ status: 3, stdout: JSON.stringify({ error: conflict }), stderr: "" });
    const error = await updateScene("/book", "scene-0001", { body: "Draft", expectedVersion: version }).catch((failure) => failure);
    expect(error).toBeInstanceOf(SceneEditConflictError);
    expect(error.conflict).toEqual(conflict);
  });
});
