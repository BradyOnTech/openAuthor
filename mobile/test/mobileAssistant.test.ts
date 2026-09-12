import { describe, expect, it } from "vitest";

import { MobileAssistantTools } from "../src/core/mobileAssistant";
import { SnapshotProject, type MobileSnapshot } from "../src/core/snapshotProject";

const snapshot: MobileSnapshot = {
  schema: "openauthor.mobile.snapshot",
  schema_version: 1,
  project_id: "project-mobile",
  revision: "rev-42",
  scenes: [{
    id: "scene-1",
    title: "The Brass Key",
    summary: "Mara finds a key.",
    pov: "Mara",
    status: "draft",
    created_at: "2026-08-30T00:00:00Z",
    updated_at: "2026-08-30T00:00:00Z",
    body: "Mara finds a brass key beneath the observatory clock.",
  }],
  codex: { entities: [], relationships: [] },
  evidence: [],
};

describe("MobileAssistantTools", () => {
  it("answers read-only tools from the immutable snapshot", async () => {
    const tools = new MobileAssistantTools(SnapshotProject.open(snapshot), async () => "queued");
    await expect(tools.execute("scene_list", {})).resolves.toMatchObject({ revision: "rev-42" });
    await expect(tools.execute("scene_get", { scene_id: "scene-1" })).resolves.toMatchObject({
      scene: { title: "The Brass Key" },
    });
    await expect(tools.execute("retrieval_query", { query: "observatory" })).resolves.toMatchObject({
      results: [{ sourceId: "scene-1" }],
    });
  });

  it("routes every write-like request into reviewable outbox work", async () => {
    const queued: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const tools = new MobileAssistantTools(SnapshotProject.open(snapshot), async (kind, payload) => {
      queued.push({ kind, payload });
      return "operation-7";
    });
    await expect(tools.execute("capture_note", { text: "Use the key later." })).resolves.toEqual({
      status: "pending_desktop_review",
      operationId: "operation-7",
      revision: "rev-42",
    });
    expect(queued).toEqual([{ kind: "capture_note", payload: { content: "Use the key later." } }]);
    await expect(tools.execute("scene.update", {})).rejects.toThrow("not available on mobile");
  });
});
