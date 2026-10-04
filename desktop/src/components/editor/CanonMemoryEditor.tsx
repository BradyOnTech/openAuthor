import { useEffect, useRef, useState } from "react";
import {
  addCanonFact,
  addNarrativeSetup,
  addOpenQuestion,
  disposeCanonDiagnostic,
  listCanonFacts,
  listNarrativeSetups,
  listOpenQuestions,
  resolveNarrativeSetup,
  runCanonDiagnostics,
  listCharacterArcStates,
  addCharacterArcState,
  getScene,
} from "../../api";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useEditor } from "../../contexts/EditorContext";
import type { CanonDiagnostic, CanonEvidence, CanonFact, CharacterArcState, NarrativeSetup, OpenQuestion, SceneSummary } from "../../types";
import { ContinuityReview } from "./ContinuityReview";
import { CanonFactCard } from "./CanonFactCard";
import { flushProjectSceneSaves } from "../../sceneSaveSession";
import { EvidencePassages } from "../shared/EvidencePassages";
import { CanonFactReview } from "./CanonFactReview";
import { useRecoverableDraft } from "../../recoverableDraft";
import { DraftStatus } from "../shared/DraftStatus";


function validForms(value: unknown): value is Record<string, string> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.values(value).every(item => typeof item === "string");
}

