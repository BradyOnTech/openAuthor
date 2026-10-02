import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { correctStoryMemorySuggestion, listStoryMemorySuggestions, reviewStoryMemorySuggestion, scanStoryMemory, type StoryMemorySuggestion } from "../../api";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useRecoverableDraft } from "../../recoverableDraft";
import { flushProjectSceneSaves } from "../../sceneSaveSession";
import { DraftStatus } from "../shared/DraftStatus";
import { EvidencePassages } from "../shared/EvidencePassages";
import type { MemoryViewRequest } from "./MemoryWorkspace";
import type { CodexEntity } from "../../types";
import { MemoryScanReview } from "./MemoryScanReview";

type Status = StoryMemorySuggestion["status"];
type Correction = { name: string; detail: string; predicate: string; entityType: CodexEntity["type"] | ""; reviewVersion: string };
type Corrections = Record<string, Correction>;
const statuses: Status[] = ["pending", "deferred", "accepted", "rejected"];
const entityTypes: CodexEntity["type"][] = ["character", "location", "lore", "item", "faction", "event"];
const statusNames: Record<Status, string> = { pending: "Needs review", deferred: "Review later", accepted: "Accepted", rejected: "Rejected" };
const kindNames: Record<StoryMemorySuggestion["kind"], string> = { entity_create: "Memory entry", canon_fact: "Canon fact", memory_note: "Memory note", relationship_create: "Connection" };
function readReviewPreference(key: string): { selectedId: string; filter: Status | "all" } {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    if (value && typeof value.selectedId === "string" && [...statuses, "all"].includes(value.filter)) return value;
  } catch { /* A missing view preference does not affect saved decisions. */ }
  return { selectedId: "", filter: "pending" };
}
function validCorrections(value: unknown): value is Corrections {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.values(value).every(row => row && typeof row === "object" && !Array.isArray(row)
    && [row.name, row.detail, row.predicate, row.reviewVersion].every(field => typeof field === "string") && (row.entityType === "" || entityTypes.includes(row.entityType)) && Object.keys(row).every(field => ["name", "detail", "predicate", "entityType", "reviewVersion"].includes(field))));
}

