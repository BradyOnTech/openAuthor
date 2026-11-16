import { useEffect, useState } from "react";
import { compareRevisions, getRevisionRetrospective, restoreRevision } from "../../api";
import { useRefreshBookTabs } from "../../hooks/useRefreshBookTabs";
import { withProjectBookChange } from "../../sceneSaveSession";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import type { RevisionComparison, RevisionRetrospective, RevisionSummary } from "../../types";
import { bookFileLabel, isBookSettingsFile, revisionKindLabel } from "../../revisionLabels";

export function RevisionReview({ revision }: { revision: RevisionSummary }) {
  const { projectRoot, scenes, refreshScenes, refreshCodex, setError, setMessage } = useWorkspace();
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

  type ComparedFile = RevisionComparison["files"][number];
  const sceneTitles = new Map(scenes.map(scene => [scene.path, scene.title]));
  const label = (path: string) => bookFileLabel(path, sceneTitles.get(path));
  const restoreLabel = (path: string) => path.startsWith("manuscript/scenes/") ? "Restore this scene" : path === "manuscript/structure.json" ? "Restore plan" : path.startsWith("codex/") ? "Restore Story Memory" : "Restore this file";
  // What changed leads; the author's work comes before the book's settings files.
  const files = comparison?.files ?? [];
  const settingsFiles = files.filter(file => isBookSettingsFile(file.path));
  const changedFiles = files.filter(file => !isBookSettingsFile(file.path) && file.status !== "unchanged");
  const unchangedFiles = files.filter(file => !isBookSettingsFile(file.path) && file.status === "unchanged");
  const restoreButton = (file: ComparedFile) => (
    <button className="btn btn--ghost btn--sm" disabled={Boolean(busyPath)} onClick={() => void handleRestore(file.path)}>
      {busyPath === file.path ? "Restoring…" : restoreLabel(file.path)}
    </button>
  );
  const fileName = (file: ComparedFile) => (
    <div style={{ minWidth: 0, display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "var(--space-2)" }}>
      <span className="badge">{file.status}</span>
      <strong style={{ color: "var(--text-primary)", fontSize: "var(--text-sm)" }}>{label(file.path)}</strong>
      {label(file.path) !== file.path && <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)", overflowWrap: "anywhere" }}>{file.path}</span>}
    </div>
  );
  const fileRow = (file: ComparedFile) => (
    <div key={file.path} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-1) var(--space-3)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", background: "var(--bg-elevated)" }}>
      {fileName(file)}
      {restoreButton(file)}
    </div>
  );
  const fileSection = (file: ComparedFile) => (
    <section key={file.path} style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)", background: "var(--bg-elevated)" }}>
        {fileName(file)}
        {restoreButton(file)}
      </div>
      <pre style={{ margin: 0, padding: "var(--space-3)", overflowX: "auto", whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", lineHeight: 1.5, color: "var(--text-secondary)" }}>
        {file.diff || "Metadata-only change."}
      </pre>
    </section>
  );

  return (
    <div style={{ padding: "var(--space-6) var(--space-8)", background: "var(--bg-surface)", minHeight: "100%", overflow: "auto" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <h2 style={{ fontSize: "var(--text-xl)", color: "var(--text-primary)" }}>{revision.message}</h2>
            <span className="badge badge--info" title={revision.kind}>{revisionKindLabel(revision.kind)}</span>
          </div>
          <div style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)" }}>
            {new Date(revision.created_at).toLocaleString()} · <span title={revision.id} style={{ fontFamily: "var(--font-mono)" }}>{revision.id.slice(0, 12)}</span>
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
        {changedFiles.map(fileSection)}
        {unchangedFiles.length > 0 && (
          <section aria-label="Unchanged in this version" style={{ display: "grid", gap: "var(--space-1)" }}>
            <h3 style={{ fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-secondary)", margin: "var(--space-2) 0 0" }}>
              {changedFiles.length ? "Unchanged in this version" : "In this version"}
            </h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", margin: 0 }}>Each can still be restored to how it stood at this Revision.</p>
            {unchangedFiles.map(fileRow)}
          </section>
        )}
        {settingsFiles.length > 0 && (
          <details>
            <summary style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", cursor: "pointer", minHeight: 32 }}>Book settings files ({settingsFiles.length})</summary>
            <div style={{ display: "grid", gap: "var(--space-1)", marginTop: "var(--space-2)" }}>{settingsFiles.map(file => file.status === "unchanged" ? fileRow(file) : fileSection(file))}</div>
          </details>
        )}
      </div>
    </div>
  );
}
