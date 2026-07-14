import { useState } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useEditor } from "../../contexts/EditorContext";
import { applyProposal, draftProposal, rejectProposal, getScene } from "../../api";
import type { ProposalProvider, ProposalRecord } from "../../types";

type Props = {
  proposal: ProposalRecord;
};

export function ProposalReview({ proposal: initial }: Props) {
  const { projectRoot, runtimeConfig, refreshProposals, refreshScenes, setError, setMessage } =
    useWorkspace();
  const { openTab, updateTab } = useEditor();
  const [proposal, setProposal] = useState(initial);
  const [busy, setBusy] = useState("");
  const [confirmForce, setConfirmForce] = useState(false);

  const draftProvider: ProposalProvider =
    (proposal.generation?.provider as ProposalProvider | undefined) ??
    (Object.entries(runtimeConfig?.providers ?? {}).find(
      ([name, config]) => name !== "local" && config.credential_present
    )?.[0] as ProposalProvider | undefined) ??
    "local";

  function syncTab(updated: ProposalRecord) {
    setProposal(updated);
    updateTab(`proposal:${updated.id}`, { data: updated });
  }

  async function handleDraft() {
    setBusy("draft");
    try {
      const updated = await draftProposal(projectRoot, {
        proposalId: proposal.id,
        provider: draftProvider,
      });
      syncTab(updated);
      setMessage("Draft ready — review the revised scene text below, then apply.");
      await refreshProposals();
    } catch (e) {
      setError(`Draft failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy("");
    }
  }

  async function handleApply() {
    const needsForce = Boolean(proposal.stale && proposal.proposed_body);
    if (needsForce && !confirmForce) {
      setConfirmForce(true);
      return;
    }
    setBusy("apply");
    try {
      const updated = await applyProposal(projectRoot, proposal.id, "", needsForce);
      syncTab(updated);
      setMessage(
        updated.applied_changes
          ? `Applied: the scene was updated with the drafted text.`
          : `Marked applied. No drafted text was attached, so the scene is unchanged.`
      );
      await Promise.all([refreshProposals(), refreshScenes()]);
    } catch (e) {
      setError(`Apply failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy("");
      setConfirmForce(false);
    }
  }

  async function handleReject() {
    setBusy("reject");
    try {
      const updated = await rejectProposal(projectRoot, proposal.id);
      syncTab(updated);
      setMessage(`Proposal rejected: ${proposal.title}`);
      await refreshProposals();
    } catch (e) {
      setError(`Reject failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy("");
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
  const hasDraft = Boolean(proposal.proposed_body && proposal.proposed_body.trim());

  return (
    <div className="review-card" style={{ background: "var(--bg-surface)", minHeight: "100%", overflow: "auto" }}>
      <div className="review-card__header">
        <div className="review-card__title">{proposal.title || proposal.id.slice(0, 12)}</div>
        <div className="review-card__meta">
          <span className={`badge badge--${proposal.status}`}>{proposal.status}</span>
          {proposal.stale && proposal.status === "pending" && (
            <span className="badge badge--warning" title="The scene changed after this proposal was written">
              scene changed
            </span>
          )}
          {proposal.scene_id && <span>{proposal.scene_id}</span>}
          {proposal.source && <span>{proposal.source}</span>}
        </div>
      </div>

      {proposal.instruction && (
        <div className="review-card__section">
          <div className="review-card__section-title">
            {proposal.source === "merge_resolution" ? "Reconciliation" : "Edit plan"}
          </div>
          <div className="review-card__section-body" style={{ whiteSpace: "pre-wrap" }}>
            {proposal.instruction}
          </div>
        </div>
      )}

      {hasDraft && (
        <div className="review-card__section">
          <div className="review-card__section-title">
            Drafted scene text {proposal.draft ? `(${proposal.draft.provider}/${proposal.draft.model})` : ""}
          </div>
          <div
            className="review-card__section-body"
            style={{
              whiteSpace: "pre-wrap",
              fontFamily: "var(--font-prose)",
              borderLeft: "2px solid var(--accent, var(--text-tertiary))",
              paddingLeft: "var(--space-3)",
            }}
          >
            {proposal.proposed_body}
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

      {proposal.status === "pending" && proposal.source === "merge_resolution" && (
        <div className="review-card__section">
          <div className="review-card__section-body" style={{ color: "var(--text-secondary)" }}>
            This reconciliation is used during the storyline merge. Open the Merge panel to
            complete the merge (or Reject it to discard).
          </div>
        </div>
      )}

      {proposal.status === "pending" && (
        <div className="review-card__actions">
          {proposal.scene_id && proposal.source !== "merge_resolution" && (
            <button className="btn btn--primary" disabled={busy === "draft"} onClick={handleDraft}>
              {busy === "draft"
                ? "Drafting..."
                : hasDraft
                  ? "Redraft scene text"
                  : "Draft scene text"}
            </button>
          )}
          {proposal.source !== "merge_resolution" && (
            <button
              className="btn btn--success"
              disabled={busy === "apply"}
              onClick={handleApply}
              title={
                hasDraft
                  ? "Write the drafted text into the scene (a snapshot is taken first)"
                  : "Mark as applied without changing the scene"
              }
            >
              {busy === "apply"
                ? "Applying..."
                : confirmForce
                  ? "Scene changed — apply anyway?"
                  : hasDraft
                    ? "Apply to scene"
                    : "Mark applied"}
            </button>
          )}
          <button className="btn btn--danger" disabled={busy === "reject"} onClick={handleReject}>
            Reject
          </button>
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
