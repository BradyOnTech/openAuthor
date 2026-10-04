import { useEffect, useRef, useState } from "react";
import type { ManuscriptPlan, SceneSummary } from "../../types";

type Note = ManuscriptPlan["notes"][number];

export function PlanNotes({ notes, scenes, focusNoteId, onOpenScene, onRevise }: {
  notes: Note[];
  scenes: SceneSummary[];
  focusNoteId?: string;
  onOpenScene: (scene: SceneSummary) => void;
  onRevise: (note: Note) => void;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const focusedNote = useRef<HTMLDetailsElement>(null);
  const [expandedId, setExpandedId] = useState(focusNoteId);
  useEffect(() => {
    setQuery("");
    setScope("all");
    setExpandedId(focusNoteId);
  }, [focusNoteId]);
  useEffect(() => {
    if (!focusNoteId || !focusedNote.current) return;
    focusedNote.current.open = true;
    focusedNote.current.scrollIntoView?.({ block: "nearest" });
    focusedNote.current.querySelector("summary")?.focus();
  }, [focusNoteId, notes]);

  const scenesById = new Map(scenes.map((scene) => [scene.id, scene]));
  const visible = [...notes].reverse().filter((note) => {
    const matchesScope = scope === "all" || (scope === "project" ? !note.scene_id : note.scene_id === scope);
    const searchText = `${note.title}\n${note.content}\n${scenesById.get(note.scene_id)?.title ?? "Project note"}`.toLocaleLowerCase();
    return matchesScope && searchText.includes(query.trim().toLocaleLowerCase());
  });

  return <section aria-label="Saved notes" style={{ marginTop: "var(--space-4)", padding: "var(--space-4)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", background: "var(--bg-surface)" }}>
    <h2 style={{ margin: "0 0 var(--space-2)", fontSize: "var(--text-lg)", color: "var(--text-primary)" }}>Notes</h2>
    <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>Keep ideas from Copilot here, return to their scenes, or use them to plan a revision. Notes are planning material; review factual claims before treating them as canon.</p>
    {notes.length === 0 ? <p>Save a Copilot reply with “Save as…” → “Scene note” or “Project note” to find it here later.</p> : <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
        <input type="search" className="input" aria-label="Search saved notes" placeholder="Find an idea, phrase, or scene…" value={query} onChange={(event) => setQuery(event.target.value)} style={{ flex: "1 1 240px" }} />
        <select className="select" aria-label="Filter notes by scene" value={scope} onChange={(event) => setScope(event.target.value)}>
          <option value="all">All notes</option><option value="project">Project notes</option>
          {scenes.filter((scene) => notes.some((note) => note.scene_id === scene.id)).map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}
        </select>
      </div>
      <p role="status" style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)" }}>{visible.length} of {notes.length} notes</p>
      {!visible.length && <p>No notes match. Try a different search or scene.</p>}
      {visible.map((note) => {
        const scene = scenesById.get(note.scene_id);
        return <details key={note.id} ref={note.id === focusNoteId ? focusedNote : undefined} open={expandedId === note.id || undefined} style={{ padding: "var(--space-3)", borderTop: "1px solid var(--border)", overflowWrap: "anywhere" }}>
          <summary style={{ cursor: "pointer", color: "var(--text-primary)" }}><strong>{note.title}</strong><span style={{ marginLeft: 8, color: "var(--text-secondary)", fontSize: "var(--text-xs)" }}>{scene?.title ?? (note.scene_id ? "Scene unavailable" : "Project note")}</span></summary>
          <p style={{ whiteSpace: "pre-wrap", color: "var(--text-secondary)", lineHeight: 1.6 }}>{note.content}</p>
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
            {scene && <button className="btn btn--sm" onClick={() => onOpenScene(scene)}>Open scene: {scene.title}</button>}
            <button className="btn btn--sm" disabled={Boolean(note.scene_id) && !scene} onClick={() => onRevise(note)}>Plan a revision</button>
          </div>
        </details>;
      })}
    </>}
  </section>;
}
