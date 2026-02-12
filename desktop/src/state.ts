import type {
  CodexEntity,
  ContinuityIssue,
  GenerationRunSummary,
  ProposalRecord,
  SceneSummary
} from "./types";

export type ProposalCounts = {
  pending: number;
  applied: number;
  rejected: number;
};

export type ContinuityCounts = {
  error: number;
  warning: number;
  info: number;
};

export type SceneStatusCounts = {
  draft: number;
  revised: number;
  final: number;
  other: number;
};

export type GenerationRunCounts = {
  succeeded: number;
  failed: number;
  other: number;
};

export type ProposalReviewMode =
  | "all"
  | "scene_priority"
  | "preferred_priority"
  | "preferred_only";

export type ProposalStatusFilter = "all" | ProposalRecord["status"];

export type PreferredPipelineHealthCode =
  | "missing_pin"
  | "stale_pin"
  | "missing_linked_proposal"
  | "linked_pending"
  | "linked_applied"
  | "linked_rejected";

export type PreferredPipelineHealthTone = "warn" | "error" | "info" | "ok";

export type PreferredPipelineHealth = {
  code: PreferredPipelineHealthCode;
  label: string;
  detail: string;
  tone: PreferredPipelineHealthTone;
};

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function orderProposalsForReview(rows: ProposalRecord[]): ProposalRecord[] {
  const rank = (status: ProposalRecord["status"]): number => {
    if (status === "pending") return 0;
    if (status === "applied") return 1;
    return 2;
  };

  return [...rows].sort((a, b) => {
    const rankDiff = rank(a.status) - rank(b.status);
    if (rankDiff !== 0) return rankDiff;
    return timestamp(b.updated_at) - timestamp(a.updated_at);
  });
}

export function selectProposalReviewRows(
  rows: ProposalRecord[],
  selectedSceneId: string,
  preferredProposalIds: Set<string>,
  mode: ProposalReviewMode,
  statusFilter: ProposalStatusFilter
): ProposalRecord[] {
  const base = orderProposalsForReview(rows);
  const baseIndex = new Map(base.map((row, index) => [row.id, index]));
  let filtered = base;

  if (statusFilter !== "all") {
    filtered = filtered.filter((row) => row.status === statusFilter);
  }

  if (mode === "preferred_only") {
    filtered = filtered.filter((row) => preferredProposalIds.has(row.id));
  }

  const rank = (row: ProposalRecord): number => {
    if (mode === "scene_priority" && selectedSceneId && row.scene_id === selectedSceneId) {
      return -1;
    }
    if ((mode === "preferred_priority" || mode === "preferred_only") && preferredProposalIds.has(row.id)) {
      return -1;
    }
    return 0;
  };

  return [...filtered].sort((a, b) => {
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    return (baseIndex.get(a.id) ?? 0) - (baseIndex.get(b.id) ?? 0);
  });
}

export function countProposals(rows: ProposalRecord[]): ProposalCounts {
  return rows.reduce(
    (acc, row) => {
      acc[row.status] += 1;
      return acc;
    },
    { pending: 0, applied: 0, rejected: 0 } satisfies ProposalCounts
  );
}

export function orderCodexEntities(rows: CodexEntity[]): CodexEntity[] {
  return [...rows].sort((a, b) => {
    const typeDiff = a.type.localeCompare(b.type);
    if (typeDiff !== 0) return typeDiff;
    return a.name.localeCompare(b.name);
  });
}

const CHECK_SEVERITY_ORDER: Record<ContinuityIssue["severity"], number> = {
  error: 0,
  warning: 1,
  info: 2
};

export function orderContinuityIssues(rows: ContinuityIssue[]): ContinuityIssue[] {
  return [...rows].sort((a, b) => {
    const severityDiff = CHECK_SEVERITY_ORDER[a.severity] - CHECK_SEVERITY_ORDER[b.severity];
    if (severityDiff !== 0) return severityDiff;
    const sceneDiff = a.scene_id.localeCompare(b.scene_id);
    if (sceneDiff !== 0) return sceneDiff;
    return a.code.localeCompare(b.code);
  });
}

