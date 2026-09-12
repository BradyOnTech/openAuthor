import { describe, expect, it } from "vitest";

import { SnapshotProject } from "../src/core/snapshotProject";

const SNAPSHOT = {
  schema: "openauthor.mobile.snapshot",
  schema_version: 1,
  project_id: "project-mobile",
  revision: "rev-42",
  scenes: [
    {
      id: "scene-0001",
      title: "Snow Key",
      summary: "Mara finds a key.",
      pov: "Mara",
      status: "draft",
      created_at: "2026-08-30T10:00:00Z",
      updated_at: "2026-08-30T10:00:00Z",
      body: "Mara lifted the brass key from the snow.",
    },
    {
      id: "scene-0002",
      title: "North Tower",
      summary: "The map points north.",
      pov: "Ilan",
      status: "draft",
      created_at: "2026-08-30T11:00:00Z",
      updated_at: "2026-08-30T11:00:00Z",
      body: "Ilan unfolded Mara's map beneath the tower bell.",
    },
  ],
  codex: {
    entities: [
      {
        id: "entity-mara",
        type: "character",
        name: "Mara",
        description: "A cautious cartographer.",
      },
    ],
    relationships: [],
  },
  evidence: [
    {
      kind: "scene",
      reference: "scene:scene-0001",
      content_digest: "a".repeat(64),
      authority: 100,
    },
  ],
} as const;

describe("SnapshotProject", () => {
  it("filters private Memory in previously downloaded snapshots before search or voice context", () => {
    const snapshot = { ...SNAPSHOT, codex: { relationships: [], entities: [
      { id: "hidden", name: "Hidden", type: "character", description: "PRIVATE-ENTRY", ai_visibility: "exclude" },
      { id: "ask", name: "Ask", type: "character", description: "PRIVATE-ASK", ai_visibility: "ask" },
      { id: "public", name: "Public", type: "character", description: "PUBLIC-FACT", notes: "PRIVATE-NOTES", details: [
        { key: "known", type: "text", value: "FORESHADOWED-ROUTE", ai_visibility: "include" },
        { key: "hidden", type: "text", value: "PRIVATE-DETAIL", ai_visibility: "exclude" },
        { key: "ask", type: "text", value: "PRIVATE-DETAIL-ASK", ai_visibility: "ask" },
      ] },
    ] } };
    const original = JSON.stringify(snapshot);
    const project = SnapshotProject.open(snapshot);
    expect(project.search("PRIVATE", 50)).toEqual([]);
    const context = project.buildContext({ utterance: "Public Hidden Ask", maxCharacters: 4000 });
    expect(context.items.some(item => item.sourceId === "hidden" || item.sourceId === "ask")).toBe(false);
    expect(JSON.stringify(context.items)).not.toContain("PRIVATE-");
    expect(project.search("FORESHADOWED", 50).some(item => item.sourceId === "public")).toBe(true);
    expect(JSON.stringify(snapshot)).toBe(original);
  });

  it("provides revision-bound scene reading, search, citations, and bounded context", () => {
    const project = SnapshotProject.open(SNAPSHOT);

    expect(project.identity()).toEqual({
      projectId: "project-mobile",
      revision: "rev-42",
    });
    expect(project.getScene("scene-0001")?.body).toContain("brass key");
    expect(project.search("Mara map", 2).map((result) => result.sourceId)).toEqual([
      "scene-0002",
      "scene-0001",
    ]);

    const context = project.buildContext({
      utterance: "Where did Mara's map point?",
      currentSceneId: "scene-0002",
      maxCharacters: 240,
    });
    expect(context.projectId).toBe("project-mobile");
    expect(context.revision).toBe("rev-42");
    expect(context.items[0]?.sourceId).toBe("scene-0002");
    expect(context.items.every((item) => item.citation.reference.length > 0)).toBe(true);
    expect(context.usedCharacters).toBeLessThanOrEqual(240);
  });
});
