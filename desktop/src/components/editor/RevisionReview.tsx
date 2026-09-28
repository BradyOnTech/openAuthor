import { useEffect, useState } from "react";
import { compareRevisions, getRevisionRetrospective, restoreRevision } from "../../api";
import { useRefreshBookTabs } from "../../hooks/useRefreshBookTabs";
import { withProjectBookChange } from "../../sceneSaveSession";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import type { RevisionComparison, RevisionRetrospective, RevisionSummary } from "../../types";

export function RevisionReview({ revision }: { revision: RevisionSummary }) {
  const { projectRoot, refreshScenes, refreshCodex, setError, setMessage } = useWorkspace();
  const refreshBookTabs = useRefreshBookTabs(projectRoot);
  const [comparison, setComparison] = useState<RevisionComparison | null>(null);
  const [retrospective, setRetrospective] = useState<RevisionRetrospective | null>(null);
  const [busyPath, setBusyPath] = useState("");

  useEffect(() => {
    let active = true;
    setComparison(null);
    setRetrospective(null);
    void Promise.all([
      compareRevisions(projectRoot, revision.parent || revision.id, revision.id),
      getRevisionRetrospective(projectRoot, revision.parent || revision.id, revision.id),
    ])
      .then(([result, retro]) => { if (active) { setComparison(result); setRetrospective(retro); } })
      .catch((error) => { if (active) setError(`Revision comparison failed: ${error instanceof Error ? error.message : String(error)}`); });
    return () => { active = false; };
  }, [projectRoot, revision.id, revision.parent, setError]);

  async function handleRestore(path: string) {
    setBusyPath(path);
    try {
      await withProjectBookChange(projectRoot, async () => {
        const deleted = comparison?.files.find(file => file.path === path)?.status === "deleted";
        await restoreRevision(projectRoot, deleted ? revision.parent : revision.id, [path]);
        await Promise.all([refreshScenes(), refreshCodex(), refreshBookTabs()]);
      });
      setMessage(`Restored ${path} as a new Revision. Your newer history was preserved.`);
    } catch (error) {
      setError(`Restore failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyPath("");
    }
  }

  return (
    <div style={{ padding: "var(--space-6) var(--space-8)", background: "var(--bg-surface)", minHeight: "100%", overflow: "auto" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <h2 style={{ fontSize: "var(--text-xl)", color: "var(--text-primary)" }}>{revision.message}</h2>
            <span className="badge badge--info">{revision.kind}</span>
          </div>
          <div style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
            {revision.id} · {new Date(revision.created_at).toLocaleString()}
          </div>
        </div>

        {!revision.parent && <div style={{ color: "var(--text-secondary)" }}>This is the first recorded state.</div>}
        {retrospective && <section style={{ padding: "var(--space-4)", border: "1px solid var(--info-border)", background: "var(--info-subtle)", borderRadius: "var(--radius-md)" }}>
          <div style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: ".08em" }}>Revision retrospective</div>
          <h3 style={{ color: "var(--text-primary)", margin: "6px 0" }}>{retrospective.summary}</h3>
          {retrospective.intent && <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>Goal: {retrospective.intent}</p>}
          {retrospective.changed_scenes.map((scene) => <div key={scene.path} style={{ display: "flex", justifyContent: "space-between", color: "var(--text-secondary)", fontSize: "var(--text-xs)", padding: "4px 0" }}><span>{scene.title}</span><span>{scene.word_count_delta >= 0 ? "+" : ""}{scene.word_count_delta} words</span></div>)}
          {retrospective.remaining_goals.length > 0 && <div style={{ marginTop: 8 }}><strong style={{ color: "var(--text-primary)", fontSize: "var(--text-xs)" }}>Still open</strong>{retrospective.remaining_goals.slice(0, 5).map((goal, index) => <div key={`${goal.kind}-${index}`} style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)", marginTop: 4 }}>• {goal.label}</div>)}</div>}
        </section>}
        {revision.parent && !comparison && <div style={{ color: "var(--text-secondary)" }}>Comparing to the previous Revision…</div>}
        {comparison?.files.map((file) => (
          <section key={file.path} style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)", background: "var(--bg-elevated)" }}>
              <div>
                <span className="badge">{file.status}</span>
                <span style={{ marginLeft: "var(--space-2)", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>{file.path}</span>
              </div>
              <button className="btn btn--ghost btn--sm" disabled={Boolean(busyPath)} onClick={() => void handleRestore(file.path)}>
                {busyPath === file.path ? "Restoring…" : file.path.startsWith("manuscript/scenes/") ? "Restore this scene" : file.path === "manuscript/structure.json" ? "Restore plan" : file.path.startsWith("codex/") ? "Restore Story Memory" : "Restore this file"}
              </button>
            </div>
            <pre style={{ margin: 0, padding: "var(--space-3)", overflowX: "auto", whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", lineHeight: 1.5, color: "var(--text-secondary)" }}>
              {file.diff || (file.status === "unchanged" ? "Unchanged in this version; available to restore." : "Metadata-only change.")}
            </pre>
          </section>
        ))}
      </div>
    </div>
  );
}
