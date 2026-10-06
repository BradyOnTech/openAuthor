import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useEditor } from "../../contexts/EditorContext";
import { countProposals, orderProposalsForReview } from "../../state";
import { applyProposalBatch, listRevisions, undoProposalBatch, saveRevision, getScene } from "../../api";
import { withProjectBookChange } from "../../sceneSaveSession";
import type { RevisionSummary } from "../../types";

export function ProposalQueue() {
  const { projectRoot, proposals, scenes, refreshProposals, refreshScenes, setError, setMessage } = useWorkspace();
  const { openTab, updateTab, tabs } = useEditor();
  const [revisions, setRevisions] = useState<RevisionSummary[]>([]);
  const [applyingGroup, setApplyingGroup] = useState("");
  const [versionName, setVersionName] = useState("");
  const [savingVersion, setSavingVersion] = useState(false);

  async function handleSaveVersion() {
    setSavingVersion(true);
    try {
      await withProjectBookChange(projectRoot, () => saveRevision(projectRoot, versionName.trim()));
      setRevisions(await listRevisions(projectRoot, 20));
      setVersionName("");
      setMessage("Version saved with your manuscript, Plan, and Story Memory.");
    } catch (error) {
      setError(`Version could not be saved: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSavingVersion(false);
    }
  }

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
  const appliedGroups = useMemo(() => {
    const groups = new Map<string, typeof proposals>();
    for (const proposal of proposals) {
      if (!proposal.coordinated_undo_available || !proposal.applied_revision || proposal.status !== "applied") continue;
      groups.set(proposal.applied_revision, [...(groups.get(proposal.applied_revision) ?? []), proposal]);
    }
    return [...groups.entries()].filter(([, rows]) => rows.length > 1 && rows.some((row) => !row.undone_at));
  }, [proposals]);

  async function undoGroup(revision: string, sceneIds: string[]) {
    if (applyingGroup || tabs.some((tab) => tab.kind === "scene" && sceneIds.includes(tab.id.replace(/^scene:/, "")) && tab.modified)) return;
    setApplyingGroup(revision);
    try {
      const result = await withProjectBookChange(projectRoot, () => undoProposalBatch(projectRoot, revision));
      for (const proposal of result.proposals) updateTab(`proposal:${proposal.id}`, { data: proposal });
      for (const scene of result.scenes) updateTab(`scene:${scene.id}`, { data: scene, label: scene.title });
      setError("");
      setMessage(`${result.scene_ids.length} scenes restored together in one Undo Revision.${result.warnings.length ? ` ${result.warnings.join(" ")}` : ""}`);
      await Promise.all([refreshProposals(), refreshScenes()]);
    } catch (error) {
      setError(`Coordinated undo failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setApplyingGroup("");
    }
  }

  async function applyGroup(groupId: string, ids: string[]) {
    if (applyingGroup) return;
    setApplyingGroup(groupId);
    try {
      const result = await withProjectBookChange(projectRoot, async () => {
        const applied = await applyProposalBatch(projectRoot, ids);
        for (const id of applied.scene_ids) {
          const scene = await getScene(projectRoot, id);
          updateTab(`scene:${id}`, { data: scene, label: scene.title, modified: false });
        }
        return applied;
      });
      for (const proposal of result.proposals) updateTab(`proposal:${proposal.id}`, { data: proposal });
      await Promise.all([refreshProposals(), refreshScenes()]);
      setMessage(`${result.scene_ids.length} scenes applied together in one reversible Revision.`);
    } catch (error) {
      setError(`Coordinated apply failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setApplyingGroup("");
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
        <form style={{ padding: "var(--space-3)", display: "grid", gap: "var(--space-2)" }} onSubmit={event => { event.preventDefault(); void handleSaveVersion(); }}>
          <input className="input" aria-label="Version name" placeholder="Name this version…" value={versionName} onChange={event => setVersionName(event.target.value)} />
          <button className="btn btn--ghost btn--sm" disabled={savingVersion || !versionName.trim()}>{savingVersion ? "Saving version…" : "Save version"}</button>
        </form>
        {coordinatedGroups.map(([groupId, rows]) => (
          <div key={groupId} style={{ margin: "var(--space-2)", padding: "var(--space-3)", border: "1px solid var(--info)", borderRadius: "var(--radius-md)", background: "var(--info-subtle)" }}>
            <div style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: "var(--text-sm)" }}>Coordinated change · {rows.length} scenes</div>
            <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)", margin: "4px 0 8px" }}>Review each scene’s hunks, then apply the set as one reversible Revision.</div>
            <button className="btn btn--primary btn--sm" disabled={Boolean(applyingGroup) || rows.some((row) => !row.change_set || row.stale)} onClick={() => void applyGroup(groupId, rows.map((row) => row.id))}>{applyingGroup === groupId ? "Applying…" : "Apply together"}</button>
          </div>
        ))}
        {appliedGroups.map(([revision, rows]) => {
          const partiallyUndone = rows.some((row) => row.undone_at);
          const dirty = tabs.some((tab) => tab.kind === "scene" && tab.modified && rows.some((row) => tab.id === `scene:${row.scene_id}`));
          return (
            <section key={revision} aria-label={`Coordinated Revision ${revision.slice(0, 12)}`} style={{ margin: "var(--space-2)", padding: "var(--space-3)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)" }}>
              <div style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: "var(--text-sm)" }}>Applied together · {rows.length} scenes</div>
              <ul style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)", paddingLeft: "var(--space-4)", margin: "8px 0" }}>
                {rows.map((row) => <li key={row.id}>{scenes.find((scene) => scene.id === row.scene_id)?.title || row.scene_id}</li>)}
              </ul>
              <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)", margin: "8px 0" }}>
                {partiallyUndone ? "Part of this Revision was already undone. Review the remaining scenes individually."
                  : dirty ? "Save or resolve open scene drafts before undoing this Revision."
                    : "Restore these scenes to before this Revision. If any scene has newer saved changes, nothing will be restored."}
              </p>
              <button className="btn btn--secondary btn--sm" disabled={Boolean(applyingGroup) || partiallyUndone || dirty} onClick={() => void undoGroup(revision, rows.map((row) => row.scene_id))}>
                {applyingGroup === revision ? "Restoring…" : `Undo ${rows.length} scenes together`}
              </button>
            </section>
          );
        })}
        {ordered.map((p) => {
          const unchanged = p.selection && p.selection.action !== "critique"
            && (p.selection.unchanged || p.selection.before === p.selection.after);
          const displayStatus = p.undone_at ? "undone" : unchanged && p.status === "rejected" ? "dismissed" : p.status;
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