export function MemorySuggestionReview({ request }: { request?: MemoryViewRequest }) {
  const { projectRoot, branches, refreshCodex, setMessage } = useWorkspace();
  const branch = branches?.find(row => row.current)?.name || "";
  const preferenceKey = `openauthor.memoryReview.v1:${JSON.stringify([projectRoot, branch])}`;
  const [preference] = useState(() => readReviewPreference(preferenceKey));
  const correctionDrafts = useRecoverableDraft<Corrections>(`openauthor.memoryCorrections.v1:${JSON.stringify([projectRoot, branch])}`, {}, validCorrections);
  const [suggestions, setSuggestions] = useState<StoryMemorySuggestion[]>([]);
  const [selectedId, setSelectedId] = useState(request?.suggestionId || preference.selectedId || Object.keys(correctionDrafts.value)[0] || "");
  const [filter, setFilter] = useState<Status | "all">(request?.suggestionId ? "pending" : preference.filter);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const loadSequence = useRef(0);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const listId = useId();
  const rows = suggestions.filter(row => filter === "all" || row.status === filter);
  const selected = rows.find(row => row.id === selectedId) || rows[0];
  const correction = selected ? correctionDrafts.value[selected.id] : undefined;
  const decidable = selected?.status === "pending" || selected?.status === "deferred";
  const hasCurrentVersion = Boolean(selected?.review_version);
  const correctionStale = Boolean(correction && correction.reviewVersion !== selected?.review_version);
  const actionBusy = busy || aiBusy;
  const typeNeedsConfirmation = Boolean(selected?.kind === "entity_create" && selected.classification_uncertain && !selected.type_confirmed);
  useEffect(() => {
    try { localStorage.setItem(preferenceKey, JSON.stringify({ selectedId: selected?.id || selectedId, filter })); }
    catch { /* Selection preferences contain no corrections or book content. */ }
  }, [preferenceKey, selected?.id, selectedId, filter]);
  useEffect(() => {
    if (request?.suggestionId) { setSelectedId(request.suggestionId); setFilter("pending"); }
    void load();
    return () => { ++loadSequence.current; };
  }, [projectRoot, branch, request]);

  async function load() {
    const sequence = ++loadSequence.current;
    setLoading(true);
    try {
      const groups = await Promise.all(statuses.map(status => listStoryMemorySuggestions(projectRoot, status)));
      if (sequence !== loadSequence.current) return;
      setSuggestions(groups.flat().filter(row => row.kind !== "relationship_create"));
      setError("");
    } catch (cause) { if (sequence === loadSequence.current) setError(`Could not load Memory suggestions: ${String(cause)}`); }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }
  async function mutate(action: () => Promise<unknown>) {
    if (pending.current || aiBusy) return;
    pending.current = true; setBusy(true); setError("");
    try {
      if (!await flushProjectSceneSaves(projectRoot)) throw new Error("Save pending manuscript writing before reviewing Memory.");
      await action();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { pending.current = false; setBusy(false); }
  }
  function scan() {
    void mutate(async () => {
      const report = await scanStoryMemory(projectRoot);
      setFilter("pending");
      await load();
      setMessage(`Scanned ${report.scanned_scenes} scenes. Suggestions remain unconfirmed until you review them.`);
    });
  }
  function decide(disposition: Exclude<Status, "pending">) {
    if (!selected || !decidable || correction || !hasCurrentVersion || disposition === "accepted" && typeNeedsConfirmation) return;
    const submitted = selected;
    void mutate(async () => {
      const updated = await reviewStoryMemorySuggestion(projectRoot, submitted.id, disposition, submitted.review_version);
      setSuggestions(previous => previous.map(row => row.id === updated.id ? updated : row));
      setMessage(disposition === "accepted" ? "Suggestion accepted into Story Memory." : disposition === "deferred" ? "Suggestion saved for later review." : "Suggestion rejected.");
      await load();
      try { await refreshCodex(); } catch (cause) { setError(`Decision saved. Could not refresh Memory entries: ${String(cause)}`); }
    });
  }
  function startCorrection() {
    if (!selected || !decidable || !selected.review_version) return;
    correctionDrafts.session.edit({ ...correctionDrafts.value, [selected.id]: { name: selected.name, detail: selected.kind === "canon_fact" ? selected.value || "" : selected.description || "", predicate: selected.predicate || "", entityType: selected.entity_type || "", reviewVersion: selected.review_version } });
  }
  function changeCorrection(changes: Partial<Correction>) {
    if (!selected || !correction || actionBusy) return;
    correctionDrafts.session.edit({ ...correctionDrafts.value, [selected.id]: { ...correction, ...changes } });
  }
  function discardCorrection(id: string) {
    correctionDrafts.session.amend(value => { const next = { ...value }; delete next[id]; return next; });
  }
  function saveCorrection() {
    if (!selected || !correction || !decidable || !hasCurrentVersion || correctionStale) return;
    const submitted = selected, fields = correction;
    void mutate(async () => {
      const updated = await correctStoryMemorySuggestion(projectRoot, submitted.id, submitted.kind === "canon_fact" ? { name: fields.name, predicate: fields.predicate, value: fields.detail, expected_version: fields.reviewVersion } : { name: fields.name, description: fields.detail, ...(submitted.kind === "entity_create" && fields.entityType ? { entity_type: fields.entityType } : {}), expected_version: fields.reviewVersion });
      setSuggestions(previous => previous.map(row => row.id === updated.id ? updated : row));
      correctionDrafts.session.amend(value => { if (JSON.stringify(value[submitted.id]) !== JSON.stringify(fields)) return value; const next = { ...value }; delete next[submitted.id]; return next; });
      setMessage("Correction saved. Review it before accepting; it is still unconfirmed.");
    });
  }
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === "ArrowDown" ? Math.min(rows.length - 1, index + 1) : event.key === "ArrowUp" ? Math.max(0, index - 1) : event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); setSelectedId(rows[next].id); buttonRefs.current.get(rows[next].id)?.focus();
  }

  return <section className="memory-inbox" aria-label="Memory suggestion review">
    <header className="memory-inbox__header"><div><h1>Memory suggestions</h1><p>Compare the recorded passages with the proposed entry. Suggestions may be incomplete and remain unconfirmed until you accept them. Connections are reviewed in Connection Map.</p></div><button className="btn" disabled={actionBusy || loading} onClick={scan}>Scan manuscript</button></header>
    <details><summary>What scanning can miss</summary><p>Scan manuscript uses local capitalized-name and saved-POV heuristics; names in scripts without capital letters may be missed. Review AI scan can interpret the scenes you choose, including uncased names, but may still miss or misclassify entries. Exact source quotations support review; they do not prove the interpretation. Check each entry's type and correct it before accepting. You can also add entries directly in Memory.</p></details>
    <MemoryScanReview disabled={busy || loading} onBusyChange={setAiBusy} onOpenChange={setScanOpen} onQueued={async report => {
      setFilter("pending"); await load();
      setMessage(`Scanned ${report.scanned_scenes} scenes. ${report.added} new suggestions remain unconfirmed until you review them.`);
    }} />
    {!scanOpen && <><div className="memory-inbox__filters"><label>Show <select className="select" aria-label="Filter Memory suggestions" value={filter} onChange={event => setFilter(event.target.value as Status | "all")}>
      {statuses.map(status => <option key={status} value={status}>{statusNames[status]}</option>)}<option value="all">All decisions</option>
    </select></label><span role="status">{rows.length} {filter === "pending" ? "awaiting review" : "in this view"}</span><button className="btn btn--sm" disabled={actionBusy || loading} onClick={() => void load()}>Refresh suggestions</button></div>
    {(correctionDrafts.dirty || correctionDrafts.error || correctionDrafts.conflict) && <DraftStatus {...correctionDrafts} onUseSaved={correctionDrafts.session.useSaved} onKeepDraft={correctionDrafts.session.keepDraft} />}
    {error && <p role="alert">{error}</p>}
    {loading && !suggestions.length ? <p role="status">Loading suggestions…</p> : !rows.length ? <p className="memory-inbox__empty">{filter === "pending" ? "No suggestions need review. Scan the manuscript to find possible entries; an empty inbox is not proof that Memory is complete." : "No suggestions in this view. Choose another filter to revisit a decision."}</p> : <div className="memory-inbox__layout">
      <nav className="memory-inbox__list" aria-label="Suggestions to review" aria-describedby={`${listId}-help`}>
        <p id={`${listId}-help`}>Use ↑ and ↓ to review the next passage. Home and End jump to the first and last suggestion.</p>
        {rows.map((row, index) => <button key={row.id} ref={node => { if (node) buttonRefs.current.set(row.id, node); else buttonRefs.current.delete(row.id); }} className={`btn memory-inbox__row${selected?.id === row.id ? " is-selected" : ""}`} aria-pressed={selected?.id === row.id} tabIndex={selected?.id === row.id ? 0 : -1} onKeyDown={event => navigate(event, index)} onClick={() => setSelectedId(row.id)}><strong>{row.name}</strong><span>{kindNames[row.kind]} · {row.evidence.length} sources</span>{correctionDrafts.value[row.id] && <span>Unfinished correction</span>}</button>)}
      </nav>
      {selected && <article className="memory-inbox__detail" aria-label={`Review ${selected.name}`}>
        <div className="memory-inbox__body" tabIndex={0} role="region" aria-label="Suggestion and source passages">
          <p className="memory-inbox__status">{kindNames[selected.kind]} · {statusNames[selected.status]}</p><h2>{selected.name}</h2>
          {selected.kind === "entity_create" && <p>Proposed {selected.entity_type || "story"} entry</p>}
          {typeNeedsConfirmation && <p role="alert">This entry's type is uncertain{selected.type_candidates?.length ? ` (${selected.type_candidates.join(", ")})` : ""}. Choose Correct, review the Entry type and Save correction before accepting.</p>}
          <p className="memory-inbox__statement">{selected.kind === "canon_fact" ? `${selected.subject_name || selected.name} · ${selected.predicate}: ${selected.value}` : selected.description}</p>
          {selected.reason && <p>{selected.reason}</p>}
          {decidable && !hasCurrentVersion && <p role="alert">This suggestion has no current review version. Refresh suggestions before making a decision.</p>}
          {correction && !decidable && <p role="alert">This suggestion was {statusNames[selected.status].toLowerCase()} while your correction was unfinished. Your draft is kept for reference; it cannot change the recorded decision.</p>}
          <h3>Recorded evidence</h3><p>Open a source to compare this suggestion with the current manuscript.</p>
          {selected.evidence.length ? <EvidencePassages evidence={selected.evidence} /> : <p>No manuscript passage was recorded. Treat this as an idea to verify before adding it to Memory.</p>}
          {correction && <fieldset disabled={actionBusy || !decidable} className="memory-inbox__correction"><legend>Correct this suggestion</legend><label>Name<input className="input" aria-label="Corrected suggestion name" value={correction.name} onChange={event => changeCorrection({ name: event.target.value })} /></label>{selected.kind === "entity_create" && <label>Entry type<select className="select" aria-label="Corrected Memory entry type" value={correction.entityType} onChange={event => changeCorrection({ entityType: event.target.value as CodexEntity["type"] })}>{entityTypes.map(type => <option key={type} value={type}>{type}</option>)}</select></label>}{selected.kind === "canon_fact" && <label>Fact predicate<input className="input" aria-label="Corrected fact predicate" value={correction.predicate} onChange={event => changeCorrection({ predicate: event.target.value })} /></label>}<label>{selected.kind === "canon_fact" ? "Fact value" : "Description or note"}<textarea className="input" rows={4} aria-label="Corrected suggestion detail" value={correction.detail} onChange={event => changeCorrection({ detail: event.target.value })} /></label>{decidable && <p>This correction stays unconfirmed until you accept the suggestion.</p>}{correctionStale && decidable && <div role="alert"><p>The saved suggestion or evidence changed. Your correction keeps its original review version. Compare the current suggestion and source passages above before saving.</p><button className="btn" disabled={actionBusy || !hasCurrentVersion} onClick={() => changeCorrection({ reviewVersion: selected.review_version! })}>I reviewed updated evidence; keep my correction</button></div>}</fieldset>}
        </div>
        <footer className="memory-inbox__actions" aria-label="Suggestion decisions">
          {correction && <><button className="btn btn--primary" disabled={actionBusy || loading || !decidable || !hasCurrentVersion || correctionStale || !correction.name.trim() || selected.kind === "canon_fact" && (!correction.detail.trim() || !correction.predicate.trim())} onClick={saveCorrection}>Save correction</button><button className="btn" disabled={actionBusy} onClick={() => discardCorrection(selected.id)}>Cancel correction</button></>}
          <div role="group" aria-label="Memory review actions"><button className="btn btn--primary" disabled={actionBusy || loading || !decidable || !hasCurrentVersion || Boolean(correction) || typeNeedsConfirmation} onClick={() => decide("accepted")}>Accept</button><button className="btn" disabled={actionBusy || loading || !decidable || !hasCurrentVersion || Boolean(correction)} onClick={startCorrection}>Correct</button><button className="btn" disabled={actionBusy || loading || !decidable || !hasCurrentVersion || Boolean(correction)} onClick={() => decide("deferred")}>Later</button><button className="btn btn--ghost" disabled={actionBusy || loading || !decidable || !hasCurrentVersion || Boolean(correction)} onClick={() => decide("rejected")}>Reject</button></div>
          <small>{decidable ? "Only Accept adds this reviewed suggestion to Story Memory." : `Decision recorded: ${statusNames[selected.status]}.`}</small>
        </footer>
      </article>}
    </div>}</>}
  </section>;
}
