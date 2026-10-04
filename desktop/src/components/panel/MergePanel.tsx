import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import {
  createBranch,
  mergeBranches,
  preflightMerge,
  scanMergeConflicts,
  switchBranch,
} from "../../api";
import { mergeResolutionSession } from "../../mergeResolutionSession";
import { RevisionContextReview } from "../editor/RevisionContextReview";
import { withProjectBookChange } from "../../sceneSaveSession";
import { useRefreshBookTabs } from "../../hooks/useRefreshBookTabs";
import type {
  BranchMergeResult,
  BranchPreflightReport,
  MergeConflictScan,
  ProposalRecord,
} from "../../types";
import { defaultProvider } from "../../providerSelection";

const sectionStyle: React.CSSProperties = {
  padding: "var(--space-4)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
};

export function MergePanel() {
  const {
    projectRoot,
    branches,
    proposals,
    refreshBranches,
    refreshScenes,
    refreshProposals,
    refreshCodex,
    runtimeConfig,
    setError,
    setMessage,
  } = useWorkspace();
  const refreshBookTabs = useRefreshBookTabs(projectRoot);

  const currentBranch = branches.find((b) => b.current)?.name ?? "";
  const [newBranchName, setNewBranchName] = useState("");
  const [base, setBase] = useState("");
  const [head, setHead] = useState("");
  const [preflight, setPreflight] = useState<BranchPreflightReport | null>(null);
  const [scan, setScan] = useState<MergeConflictScan | null>(null);
  const [mergeResult, setMergeResult] = useState<BranchMergeResult | null>(null);
  const [busyAction, setBusyAction] = useState("");
  const session = useMemo(() => mergeResolutionSession(projectRoot), [projectRoot]);
  const recovery = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const view = useRef({ projectRoot, mounted: true });
  view.current.projectRoot = projectRoot;
  useEffect(() => {
    view.current.mounted = true;
    return () => { view.current.mounted = false; };
  }, []);

  const effectiveBase = base || currentBranch;
  const effectiveHead = head;
  const selection = useRef("");
  const selectionKey = JSON.stringify([projectRoot, effectiveBase, effectiveHead]);
  selection.current = selectionKey;
  useEffect(() => {
    setPreflight(null);
    setScan(null);
    setMergeResult(null);
  }, [selectionKey]);

  const pendingResolutions = useMemo(
    () =>
      proposals.filter(
        (p) =>
          p.status === "pending" &&
          !p.stale &&
          p.source === "merge_resolution" &&
          p.merge?.base === effectiveBase &&
          p.merge?.head === effectiveHead
      ),
    [proposals, effectiveBase, effectiveHead]
  );

  const resolvedPaths = useMemo(
    () => new Set(pendingResolutions.map((p) => p.merge?.path ?? "")),
    [pendingResolutions]
  );

  function reportError(prefix: string, e: unknown) {
    setError(`${prefix}: ${e instanceof Error ? e.message : String(e)}`);
  }

  async function handleCreateBranch() {
    const name = newBranchName.trim();
    if (!name) return;
    setBusyAction("create");
    try {
      await withProjectBookChange(projectRoot, async () => {
        await createBranch(projectRoot, { name });
        await Promise.all([refreshBranches(), refreshScenes(), refreshCodex(), refreshBookTabs()]);
      });
      setNewBranchName("");
      setMessage(`Created storyline "${name}" and switched to it.`);
    } catch (e) {
      reportError("Failed to create storyline", e);
    } finally {
      setBusyAction("");
    }
  }

  async function handleSwitch(name: string) {
    setBusyAction(`switch:${name}`);
    try {
      await withProjectBookChange(projectRoot, async () => {
        await switchBranch(projectRoot, name);
        await Promise.all([refreshBranches(), refreshScenes(), refreshCodex(), refreshProposals(), refreshBookTabs()]);
      });
      setMessage(`Switched to storyline "${name}".`);
    } catch (e) {
      reportError("Failed to switch storyline", e);
    } finally {
      setBusyAction("");
    }
  }

  async function handleCheck() {
    if (!effectiveBase || !effectiveHead) return;
    setBusyAction("check");
    setMergeResult(null);
    try {
      const [pf, cs] = await Promise.all([
        preflightMerge(projectRoot, { base: effectiveBase, head: effectiveHead }),
        scanMergeConflicts(projectRoot, { base: effectiveBase, head: effectiveHead }),
        refreshProposals(),
      ]);
      if (!view.current.mounted || selection.current !== selectionKey) return;
      setPreflight(pf);
      setScan(cs);
    } catch (e) {
      reportError("Compatibility check failed", e);
    } finally {
      setBusyAction("");
    }
  }

  async function showResolution(proposal: ProposalRecord | null) {
    if (!proposal || !view.current.mounted || view.current.projectRoot !== projectRoot) return;
    try {
      await refreshProposals();
      if (!view.current.mounted || view.current.projectRoot !== projectRoot) return;
      session.clear();
      if (proposal.stale) {
        setError("The saved reconciliation is now outdated. Check compatibility and generate a new one before merging.");
      } else {
        setMessage(`Drafted a reconciled version of ${proposal.merge?.path} as Change Set ${proposal.id}. Review it in Changes.`);
      }
    } catch (e) {
      reportError("The reconciliation is saved but could not be refreshed; Retry can recover it", e);
    }
  }

  async function handleResolve(path: string) {
    await showResolution(await session.start({ base: effectiveBase, head: effectiveHead, path, provider: "local" }));
  }

  async function handleMerge() {
    if (!effectiveBase || !effectiveHead) return;
    setBusyAction("merge");
    try {
      const result = await withProjectBookChange(projectRoot, async () => {
        const merged = await mergeBranches(projectRoot, {
          base: effectiveBase,
          head: effectiveHead,
          resolutionIds: pendingResolutions.map((p) => p.id),
        });
        await Promise.all([refreshBranches(), refreshScenes(), refreshCodex(), refreshProposals(), refreshBookTabs()]);
        return merged;
      });
      setMergeResult(result);
      setMessage(`Merged "${effectiveHead}" into "${effectiveBase}".`);
      setPreflight(null);
      setScan(null);
    } catch (e) {
      reportError("Merge failed", e);
    } finally {
      setBusyAction("");
    }
  }

  const unresolvedConflicts = (scan?.conflicts ?? []).filter(
    (c) => !resolvedPaths.has(c.path)
  );

  return (
    <div style={{ overflow: "auto", height: "100%" }}>
      <div style={sectionStyle}>
        <div style={{ fontWeight: 600 }}>Storylines</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
          {branches.map((b) => (
            <button
              type="button"
              key={b.name}
              className={`badge${b.current ? " badge--applied" : ""}`}
              style={{ cursor: b.current ? "default" : "pointer", minHeight: 40, font: "inherit" }}
              disabled={b.current || Boolean(busyAction)}
              aria-label={b.current ? `${b.name} (current)` : `Switch to ${b.name}`}
              title={b.current ? "Current storyline" : `Switch to ${b.name}`}
              onClick={() => !b.current && handleSwitch(b.name)}
            >
              {b.current ? `${b.name} (current)` : b.name}
            </button>
          ))}
          {branches.length === 0 && (
            <span style={{ color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
              No storylines yet. Create a snapshot first, then branch a storyline.
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <input
            className="input"
            aria-label="New storyline name"
            placeholder="New storyline name (e.g. what-if-betrayal)"
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateBranch()}
          />
          <button
            className="btn btn--primary"
            disabled={!newBranchName.trim() || busyAction === "create"}
            onClick={handleCreateBranch}
          >
            Branch storyline
          </button>
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={{ fontWeight: 600 }}>Merge a storyline back</div>
        {(recovery.pending || recovery.error) && <section aria-label="Reconciliation recovery" style={{ display: "grid", gap: 12, padding: 16, background: "var(--bg-elevated)", borderRadius: "var(--radius-md)" }}>
          <strong>{recovery.busy ? "Reconciling…" : "Reconciliation request retained"}</strong>
          {recovery.pending && <p style={{ overflowWrap: "anywhere" }}>{recovery.pending.head} into {recovery.pending.base}: {recovery.pending.path}</p>}
          {recovery.error && <p role="alert" style={{ overflowWrap: "anywhere" }}>{recovery.error}</p>}
          <p>Retry reuses saved results. An unsaved provider response may incur another charge. Discard keeps existing proposals and does not merge anything.</p>
          {recovery.pending && <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {recovery.pending.authorization && <button className="btn btn--primary" style={{ minHeight: 40 }} disabled={recovery.busy} onClick={() => void session.retry().then(showResolution)}>Retry reconciliation</button>}
            {recovery.pending.authorization && recovery.error && <button className="btn" style={{ minHeight: 40 }} disabled={recovery.busy} onClick={session.reviewAgain}>Start new context review</button>}
            <button className="btn" style={{ minHeight: 40 }} disabled={recovery.busy} onClick={session.clear}>Discard reconciliation request</button>
          </div>}
        </section>}
        {recovery.pending && !recovery.pending.authorization && !recovery.busy && <RevisionContextReview
          key={recovery.pending.requestId} projectRoot={projectRoot} mergeInput={recovery.pending}
          provider={recovery.pending.provider} model={recovery.pending.model}
          onSend={async authorization => { await showResolution(await session.approve(authorization)); }}
          onClose={session.clear} closeLabel="Cancel reconciliation" />}
        <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
          <select
            className="input"
            aria-label="Storyline to merge"
            value={effectiveHead}
            onChange={(e) => setHead(e.target.value)}
          >
            <option value="">Choose storyline to merge...</option>
            {branches
              .filter((b) => b.name !== effectiveBase)
              .map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
          </select>
          <span style={{ color: "var(--text-tertiary)" }}>into</span>
          <select className="input" aria-label="Destination storyline" value={effectiveBase} onChange={(e) => setBase(e.target.value)}>
            {branches.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
          <button
            className="btn btn--ghost"
            disabled={!effectiveHead || busyAction === "check"}
            onClick={handleCheck}
          >
            {busyAction === "check" ? "Checking..." : "Check compatibility"}
          </button>
        </div>

        {preflight && scan && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
              <span
                className={`badge badge--${
                  scan.conflict_count === 0 ? "applied" : preflight.risk_level === "high" ? "error" : "warning"
                }`}
              >
                {scan.conflict_count === 0
                  ? "No conflicts — safe to merge"
                  : `${scan.conflict_count} scene conflict${scan.conflict_count === 1 ? "" : "s"}`}
              </span>
              {scan.auto_mergeable.length > 0 && (
                <span style={{ color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
                  {scan.auto_mergeable.length} overlapping file
                  {scan.auto_mergeable.length === 1 ? "" : "s"} will merge automatically
                </span>
              )}
            </div>

            {unresolvedConflicts.map((c) => (
              <div
                key={c.path}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                  fontSize: "var(--text-sm)",
                }}
              >
                <span className="badge badge--error">conflict</span>
                <span className="mono" style={{ flex: 1 }}>{c.path}</span>
                {c.category === "scene" && c.kind === "content" ? (
                  <button
                    className="btn btn--ghost"
                    disabled={recovery.busy || Boolean(recovery.pending)}
                    onClick={() => handleResolve(c.path)}
                  >
                    {recovery.busy && recovery.pending?.path === c.path ? "Reconciling..." : "Reconcile with AI"}
                  </button>
                ) : (
                  <span style={{ color: "var(--text-tertiary)" }}>
                    {c.kind === "delete_modify"
                      ? "Deleted on one storyline — resolve manually"
                      : "Resolve manually"}
                  </span>
                )}
              </div>
            ))}

            {pendingResolutions.map((p: ProposalRecord) => (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                  fontSize: "var(--text-sm)",
                }}
              >
                <span className="badge badge--applied">reconciled</span>
                <span className="mono" style={{ flex: 1 }}>{p.merge?.path}</span>
                <span style={{ color: "var(--text-tertiary)" }}>
                  proposal {p.id.slice(0, 16)} will be used
                </span>
              </div>
            ))}

            <div>
              <button
                className="btn btn--success"
                disabled={busyAction === "merge" || unresolvedConflicts.length > 0}
                onClick={handleMerge}
                title={
                  unresolvedConflicts.length > 0
                    ? "Reconcile all conflicts before merging"
                    : "Merge the storyline"
                }
              >
                {busyAction === "merge"
                  ? "Merging..."
                  : pendingResolutions.length > 0
                    ? `Merge with ${pendingResolutions.length} reconciliation${pendingResolutions.length === 1 ? "" : "s"}`
                    : "Merge storyline"}
              </button>
            </div>
          </div>
        )}

        {mergeResult && (
          <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
            Merged {mergeResult.head} into {mergeResult.base}
            {mergeResult.resolved_paths && mergeResult.resolved_paths.length > 0 && (
              <> — reconciled {mergeResult.resolved_paths.length} scene
                {mergeResult.resolved_paths.length === 1 ? "" : "s"}</>
            )}
            . You are now on {mergeResult.current_branch}.
          </div>
        )}
      </div>
    </div>
  );
}
