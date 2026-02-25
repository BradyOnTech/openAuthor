import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useEditor } from "../../contexts/EditorContext";
import { applyProposal, rejectProposal, getScene } from "../../api";
import type { ProposalRecord } from "../../types";

type Props = {
  proposal: ProposalRecord;
};

export function ProposalReview({ proposal }: Props) {
  const { projectRoot, refreshProposals, refreshScenes, setError, setMessage } = useWorkspace();
  const { openTab, closeTab } = useEditor();

  async function handleApply() {
    try {
      await applyProposal(projectRoot, proposal.id);
      setMessage(`Proposal applied: ${proposal.title}`);
      await Promise.all([refreshProposals(), refreshScenes()]);
    } catch (e) {
      setError(`Apply failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleReject() {
    try {
      await rejectProposal(projectRoot, proposal.id);
      setMessage(`Proposal rejected: ${proposal.title}`);
      await refreshProposals();
    } catch (e) {
      setError(`Reject failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleOpenScene() {
    if (!proposal.scene_id) return;
    try {
      const scene = await getScene(projectRoot, proposal.scene_id);
      openTab({ id: `scene:${scene.id}`, kind: "scene", label: scene.title || scene.id, data: scene });
    } catch (e) {
      setError(`Failed to open scene: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const gen = proposal.generation;

  return (
    <div className="review-card" style={{ background: "var(--bg-surface)", minHeight: "100%", overflow: "auto" }}>
      <div className="review-card__header">
        <div className="review-card__title">{proposal.title || proposal.id.slice(0, 12)}</div>
        <div className="review-card__meta">
          <span className={`badge badge--${proposal.status}`}>{proposal.status}</span>
          {proposal.scene_id && <span>{proposal.scene_id}</span>}
          {proposal.source && <span>{proposal.source}</span>}
        </div>
      </div>

      {proposal.instruction && (
        <div className="review-card__section">
          <div className="review-card__section-title">Instruction</div>
          <div className="review-card__section-body" style={{ whiteSpace: "pre-wrap" }}>
            {proposal.instruction}
          </div>
        </div>
      )}

      {proposal.notes && (
        <div className="review-card__section">
          <div className="review-card__section-title">Notes</div>
          <div className="review-card__section-body" style={{ whiteSpace: "pre-wrap" }}>
            {proposal.notes}
          </div>
        </div>
      )}

      {gen && (
        <div className="review-card__generation-meta">
          <span>{gen.provider}/{gen.model}</span>
          <span>{gen.input_tokens} in / {gen.output_tokens} out</span>
          {gen.latency_ms != null && <span>{(gen.latency_ms / 1000).toFixed(1)}s</span>}
          {gen.estimated_cost_usd != null && <span>${gen.estimated_cost_usd.toFixed(4)}</span>}
          {gen.quality_tier && <span className={`badge badge--${gen.quality_tier === "high" ? "applied" : gen.quality_tier === "low" ? "error" : "warning"}`}>{gen.quality_tier}</span>}
        </div>
      )}

      {proposal.status === "pending" && (
        <div className="review-card__actions">
          <button className="btn btn--success" onClick={handleApply}>Apply</button>
          <button className="btn btn--danger" onClick={handleReject}>Reject</button>
          {proposal.scene_id && (
            <button className="btn btn--ghost" onClick={handleOpenScene}>Open Scene</button>
          )}
        </div>
      )}

      {proposal.status !== "pending" && proposal.scene_id && (
        <div className="review-card__actions">
          <button className="btn btn--ghost" onClick={handleOpenScene}>Open Scene</button>
        </div>
      )}
    </div>
  );
}
