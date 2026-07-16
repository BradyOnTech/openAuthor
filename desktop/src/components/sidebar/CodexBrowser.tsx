import { useEffect, useState, useMemo } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useEditor } from "../../contexts/EditorContext";
import {
  addCodexEntity,
  correctStoryMemorySuggestion,
  getCodexEntity,
  listStoryMemorySuggestions,
  reviewStoryMemorySuggestion,
  scanStoryMemory,
  type StoryMemorySuggestion,
} from "../../api";
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
  const [suggestions, setSuggestions] = useState<StoryMemorySuggestion[]>([]);
  const [scanning, setScanning] = useState(false);
  const [bulkReviewing, setBulkReviewing] = useState(false);
  const [correctingId, setCorrectingId] = useState("");
  const [correctionName, setCorrectionName] = useState("");
  const [correctionDescription, setCorrectionDescription] = useState("");

  useEffect(() => {
    void refreshSuggestions();
  }, [projectRoot]);

  async function refreshSuggestions() {
    if (!projectRoot) return;
    try {
      setSuggestions(await listStoryMemorySuggestions(projectRoot));
    } catch (error) {
      setError(`Failed to load Memory suggestions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function handleScan() {
    setScanning(true);
    try {
      const report = await scanStoryMemory(projectRoot);
      setSuggestions(report.suggestions.filter((row) => row.status === "pending"));
      setMessage(`Scanned ${report.scanned_scenes} scenes; ${report.pending} suggestions await review.`);
    } catch (error) {
      setError(`Story Memory scan failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setScanning(false);
    }
  }

  async function decideSuggestion(id: string, disposition: "accepted" | "rejected" | "deferred") {
    try {
      await reviewStoryMemorySuggestion(projectRoot, id, disposition);
      await Promise.all([refreshSuggestions(), refreshCodex()]);
      setMessage(disposition === "accepted" ? "Suggestion accepted into Story Memory." : `Suggestion ${disposition}.`);
    } catch (error) {
      setError(`Suggestion review failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function decideAllSuggestions(disposition: "accepted" | "rejected" | "deferred") {
    setBulkReviewing(true);
    try {
      for (const suggestion of suggestions) {
        await reviewStoryMemorySuggestion(projectRoot, suggestion.id, disposition);
      }
      await Promise.all([refreshSuggestions(), refreshCodex()]);
      setMessage(`${suggestions.length} suggestions ${disposition === "accepted" ? "accepted into Story Memory" : "deferred"}.`);
    } catch (error) {
      setError(`Bulk suggestion review failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBulkReviewing(false);
    }
  }

  async function saveCorrection(suggestion: StoryMemorySuggestion) {
    try {
      const updated = await correctStoryMemorySuggestion(projectRoot, suggestion.id, suggestion.kind === "canon_fact"
        ? { name: correctionName, value: correctionDescription }
        : { name: correctionName, description: correctionDescription });
      setSuggestions((rows) => rows.map((row) => row.id === updated.id ? updated : row));
      setCorrectingId("");
      setMessage("Suggestion corrected. It is still non-canon until you accept it.");
    } catch (error) {
      setError(`Suggestion correction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

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
        <span className="sidebar__title">Story Memory</span>
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
        <button className="btn btn--sm" disabled={scanning} onClick={() => void handleScan()} style={{ width: "100%", marginTop: "var(--space-2)" }}>
          {scanning ? "Scanning…" : "Scan Manuscript for Memory"}
        </button>
        <button className="btn btn--primary btn--sm" onClick={() => openTab({ id: "memory:canon", kind: "memory", label: "Canon & Continuity" })} style={{ width: "100%", marginTop: "var(--space-2)" }}>
          Canon & Continuity
        </button>
      </div>
      <div className="sidebar__content">
        {suggestions.length > 0 && (
          <div>
            <div className="section-header"><span>Suggestion inbox</span><span className="section-header__count">({suggestions.length})</span></div>
            <div style={{ display: "flex", gap: 5, padding: "0 var(--space-3) var(--space-2)" }}>
              <button className="btn btn--sm btn--primary" disabled={bulkReviewing} onClick={() => void decideAllSuggestions("accepted")}>Accept all</button>
              <button className="btn btn--sm" disabled={bulkReviewing} onClick={() => void decideAllSuggestions("deferred")}>Review later</button>
              <button className="btn btn--sm" disabled={bulkReviewing} onClick={() => void decideAllSuggestions("rejected")}>Exclude all</button>
            </div>
            {suggestions.map((suggestion) => (
              <div key={suggestion.id} style={{ padding: "var(--space-3)", borderBottom: "1px solid var(--border)", background: "var(--warning-subtle)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <strong style={{ color: "var(--text-primary)", fontSize: "var(--text-sm)" }}>{suggestion.name}</strong>
                  <span style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)" }}>{Math.round(suggestion.confidence * 100)}%</span>
                </div>
                <p style={{ margin: "6px 0", color: "var(--text-secondary)", fontSize: "var(--text-xs)", lineHeight: 1.4 }}>{suggestion.evidence[0]?.excerpt}</p>
                <div style={{ display: "flex", gap: 5 }}>
                  <button className="btn btn--sm btn--primary" onClick={() => void decideSuggestion(suggestion.id, "accepted")}>Accept</button>
                  <button className="btn btn--sm" onClick={() => void decideSuggestion(suggestion.id, "deferred")}>Later</button>
                  <button className="btn btn--sm" onClick={() => void decideSuggestion(suggestion.id, "rejected")}>Reject</button>
                  <button className="btn btn--sm" onClick={() => { setCorrectingId(suggestion.id); setCorrectionName(suggestion.name); setCorrectionDescription(suggestion.kind === "canon_fact" ? suggestion.value ?? "" : suggestion.description ?? ""); }}>Correct</button>
                </div>
                {correctingId === suggestion.id && <div style={{ display: "grid", gap: 5, marginTop: 7 }}>
                  <input className="input" aria-label={`Corrected name for ${suggestion.name}`} value={correctionName} onChange={(event) => setCorrectionName(event.target.value)} />
                  <textarea className="input" rows={3} aria-label={`Corrected detail for ${suggestion.name}`} value={correctionDescription} onChange={(event) => setCorrectionDescription(event.target.value)} />
                  <div style={{ display: "flex", gap: 5 }}><button className="btn btn--primary btn--sm" disabled={!correctionName.trim() || !correctionDescription.trim()} onClick={() => void saveCorrection(suggestion)}>Save correction</button><button className="btn btn--sm" onClick={() => setCorrectingId("")}>Cancel</button></div>
                </div>}
              </div>
            ))}
          </div>
        )}
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
          {search ? "No matches." : "No Story Memory entries yet."}
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
          Add Memory Entry
        </button>
      </div>
    </>
  );
}
