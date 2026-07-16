import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useEditor } from "../../contexts/EditorContext";
import { countProposals, orderProposalsForReview } from "../../state";
import { applyProposalBatch, listRevisions } from "../../api";
import type { RevisionSummary } from "../../types";

export function ProposalQueue() {
  const { projectRoot, proposals, refreshProposals, setError, setMessage } = useWorkspace();
  const { openTab } = useEditor();
  const [revisions, setRevisions] = useState<RevisionSummary[]>([]);

  useEffect(() => {
    let active = true;
    void listRevisions(projectRoot, 20)
      .then((rows) => { if (active) setRevisions(rows); })
      .catch((error) => { if (active) setError(`Failed to load Revision history: ${error instanceof Error ? error.message : String(error)}`); });
    return () => { active = false; };
  }, [projectRoot, proposals, setError]);

  const counts = useMemo(() => countProposals(proposals), [proposals]);
  const ordered = useMemo(() => orderProposalsForReview(proposals), [proposals]);
  const coordinatedGroups = useMemo(() => {
    const groups = new Map<string, typeof proposals>();
    for (const proposal of proposals) {
      if (!proposal.change_group_id || proposal.status !== "pending") continue;
      groups.set(proposal.change_group_id, [...(groups.get(proposal.change_group_id) ?? []), proposal]);
    }
    return [...groups.entries()].filter(([, rows]) => rows.length > 1);
  }, [proposals]);

  async function applyGroup(groupId: string, ids: string[]) {
    try {
      const result = await applyProposalBatch(projectRoot, ids);
      await refreshProposals();
      setMessage(`${result.scene_ids.length} scenes applied together in one reversible Revision.`);
    } catch (error) {
      setError(`Coordinated apply failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function handleClick(proposalId: string, title: string) {
    const proposal = proposals.find((p) => p.id === proposalId);
    openTab({
      id: `proposal:${proposalId}`,
      kind: "proposal",
      label: title || proposalId.slice(0, 8),
      data: proposal,
    });
  }

  return (
    <>
      <div className="sidebar__header">
        <span className="sidebar__title">Changes</span>
        <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <span style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)" }}>
            {counts.pending} pending
          </span>
          <button
            className="btn btn--ghost"
            style={{ fontSize: "var(--text-xs)", padding: "2px 8px" }}
            title="Create a reviewable Change Set"
            onClick={() => openTab({ id: "generate", kind: "generate", label: "Generate" })}
          >
            {"+ AI"}
          </button>
        </span>
      </div>
      <div className="sidebar__content">
        {coordinatedGroups.map(([groupId, rows]) => (
          <div key={groupId} style={{ margin: "var(--space-2)", padding: "var(--space-3)", border: "1px solid var(--info)", borderRadius: "var(--radius-md)", background: "var(--info-subtle)" }}>
            <div style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: "var(--text-sm)" }}>Coordinated change · {rows.length} scenes</div>
            <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)", margin: "4px 0 8px" }}>Review each scene’s hunks, then apply the set as one reversible Revision.</div>
            <button className="btn btn--primary btn--sm" disabled={rows.some((row) => !row.change_set || row.stale)} onClick={() => void applyGroup(groupId, rows.map((row) => row.id))}>Apply together</button>
          </div>
        ))}
        {ordered.map((p) => {
          const displayStatus = p.undone_at ? "undone" : p.status;
          const displayTitle = p.title || p.id.slice(0, 12);
          return (
          <button
            type="button"
            key={p.id}
            className="list-item"
            onClick={() => handleClick(p.id, p.title)}
            title={`${p.id} \u2014 ${displayStatus}`}
            aria-label={`${displayTitle} \u2014 ${displayStatus}`}
          >
            <span className={`list-item__dot list-item__dot--${displayStatus}`} />
            <div className="list-item__content">
              <div className="list-item__title">{displayTitle}</div>
              <div className="list-item__meta">
                {p.scene_id || "no scene"} {"\u00B7"} {timeAgo(p.created_at)}
              </div>
            </div>
          </button>
          );
        })}

        {ordered.length === 0 && (
          <div style={{ padding: "var(--space-4)", color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
            No Change Sets yet.
          </div>
        )}

        <div className="section-header" style={{ marginTop: "var(--space-3)" }}>
          <span>Revision History</span>
          <span className="section-header__count">({revisions.length})</span>
        </div>
        {revisions.map((revision) => (
          <button
            type="button"
            key={revision.id}
            className="list-item"
            onClick={() => openTab({ id: `revision:${revision.id}`, kind: "revision", label: revision.message || revision.id.slice(0, 8), data: revision })}
            title={revision.id}
          >
            <span className="list-item__dot list-item__dot--applied" />
            <div className="list-item__content">
              <div className="list-item__title">{revision.message || revision.kind}</div>
              <div className="list-item__meta">{revision.kind} · {timeAgo(revision.created_at)}</div>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
