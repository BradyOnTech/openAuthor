import { useState, useMemo } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useEditor } from "../../contexts/EditorContext";
import { getCodexEntity, getScene } from "../../api";

export function ProjectSearch() {
  const { projectRoot, scenes, codexEntities, setError } = useWorkspace();
  const { openTab } = useEditor();
  const [query, setQuery] = useState("");
  const [searchScenes, setSearchScenes] = useState(true);
  const [searchCodex, setSearchCodex] = useState(true);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    const items: { id: string; kind: "scene" | "codex"; title: string; detail: string }[] = [];

    if (searchScenes) {
      for (const s of scenes) {
        if (
          s.title.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q) ||
          s.summary.toLowerCase().includes(q) ||
          s.pov.toLowerCase().includes(q)
        ) {
          items.push({
            id: s.id,
            kind: "scene",
            title: s.title || s.id,
            detail: s.summary ? s.summary.slice(0, 80) : s.id,
          });
        }
      }
    }

    if (searchCodex) {
      for (const e of codexEntities) {
        if (
          e.name.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.type.toLowerCase().includes(q)
        ) {
          items.push({
            id: e.id,
            kind: "codex",
            title: e.name,
            detail: `${e.type} \u2014 ${e.description.slice(0, 60)}`,
          });
        }
      }
    }

    return items.slice(0, 50);
  }, [query, scenes, codexEntities, searchScenes, searchCodex]);

  async function handleResultClick(item: (typeof results)[0]) {
    if (item.kind === "scene") {
      try {
        const detail = await getScene(projectRoot, item.id);
        openTab({ id: `scene:${item.id}`, kind: "scene", label: item.title, data: detail });
      } catch (e) {
        setError(`Failed to open scene: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      try {
        const entity = await getCodexEntity(projectRoot, item.id);
        openTab({ id: `codex:${item.id}`, kind: "codex", label: item.title, data: entity });
      } catch (e) {
        setError(`Failed to open entity: ${e instanceof Error ? e.message : String(e)}`);
      }
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
            <input type="checkbox" checked={searchCodex} onChange={(e) => setSearchCodex(e.target.checked)} />
            Codex
          </label>
        </div>
      </div>
      <div className="sidebar__content">
        {query.trim() && (
          <div style={{ padding: "var(--space-2) var(--space-3)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
            {results.length} result{results.length !== 1 ? "s" : ""}
          </div>
        )}
        {results.map((r) => (
          <div key={`${r.kind}:${r.id}`} className="list-item" onClick={() => handleResultClick(r)}>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-ghost)", flexShrink: 0, width: 16, textAlign: "center" }}>
              {r.kind === "scene" ? "\u25CB" : "\u25C6"}
            </span>
            <div className="list-item__content">
              <div className="list-item__title">{r.title}</div>
              <div className="list-item__meta">{r.detail}</div>
            </div>
          </div>
        ))}
        {query.trim() && results.length === 0 && (
          <div style={{ padding: "var(--space-4)", color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
            No results found.
          </div>
        )}
      </div>
    </>
  );
}
