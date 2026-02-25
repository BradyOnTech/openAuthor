import { useState, useMemo } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useEditor } from "../../contexts/EditorContext";
import { addCodexEntity, getCodexEntity } from "../../api";
import { orderCodexEntities } from "../../state";
import type { CodexEntity } from "../../types";

const TYPE_ORDER: CodexEntity["type"][] = ["character", "location", "lore", "item", "faction", "event"];

const TYPE_ICONS: Record<CodexEntity["type"], string> = {
  character: "\u25C6",
  location: "\u25C7",
  lore: "\u25C8",
  item: "\u25A0",
  faction: "\u25B2",
  event: "\u25CF",
};

export function CodexBrowser() {
  const { projectRoot, codexEntities, refreshCodex, setError, setMessage } = useWorkspace();
  const { openTab } = useEditor();
  const [search, setSearch] = useState("");
  const [newType, setNewType] = useState<CodexEntity["type"]>("character");
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  const ordered = useMemo(() => orderCodexEntities(codexEntities), [codexEntities]);

  const filtered = useMemo(() => {
    if (!search.trim()) return ordered;
    const q = search.toLowerCase();
    return ordered.filter(
      (e) => e.name.toLowerCase().includes(q) || e.type.toLowerCase().includes(q)
    );
  }, [ordered, search]);

  const grouped = useMemo(() => {
    const groups: Record<string, CodexEntity[]> = {};
    for (const e of filtered) {
      (groups[e.type] ??= []).push(e);
    }
    return TYPE_ORDER.filter((t) => groups[t]?.length).map((t) => ({
      type: t,
      entities: groups[t],
    }));
  }, [filtered]);

  async function handleEntityClick(entityId: string, name: string) {
    try {
      const entity = await getCodexEntity(projectRoot, entityId);
      openTab({
        id: `codex:${entityId}`,
        kind: "codex",
        label: name,
        data: entity,
      });
    } catch (e) {
      setError(`Failed to open entity: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleAdd() {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      await addCodexEntity(projectRoot, {
        type: newType,
        name: newName.trim(),
        description: "",
      });
      setNewName("");
      setMessage("Entity created.");
      await refreshCodex();
    } catch (e) {
      setError(`Failed to add entity: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAdding(false);
    }
  }

  return (
    <>
      <div className="sidebar__header">
        <span className="sidebar__title">Codex</span>
        <span style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)" }}>
          {codexEntities.length}
        </span>
      </div>
      <div className="sidebar__filter">
        <input
          className="input"
          placeholder="Search entities..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="sidebar__content">
        {grouped.map((g) => (
          <div key={g.type}>
            <div className="section-header">
              <span>{g.type}s</span>
              <span className="section-header__count">({g.entities.length})</span>
            </div>
            {g.entities.map((e) => (
              <div
                key={e.id}
                className="list-item"
                onClick={() => handleEntityClick(e.id, e.name)}
                title={e.description || e.id}
              >
                <span style={{ color: "var(--text-tertiary)", fontSize: "var(--text-sm)", flexShrink: 0 }}>
                  {TYPE_ICONS[e.type]}
                </span>
                <div className="list-item__content">
                  <div className="list-item__title">{e.name}</div>
                </div>
              </div>
            ))}
          </div>
        ))}

        {filtered.length === 0 && (
          <div style={{ padding: "var(--space-4)", color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
            {search ? "No matches." : "No entities yet."}
          </div>
        )}
      </div>

      <div style={{
        padding: "var(--space-3)",
        borderTop: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
      }}>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <select
            className="select"
            value={newType}
            onChange={(e) => setNewType(e.target.value as CodexEntity["type"])}
          >
            {TYPE_ORDER.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <input
            className="input"
            placeholder="Entity name..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            style={{ flex: 1 }}
          />
        </div>
        <button
          className="btn btn--primary"
          disabled={!newName.trim() || adding}
          onClick={handleAdd}
          style={{ width: "100%" }}
        >
          Add Entity
        </button>
      </div>
    </>
  );
}
