import { describe, expect, it } from "vitest";
import {
  continuityIssuesForScene,
  evaluatePreferredPipelineHealth,
  findPreferredProposalForScene,
  countGenerationRuns,
  countSceneStatuses,
  countContinuityIssues,
  countProposals,
  orderGenerationRuns,
  orderScenesForOutline,
  orderCodexEntities,
  orderContinuityIssues,
  orderProposalsForReview,
  selectProposalReviewRows,
  proposalsForScene
} from "./state";
import type {
  CodexEntity,
  ContinuityIssue,
  GenerationRunSummary,
  ProposalRecord,
  SceneSummary
} from "./types";

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

describe("selectProposalReviewRows", () => {
  it("prioritizes selected scene proposals when scene priority mode is active", () => {
    const selected = selectProposalReviewRows(
      rows,
      "scene-0001",
      new Set<string>(),
      "scene_priority",
      "all"
    );
    expect(selected[0]?.id).toBe("proposal-a");
  });

  it("supports preferred-only filtering", () => {
    const selected = selectProposalReviewRows(
      rows,
      "",
      new Set<string>(["proposal-c"]),
      "preferred_only",
      "all"
    );
    expect(selected.map((item) => item.id)).toEqual(["proposal-c"]);
  });

  it("combines status filter with preferred priority", () => {
    const selected = selectProposalReviewRows(
      rows,
      "",
      new Set<string>(["proposal-a"]),
      "preferred_priority",
      "applied"
    );
    expect(selected.map((item) => item.id)).toEqual(["proposal-a"]);
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

describe("orderScenesForOutline", () => {
  it("orders scenes by numeric id", () => {
    const scenes: SceneSummary[] = [
      {
        id: "scene-0010",
        title: "Ten",
        summary: "",
        pov: "",
        status: "draft",
        created_at: "",
        updated_at: "",
        path: "manuscript/scenes/0010-ten.md"
      },
      {
        id: "scene-0002",
        title: "Two",
        summary: "",
        pov: "",
        status: "draft",
        created_at: "",
        updated_at: "",
        path: "manuscript/scenes/0002-two.md"
      },
      {
        id: "scene-0001",
        title: "One",
        summary: "",
        pov: "",
        status: "draft",
        created_at: "",
        updated_at: "",
        path: "manuscript/scenes/0001-one.md"
      }
    ];
    const ordered = orderScenesForOutline(scenes);
    expect(ordered.map((item) => item.id)).toEqual(["scene-0001", "scene-0002", "scene-0010"]);
  });
});

describe("countSceneStatuses", () => {
  it("counts standard statuses and groups unknown statuses as other", () => {
    const counts = countSceneStatuses([
      {
        id: "scene-0001",
        title: "",
        summary: "",
        pov: "",
        status: "draft",
        created_at: "",
        updated_at: "",
        path: ""
      },
      {
        id: "scene-0002",
        title: "",
        summary: "",
        pov: "",
        status: "revised",
        created_at: "",
        updated_at: "",
        path: ""
      },
      {
        id: "scene-0003",
        title: "",
        summary: "",
        pov: "",
        status: "final",
        created_at: "",
        updated_at: "",
        path: ""
      },
      {
        id: "scene-0004",
        title: "",
        summary: "",
        pov: "",
        status: "blocked",
        created_at: "",
        updated_at: "",
        path: ""
      }
    ]);
    expect(counts).toEqual({
      draft: 1,
      revised: 1,
      final: 1,
      other: 1
    });
  });
});

describe("proposalsForScene", () => {
  it("returns scene-specific and global proposals for a scene", () => {
    const sceneRows = proposalsForScene(rows, "scene-0001");
    expect(sceneRows.map((item) => item.id)).toEqual(["proposal-a"]);

    const mixed: ProposalRecord[] = [
      ...rows,
      {
        id: "proposal-global",
        title: "Global",
        instruction: "Global",
        scene_id: "",
        status: "pending",
        created_at: "2026-02-11T13:00:00Z",
        updated_at: "2026-02-11T13:00:00Z",
        notes: ""
      }
    ];
    const mixedRows = proposalsForScene(mixed, "scene-0001");
    expect(mixedRows.map((item) => item.id)).toEqual(["proposal-a", "proposal-global"]);
  });
});

describe("findPreferredProposalForScene", () => {
  it("returns linked proposal for pinned run in scene", () => {
    const proposals: ProposalRecord[] = [
      {
        id: "proposal-a",
        title: "A",
        instruction: "A",
        scene_id: "scene-0001",
        status: "pending",
        created_at: "",
        updated_at: "",
        notes: "",
        source: "ai_generate",
        generation: {
          id: "gen-1",
          provider: "openai",
          model: "gpt-4.1-mini",
          temperature: 0.2,
          max_output_tokens: 700,
          context_scene_radius: 1,
          codex_limit: 20,
          input_tokens: 10,
          output_tokens: 20,
          latency_ms: 1000,
          provider_attempts: 1,
          estimated_cost_usd: 0.001,
          log_path: ".openauthor/generations/gen-1.json"
        }
      },
      {
        id: "proposal-b",
        title: "B",
        instruction: "B",
        scene_id: "scene-0001",
        status: "pending",
        created_at: "",
        updated_at: "",
        notes: "",
        source: "ai_generate",
        generation: {
          id: "gen-2",
          provider: "openai",
          model: "gpt-4.1-mini",
          temperature: 0.2,
          max_output_tokens: 700,
          context_scene_radius: 1,
          codex_limit: 20,
          input_tokens: 10,
          output_tokens: 20,
          latency_ms: 1000,
          provider_attempts: 1,
          estimated_cost_usd: 0.001,
          log_path: ".openauthor/generations/gen-2.json"
        }
      }
    ];
    const preferred = findPreferredProposalForScene(proposals, "scene-0001", {
      "scene-0001": "gen-2"
    });
    expect(preferred?.id).toBe("proposal-b");
  });

  it("returns null when no pinned run or no matching proposal exists", () => {
    const preferred = findPreferredProposalForScene(rows, "scene-0001", {});
    expect(preferred).toBeNull();
  });
});

describe("evaluatePreferredPipelineHealth", () => {
  it("returns missing pin when no preferred run is set", () => {
    const health = evaluatePreferredPipelineHealth("", false, null);
    expect(health.code).toBe("missing_pin");
    expect(health.tone).toBe("warn");
  });

  it("returns stale pin when preferred run does not resolve", () => {
    const health = evaluatePreferredPipelineHealth("gen-stale", false, null);
    expect(health.code).toBe("stale_pin");
    expect(health.tone).toBe("error");
  });

  it("returns linked proposal states for pending/applied/rejected", () => {
    expect(evaluatePreferredPipelineHealth("gen-1", true, "pending").code).toBe(
      "linked_pending"
    );
    expect(evaluatePreferredPipelineHealth("gen-1", true, "applied").code).toBe(
      "linked_applied"
    );
    expect(evaluatePreferredPipelineHealth("gen-1", true, "rejected").code).toBe(
      "linked_rejected"
    );
  });
});

describe("continuityIssuesForScene", () => {
  it("filters issues by scene id", () => {
    const rows: ContinuityIssue[] = [
      {
        id: "a",
        severity: "warning",
        code: "x",
        title: "A",
        message: "A",
        scene_id: "scene-0001",
        path: "a"
      },
      {
        id: "b",
        severity: "info",
        code: "y",
        title: "B",
        message: "B",
        scene_id: "scene-0002",
        path: "b"
      }
    ];
    expect(continuityIssuesForScene(rows, "scene-0001").map((item) => item.id)).toEqual(["a"]);
  });
});

describe("orderGenerationRuns", () => {
  it("sorts generation runs by created_at desc", () => {
    const rows: GenerationRunSummary[] = [
      {
        run_id: "gen-a",
        status: "succeeded",
        created_at: "2026-02-11T10:00:00Z",
        scene_id: "scene-0001",
        provider: "openai",
        model: "gpt-4.1-mini",
        proposal_id: "proposal-a",
        input_tokens: 100,
        output_tokens: 80,
        latency_ms: 1200,
        provider_attempts: 1,
        estimated_cost_usd: 0.001,
        error_category: "",
        error_retriable: null,
        normalization_changed: true,
        missing_sections_filled: [],
        quality_score: 92,
        quality_tier: "high",
        quality_flags: [],
        log_path: ".openauthor/generations/gen-a.json"
      },
      {
        run_id: "gen-b",
        status: "failed",
        created_at: "2026-02-11T12:00:00Z",
        scene_id: "scene-0002",
        provider: "anthropic",
        model: "claude-3-5-haiku-latest",
        proposal_id: "",
        input_tokens: null,
        output_tokens: null,
        latency_ms: null,
        provider_attempts: 3,
        estimated_cost_usd: null,
        error_category: "rate_limited",
        error_retriable: true,
        normalization_changed: null,
        missing_sections_filled: [],
        quality_score: null,
        quality_tier: null,
        quality_flags: [],
        log_path: ".openauthor/generations/gen-b.json"
      }
    ];
    const ordered = orderGenerationRuns(rows);
    expect(ordered.map((item) => item.run_id)).toEqual(["gen-b", "gen-a"]);
  });
});

describe("countGenerationRuns", () => {
  it("counts succeeded and failed run statuses", () => {
    const counts = countGenerationRuns([
      {
        run_id: "gen-a",
        status: "succeeded",
        created_at: "",
        scene_id: "",
        provider: "local",
        model: "heuristic-v1",
        proposal_id: "",
        input_tokens: null,
        output_tokens: null,
        latency_ms: null,
        provider_attempts: 1,
        estimated_cost_usd: null,
        error_category: "",
        error_retriable: null,
        normalization_changed: false,
        missing_sections_filled: [],
        quality_score: 85,
        quality_tier: "high",
        quality_flags: [],
        log_path: ""
      },
      {
        run_id: "gen-b",
        status: "failed",
        created_at: "",
        scene_id: "",
        provider: "openai",
        model: "gpt-4.1-mini",
        proposal_id: "",
        input_tokens: null,
        output_tokens: null,
        latency_ms: null,
        provider_attempts: 2,
        estimated_cost_usd: null,
        error_category: "network_error",
        error_retriable: true,
        normalization_changed: null,
        missing_sections_filled: [],
        quality_score: null,
        quality_tier: null,
        quality_flags: [],
        log_path: ""
      },
      {
        run_id: "gen-c",
        status: "other",
        created_at: "",
        scene_id: "",
        provider: "openai",
        model: "gpt-4.1-mini",
        proposal_id: "",
        input_tokens: null,
        output_tokens: null,
        latency_ms: null,
        provider_attempts: 1,
        estimated_cost_usd: null,
        error_category: "",
        error_retriable: null,
        normalization_changed: false,
        missing_sections_filled: [],
        quality_score: 58,
        quality_tier: "low",
        quality_flags: ["missing_sections_filled"],
        log_path: ""
      }
    ]);
    expect(counts).toEqual({
      succeeded: 1,
      failed: 1,
      other: 1
    });
  });
});
