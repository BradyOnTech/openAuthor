import { useEffect, useMemo, useState } from "react";
import {
  addCodexRelationship,
  getCodexEntity,
  listCodexRelationships,
  listStoryMemorySuggestions,
  reviewStoryMemorySuggestion,
  scanStoryMemory,
  type StoryMemorySuggestion,
} from "../../api";
import { useEditor } from "../../contexts/EditorContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import type { CodexEntity, CodexRelationship } from "../../types";

const ENTITY_TYPES: Array<CodexEntity["type"]> = ["character", "location", "lore", "item", "faction", "event"];
const ENTITY_TYPE_LABELS: Record<CodexEntity["type"], string> = {
  character: "Characters",
  location: "Locations",
  lore: "Lore",
  item: "Items",
  faction: "Factions",
  event: "Events",
};
const RELATION_PRESETS = ["trusts", "distrusts", "protects", "loves", "fears", "owes", "betrayed", "serves", "works for", "is sibling of", "is parent of", "is child of"];

type GraphNode = CodexEntity & { x: number; y: number };

function graphNodes(entities: CodexEntity[]): GraphNode[] {
  if (entities.length === 1) return [{ ...entities[0], x: 500, y: 270 }];
  return entities.map((entity, index) => {
    const angle = (index / Math.max(entities.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const radius = entities.length > 8 ? 225 : 190;
    return { ...entity, x: 500 + Math.cos(angle) * radius, y: 270 + Math.sin(angle) * radius };
  });
}

function shortLabel(value: string, limit = 19) {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

export function ConnectionGraphEditor() {
  const { projectRoot, codexEntities, scenes, refreshCodex, setError, setMessage } = useWorkspace();
  const { openTab } = useEditor();
  const [relationships, setRelationships] = useState<CodexRelationship[]>([]);
  const [suggestions, setSuggestions] = useState<StoryMemorySuggestion[]>([]);
  const [filter, setFilter] = useState<"all" | CodexEntity["type"]>("all");
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [relation, setRelation] = useState("");
  const [notes, setNotes] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

  async function refreshConnections() {
    if (!projectRoot) return;
    try {
      const [relationshipRows, suggestionRows] = await Promise.all([
        listCodexRelationships(projectRoot),
        listStoryMemorySuggestions(projectRoot),
      ]);
      setRelationships(relationshipRows);
      setSuggestions(suggestionRows.filter((row) => row.kind === "relationship_create"));
    } catch (error) {
      setError(`Failed to load the connection map: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  useEffect(() => {
    void refreshConnections();
  }, [projectRoot]);

  useEffect(() => {
    if (!sourceId && codexEntities[0]) setSourceId(codexEntities[0].id);
  }, [codexEntities, sourceId]);

  const visibleEntities = useMemo(
    () => filter === "all" ? codexEntities : codexEntities.filter((entity) => entity.type === filter),
    [codexEntities, filter],
  );
  const nodes = useMemo(() => graphNodes(visibleEntities), [visibleEntities]);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const visibleRelationships = useMemo(
    () => relationships.filter((row) => nodeById.has(row.source_entity_id) && nodeById.has(row.target_entity_id)),
    [relationships, nodeById],
  );
  const connectedToSelection = useMemo(() => {
    const ids = new Set<string>();
    if (selectedNodeId) ids.add(selectedNodeId);
    for (const row of visibleRelationships) {
      if (row.source_entity_id === selectedNodeId) ids.add(row.target_entity_id);
      if (row.target_entity_id === selectedNodeId) ids.add(row.source_entity_id);
    }
    return ids;
  }, [selectedNodeId, visibleRelationships]);

  const targetOptions = codexEntities.filter((entity) => entity.id !== sourceId);
  const sceneTitle = (sceneId: string | undefined) => scenes.find((scene) => scene.id === sceneId)?.title || "Manuscript evidence";

  async function openEntity(entity: CodexEntity) {
    try {
      const detail = await getCodexEntity(projectRoot, entity.id);
      openTab({ id: `codex:${entity.id}`, kind: "codex", label: entity.name, data: detail });
    } catch (error) {
      setError(`Failed to open ${entity.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function scanForConnections() {
    setScanning(true);
    try {
      const report = await scanStoryMemory(projectRoot);
      setSuggestions(report.suggestions.filter((row) => row.status === "pending" && row.kind === "relationship_create"));
      setMessage(`Connection scan complete. ${report.suggestions.filter((row) => row.status === "pending" && row.kind === "relationship_create").length} relationship suggestion${report.suggestions.filter((row) => row.status === "pending" && row.kind === "relationship_create").length === 1 ? "" : "s"} await review.`);
    } catch (error) {
      setError(`Connection scan failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setScanning(false);
    }
  }

  async function decideSuggestion(id: string, disposition: "accepted" | "rejected" | "deferred") {
    setBusy(true);
    try {
      await reviewStoryMemorySuggestion(projectRoot, id, disposition);
      await Promise.all([refreshConnections(), refreshCodex()]);
      setError("");
      setMessage(disposition === "accepted" ? "Connection accepted into Story Memory." : `Connection ${disposition}.`);
    } catch (error) {
      setError(`Connection review failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function addConnection() {
    if (!sourceId || !targetId || !relation.trim()) return;
    setBusy(true);
    try {
      await addCodexRelationship(projectRoot, {
        sourceId,
        targetId,
        relation: relation.trim(),
        notes: notes.trim(),
        validFrom,
      });
      setTargetId("");
      setRelation("");
      setNotes("");
      setValidFrom("");
      await refreshConnections();
      setError("");
      setMessage("Connection added to Story Memory.");
    } catch (error) {
      setError(`Failed to add connection: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="connection-map">
      <header className="connection-map__header">
        <div>
          <div className="connection-map__eyebrow">Story Memory · Evidence-backed relationships</div>
          <h1>Connection Map</h1>
          <p>See how characters, places, objects, factions, events, and lore shape one another. AI-found links remain suggestions until you accept them.</p>
        </div>
        <button className="btn btn--primary" disabled={scanning} onClick={() => void scanForConnections()}>
          {scanning ? "Scanning manuscript…" : "Find connections in prose"}
        </button>
      </header>

      <div className="connection-map__metrics" aria-label="Connection map summary">
        <span><strong>{codexEntities.length}</strong> memory entries</span>
        <span><strong>{relationships.length}</strong> accepted connections</span>
        <span><strong>{suggestions.length}</strong> awaiting review</span>
      </div>

      <div className="connection-map__filters" aria-label="Filter connection map">
        <button className={`connection-map__filter${filter === "all" ? " connection-map__filter--active" : ""}`} onClick={() => setFilter("all")}>All</button>
        {ENTITY_TYPES.map((type) => (
          <button key={type} className={`connection-map__filter${filter === type ? " connection-map__filter--active" : ""}`} onClick={() => setFilter(type)}>{ENTITY_TYPE_LABELS[type]}</button>
        ))}
      </div>

      <div className="connection-map__workspace">
        <section className="connection-map__graph-panel" aria-label="Accepted story connections">
          {nodes.length === 0 ? (
            <div className="connection-map__empty">
              <strong>No memory entries to map yet.</strong>
              <span>Add characters, places, objects, or ideas in Story Memory, then return here to connect them.</span>
            </div>
          ) : (
            <>
              <svg className="connection-map__graph" viewBox="0 0 1000 540" role="img" aria-label={`${nodes.length} story memory entries connected by ${visibleRelationships.length} accepted relationships`}>
                <defs>
                  <marker id="connection-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker>
                </defs>
                {visibleRelationships.map((edge) => {
                  const source = nodeById.get(edge.source_entity_id)!;
                  const target = nodeById.get(edge.target_entity_id)!;
                  const connected = !selectedNodeId || edge.source_entity_id === selectedNodeId || edge.target_entity_id === selectedNodeId;
                  return (
                    <g key={edge.id} className={connected ? "connection-map__edge" : "connection-map__edge connection-map__edge--muted"}>
                      <line x1={source.x} y1={source.y} x2={target.x} y2={target.y} markerEnd="url(#connection-arrow)" />
                      <text x={(source.x + target.x) / 2} y={(source.y + target.y) / 2 - 8} textAnchor="middle">{shortLabel(edge.relation, 24)}</text>
                    </g>
                  );
                })}
                {nodes.map((node) => {
                  const muted = selectedNodeId && !connectedToSelection.has(node.id);
                  return (
                    <g
                      key={node.id}
                      className={`connection-map__node connection-map__node--${node.type}${selectedNodeId === node.id ? " connection-map__node--selected" : ""}${muted ? " connection-map__node--muted" : ""}`}
                      transform={`translate(${node.x - 76} ${node.y - 30})`}
                      role="button"
                      tabIndex={0}
                      aria-label={`Open ${node.name}, ${node.type}`}
                      onClick={() => { setSelectedNodeId(node.id === selectedNodeId ? "" : node.id); }}
                      onDoubleClick={() => void openEntity(node)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void openEntity(node);
                        if (event.key === " ") { event.preventDefault(); setSelectedNodeId(node.id === selectedNodeId ? "" : node.id); }
                      }}
                    >
                      <rect width="152" height="60" rx="15" />
                      <text className="connection-map__node-name" x="76" y="26" textAnchor="middle">{shortLabel(node.name)}</text>
                      <text className="connection-map__node-type" x="76" y="44" textAnchor="middle">{node.type}</text>
                    </g>
                  );
                })}
              </svg>
              <div className="connection-map__graph-hint">Select a node to focus its links. Press Enter or double-click to open its Story Memory page.</div>
            </>
          )}
        </section>

        <aside className="connection-map__review" aria-label="Relationship suggestions">
          <div className="connection-map__section-heading">
            <div><span className="connection-map__eyebrow">Review first</span><h2>Suggested connections</h2></div>
            <span className="connection-map__count">{suggestions.length}</span>
          </div>
          {suggestions.length === 0 ? (
            <div className="connection-map__quiet-state">No relationship suggestions are waiting. A scan only flags explicit statements such as “Mara distrusts Soren”—never mere co-occurrence.</div>
          ) : suggestions.map((suggestion) => (
            <article className="connection-suggestion" key={suggestion.id}>
              <div className="connection-suggestion__relation">
                <strong>{suggestion.source_name}</strong><span>{suggestion.relation}</span><strong>{suggestion.target_name}</strong>
              </div>
              <blockquote>“{suggestion.evidence[0]?.excerpt}”</blockquote>
              <div className="connection-suggestion__evidence">{sceneTitle(suggestion.evidence[0]?.scene_id)} · {Math.round(suggestion.confidence * 100)}% confidence</div>
              <div className="connection-suggestion__actions">
                <button className="btn btn--primary btn--sm" disabled={busy} onClick={() => void decideSuggestion(suggestion.id, "accepted")}>Accept</button>
                <button className="btn btn--sm" disabled={busy} onClick={() => void decideSuggestion(suggestion.id, "deferred")}>Later</button>
                <button className="btn btn--sm" disabled={busy} onClick={() => void decideSuggestion(suggestion.id, "rejected")}>Reject</button>
              </div>
            </article>
          ))}
        </aside>
      </div>

      <div className="connection-map__lower-grid">
        <section className="connection-map__panel">
          <div className="connection-map__section-heading"><div><span className="connection-map__eyebrow">Author controlled</span><h2>Add a connection</h2></div></div>
          <div className="connection-map__form-grid">
            <label><span>From</span><select className="select" aria-label="Connection source" value={sourceId} onChange={(event) => { setSourceId(event.target.value); if (event.target.value === targetId) setTargetId(""); }}><option value="">Choose entry</option>{codexEntities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></label>
            <label><span>Connection</span><input className="input" aria-label="Connection type" list="connection-relations" value={relation} onChange={(event) => setRelation(event.target.value)} placeholder="e.g. distrusts" /><datalist id="connection-relations">{RELATION_PRESETS.map((value) => <option key={value} value={value} />)}</datalist></label>
            <label><span>To</span><select className="select" aria-label="Connection target" value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">Choose entry</option>{targetOptions.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></label>
            <label><span>True from scene</span><select className="select" aria-label="Connection begins in scene" value={validFrom} onChange={(event) => setValidFrom(event.target.value)}><option value="">Whole story / unspecified</option>{scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</select></label>
            <label className="connection-map__form-wide"><span>Context</span><textarea className="input" aria-label="Connection context" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Why this connection matters, or how it changes…" /></label>
          </div>
          <button className="btn btn--primary" disabled={busy || !sourceId || !targetId || !relation.trim()} onClick={() => void addConnection()}>Add accepted connection</button>
        </section>

        <section className="connection-map__panel">
          <div className="connection-map__section-heading"><div><span className="connection-map__eyebrow">Accessible outline</span><h2>Accepted connections</h2></div></div>
          {visibleRelationships.length === 0 ? <div className="connection-map__quiet-state">No accepted connections match this filter.</div> : (
            <div className="connection-map__list">
              {visibleRelationships.map((edge) => (
                <button key={edge.id} className="connection-map__list-row" onClick={() => setSelectedNodeId(edge.source_entity_id)}>
                  <strong>{edge.source_name}</strong><span>→ {edge.relation} →</span><strong>{edge.target_name}</strong>
                  {edge.valid_from_scene_id && <small>from {sceneTitle(edge.valid_from_scene_id)}</small>}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
