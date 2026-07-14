import { useMemo } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useEditor } from "../../contexts/EditorContext";
import { countProposals, orderProposalsForReview } from "../../state";

export function ProposalQueue() {
  const { proposals } = useWorkspace();
  const { openTab } = useEditor();

  const counts = useMemo(() => countProposals(proposals), [proposals]);
  const ordered = useMemo(() => orderProposalsForReview(proposals), [proposals]);

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
        <span className="sidebar__title">Proposals</span>
        <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <span style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)" }}>
            {counts.pending} pending
          </span>
          <button
            className="btn btn--ghost"
            style={{ fontSize: "var(--text-xs)", padding: "2px 8px" }}
            title="Ask the AI for an edit proposal"
            onClick={() => openTab({ id: "generate", kind: "generate", label: "Generate" })}
          >
            {"+ AI"}
          </button>
        </span>
      </div>
      <div className="sidebar__content">
        {ordered.map((p) => (
          <div
            key={p.id}
            className="list-item"
            onClick={() => handleClick(p.id, p.title)}
            title={`${p.id} \u2014 ${p.status}`}
          >
            <span className={`list-item__dot list-item__dot--${p.status}`} />
            <div className="list-item__content">
              <div className="list-item__title">{p.title || p.id.slice(0, 12)}</div>
              <div className="list-item__meta">
                {p.scene_id || "no scene"} {"\u00B7"} {timeAgo(p.created_at)}
              </div>
            </div>
          </div>
        ))}

        {ordered.length === 0 && (
          <div style={{ padding: "var(--space-4)", color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
            No proposals yet.
          </div>
        )}
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
