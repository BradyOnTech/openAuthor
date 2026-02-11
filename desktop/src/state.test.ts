import { describe, expect, it } from "vitest";
import { countProposals, orderProposalsForReview } from "./state";
import type { ProposalRecord } from "./types";

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
