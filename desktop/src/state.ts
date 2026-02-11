import type { ProposalRecord } from "./types";

export type ProposalCounts = {
  pending: number;
  applied: number;
  rejected: number;
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
