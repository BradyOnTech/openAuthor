import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useEditor } from "../../contexts/EditorContext";
import { getCodexEntity, getScene, searchProject, type ProjectSearchResult } from "../../api";

export function ProjectSearch() {
  const { projectRoot, setError } = useWorkspace();
  const { openTab } = useEditor();
  const [query, setQuery] = useState("");
  const [searchScenes, setSearchScenes] = useState(true);
  const [searchMemory, setSearchMemory] = useState(true);
  const [results, setResults] = useState<ProjectSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const cleaned = query.trim();
    if (cleaned.length < 2) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setLoading(true);
      void searchProject(projectRoot, cleaned)
        .then(setResults)
        .catch((error) => setError(`Search failed: ${error instanceof Error ? error.message : String(error)}`))
        .finally(() => setLoading(false));
    }, 160);
    return () => window.clearTimeout(timer);
  }, [projectRoot, query, setError]);

  const visibleResults = useMemo(() => results.filter((row) => (
    (row.source_kind !== "scene" || searchScenes) &&
    (row.source_kind !== "memory" || searchMemory)
  )), [results, searchScenes, searchMemory]);

  async function handleResultClick(item: ProjectSearchResult) {
    if (item.source_kind === "scene") {
      try {
        const detail = await getScene(projectRoot, item.source_id);
        openTab({ id: `scene:${item.source_id}`, kind: "scene", label: item.title, data: detail });
      } catch (e) {
        setError(`Failed to open scene: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (item.source_kind === "memory") {
      try {
        const entity = await getCodexEntity(projectRoot, item.source_id);
        openTab({ id: `codex:${item.source_id}`, kind: "codex", label: item.title, data: entity });
      } catch (e) {
        setError(`Failed to open entity: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      openTab({ id: "plan", kind: "plan", label: "Plan" });
    }
  }

  return (
    <>
      <div className="sidebar__header">
        <span className="sidebar__title">Search</span>
      </div>
      <div className="sidebar__filter">
        <input
          className="input"
          placeholder="Search manuscript..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-2)", fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", cursor: "pointer" }}>
            <input type="checkbox" checked={searchScenes} onChange={(e) => setSearchScenes(e.target.checked)} />
            Scenes
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", cursor: "pointer" }}>
            <input type="checkbox" checked={searchMemory} onChange={(e) => setSearchMemory(e.target.checked)} />
            Story Memory
          </label>
        </div>
      </div>
      <div className="sidebar__content">
        {query.trim() && (
          <div style={{ padding: "var(--space-2) var(--space-3)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
            {loading ? "Searching…" : `${visibleResults.length} result${visibleResults.length !== 1 ? "s" : ""}`}
          </div>
        )}
        {visibleResults.map((r) => (
          <div key={`${r.source_kind}:${r.source_id}`} className="list-item" onClick={() => handleResultClick(r)}>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-ghost)", flexShrink: 0, width: 16, textAlign: "center" }}>
              {r.source_kind === "scene" ? "\u25CB" : r.source_kind === "memory" ? "\u25C6" : "\u25A6"}
            </span>
            <div className="list-item__content">
              <div className="list-item__title">{r.title}</div>
              <div className="list-item__meta">{r.excerpt}</div>
            </div>
          </div>
        ))}
        {query.trim().length >= 2 && !loading && visibleResults.length === 0 && (
          <div style={{ padding: "var(--space-4)", color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
            No results found.
          </div>
        )}
      </div>
    </>
  );
}