export function CanonMemoryEditor() {
  const { projectRoot, branches, scenes, codexEntities, setError, setMessage } = useWorkspace();
  const { tabs, setActiveTab, beginNavigation, openTab, updateTab } = useEditor();
  const branch = branches?.find(row => row.current)?.name || "main";
  const forms = useRecoverableDraft<Record<string, string>>(`openauthor.canonForms.v1:${JSON.stringify([projectRoot, branch])}`, {}, validForms);
  const changeForm = (key: string, value: string) => {
    const next = { ...forms.session.getSnapshot().value, [key]: value };
    if (!value) delete next[key];
    forms.session.edit(next);
  };
  const [facts, setFacts] = useState<CanonFact[]>([]);
  const [factFilter, setFactFilter] = useState("accepted");
  const [setups, setSetups] = useState<NarrativeSetup[]>([]);
  const [questions, setQuestions] = useState<OpenQuestion[]>([]);
  const [diagnostics, setDiagnostics] = useState<CanonDiagnostic[]>([]);
  const [arcStates, setArcStates] = useState<CharacterArcState[]>([]);
  const { subjectId = "", predicate = "", value = "", sceneId = scenes[0]?.id ?? "", excerpt = "", validFrom = "", validTo = "", setupText = "", questionText = "", arcCharacter = "", arcDimension = "", arcValue = "" } = forms.value;
  const arcType = forms.value.arcType === "planned" ? "planned" : "observed";
  const setSubjectId = (value: string) => changeForm("subjectId", value);
  const setPredicate = (value: string) => changeForm("predicate", value);
  const setValue = (value: string) => changeForm("value", value);
  const setSceneId = (value: string) => changeForm("sceneId", value);
  const setExcerpt = (value: string) => changeForm("excerpt", value);
  const setValidFrom = (value: string) => changeForm("validFrom", value);
  const setValidTo = (value: string) => changeForm("validTo", value);
  const setSetupText = (value: string) => changeForm("setupText", value);
  const setQuestionText = (value: string) => changeForm("questionText", value);
  const setArcCharacter = (value: string) => changeForm("arcCharacter", value);
  const setArcDimension = (value: string) => changeForm("arcDimension", value);
  const setArcValue = (value: string) => changeForm("arcValue", value);
  const setArcType = (value: string) => changeForm("arcType", value);
  const [busy, setBusy] = useState(false);
  const mutationPending = useRef(false);
  const loadSequence = useRef(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => { void load(); return () => { ++loadSequence.current; }; }, [projectRoot, branch]);

  async function load() {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError("");
    try {
      if (!await flushProjectSceneSaves(projectRoot)) throw new Error("Save your pending writing before running diagnostics.");
      const [nextFacts, nextSetups, nextQuestions, nextArcStates, report] = await Promise.all([
        listCanonFacts(projectRoot), listNarrativeSetups(projectRoot), listOpenQuestions(projectRoot), listCharacterArcStates(projectRoot), runCanonDiagnostics(projectRoot),
      ]);
      if (sequence !== loadSequence.current) return;
      setFacts(nextFacts); setSetups(nextSetups); setQuestions(nextQuestions); setArcStates(nextArcStates); setDiagnostics(report.diagnostics);
    } catch (error) {
      if (sequence === loadSequence.current) setLoadError(`Failed to load Canon Memory: ${error instanceof Error ? error.message : String(error)}`);
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }

  async function mutate(action: () => Promise<unknown>, message: string, clearFields: string[] = []) {
    if (mutationPending.current) return;
    mutationPending.current = true;
    const submitted = forms.session.getSnapshot().value;
    setBusy(true);
    try {
      if (!await flushProjectSceneSaves(projectRoot)) throw new Error("Save pending manuscript writing before updating Canon.");
      await action();
      forms.session.amend(current => {
        const next = { ...current };
        for (const field of clearFields) if (current[field] === submitted[field]) delete next[field];
        return next;
      });
      setError("");
      await load();
      setMessage(message);
    }
    catch (error) { setError(`Canon Memory update failed: ${error instanceof Error ? error.message : String(error)}`); }
    finally { mutationPending.current = false; setBusy(false); }
  }

  async function openScene(scene: SceneSummary, evidence?: CanonEvidence) {
    const tabId = `scene:${scene.id}`;
    if (tabs.some((tab) => tab.id === tabId)) { if (evidence) updateTab(tabId, { focusPassage: evidence }); setActiveTab(tabId); return; }
    const isCurrent = beginNavigation();
    try {
      const detail = await getScene(projectRoot, scene.id);
      if (isCurrent()) openTab({ id: tabId, kind: "scene", label: detail.title, data: detail, focusPassage: evidence });
    } catch (error) {
      if (isCurrent()) setError(`Failed to open evidence scene: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const entityName = (id: string) => codexEntities.find((row) => row.id === id)?.name || "Story";
  return (
    <div className="canon-memory-editor" style={{ height: "100%", overflow: "auto", background: "var(--bg-deep)" }}>
      <div style={{ maxWidth: 1440, margin: "0 auto", padding: "var(--space-6)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", marginBottom: "var(--space-5)" }}>
          <div><div style={eyebrow}>Evidence-backed story truth</div><h1 style={pageTitle}>Canon & Continuity</h1></div>
          <button className="btn" disabled={busy || loading} onClick={() => void load()}>{loading ? "Checking…" : "Run Diagnostics"}</button>
        </div>
        <p style={{ ...valueStyle, marginBottom: 16 }}>Local checks compare recorded Canon, knowledge, setups and arcs, plus a limited set of English and Spanish physical descriptions and explicit changes. Not a comprehensive plot, timeline, motivation or prose-quality analysis. Warnings need author review; an empty result is not proof of consistency.</p>
        <DraftStatus {...forms} onUseSaved={forms.session.useSaved} onKeepDraft={forms.session.keepDraft} />
        {forms.dirty && <button className="btn" style={{ minHeight: 40, marginBottom: 16 }} disabled={busy} onClick={forms.session.useSaved}>Clear unfinished forms</button>}

        {loadError && <p role="alert">{loadError} Use Run Diagnostics to retry.</p>}

          {loading && !diagnostics.length ? <p role="status">Checking continuity…</p> : !loadError && <ContinuityReview diagnostics={diagnostics} scenes={scenes} busy={busy || loading} onOpenEvidence={(scene, evidence) => void openScene(scene, evidence)} onOpenScene={(scene) => void openScene(scene)} onRevise={(diagnostic, targetId, instruction) => {
            openTab({ id: `generate:continuity:${diagnostic.id}`, kind: "generate", label: "Revise continuity", data: { sceneId: targetId, instruction } });
          }} onReview={(id, disposition, notes) => void mutate(() => disposeCanonDiagnostic(projectRoot, id, disposition, notes), "Continuity review saved.")} />}
        <details className="canon-records" style={{ marginTop: 24 }}><summary>Add or update story records</summary>
        <section style={panelStyle}>
          <h2 style={sectionTitle}>Add Canon Fact</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.5fr", gap: 8 }}>
            <select className="select" aria-label="Fact subject" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}><option value="">Story-wide fact</option>{codexEntities.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
            <input className="input" aria-label="Fact predicate" placeholder="role, location, color…" value={predicate} onChange={(event) => setPredicate(event.target.value)} />
            <input className="input" aria-label="Fact value" placeholder="What is true?" value={value} onChange={(event) => setValue(event.target.value)} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8, marginTop: 8 }}>
            <select className="select" aria-label="Evidence scene" value={sceneId} onChange={(event) => setSceneId(event.target.value)}>{scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</select>
            <input className="input" aria-label="Evidence excerpt" placeholder="Exact supporting passage" value={excerpt} onChange={(event) => setExcerpt(event.target.value)} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, marginTop: 8 }}>
            <select className="select" aria-label="Valid from" value={validFrom} onChange={(event) => setValidFrom(event.target.value)}><option value="">True from beginning</option>{scenes.map((scene) => <option key={scene.id} value={scene.id}>From {scene.title}</option>)}</select>
            <select className="select" aria-label="Valid to" value={validTo} onChange={(event) => setValidTo(event.target.value)}><option value="">Remains true</option>{scenes.map((scene) => <option key={scene.id} value={scene.id}>Until {scene.title}</option>)}</select>
            <button className="btn btn--primary" disabled={busy || !predicate.trim() || !value.trim() || !sceneId || !excerpt.trim()} onClick={() => void mutate(() => addCanonFact(projectRoot, { subjectId, predicate, value, sceneId, excerpt, validFrom, validTo }), "Canon Fact added.", ["predicate", "value"])}>Add Fact</button>
          </div>
        </section>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)", marginTop: "var(--space-4)" }}>
          <section aria-label="Canon Facts" style={panelStyle}>
            <h2 style={sectionTitle}>Canon Facts <span style={countStyle}>{facts.filter((fact) => fact.status === "accepted").length} accepted</span></h2>
            <select className="select" aria-label="Filter Canon Facts" value={factFilter} onChange={(event) => setFactFilter(event.target.value)}>
              <option value="accepted">Accepted canon</option><option value="suggested">Needs review</option><option value="rejected">Withdrawn</option><option value="all">All facts</option>
            </select>
            {!facts.some((fact) => factFilter === "all" || fact.status === factFilter) && <p style={metaStyle}>No facts in this view.</p>}
            {facts.map((fact) => <div key={fact.id} hidden={factFilter !== "all" && fact.status !== factFilter}>
              <CanonFactCard fact={fact} subjectName={entityName(fact.subject_entity_id)} scenes={scenes} projectRoot={projectRoot} branch={branches?.find(row => row.current)?.name ?? ""} disabled={busy || loading || Boolean(loadError)} onOpenScene={(scene) => void openScene(scene)} onSaved={(updated) => {
                setFacts((rows) => rows.map((row) => row.id === updated.id ? updated : row));
                setMessage(updated.status === "rejected" ? "Fact withdrawn. Its text and evidence are kept under Withdrawn." : "Canon Fact corrected.");
                void load();
              }} />
              <CanonFactReview fact={fact} onUpdated={load} />
            </div>)}
          </section>

        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)", marginTop: "var(--space-4)" }}>
          <section style={panelStyle}><h2 style={sectionTitle}>Setups & Payoffs</h2><div style={{ display: "flex", gap: 8 }}><input className="input" aria-label="Narrative setup" placeholder="Narrative promise or planted detail" value={setupText} onChange={(event) => setSetupText(event.target.value)} /><button className="btn" disabled={busy || !setupText.trim() || !sceneId || !excerpt.trim()} onClick={() => void mutate(() => addNarrativeSetup(projectRoot, setupText, sceneId, excerpt), "Setup tracked.", ["setupText"])}>Track</button></div>{setups.map((setup) => <article key={setup.id} style={rowStyle}><strong>{setup.description}</strong><div style={metaStyle}>{setup.status === "paid_off" ? "Paid off" : `Open since ${setup.setup_evidence.scene_id}`}</div>{setup.status === "open" && <button className="btn btn--sm" style={{ marginTop: 6 }} disabled={busy || !sceneId || !excerpt.trim()} onClick={() => void mutate(() => resolveNarrativeSetup(projectRoot, setup.id, sceneId, excerpt), "Payoff linked.")}>Use current evidence as payoff</button>}</article>)}</section>
          <section style={panelStyle}><h2 style={sectionTitle}>Open Questions</h2><div style={{ display: "flex", gap: 8 }}><input className="input" aria-label="Open question" placeholder="What should remain unresolved?" value={questionText} onChange={(event) => setQuestionText(event.target.value)} /><button className="btn" disabled={busy || !questionText.trim()} onClick={() => void mutate(() => addOpenQuestion(projectRoot, questionText, sceneId, true), "Open Question tracked.", ["questionText"])}>Track</button></div>{questions.map((question) => <article key={question.id} style={rowStyle}><strong>{question.question}</strong><div style={metaStyle}>{question.status.replace(/_/g, " ")}</div></article>)}</section>
        </div>

        <section style={{ ...panelStyle, marginTop: "var(--space-4)" }}>
          <h2 style={sectionTitle}>Character Arcs <span style={countStyle}>{arcStates.length}</span></h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)" }}>Track how a character’s belief, desire, relationship, or self-image changes through manuscript evidence. Planned and observed states can diverge without silently rewriting canon.</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 120px auto", gap: 8 }}>
            <select className="select" aria-label="Arc character" value={arcCharacter} onChange={(event) => setArcCharacter(event.target.value)}><option value="">Character…</option>{codexEntities.filter((row) => row.type === "character").map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
            <input className="input" aria-label="Arc dimension" placeholder="belief, trust, desire…" value={arcDimension} onChange={(event) => setArcDimension(event.target.value)} />
            <input className="input" aria-label="Arc state" placeholder="What is true here?" value={arcValue} onChange={(event) => setArcValue(event.target.value)} />
            <select className="select" aria-label="Arc state type" value={arcType} onChange={(event) => setArcType(event.target.value as typeof arcType)}><option value="observed">Observed</option><option value="planned">Planned</option></select>
            <button className="btn" disabled={busy || !arcCharacter || !arcDimension.trim() || !arcValue.trim() || !sceneId || !excerpt.trim()} onClick={() => void mutate(() => addCharacterArcState(projectRoot, { characterId: arcCharacter, dimension: arcDimension, value: arcValue, sceneId, excerpt, stateType: arcType }), "Character Arc State added.", ["arcDimension", "arcValue"])}>Add State</button>
          </div>
          {arcStates.map((state) => <article key={state.id} style={rowStyle}><strong>{entityName(state.character_entity_id)} · {state.dimension}</strong><div style={valueStyle}>{state.value}</div><div style={metaStyle}>{state.state_type} in {scenes.find((row) => row.id === state.scene_id)?.title ?? state.scene_id}</div></article>)}
        </section>
        </details>
      </div>
    </div>
  );
}

const panelStyle = { padding: "var(--space-4)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", background: "var(--bg-surface)" } as const;
const eyebrow = { color: "var(--text-tertiary)", fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: ".1em" } as const;
const pageTitle = { color: "var(--text-primary)", fontFamily: "var(--font-prose)", fontWeight: 500, margin: "4px 0 0" } as const;
const sectionTitle = { color: "var(--text-primary)", fontSize: "var(--text-lg)", margin: "0 0 var(--space-3)" } as const;
const countStyle = { color: "var(--text-tertiary)", fontSize: "var(--text-xs)", fontWeight: 400 } as const;
const rowStyle = { padding: "var(--space-3)", marginTop: 8, border: "1px solid var(--border)", borderRadius: "var(--radius-md)", color: "var(--text-primary)" } as const;
const valueStyle = { color: "var(--text-secondary)", fontSize: "var(--text-sm)", marginTop: 4, lineHeight: 1.45 } as const;
const metaStyle = { color: "var(--text-tertiary)", fontSize: "var(--text-xs)", marginTop: 5 } as const;
