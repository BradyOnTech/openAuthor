import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { focusNewSceneTitle, useWorkspaceNavigation } from "../../hooks/useWorkspaceNavigation";

function guideKey(projectId: string): string {
  return `openauthor.firstRunGuide.v1:${projectId}`;
}

export function FirstRunGuide() {
  const { activeProjectId, scenes, proposals } = useWorkspace();
  const navigateTo = useWorkspaceNavigation();
  const [hidden, setHidden] = useState(() => {
    if (typeof window === "undefined" || !activeProjectId) return false;
    return window.localStorage.getItem(guideKey(activeProjectId)) === "done";
  });

  const progress = useMemo(() => {
    const hasManuscript = scenes.length > 0;
    const hasProposal = proposals.length > 0;
    const completedLoop = proposals.some(
      (proposal) => proposal.status === "applied" && proposal.applied_changes
    );
    return { hasManuscript, hasProposal, completedLoop };
  }, [proposals, scenes.length]);

  useEffect(() => {
    if (!activeProjectId) return;
    setHidden(window.localStorage.getItem(guideKey(activeProjectId)) === "done");
  }, [activeProjectId]);

  if (hidden || !activeProjectId) return null;

  function finish() {
    window.localStorage.setItem(guideKey(activeProjectId), "done");
    setHidden(true);
  }

  function openManuscript() {
    void navigateTo("manuscript").then(focusNewSceneTitle);
  }

  function openProposalFlow() {
    void navigateTo("proposals");
  }

  const completed = Object.values(progress).filter(Boolean).length;
  const nextStep = !progress.hasManuscript
    ? { title: "Create your first scene", detail: "Give the opening a title, then write a few real paragraphs.", action: "Start a scene", run: openManuscript }
    : !progress.hasProposal
      ? { title: "Try a safe revision", detail: "Open Changes and ask for one small, reviewable improvement.", action: "Open Changes", run: openProposalFlow }
      : !progress.completedLoop
        ? { title: "Review before you apply", detail: "Inspect each hunk, apply only what helps, and try Undo once.", action: "Review Changes", run: openProposalFlow }
        : null;

  return (
    <aside aria-label="Getting started" style={{ position: "fixed", right: "var(--space-4)", bottom: "calc(var(--statusbar-height) + var(--space-4))", zIndex: 500, width: 300, border: "1px solid var(--border-strong)", borderRadius: "var(--radius-lg)", background: "var(--bg-elevated)", boxShadow: "var(--shadow-lg)", padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-2)" }}>
        <div>
          <div style={{ fontWeight: 650, color: "var(--text-primary)" }}>Getting started</div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>{completed}/3 complete</div>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={finish} aria-label="Hide first-run guide">×</button>
      </div>

      {nextStep ? (
        <GuideStep complete={false} title={nextStep.title} detail={nextStep.detail} actionLabel={nextStep.action} onAction={nextStep.run} />
      ) : (
        <><div style={{ fontSize: "var(--text-sm)", color: "var(--success)" }}>You completed the safe revision loop.</div><button className="btn btn--primary btn--sm" onClick={finish}>Finish</button></>
      )}
    </aside>
  );
}

function GuideStep({
  complete,
  title,
  detail,
  actionLabel,
  onAction,
}: {
  complete: boolean;
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "20px 1fr", gap: "var(--space-2)" }}>
      <span style={{ color: complete ? "var(--success)" : "var(--text-ghost)" }}>{complete ? "✓" : "○"}</span>
      <div>
        <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-primary)" }}>{title}</div>
        <div style={{ fontSize: "var(--text-xs)", lineHeight: "var(--leading-relaxed)", color: "var(--text-secondary)", marginTop: 2 }}>{detail}</div>
        {actionLabel && onAction && (
          <button className="btn btn--ghost btn--sm" style={{ marginTop: "var(--space-1)" }} onClick={onAction}>{actionLabel}</button>
        )}
      </div>
    </div>
  );
}
