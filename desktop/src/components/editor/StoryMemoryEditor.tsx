import { useEffect, useId, useState } from "react";
import {
  addCodexRelationship,
  deleteCodexRelationship,
  listCodexRelationships,
  updateCodexEntity,
} from "../../api";
import { useEditor } from "../../contexts/EditorContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import type { CodexEntity, CodexRelationship } from "../../types";
import { useRecoverableDraft } from "../../recoverableDraft";
import { DraftStatus } from "../shared/DraftStatus";
import { memoryDetailHelp, memoryDetailInputText, memoryDetailValueError, parseMemoryDetailInput, prepareMemoryDetails, type MemoryDetailDraft } from "../../memoryDetailValues";

const EMPTY_FORM = { targetId: "", relation: "", relationNotes: "", relationFrom: "", relationTo: "", detailKey: "", detailType: "text" as NonNullable<CodexEntity["details"]>[number]["type"], detailValue: "" };
function validForm(value: unknown): value is typeof EMPTY_FORM {
  return !!value && typeof value === "object" && Object.keys(EMPTY_FORM).every(key => typeof (value as Record<string, unknown>)[key] === "string");
}

export function StoryMemoryEditor({ entity }: { entity: CodexEntity }) {
  const { projectRoot, branches, scenes, codexEntities, refreshCodex, setError, setMessage } = useWorkspace();
  const { updateTab } = useEditor();
  const draftScope = JSON.stringify([projectRoot, branches?.find(row => row.current)?.name || "main", entity.id]);
  const recovery = useRecoverableDraft(`openauthor.memoryRecovery.v1:${draftScope}`, normalize(entity), validDraft);
  const draft = recovery.value;
  const setDraft = recovery.session.edit;
  const [relationships, setRelationships] = useState<CodexRelationship[]>([]);
  const formRecovery = useRecoverableDraft(`openauthor.memoryFormRecovery.v1:${draftScope}`, EMPTY_FORM, validForm);
  const { targetId, relation, relationNotes, relationFrom, relationTo, detailKey, detailType, detailValue } = formRecovery.value;
  const changeForm = (key: keyof typeof EMPTY_FORM) => (value: string) => formRecovery.session.edit({ ...formRecovery.session.getSnapshot().value, [key]: value });
  const setTargetId = changeForm("targetId"), setRelation = changeForm("relation"), setRelationNotes = changeForm("relationNotes");
  const setRelationFrom = changeForm("relationFrom"), setRelationTo = changeForm("relationTo");
  const setDetailKey = changeForm("detailKey"), setDetailType = changeForm("detailType"), setDetailValue = changeForm("detailValue");
  const [busy, setBusy] = useState(false);
  const [detailError, setDetailError] = useState("");
  const detailHelpId = useId();
  const references = { entities: [...codexEntities.filter(row => row.id !== entity.id), entity], scenes };

  useEffect(() => {
    recovery.session.acceptSaved(normalize(entity));
  }, [entity, recovery.session]);

  useEffect(() => {
    void refreshRelationships();
  }, [projectRoot, entity.id]);

  async function refreshRelationships() {
    try {
      setRelationships(await listCodexRelationships(projectRoot, entity.id));
    } catch (error) {
      setError(`Failed to load relationships: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function save() {
    const submitted = draft;
    setBusy(true);
    setDetailError("");
    try {
      const updated = await updateCodexEntity(projectRoot, entity.id, {
        type: draft.type,
        name: draft.name,
        description: draft.description,
        category: draft.category,
        aliases: draft.aliases.map(value => value.trim()).filter(Boolean),
        tags: draft.tags.map(value => value.trim()).filter(Boolean),
        details: prepareMemoryDetails(draft.details, entity.details ?? [], references),
        notes: draft.notes,
        aiVisibility: draft.ai_visibility,
        scope: draft.scope,
      });
      recovery.session.saved(submitted, normalize(updated));
      updateTab(`codex:${entity.id}`, { label: updated.name, data: updated });
      await refreshCodex();
      setError("");
      setMessage("Story Memory entry saved.");
    } catch (error) {
      const message = `Failed to save Story Memory: ${error instanceof Error ? error.message : String(error)}`;
      setDetailError(message);
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  function addDetail() {
    if (!detailKey.trim()) return;
    try {
      if (draft.details.some(row => row.key.trim().toLowerCase() === detailKey.trim().toLowerCase())) {
        throw new Error("This detail key already exists. Edit the existing detail or choose another name.");
      }
      const value = parseMemoryDetailInput(detailType, detailValue, references);
      setDraft({ ...draft, details: [...draft.details, { key: detailKey.trim(), type: detailType, value, ai_visibility: "include" }] });
      setDetailKey("");
      setDetailValue("");
      setDetailError("");
    } catch (error) {
      setDetailError(`Detail '${detailKey.trim()}': ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function detailValueError(detail: MemoryDetailDraft) {
    if (detail.valueInput === undefined) return memoryDetailValueError(detail.type, detail.value, references);
    try { parseMemoryDetailInput(detail.type, detail.valueInput, references); return null; }
    catch (error) { return error instanceof Error ? error.message : String(error); }
  }

  async function createRelationship() {
    if (!targetId || !relation.trim()) return;
    const submitted = formRecovery.value;
    setBusy(true);
    try {
      await addCodexRelationship(projectRoot, { sourceId: entity.id, targetId, relation: relation.trim(), notes: relationNotes, validFrom: relationFrom, validTo: relationTo });
      formRecovery.session.amend(current => {
        const remaining = { ...current };
        for (const key of ["targetId", "relation", "relationNotes", "relationFrom", "relationTo"] as const) {
          if (current[key] === submitted[key]) remaining[key] = "";
        }
        return remaining;
      });
      await refreshRelationships();
      setError("");
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
          <button className="btn btn--primary" disabled={busy || recovery.conflict || !draft.name.trim()} onClick={() => void save()}>Save Memory</button>
        </div>
        <DraftStatus {...recovery} onUseSaved={recovery.session.useSaved} onKeepDraft={recovery.session.keepDraft} />
        {formRecovery.error ? <p role="alert">{formRecovery.error}</p> : (detailKey || detailValue || targetId || relation || relationNotes || relationFrom || relationTo) && <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>Unfinished detail or connection forms are saved for recovery on this device. Use Add or Add connection to save them to the book.</p>}

        <section style={panelStyle}>
          <div style={twoColumns}>
            <label style={labelStyle}>Name<input className="input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
            <label style={labelStyle}>Category<input className="input" placeholder="protagonist, city, artifact…" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} /></label>
            <label style={labelStyle}>Aliases<input className="input" placeholder="Comma separated" value={draft.aliases.join(",")} onChange={(event) => setDraft({ ...draft, aliases: event.target.value.split(",") })} /></label>
            <label style={labelStyle}>Tags<input className="input" placeholder="POV, antagonist, book two…" value={draft.tags.join(",")} onChange={(event) => setDraft({ ...draft, tags: event.target.value.split(",") })} /></label>
            <label style={labelStyle}>Scope<select className="select" value={draft.scope} onChange={(event) => setDraft({ ...draft, scope: event.target.value as "project" | "series" })}><option value="project">This book</option><option value="series">Entire series</option></select></label>
            <label style={labelStyle}>Assistant access<select className="select" value={draft.ai_visibility} onChange={(event) => setDraft({ ...draft, ai_visibility: event.target.value as "include" | "exclude" | "ask" })}><option value="include">Use automatically</option><option value="ask">Ask before using</option><option value="exclude">Keep out of AI context</option></select></label>
          </div>
          <label style={{ ...labelStyle, marginTop: "var(--space-3)" }}>Description<textarea className="input" rows={5} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
          <label style={{ ...labelStyle, marginTop: "var(--space-3)" }}>Private author notes<textarea className="input" rows={3} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
        </section>

        <section style={{ ...panelStyle, marginTop: "var(--space-4)" }}>
          <h2 style={sectionTitle}>Typed details</h2>
          {detailError && <p role="alert" style={{ color: "var(--danger-text)" }}>{detailError}</p>}
          {draft.details.map((detail, index) => (
            <div key={index} style={{ display: "grid", gridTemplateColumns: "1fr 110px 2fr auto", gap: 8, marginBottom: 16, alignItems: "center" }}>
              <input className="input" aria-label={`Detail ${index + 1} key`} value={detail.key} onChange={(event) => setDraft({ ...draft, details: draft.details.map((row, rowIndex) => rowIndex === index ? { ...row, key: event.target.value } : row) })} />
              <span className="badge badge--info">{detail.type}</span>
              <input className="input" aria-label={`Detail ${detail.key} value`} aria-describedby={`${detailHelpId}-${index}`} aria-invalid={!!detailValueError(detail)} list={detail.type === "entity" ? `${detailHelpId}-entities` : detail.type === "scene" ? `${detailHelpId}-scenes` : undefined} value={memoryDetailInputText(detail)} onChange={(event) => setDraft({ ...draft, details: draft.details.map((row, rowIndex) => rowIndex === index ? { ...row, valueInput: event.target.value } : row) })} />
              <button className="btn btn--sm" style={{ minHeight: 40, minWidth: 40 }} aria-label={`Remove ${detail.key}`} onClick={() => setDraft({ ...draft, details: draft.details.filter((_, rowIndex) => rowIndex !== index) })}>×</button>
              <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>Assistant access for {detail.key}<select className="select" style={{ minHeight: 40 }} value={detail.ai_visibility} onChange={event => setDraft({ ...draft, details: draft.details.map((row, rowIndex) => rowIndex === index ? { ...row, ai_visibility: event.target.value as "include" | "ask" | "exclude" } : row) })}>
                <option value="include">Use automatically when this entry is included</option><option value="ask">Ask before using this detail</option><option value="exclude">Keep this detail out of AI context</option>
              </select></label>
              <p id={`${detailHelpId}-${index}`} style={{ gridColumn: "1 / -1", margin: 0, color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>{memoryDetailHelp[detail.type]}</p>
              {detailValueError(detail) && <p role="alert" style={{ gridColumn: "1 / -1", margin: 0, color: "var(--danger-text)" }}>{detail.valueInput === undefined ? `This saved value needs review: ${detailValueError(detail)} It is preserved until you edit it.` : `Detail '${detail.key}': ${detailValueError(detail)}`}</p>}
            </div>
          ))}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 2fr auto", gap: 8 }}>
            <input className="input" placeholder="Detail name" value={detailKey} onChange={(event) => setDetailKey(event.target.value)} />
            <select className="select" aria-label="New detail type" value={detailType} onChange={(event) => setDetailType(event.target.value as typeof detailType)}>{["text", "number", "boolean", "date", "scene", "entity", "list"].map((type) => <option key={type}>{type}</option>)}</select>
            <input className="input" aria-label="New detail value" aria-describedby={`${detailHelpId}-new`} placeholder="Value" list={detailType === "entity" ? `${detailHelpId}-entities` : detailType === "scene" ? `${detailHelpId}-scenes` : undefined} value={detailValue} onChange={(event) => setDetailValue(event.target.value)} />
            <button className="btn" disabled={!detailKey.trim()} onClick={addDetail}>Add</button>
          </div>
          <p id={`${detailHelpId}-new`} style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>{memoryDetailHelp[detailType]}</p>
          <datalist id={`${detailHelpId}-entities`}>{references.entities.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</datalist>
          <datalist id={`${detailHelpId}-scenes`}>{scenes.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</datalist>
        </section>

        <section style={{ ...panelStyle, marginTop: "var(--space-4)" }}>
          <h2 style={sectionTitle}>Connections</h2>
          <p style={{ margin: "-6px 0 var(--space-3)", color: "var(--text-secondary)", fontSize: "var(--text-xs)", lineHeight: 1.5 }}>Build the character web the Assistant should understand. Connections can change at a specific scene as the story evolves.</p>
          {relationships.length === 0 && <div style={{ padding: "var(--space-3)", border: "1px dashed var(--border)", borderRadius: "var(--radius-md)", color: "var(--text-tertiary)", fontSize: "var(--text-sm)", marginBottom: "var(--space-3)" }}>No connections yet. Link {entity.name} to another character, place, faction, or object below.</div>}
          {relationships.map((row) => {
            const outward = row.source_entity_id === entity.id;
            const from = outward ? entity.name : row.source_name;
            const to = outward ? row.target_name : entity.name;
            const starts = row.valid_from_scene_id ? scenes.find((scene) => scene.id === row.valid_from_scene_id)?.title ?? row.valid_from_scene_id : "Beginning";
            const ends = row.valid_to_scene_id ? scenes.find((scene) => scene.id === row.valid_to_scene_id)?.title ?? row.valid_to_scene_id : "Ongoing";
            return <div key={row.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "var(--space-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--bg-elevated)", marginBottom: 8 }}>
              <span style={{ flex: 1, minWidth: 0, color: "var(--text-primary)", fontSize: "var(--text-sm)" }}><strong>{from}</strong> <span style={{ color: "var(--info-text)", fontWeight: 600 }}>→ {row.relation} →</span> <strong>{to}</strong>{row.notes && <span style={{ display: "block", color: "var(--text-secondary)", marginTop: 5 }}>{row.notes}</span>}<small style={{ display: "block", color: "var(--text-tertiary)", marginTop: 5 }}>{starts} → {ends}</small></span>
              <button className="btn btn--sm" aria-label={`Delete relationship ${row.relation}`} onClick={() => void deleteCodexRelationship(projectRoot, row.id).then(refreshRelationships)}>Remove</button>
            </div>;
          })}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginTop: "var(--space-3)" }}>
            <label style={labelStyle}>Related entry<select className="select" value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">Choose an entry…</option>{codexEntities.filter((row) => row.id !== entity.id).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
            <label style={labelStyle}>Connection<input className="input" list="relationship-types" placeholder="trusts, protects, rivals…" value={relation} onChange={(event) => setRelation(event.target.value)} /></label>
            <datalist id="relationship-types">{["trusts", "distrusts", "protects", "loves", "owes", "rivals", "mentors", "is sibling of", "works for", "owns"].map((value) => <option key={value} value={value} />)}</datalist>
            <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>Context<input className="input" placeholder="Why this connection matters, or what makes it complicated" value={relationNotes} onChange={(event) => setRelationNotes(event.target.value)} /></label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginTop: 8 }}>
            <label style={labelStyle}>True from<select className="select" value={relationFrom} onChange={(event) => setRelationFrom(event.target.value)}><option value="">Beginning of story</option>{scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</select></label>
            <label style={labelStyle}>True until<select className="select" value={relationTo} onChange={(event) => setRelationTo(event.target.value)}><option value="">Ongoing</option>{scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</select></label>
          </div>
          <button className="btn btn--primary" style={{ marginTop: "var(--space-3)" }} disabled={busy || !targetId || !relation.trim()} onClick={() => void createRelationship()}>Add connection</button>
        </section>
      </div>
    </div>
  );
}

function normalize(entity: CodexEntity) {
  return {
    type: entity.type,
    name: entity.name,
    description: entity.description,
    category: entity.category ?? "",
    aliases: entity.aliases ?? [],
    tags: entity.tags ?? [],
    details: (entity.details ?? []).map(row => ({ ...row } as MemoryDetailDraft)),
    notes: entity.notes ?? "",
    ai_visibility: entity.ai_visibility ?? "include" as const,
    scope: entity.scope ?? "project" as const,
  };
}

function validDraft(value: unknown): value is ReturnType<typeof normalize> {
  if (!value || typeof value !== "object") return false;
  const row = value as ReturnType<typeof normalize>;
  return [row.type, row.name, row.description, row.category, row.notes, row.ai_visibility, row.scope].every(item => typeof item === "string")
    && [row.aliases, row.tags].every(items => Array.isArray(items) && items.every(item => typeof item === "string"))
    && Array.isArray(row.details) && row.details.every(detail => detail && typeof detail.key === "string" && typeof detail.type === "string" && typeof detail.ai_visibility === "string" && (detail.valueInput === undefined || typeof detail.valueInput === "string"));
}

const panelStyle = { padding: "var(--space-4)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", background: "var(--bg-surface)" } as const;
const twoColumns = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--space-3)" } as const;
const labelStyle = { display: "grid", gap: 5, color: "var(--text-secondary)", fontSize: "var(--text-xs)", fontWeight: 600 } as const;
const sectionTitle = { margin: "0 0 var(--space-3)", color: "var(--text-primary)", fontSize: "var(--text-lg)" } as const;
