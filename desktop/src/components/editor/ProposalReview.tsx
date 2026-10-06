import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { GenerationAssessment } from "../common/GenerationAssessment";
import { useEditor } from "../../contexts/EditorContext";
import { applyProposal, editProposalHunk, rebaseProposal, rejectProposal, undoProposal, getProposal, getScene, updateProposalHunk, selectDraftCandidate, prepareDraftRevision, type RevisionAuthorization } from "../../api";
import { proposalGenerationSession } from "../../proposalGenerationSession";
import type { ProposalProvider, ProposalRecord } from "../../types";
import { defaultProvider } from "../../providerSelection";
import { flushProjectSceneSaves, sceneSaveSession, withProjectBookChange } from "../../sceneSaveSession";
import { RevisionContextReview } from "./RevisionContextReview";
import { EditorialFindings } from "./EditorialFindings";
import { PassageComparison } from "../shared/PassageComparison";
import { DraftCraftReview } from "./DraftCraftReview";
import { proposalDisplayLabel } from "../../state";

type Props = {
  proposal: ProposalRecord;
};

export function ProposalReview({ proposal: initial }: Props) {
  const { projectRoot, runtimeConfig, scenes, branches, refreshProposals, refreshScenes, setError, setMessage } =
    useWorkspace();
  const { openTab, updateTab } = useEditor();
  const [proposal, setProposal] = useState(initial);
  useEffect(() => setProposal(initial), [initial]);
  const [busy, setBusy] = useState("");
  const [selectionVerified, setSelectionVerified] = useState(!initial.selection);
  const [selectionRefresh, setSelectionRefresh] = useState(0);
  useEffect(() => {
    if (!initial.selection || busy) return;
    let current = true;
    setSelectionVerified(false);
    void getProposal(projectRoot, initial.id).then(updated => {
      if (current) { setProposal(updated); setSelectionVerified(true); }
    }).catch(error => { if (current) setError(`Could not verify this selection: ${error instanceof Error ? error.message : String(error)}`); });
    return () => { current = false; };
  }, [projectRoot, initial.id, Boolean(initial.selection), scenes, branches, busy, selectionRefresh, setError]);
  const [confirmForce, setConfirmForce] = useState(false);
  const [editingHunkId, setEditingHunkId] = useState("");
  const [editedHunkText, setEditedHunkText] = useState("");
  const [feedbackHunkId, setFeedbackHunkId] = useState("");
  const [hunkFeedback, setHunkFeedback] = useState("");
  const [hunkReview, setHunkReview] = useState<{ id: string; feedback: string } | null>(null);
  const [reviewDraft, setReviewDraft] = useState(true);
  const [draftFeedback, setDraftFeedback] = useState("");
  const revisionRequest = useRef<{ feedback: string; updatedAt: string; id: string } | null>(null);
  const [reviewEffort, setReviewEffort] = useState<"" | "low" | "medium" | "high">(initial.draft?.review_reasoning_effort ?? "");
  const draftSession = useMemo(() => proposalGenerationSession(projectRoot, initial.id), [projectRoot, initial.id]);
  const draftState = useSyncExternalStore(draftSession.subscribe, draftSession.getSnapshot);
  const hunkSession = useMemo(() => proposalGenerationSession(projectRoot, `${initial.id}:hunks`), [projectRoot, initial.id]);
  const hunkState = useSyncExternalStore(hunkSession.subscribe, hunkSession.getSnapshot);
  const view = useRef({ mounted: true, key: "" });
  const viewKey = JSON.stringify([projectRoot, initial.id]);
  view.current.key = viewKey;
  useEffect(() => {
    view.current.mounted = true;
    return () => { view.current.mounted = false; };
  }, []);

  const draftProvider: ProposalProvider =
    (proposal.draft?.provider as ProposalProvider | undefined) ??
    ((proposal.draft_revision?.source.provider || undefined) as ProposalProvider | undefined) ??
    (proposal.generation?.provider as ProposalProvider | undefined) ??
    defaultProvider(runtimeConfig).id;

  function syncTab(updated: ProposalRecord) {
    setProposal(updated);
    updateTab(`proposal:${updated.id}`, { data: updated });
  }

  async function handleDraft(authorization?: RevisionAuthorization) {
    setBusy("draft");
    try {
      if (!await flushProjectSceneSaves(projectRoot)) throw new Error("Save pending writing before drafting.");
      let results;
      if (authorization && draftState.reviewTask) results = await draftSession.approveDraft(draftState.reviewTask.index, authorization);
      else if (draftState.job) results = await draftSession.retry();
      else {
        let target = proposal;
        if (draftFeedback.trim()) {
          if (revisionRequest.current?.feedback !== draftFeedback || revisionRequest.current?.updatedAt !== proposal.updated_at)
            revisionRequest.current = { feedback: draftFeedback, updatedAt: proposal.updated_at, id: crypto.randomUUID() };
          target = await prepareDraftRevision(projectRoot, proposal, draftFeedback, revisionRequest.current.id);
          await refreshProposals();
        }
        results = await draftSession.start([{
          sceneId: target.scene_id, instruction: target.instruction, provider: draftProvider,
          model: proposal.draft?.model ?? (proposal.draft_revision?.source.model || undefined) ?? proposal.generation?.model,
          reviewMode: reviewDraft ? "refine" : "off",
          reviewReasoningEffort: reviewDraft && draftProvider === "openai-codex" ? reviewEffort || undefined : undefined,
        }], target.id);
      }
      if (!results || !view.current.mounted || view.current.key !== viewKey) return;
      const updated = results[0];
      if (updated.id === proposal.id) syncTab(updated);
      else {
        openTab({ id: `proposal:${updated.id}`, kind: "proposal", label: proposalDisplayLabel(updated), data: updated });
        setDraftFeedback(""); revisionRequest.current = null;
      }
      draftSession.clear();
      setMessage("Draft ready — review the revised scene text below, then apply.");
      await refreshProposals();
    } catch (e) {
      setError(`Draft failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy("");
    }
  }

  async function handleApply() {
    const needsForce = Boolean(!proposal.selection && proposal.stale && proposal.proposed_body);
    if (needsForce && !confirmForce) {
      setConfirmForce(true);
      return;
    }
    setBusy("apply");
    try {
      const apply = async () => {
        const updated = await applyProposal(projectRoot, proposal.id, "", needsForce);
        if (updated.applied_changes) {
          const scene = await getScene(projectRoot, proposal.scene_id);
          sceneSaveSession(projectRoot, scene).acceptScene(scene);
          updateTab(`scene:${scene.id}`, { data: scene, label: scene.title, modified: false });
        }
        return updated;
      };
      const updated = await withProjectBookChange(projectRoot, apply);
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

  async function handleHunkDecision(hunkId: string, decision: "accepted" | "rejected") {
    setBusy(hunkId);
    try {
      const updated = await updateProposalHunk(projectRoot, proposal.id, hunkId, decision);
      syncTab(updated);
      setMessage(decision === "accepted" ? "Change hunk included." : "Change hunk excluded.");
      await refreshProposals();
    } catch (e) {
      setError(`Hunk review failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy("");
    }
  }

  async function handleSaveHunkEdit(hunkId: string) {
    setBusy(hunkId);
    try {
      const updated = await editProposalHunk(projectRoot, proposal.id, hunkId, editedHunkText);
      syncTab(updated);
      setEditingHunkId("");
      setMessage("Change hunk edited and included.");
      await refreshProposals();
    } catch (e) {
      setError(`Hunk edit failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy("");
    }
  }

  async function handleRegenerateHunk(hunkId: string, feedback = "", authorization?: RevisionAuthorization) {
    if (!hunkState.job && !authorization) { setHunkReview({ id: hunkId, feedback }); return; }
    setBusy(hunkId);
    setHunkReview(null);
    try {
      if (!await flushProjectSceneSaves(projectRoot)) throw new Error("Save pending writing before revising a passage.");
      const results = hunkState.job ? await hunkSession.retry() : await hunkSession.start([{
        sceneId: proposal.scene_id, instruction: proposal.instruction, provider: draftProvider,
      }], proposal.id, { id: hunkId, feedback, authorization });
      if (!results || !view.current.mounted || view.current.key !== viewKey) return;
      syncTab(results[0]);
      hunkSession.clear();
      setFeedbackHunkId("");
      setHunkFeedback("");
      setMessage("Change hunk regenerated; review its replacement before applying.");
      await refreshProposals();
    } catch (e) {
      setError(`Hunk regeneration failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy("");
    }
  }

  async function handleRebase() {
    setBusy("rebase");
    try {
      const updated = await rebaseProposal(projectRoot, proposal.id);
      syncTab(updated);
      if (updated.rebase_report?.status === "rebased") {
        setMessage("Change Set rebased onto the current scene; review carried hunks before applying.");
      } else {
        setError("Automatic rebase stopped because one or more source passages changed. Review the explained conflicts.");
      }
      await refreshProposals();
    } catch (e) {
      setError(`Rebase failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy("");
    }
  }

  async function handleReject() {
    setBusy("reject");
    try {
      const updated = await rejectProposal(projectRoot, proposal.id);
      syncTab(updated);
      setMessage(`${selectionUnchanged ? "Result dismissed" : "Proposal rejected"}: ${proposal.title}`);
      await refreshProposals();
    } catch (e) {
      setError(`Reject failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy("");
    }
  }

  async function handleUndo() {
    setBusy("undo");
    try {
      const undo = async () => {
        const updated = await undoProposal(projectRoot, proposal.id);
        const scene = await getScene(projectRoot, updated.scene_id);
        sceneSaveSession(projectRoot, scene).acceptScene(scene);
        return { updated, scene };
      };
      const { updated, scene } = await withProjectBookChange(projectRoot, undo);
      syncTab(updated);
      openTab({ id: `scene:${scene.id}`, kind: "scene", label: scene.title || scene.id, data: scene });
      setMessage("Change undone — the scene was restored and a new revision recorded.");
      await Promise.all([refreshProposals(), refreshScenes()]);
    } catch (e) {
      setError(`Undo failed: ${e instanceof Error ? e.message : String(e)}`);
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
  const changeSet = proposal.change_set;
  const acceptedCount = changeSet?.hunks.filter((hunk) => hunk.decision === "accepted").length ?? 0;
  const displayStatus = proposal.undone_at ? "undone" : proposal.status;
  const selectionUnchanged = Boolean(proposal.selection && proposal.selection.action !== "critique"
    && (proposal.selection.unchanged || proposal.selection.before === proposal.selection.after));
  const statusLabel = selectionUnchanged && proposal.status === "rejected" ? "Dismissed"
    : proposal.status === "pending" && proposal.selection
      ? proposal.selection.action === "critique" ? "Feedback ready" : selectionUnchanged ? "No replacement suggested" : "Replacement awaiting review" : displayStatus;

  return (
    <div className="review-card" style={{ background: "var(--bg-surface)", minHeight: "100%", overflow: "auto" }}>
      <div className="review-card__header">
        <div className="review-card__title">{proposalDisplayLabel(proposal)}</div>
        <div className="review-card__meta">
          <span className={selectionUnchanged ? "badge" : `badge badge--${displayStatus}`}>{statusLabel}</span>
          {proposal.stale && proposal.status === "pending" && (
            <span className="badge badge--warning" title="The scene changed after this proposal was written">
              scene changed
            </span>
          )}
          {proposal.scene_id && <span>{proposal.scene_id}</span>}
          {proposal.source && <span>{proposal.source}</span>}
        </div>
      </div>

      {proposal.draft?.writing_review && <DraftCraftReview report={proposal.draft.writing_review} disabled={Boolean(busy)}
        onChoose={proposal.status === "pending" && !proposal.stale ? candidate => {
          setBusy("choose-candidate");
          void flushProjectSceneSaves(projectRoot).then(saved => {
            if (!saved) throw new Error("Save pending writing before choosing a candidate.");
            return selectDraftCandidate(projectRoot, proposal, candidate);
          }).then(updated => {
            if (!view.current.mounted || view.current.key !== viewKey) return;
            syncTab(updated); setMessage("Candidate selected. Review the rebuilt hunks before applying.");
            return refreshProposals();
          }).catch(error => {
            if (view.current.mounted && view.current.key === viewKey) setError(error instanceof Error ? error.message : String(error));
          }).finally(() => {
            if (view.current.mounted && view.current.key === viewKey) setBusy("");
          });
        } : undefined} />}

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

      {proposal.revision_intent && (proposal.revision_intent.constraints.length > 0 || proposal.revision_intent.protected_elements.length > 0) && (
        <div className="review-card__section">
          <div className="review-card__section-title">Protected intent</div>
          <div className="review-card__section-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
            <div>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginBottom: "var(--space-1)" }}>CONSTRAINTS</div>
              {proposal.revision_intent.constraints.length ? proposal.revision_intent.constraints.map((value) => <div key={value}>• {value}</div>) : <div>None</div>}
            </div>
            <div>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginBottom: "var(--space-1)" }}>MUST NOT CHANGE</div>
              {proposal.revision_intent.protected_elements.length ? proposal.revision_intent.protected_elements.map((value) => <div key={value}>• {value}</div>) : <div>None</div>}
            </div>
          </div>
        </div>
      )}

      {proposal.rebase_report?.status === "conflicted" && (
        <div className="review-card__section">
          <div className="review-card__section-title">Rebase conflicts</div>
          {proposal.rebase_report.conflicts.map((conflict) => (
            <div key={conflict.hunk_id} style={{ color: "var(--warning-text)", marginBottom: "var(--space-1)" }}>
              {conflict.hunk_id}: {conflict.message}
            </div>
          ))}
        </div>
      )}

      {changeSet && (
        <div className="review-card__section">
          <div className="review-card__section-title" style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-2)" }}>
            <span>Change Set · {acceptedCount}/{changeSet.hunks.length} hunks included</span>
            <span className={`badge badge--${changeSet.impact_report.risk === "low" ? "applied" : "warning"}`}>
              {changeSet.impact_report.risk} impact
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {changeSet.impact_report.warnings.map((warning) => (
              <div key={warning} style={{ padding: "var(--space-2) var(--space-3)", border: "1px solid var(--warning-border)", background: "var(--warning-subtle)", color: "var(--warning-text)", borderRadius: "var(--radius-sm)", fontSize: "var(--text-sm)" }}>
                {warning}
              </div>
            ))}
            {changeSet.impact_report.affected_story_memory.map((impact) => (
              <div key={typeof impact === "string" ? impact : impact.id} style={{ marginTop: 6, padding: "8px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--info-border)", background: "var(--info-subtle)", fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                <strong style={{ color: "var(--text-primary)" }}>{typeof impact === "string" ? impact : impact.label}</strong>
                {typeof impact !== "string" && <div style={{ marginTop: 3 }}>{impact.reason}</div>}
              </div>
            ))}
            {changeSet.hunks.map((hunk) => (
              <div key={hunk.id} style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-2)", background: "var(--bg-elevated)" }}>
                  <div>
                    <span className="badge">{hunk.kind}</span>
                    <span style={{ marginLeft: "var(--space-2)", fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{hunk.rationale}</span>
                  </div>
                  <div style={{ display: "flex", gap: "var(--space-1)" }}>
                    <button className="btn btn--ghost btn--sm" disabled={busy === hunk.id} onClick={() => { setEditingHunkId(hunk.id); setEditedHunkText(hunk.after_text); }}>Edit</button>
                    <button className="btn btn--ghost btn--sm" style={{ minHeight: 40 }} disabled={Boolean(busy) || hunkState.busy || Boolean(hunkState.job)} onClick={() => void handleRegenerateHunk(hunk.id)}>Regenerate</button>
                    <button className="btn btn--ghost btn--sm" disabled={busy === hunk.id} onClick={() => { setFeedbackHunkId(hunk.id); setHunkFeedback(""); }}>Comment</button>
                    <button
                      className={`btn btn--sm ${hunk.decision === "accepted" ? "btn--success" : "btn--ghost"}`}
                      disabled={busy === hunk.id}
                      onClick={() => void handleHunkDecision(hunk.id, hunk.decision === "accepted" ? "rejected" : "accepted")}
                      aria-label={`${hunk.decision === "accepted" ? "Exclude" : "Include"} change hunk ${hunk.order}`}
                    >
                      {hunk.decision === "accepted" ? "Included" : "Excluded"}
                    </button>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: "var(--border-subtle)" }}>
                  <div style={{ padding: "var(--space-3)", background: "color-mix(in srgb, var(--danger) 8%, var(--bg-surface))", whiteSpace: "pre-wrap", fontFamily: "var(--font-prose)", fontSize: "var(--text-sm)" }}>
                    <div style={{ color: "var(--danger-text)", fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", marginBottom: "var(--space-1)" }}>BEFORE</div>
                    {hunk.before_text || "∅"}
                  </div>
                  <div style={{ padding: "var(--space-3)", background: "color-mix(in srgb, var(--success) 8%, var(--bg-surface))", whiteSpace: "pre-wrap", fontFamily: "var(--font-prose)", fontSize: "var(--text-sm)" }}>
                    <div style={{ color: "var(--success-text)", fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", marginBottom: "var(--space-1)" }}>AFTER</div>
                    {hunk.after_text || "∅"}
                  </div>
                </div>
                {editingHunkId === hunk.id && (
                  <div style={{ padding: "var(--space-3)", background: "var(--bg-elevated)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                    <textarea className="input" rows={6} value={editedHunkText} onChange={(event) => setEditedHunkText(event.target.value)} aria-label={`Edit replacement for hunk ${hunk.order}`} />
                    <div style={{ display: "flex", gap: "var(--space-2)" }}>
                      <button className="btn btn--primary btn--sm" disabled={busy === hunk.id} onClick={() => void handleSaveHunkEdit(hunk.id)}>Save hunk</button>
                      <button className="btn btn--ghost btn--sm" onClick={() => setEditingHunkId("")}>Cancel</button>
                    </div>
                  </div>
                )}
                {feedbackHunkId === hunk.id && (
                  <div style={{ padding: "var(--space-3)", background: "var(--bg-elevated)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                    <textarea className="input" rows={3} disabled={hunkState.busy || Boolean(hunkState.job)} value={hunkFeedback} onChange={(event) => setHunkFeedback(event.target.value)} placeholder="What should this passage do differently?" aria-label={`Revision comment for hunk ${hunk.order}`} />
                    <div style={{ display: "flex", gap: "var(--space-2)" }}>
                      <button className="btn btn--primary btn--sm" style={{ minHeight: 40 }} disabled={Boolean(busy) || hunkState.busy || Boolean(hunkState.job) || !hunkFeedback.trim()} onClick={() => void handleRegenerateHunk(hunk.id, hunkFeedback)}>Revise hunk</button>
                      <button className="btn btn--ghost btn--sm" onClick={() => setFeedbackHunkId("")}>Cancel</button>
                    </div>
                  </div>
                )}
                {hunkReview?.id === hunk.id && <RevisionContextReview key={JSON.stringify([projectRoot, proposal.id, hunk.id, hunkReview.feedback])}
                  projectRoot={projectRoot} proposalId={proposal.id} hunkId={hunk.id} provider={draftProvider} feedback={hunkReview.feedback}
                  onSend={authorization => handleRegenerateHunk(hunk.id, hunkReview.feedback, authorization)} onClose={() => setHunkReview(null)} />}
              </div>
            ))}
            {changeSet.hunks.length === 0 && (
              <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>No prose changes were generated. Redraft with a clearer intent.</div>
            )}
          </div>
        </div>
      )}

      {proposal.selection && <section className="review-card__section selection-review" aria-label="Selected passage review">
        <h3>{proposal.selection.action === "critique" ? "Critique · feedback only" : selectionUnchanged ? "Selected passage · unchanged" : "Selected passage · review before applying"}</h3>
        <p>Characters {proposal.selection.start + 1}–{proposal.selection.end}. {selectionUnchanged ? "The writer returned this passage unchanged. Your manuscript was not altered." : proposal.selection.action === "critique" ? "Feedback never changes the manuscript." : "Surrounding prose is protected."} {proposal.stale ? "The scene or book version changed; select the passage again for a new request." : proposal.status === "pending" && proposal.selection.action !== "critique" && !selectionUnchanged ? "Accepting replaces only this passage." : ""}</p>
        {proposal.selection.action === "critique" ? proposal.selection.review
          ? <EditorialFindings review={proposal.selection.review} feedback={proposal.selection.feedback} stale={Boolean(proposal.stale)} />
          : <div className="selection-review__comparison"><div><strong>Selected passage</strong><blockquote>{proposal.selection.before}</blockquote></div><div><strong>Feedback · quotations not verified</strong><blockquote>{proposal.selection.feedback}</blockquote></div></div>
          : selectionUnchanged ? <blockquote>{proposal.selection.before}</blockquote>
          : <PassageComparison before={proposal.selection.before} after={proposal.selection.after} />}
        {proposal.generation?.provider === "local" && <p>Local deterministic result. This is a mechanical aid, not a creative AI quality assessment.</p>}
        {!selectionVerified && <p role="status">Checking current scene and book version before any manuscript change.</p>}
        <button className="btn" style={{ minHeight: 40 }} disabled={Boolean(busy)} onClick={() => setSelectionRefresh(value => value + 1)}>Refresh selection status</button>
      </section>}

      {hasDraft && !changeSet && !proposal.selection && (
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

      {proposal.draft_revision && <section className="review-card__section" aria-label="Draft revision source">
        <div className="review-card__section-title">Draft feedback</div>
        <p style={{ whiteSpace: "pre-wrap" }}>{proposal.draft_revision.feedback}</p>
        <details><summary>Previous draft · retained for comparison</summary>
          <div style={{ whiteSpace: "pre-wrap", fontFamily: "var(--font-prose)" }}>{proposal.draft_revision.source.body}</div>
        </details>
      </section>}

      {proposal.draft && hasDraft && !proposal.selection && (
        <div className="review-card__generation-meta" aria-label="Draft generation receipt">
          <strong>{proposal.draft.writing_review?.stages.length ? "Draft and review" : "Draft"}</strong>
          <span>{proposal.draft.provider}/{proposal.draft.model}</span>
          <span>{proposal.draft.input_tokens} in / {proposal.draft.output_tokens} out</span>
          {proposal.draft.latency_ms != null && <span>{(proposal.draft.latency_ms / 1000).toFixed(1)}s</span>}
          {proposal.draft.estimated_cost_usd != null && <span>${proposal.draft.estimated_cost_usd.toFixed(4)}</span>}
        </div>
      )}

      {gen && (
        <div className="review-card__generation-meta" aria-label={proposal.selection ? "Passage generation receipt" : "Edit plan generation receipt"}>
          <strong>{proposal.selection ? "Passage" : "Edit plan"}</strong>
          <span>{gen.provider}/{gen.model}</span>
          <span>{gen.input_tokens} in / {gen.output_tokens} out</span>
          {gen.latency_ms != null && <span>{(gen.latency_ms / 1000).toFixed(1)}s</span>}
          {gen.estimated_cost_usd != null && <span>${gen.estimated_cost_usd.toFixed(4)}</span>}
          <GenerationAssessment tier={gen.quality_tier} />
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

      {(hunkState.job || hunkState.error) && <section aria-label="Hunk regeneration recovery" className="review-card__section" style={{ display: "grid", gap: 12 }}>
        <strong>{hunkState.busy ? "Regenerating passage…" : "Passage revision needs recovery"}</strong>
        {hunkState.job?.tasks[0].hunk?.feedback && <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{hunkState.job.tasks[0].hunk.feedback}</p>}
        {hunkState.error && <p role="alert">{hunkState.error}</p>}
        <p>Saved results are reused. An interrupted request without a saved result may incur another provider charge. Discarding this request keeps existing changes and prose.</p>
        {hunkState.job && <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button className="btn btn--primary" style={{ minHeight: 40 }} disabled={Boolean(busy) || hunkState.busy} onClick={() => void handleRegenerateHunk(hunkState.job!.tasks[0].hunk!.id)}>Retry passage revision</button>
          <button className="btn" style={{ minHeight: 40 }} disabled={hunkState.busy} onClick={hunkSession.clear}>Discard passage request</button>
        </div>}
      </section>}

      {draftState.reviewTask && !draftState.busy && <RevisionContextReview key={`${draftState.job!.id}:${draftState.reviewTask.index}`}
        projectRoot={projectRoot} proposalId={draftState.reviewTask.proposalId} provider={draftState.reviewTask.input.provider}
        model={draftState.reviewTask.input.model} reviewMode={draftState.reviewTask.input.reviewMode}
        reviewReasoningEffort={draftState.reviewTask.input.reviewReasoningEffort} onSend={handleDraft} onClose={draftSession.clear} />}

      {proposal.status === "pending" && (
        <>
        {hasDraft && !proposal.selection && proposal.source !== "merge_resolution" && !draftState.job && !proposal.stale && <section className="review-card__section">
          <label htmlFor={`draft-feedback-${proposal.id}`}>Feedback for this draft</label>
          <textarea id={`draft-feedback-${proposal.id}`} className="input" rows={3} maxLength={6000} value={draftFeedback}
            disabled={Boolean(busy)} onChange={event => setDraftFeedback(event.target.value)} placeholder="What should change in this draft?" />
          <p>Feedback creates a separate Change Set. This draft remains available, and your manuscript changes only when you apply.</p>
        </section>}
        <div className="review-card__actions">
          {draftState.error && <p role="alert">{draftState.error} Saved results are reused; an unsaved provider result may require another paid attempt.</p>}
          {draftState.error && !draftState.busy && draftState.job?.tasks.find(task => !task.drafted)?.authorization && <>
            <button className="btn" style={{ minHeight: 40 }} onClick={draftSession.reviewDraftAgain}>Start new draft review</button>
            <p>A new review retains this edit plan, clears permissions and starts a new request. Earlier provider charges still apply.</p>
          </>}
          {draftState.job && !draftState.busy && <button className="btn" style={{ minHeight: 40 }} onClick={draftSession.clear}>Discard draft request</button>}
          {proposal.stale && changeSet && (
            <button className="btn btn--primary" disabled={busy === "rebase"} onClick={() => void handleRebase()}>
              {busy === "rebase" ? "Rebasing…" : "Rebase safe hunks"}
            </button>
          )}
          {proposal.scene_id && proposal.source !== "merge_resolution" && !proposal.selection && !draftState.reviewTask && (
            <>
            {!draftState.job && <label><input type="checkbox" checked={reviewDraft} disabled={Boolean(busy) || draftState.busy} onChange={event => setReviewDraft(event.target.checked)} /> Review and refine the draft</label>}
            {!draftState.job && reviewDraft && draftProvider === "openai-codex" && <label>
              Review reasoning effort <select className="input" value={reviewEffort} disabled={Boolean(busy) || draftState.busy} onChange={event => setReviewEffort(event.target.value as typeof reviewEffort)}>
                <option value="">Model default</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
              </select>
              {reviewEffort === "high" && <small>High allows up to three minutes for each review step by default. The first draft keeps its model default.</small>}
            </label>}
            <button className="btn btn--primary" style={{ minHeight: 40 }} disabled={Boolean(busy) || draftState.busy} onClick={() => void handleDraft()}>
              {draftState.busy
                ? "Drafting..."
                : draftState.job ? "Retry draft" : hasDraft
                  ? draftFeedback.trim() ? "Review draft revision" : "Regenerate Change Set"
                  : "Build Change Set"}
            </button>
            </>
          )}
          {proposal.source !== "merge_resolution" && hasDraft && !selectionUnchanged && (
            <button
              className="btn btn--success"
              disabled={Boolean(busy) || Boolean(proposal.selection && (!selectionVerified || proposal.stale)) || Boolean(changeSet && (acceptedCount === 0 || proposal.stale))}
              onClick={handleApply}
              title="Write the drafted text into the scene and record before/after revisions"
            >
              {busy === "apply"
                ? "Applying..."
                : confirmForce
                  ? "Scene changed — apply anyway?"
                  : proposal.selection ? "Accept selected replacement" : `Apply ${acceptedCount || "selected"} ${acceptedCount === 1 ? "change" : "changes"}`}
            </button>
          )}
          <button className={selectionUnchanged ? "btn" : "btn btn--danger"} disabled={Boolean(busy)} onClick={handleReject}>
            {selectionUnchanged ? "Dismiss result" : "Reject"}
          </button>
          {proposal.scene_id && (
            <button className="btn btn--ghost" onClick={handleOpenScene}>Open Scene</button>
          )}
        </div>
        </>
      )}

      {proposal.status !== "pending" && proposal.scene_id && (
        <div className="review-card__actions">
          {proposal.status === "applied" && proposal.applied_changes && !proposal.undone_at && (
            <button className="btn btn--primary" disabled={Boolean(busy) || Boolean(proposal.selection && (!selectionVerified || proposal.stale))} onClick={handleUndo}>
              {busy === "undo" ? "Undoing..." : "Undo change"}
            </button>
          )}
          {proposal.undone_at && (
            <span className="badge badge--warning">undone</span>
          )}
          <button className="btn btn--ghost" onClick={handleOpenScene}>Open Scene</button>
        </div>
      )}
    </div>
  );
}
