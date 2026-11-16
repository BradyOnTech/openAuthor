import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { focusNewSceneTitle, useWorkspaceNavigation } from "../../hooks/useWorkspaceNavigation";
import { onlyOfflineDemo } from "../../providerSelection";

function guideKey(projectId: string): string {
  return `openauthor.firstRunGuide.v1:${projectId}`;
}

export function FirstRunGuide() {
  const { activeProjectId, scenes, proposals, runtimeConfig } = useWorkspace();
  // Revisions made without a provider come from the offline demo, which only
  // makes small rule-based edits; say so before the author judges the result.
  const offlineOnly = onlyOfflineDemo(runtimeConfig);
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
      ? { title: "Try a safe revision", detail: offlineOnly
          ? "Open Changes and ask for one small, reviewable improvement. Connect ChatGPT first for real revisions; without it you get the offline demo."
          : "Open Changes and ask for one small, reviewable improvement.", action: "Open Changes", run: openProposalFlow, connect: offlineOnly }
      : !progress.completedLoop
        ? { title: "Review before you apply", detail: "Read each before-and-after, apply only what helps, and try Undo once.", action: "Review Changes", run: openProposalFlow }
        : null;

  return (
    <aside aria-label="Getting started" className="first-run-guide">
      <span className="first-run-guide__progress" aria-label={`Getting started: ${completed} of 3 complete`}>
        <strong>Getting started</strong>
        <span aria-hidden="true">{completed}/3</span>
      </span>
      {nextStep ? (
        <GuideStep title={nextStep.title} detail={nextStep.detail} actionLabel={nextStep.action} onAction={nextStep.run}
          secondaryLabel={"connect" in nextStep && nextStep.connect ? "Connect ChatGPT" : undefined} onSecondary={() => void navigateTo("settings")} />
      ) : (
        <><span className="first-run-guide__step" style={{ color: "var(--success-text)" }}>You completed the safe revision loop.</span><button className="btn btn--primary btn--sm" onClick={finish}>Finish</button></>
      )}
      <button className="btn btn--ghost btn--sm first-run-guide__close" onClick={finish} aria-label="Hide first-run guide">×</button>
    </aside>
  );
}

function GuideStep({
  title,
  detail,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
}: {
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  return (
    <>
      <span className="first-run-guide__step">
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
      {actionLabel && onAction && <button className="btn btn--sm" onClick={onAction}>{actionLabel}</button>}
      {secondaryLabel && onSecondary && <button className="btn btn--ghost btn--sm" onClick={onSecondary}>{secondaryLabel}</button>}
    </>
  );
}
