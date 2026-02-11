import { describe, expect, it } from "vitest";
import {
  countContinuityIssues,
  countProposals,
  orderCodexEntities,
  orderContinuityIssues,
  orderProposalsForReview
} from "./state";
import type { CodexEntity, ContinuityIssue, ProposalRecord } from "./types";

const rows: ProposalRecord[] = [
  {
    id: "proposal-a",
    title: "A",
    instruction: "A",
    scene_id: "scene-0001",
    status: "applied",
    created_at: "2026-02-11T10:00:00Z",
    updated_at: "2026-02-11T10:00:00Z",
    notes: ""
  },
  {
    id: "proposal-b",
    title: "B",
    instruction: "B",
    scene_id: "scene-0002",
    status: "pending",
    created_at: "2026-02-11T11:00:00Z",
    updated_at: "2026-02-11T11:00:00Z",
    notes: ""
  },
  {
    id: "proposal-c",
    title: "C",
    instruction: "C",
    scene_id: "scene-0003",
    status: "rejected",
    created_at: "2026-02-11T12:00:00Z",
    updated_at: "2026-02-11T12:00:00Z",
    notes: ""
  },
  {
    id: "proposal-d",
    title: "D",
    instruction: "D",
    scene_id: "scene-0004",
    status: "pending",
    created_at: "2026-02-11T13:00:00Z",
    updated_at: "2026-02-11T13:00:00Z",
    notes: ""
  }
];

describe("orderProposalsForReview", () => {
  it("prioritizes pending proposals first and sorts by updated time desc", () => {
    const ordered = orderProposalsForReview(rows);
    expect(ordered.map((item) => item.id)).toEqual([
      "proposal-d",
      "proposal-b",
      "proposal-a",
      "proposal-c"
    ]);
  });
});

describe("countProposals", () => {
  it("returns proposal status counts", () => {
    const counts = countProposals(rows);
    expect(counts).toEqual({
      pending: 2,
      applied: 1,
      rejected: 1
    });
  });
});

describe("orderCodexEntities", () => {
  it("orders entities by type then name", () => {
    const entities: CodexEntity[] = [
      {
        id: "entity-z",
        type: "location",
        name: "Zeta City",
        description: "",
        created_at: "2026-02-11T10:00:00Z",
        updated_at: "2026-02-11T10:00:00Z"
      },
      {
        id: "entity-a",
        type: "character",
        name: "Aria",
        description: "",
        created_at: "2026-02-11T10:00:00Z",
        updated_at: "2026-02-11T10:00:00Z"
      },
      {
        id: "entity-b",
        type: "character",
        name: "Bran",
        description: "",
        created_at: "2026-02-11T10:00:00Z",
        updated_at: "2026-02-11T10:00:00Z"
      }
    ];
    const ordered = orderCodexEntities(entities);
    expect(ordered.map((item) => item.id)).toEqual(["entity-a", "entity-b", "entity-z"]);
  });
});

describe("orderContinuityIssues", () => {
  it("orders by severity, scene id, and code", () => {
    const issues: ContinuityIssue[] = [
      {
        id: "a",
        severity: "warning",
        code: "b_code",
        title: "A",
        message: "A",
        scene_id: "scene-0002",
        path: "manuscript/scenes/0002-a.md"
      },
      {
        id: "b",
        severity: "info",
        code: "a_code",
        title: "B",
        message: "B",
        scene_id: "scene-0001",
        path: "manuscript/scenes/0001-b.md"
      },
      {
        id: "c",
        severity: "error",
        code: "z_code",
        title: "C",
        message: "C",
        scene_id: "scene-0003",
        path: "manuscript/scenes/0003-c.md"
      },
      {
        id: "d",
        severity: "warning",
        code: "a_code",
        title: "D",
        message: "D",
        scene_id: "scene-0002",
        path: "manuscript/scenes/0002-d.md"
      }
    ];
    const ordered = orderContinuityIssues(issues);
    expect(ordered.map((item) => item.id)).toEqual(["c", "d", "a", "b"]);
  });
});

describe("countContinuityIssues", () => {
  it("returns severity counts", () => {
    const counts = countContinuityIssues([
      {
        id: "a",
        severity: "error",
        code: "a",
        title: "A",
        message: "A",
        scene_id: "scene-0001",
        path: "x"
      },
      {
        id: "b",
        severity: "warning",
        code: "b",
        title: "B",
        message: "B",
        scene_id: "scene-0001",
        path: "y"
      },
      {
        id: "c",
        severity: "warning",
        code: "c",
        title: "C",
        message: "C",
        scene_id: "scene-0002",
        path: "z"
      }
    ]);
    expect(counts).toEqual({
      error: 1,
      warning: 2,
      info: 0
    });
  });
});
