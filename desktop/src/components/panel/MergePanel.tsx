import { useMemo, useState } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import {
  createBranch,
  mergeBranches,
  preflightMerge,
  resolveMergeConflict,
  scanMergeConflicts,
  switchBranch,
} from "../../api";
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

  const currentBranch = branches.find((b) => b.current)?.name ?? "";
  const [newBranchName, setNewBranchName] = useState("");
  const [base, setBase] = useState("");
  const [head, setHead] = useState("");
  const [preflight, setPreflight] = useState<BranchPreflightReport | null>(null);
  const [scan, setScan] = useState<MergeConflictScan | null>(null);
  const [mergeResult, setMergeResult] = useState<BranchMergeResult | null>(null);
  const [busyAction, setBusyAction] = useState("");
  const [resolving, setResolving] = useState<string>("");

  const effectiveBase = base || currentBranch;
  const effectiveHead = head;

  const pendingResolutions = useMemo(
    () =>
      proposals.filter(
        (p) =>
          p.status === "pending" &&
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
      await createBranch(projectRoot, { name });
      setNewBranchName("");
      setMessage(`Created storyline "${name}" and switched to it.`);
      await Promise.all([refreshBranches(), refreshScenes(), refreshCodex()]);
    } catch (e) {
      reportError("Failed to create storyline", e);
    } finally {
      setBusyAction("");
    }
  }

  async function handleSwitch(name: string) {
    setBusyAction(`switch:${name}`);
    try {
      await switchBranch(projectRoot, name);
      setMessage(`Switched to storyline "${name}".`);
      await Promise.all([refreshBranches(), refreshScenes(), refreshCodex(), refreshProposals()]);
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
      ]);
      setPreflight(pf);
      setScan(cs);
    } catch (e) {
      reportError("Compatibility check failed", e);
    } finally {
      setBusyAction("");
    }
  }

  async function handleResolve(path: string) {
    setResolving(path);
    try {
      const proposal = await resolveMergeConflict(projectRoot, {
        base: effectiveBase,
        head: effectiveHead,
        path,
        provider: defaultProvider(runtimeConfig).id,
      });
      setMessage(
        `Drafted a reconciled version of ${path} as Change Set ${proposal.id}. Review it in Changes.`
      );
      await refreshProposals();
    } catch (e) {
      reportError("Reconciliation failed", e);
    } finally {
      setResolving("");
    }
  }

  async function handleMerge() {
    if (!effectiveBase || !effectiveHead) return;
    setBusyAction("merge");
    try {
      const result = await mergeBranches(projectRoot, {
        base: effectiveBase,
        head: effectiveHead,
        resolutionIds: pendingResolutions.map((p) => p.id),
      });
      setMergeResult(result);
      setMessage(`Merged "${effectiveHead}" into "${effectiveBase}".`);
      setPreflight(null);
      setScan(null);
      await Promise.all([
        refreshBranches(),
        refreshScenes(),
        refreshCodex(),
        refreshProposals(),
      ]);
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
            <span
              key={b.name}
              className={`badge${b.current ? " badge--applied" : ""}`}
              style={{ cursor: b.current ? "default" : "pointer" }}
              title={b.current ? "Current storyline" : `Switch to ${b.name}`}
              onClick={() => !b.current && handleSwitch(b.name)}
            >
              {b.current ? `${b.name} (current)` : b.name}
            </span>
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
        <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
          <select
            className="input"
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
          <select className="input" value={effectiveBase} onChange={(e) => setBase(e.target.value)}>
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
                    disabled={resolving === c.path}
                    onClick={() => handleResolve(c.path)}
                  >
                    {resolving === c.path ? "Reconciling..." : "Reconcile with AI"}
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
