import { useEffect, useState } from "react";
import {
  addCodexRelationship,
  deleteCodexRelationship,
  listCodexRelationships,
  updateCodexEntity,
} from "../../api";
import { useEditor } from "../../contexts/EditorContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import type { CodexEntity, CodexRelationship } from "../../types";

export function StoryMemoryEditor({ entity }: { entity: CodexEntity }) {
  const { projectRoot, scenes, codexEntities, refreshCodex, setError, setMessage } = useWorkspace();
  const { updateTab } = useEditor();
  const [draft, setDraft] = useState(() => normalize(entity));
  const [relationships, setRelationships] = useState<CodexRelationship[]>([]);
  const [targetId, setTargetId] = useState("");
  const [relation, setRelation] = useState("");
  const [relationNotes, setRelationNotes] = useState("");
  const [relationFrom, setRelationFrom] = useState("");
  const [relationTo, setRelationTo] = useState("");
  const [detailKey, setDetailKey] = useState("");
  const [detailType, setDetailType] = useState<NonNullable<CodexEntity["details"]>[number]["type"]>("text");
  const [detailValue, setDetailValue] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(normalize(entity));
    void refreshRelationships();
  }, [entity.id]);

  async function refreshRelationships() {
    try {
      setRelationships(await listCodexRelationships(projectRoot, entity.id));
    } catch (error) {
      setError(`Failed to load relationships: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const updated = await updateCodexEntity(projectRoot, entity.id, {
        type: draft.type,
        name: draft.name,
        description: draft.description,
        category: draft.category,
        aliases: draft.aliases,
        tags: draft.tags,
        details: draft.details,
        notes: draft.notes,
        aiVisibility: draft.ai_visibility,
        scope: draft.scope,
      });
      updateTab(`codex:${entity.id}`, { label: updated.name, data: updated });
      await refreshCodex();
      setMessage("Story Memory entry saved.");
    } catch (error) {
      setError(`Failed to save Story Memory: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function addDetail() {
    if (!detailKey.trim()) return;
    setDraft({ ...draft, details: [...draft.details, { key: detailKey.trim(), type: detailType, value: detailValue, ai_visibility: "include" }] });
    setDetailKey("");
    setDetailValue("");
  }

  async function createRelationship() {
    if (!targetId || !relation.trim()) return;
    setBusy(true);
    try {
      await addCodexRelationship(projectRoot, { sourceId: entity.id, targetId, relation: relation.trim(), notes: relationNotes, validFrom: relationFrom, validTo: relationTo });
      setTargetId("");
      setRelation("");
      setRelationNotes("");
      setRelationFrom("");
      setRelationTo("");
      await refreshRelationships();
      setMessage("Relationship added.");
    } catch (error) {
      setError(`Failed to add relationship: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ height: "100%", overflow: "auto", background: "var(--bg-deep)" }}>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "var(--space-6)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-5)" }}>
          <div>
            <div style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: ".1em" }}>Story Memory · {draft.type}</div>
            <h1 style={{ color: "var(--text-primary)", margin: "4px 0 0", fontFamily: "var(--font-prose)", fontWeight: 500 }}>{draft.name}</h1>
          </div>
          <button className="btn btn--primary" disabled={busy || !draft.name.trim()} onClick={() => void save()}>Save Memory</button>
        </div>

        <section style={panelStyle}>
          <div style={twoColumns}>
            <label style={labelStyle}>Name<input className="input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
            <label style={labelStyle}>Category<input className="input" placeholder="protagonist, city, artifact…" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} /></label>
            <label style={labelStyle}>Aliases<input className="input" placeholder="Comma separated" value={draft.aliases.join(", ")} onChange={(event) => setDraft({ ...draft, aliases: splitList(event.target.value) })} /></label>
            <label style={labelStyle}>Tags<input className="input" placeholder="POV, antagonist, book two…" value={draft.tags.join(", ")} onChange={(event) => setDraft({ ...draft, tags: splitList(event.target.value) })} /></label>
            <label style={labelStyle}>Scope<select className="select" value={draft.scope} onChange={(event) => setDraft({ ...draft, scope: event.target.value as "project" | "series" })}><option value="project">This book</option><option value="series">Entire series</option></select></label>
            <label style={labelStyle}>Assistant access<select className="select" value={draft.ai_visibility} onChange={(event) => setDraft({ ...draft, ai_visibility: event.target.value as "include" | "exclude" | "ask" })}><option value="include">Use automatically</option><option value="ask">Ask before using</option><option value="exclude">Keep out of AI context</option></select></label>
          </div>
          <label style={{ ...labelStyle, marginTop: "var(--space-3)" }}>Description<textarea className="input" rows={5} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
          <label style={{ ...labelStyle, marginTop: "var(--space-3)" }}>Private author notes<textarea className="input" rows={3} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
        </section>

        <section style={{ ...panelStyle, marginTop: "var(--space-4)" }}>
          <h2 style={sectionTitle}>Typed details</h2>
          {draft.details.map((detail, index) => (
            <div key={`${detail.key}-${index}`} style={{ display: "grid", gridTemplateColumns: "1fr 110px 2fr auto", gap: 8, marginBottom: 8, alignItems: "center" }}>
              <input className="input" aria-label={`Detail ${index + 1} key`} value={detail.key} onChange={(event) => setDraft({ ...draft, details: draft.details.map((row, rowIndex) => rowIndex === index ? { ...row, key: event.target.value } : row) })} />
              <span className="badge badge--info">{detail.type}</span>
              <input className="input" aria-label={`Detail ${detail.key} value`} value={String(detail.value ?? "")} onChange={(event) => setDraft({ ...draft, details: draft.details.map((row, rowIndex) => rowIndex === index ? { ...row, value: event.target.value } : row) })} />
              <button className="btn btn--sm" aria-label={`Remove ${detail.key}`} onClick={() => setDraft({ ...draft, details: draft.details.filter((_, rowIndex) => rowIndex !== index) })}>×</button>
            </div>
          ))}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 2fr auto", gap: 8 }}>
            <input className="input" placeholder="Detail name" value={detailKey} onChange={(event) => setDetailKey(event.target.value)} />
            <select className="select" value={detailType} onChange={(event) => setDetailType(event.target.value as typeof detailType)}>{["text", "number", "boolean", "date", "scene", "entity", "list"].map((type) => <option key={type}>{type}</option>)}</select>
            <input className="input" placeholder="Value" value={detailValue} onChange={(event) => setDetailValue(event.target.value)} />
            <button className="btn" disabled={!detailKey.trim()} onClick={addDetail}>Add</button>
          </div>
        </section>

        <section style={{ ...panelStyle, marginTop: "var(--space-4)" }}>
          <h2 style={sectionTitle}>Relationships</h2>
          {relationships.map((row) => {
            const outward = row.source_entity_id === entity.id;
            return <div key={row.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
              <span style={{ flex: 1, color: "var(--text-primary)", fontSize: "var(--text-sm)" }}>{outward ? entity.name : row.source_name} <strong>{row.relation}</strong> {outward ? row.target_name : entity.name}{row.notes ? ` — ${row.notes}` : ""}<small style={{ display: "block", color: "var(--text-tertiary)", marginTop: 3 }}>{row.valid_from_scene_id || "beginning"} → {row.valid_to_scene_id || "ongoing"}</small></span>
              <button className="btn btn--sm" aria-label={`Delete relationship ${row.relation}`} onClick={() => void deleteCodexRelationship(projectRoot, row.id).then(refreshRelationships)}>Remove</button>
            </div>;
          })}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.5fr auto", gap: 8, marginTop: "var(--space-3)" }}>
            <select className="select" aria-label="Related entry" value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">Related entry…</option>{codexEntities.filter((row) => row.id !== entity.id).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
            <input className="input" aria-label="Relationship type" placeholder="trusts, fears, owns…" value={relation} onChange={(event) => setRelation(event.target.value)} />
            <input className="input" aria-label="Relationship notes" placeholder="Optional context" value={relationNotes} onChange={(event) => setRelationNotes(event.target.value)} />
            <button className="btn" disabled={busy || !targetId || !relation.trim()} onClick={() => void createRelationship()}>Connect</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
            <select className="select" aria-label="Relationship starts" value={relationFrom} onChange={(event) => setRelationFrom(event.target.value)}><option value="">True from beginning</option>{scenes.map((scene) => <option key={scene.id} value={scene.id}>From {scene.title}</option>)}</select>
            <select className="select" aria-label="Relationship ends" value={relationTo} onChange={(event) => setRelationTo(event.target.value)}><option value="">Ongoing</option>{scenes.map((scene) => <option key={scene.id} value={scene.id}>Until {scene.title}</option>)}</select>
          </div>
        </section>
      </div>
    </div>
  );
}

function normalize(entity: CodexEntity) {
  return {
    ...entity,
    category: entity.category ?? "",
    aliases: entity.aliases ?? [],
    tags: entity.tags ?? [],
    details: entity.details ?? [],
    notes: entity.notes ?? "",
    ai_visibility: entity.ai_visibility ?? "include" as const,
    scope: entity.scope ?? "project" as const,
  };
}

function splitList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

const panelStyle = { padding: "var(--space-4)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", background: "var(--bg-surface)" } as const;
const twoColumns = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--space-3)" } as const;
const labelStyle = { display: "grid", gap: 5, color: "var(--text-secondary)", fontSize: "var(--text-xs)", fontWeight: 600 } as const;
const sectionTitle = { margin: "0 0 var(--space-3)", color: "var(--text-primary)", fontSize: "var(--text-lg)" } as const;