export function countContinuityIssues(rows: ContinuityIssue[]): ContinuityCounts {
  return rows.reduce(
    (acc, row) => {
      acc[row.severity] += 1;
      return acc;
    },
    { error: 0, warning: 0, info: 0 } satisfies ContinuityCounts
  );
}

function sceneNumber(sceneId: string): number {
  const match = sceneId.match(/scene-(\d+)$/);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number.parseInt(match[1], 10);
}

export function orderScenesForOutline(rows: SceneSummary[]): SceneSummary[] {
  return [...rows].sort((a, b) => {
    const indexDiff = sceneNumber(a.id) - sceneNumber(b.id);
    if (indexDiff !== 0) return indexDiff;
    return a.id.localeCompare(b.id);
  });
}

export function countSceneStatuses(rows: SceneSummary[]): SceneStatusCounts {
  return rows.reduce(
    (acc, row) => {
      const status = row.status.toLowerCase();
      if (status === "draft" || status === "revised" || status === "final") {
        acc[status] += 1;
      } else {
        acc.other += 1;
      }
      return acc;
    },
    { draft: 0, revised: 0, final: 0, other: 0 } satisfies SceneStatusCounts
  );
}

export function proposalsForScene(
  rows: ProposalRecord[],
  sceneId: string
): ProposalRecord[] {
  if (!sceneId) return [];
  return rows.filter((row) => row.scene_id === sceneId || row.scene_id === "");
}

export function findPreferredProposalForScene(
  rows: ProposalRecord[],
  sceneId: string,
  pinnedRunByScene: Record<string, string>
): ProposalRecord | null {
  if (!sceneId) return null;
  const pinnedRunId = pinnedRunByScene[sceneId];
  if (!pinnedRunId) return null;
  return (
    rows.find(
      (row) => row.scene_id === sceneId && row.generation?.id === pinnedRunId
    ) ?? null
  );
}

export function evaluatePreferredPipelineHealth(
  pinnedRunId: string,
  pinnedRunExists: boolean,
  linkedProposalStatus: ProposalRecord["status"] | null
): PreferredPipelineHealth {
  if (!pinnedRunId) {
    return {
      code: "missing_pin",
      label: "Missing Pin",
      detail: "No preferred generation run is pinned for this scene.",
      tone: "warn"
    };
  }

  if (!pinnedRunExists) {
    return {
      code: "stale_pin",
      label: "Stale Pin",
      detail: `Pinned run '${pinnedRunId}' is missing.`,
      tone: "error"
    };
  }

  if (!linkedProposalStatus) {
    return {
      code: "missing_linked_proposal",
      label: "Missing Linked Proposal",
      detail: "Pinned run exists but no linked proposal is available in the queue.",
      tone: "warn"
    };
  }

  if (linkedProposalStatus === "applied") {
    return {
      code: "linked_applied",
      label: "Applied",
      detail: "Linked proposal has already been applied.",
      tone: "ok"
    };
  }

  if (linkedProposalStatus === "rejected") {
    return {
      code: "linked_rejected",
      label: "Rejected",
      detail: "Linked proposal was rejected and should likely be re-generated.",
      tone: "warn"
    };
  }

  return {
    code: "linked_pending",
    label: "Pending Review",
    detail: "Linked proposal is pending review.",
    tone: "info"
  };
}

export function continuityIssuesForScene(
  rows: ContinuityIssue[],
  sceneId: string
): ContinuityIssue[] {
  if (!sceneId) return [];
  return rows.filter((row) => row.scene_id === sceneId);
}

export function orderGenerationRuns(rows: GenerationRunSummary[]): GenerationRunSummary[] {
  return [...rows].sort((a, b) => {
    return timestamp(b.created_at) - timestamp(a.created_at);
  });
}

export function countGenerationRuns(rows: GenerationRunSummary[]): GenerationRunCounts {
  return rows.reduce(
    (acc, row) => {
      if (row.status === "succeeded") {
        acc.succeeded += 1;
      } else if (row.status === "failed") {
        acc.failed += 1;
      } else {
        acc.other += 1;
      }
      return acc;
    },
    { succeeded: 0, failed: 0, other: 0 } satisfies GenerationRunCounts
  );
}
