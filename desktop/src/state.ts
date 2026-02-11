import type { CodexEntity, ContinuityIssue, ProposalRecord } from "./types";

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
